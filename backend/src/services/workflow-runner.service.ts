/**
 * Exécution d'un workflow. Notre serveur orchestre, SpicyAPI exécute chaque étape :
 * les nœuds payants sont lancés dans l'ordre de leurs dépendances (les branches
 * indépendantes en même temps), chaque nœud reçoit le résultat actif de ses entrées.
 * Un nœud en échec bloque ceux qui en dépendent, le reste continue.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { HTTPException } from 'hono/http-exception';
import {
  WORKFLOW_NODES,
  generationPlan,
  graphErrors,
  applyInputs,
  finalNodeIds,
  normalizeGraph,
  templateInputs,
  paidSources,
  threadUsableError,
  workflowInputs,
  runOrder,
  staticOutput,
  textPlan,
  type Generation,
  type PortValue,
  type WorkflowGraph,
  type WorkflowNodeResult,
  type WorkflowQuoteResponse,
  type WorkflowRun,
  type WorkflowRunInput,
  type WorkflowRunRequest,
  type WorkflowRunStartResponse,
  type ThreadWorkflowRun,
  type WorkflowStateResponse,
} from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, generations, personas, threads, users, workflowNodeResults, workflowRuns, workflows } from '../db/schema.js';
import { env } from '../env.js';
import type { SessionUser } from '../types.js';
import { createWorkflowGeneration, loadGenerations, quoteWorkflowGeneration } from './generation.service.js';
import { estimateChat, runChat, SYSTEM_PROMPTS } from './chat.service.js';
import { toAsset } from './serialize.js';

type ResultRow = typeof workflowNodeResults.$inferSelect;
type RunRow = typeof workflowRuns.$inferSelect;

/** Marge tolérée au-dessus du devis confirmé (20 %). */
const COST_MARGIN = 1.2;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const isTextNode = (graph: WorkflowGraph, nodeId: string) => {
  const type = graph.nodes.find(n => n.id === nodeId)?.type;
  return type === 'describe' || type === 'llm';
};

const label = (graph: WorkflowGraph, nodeId: string) => {
  const node = graph.nodes.find(n => n.id === nodeId);
  return node ? WORKFLOW_NODES[node.type].label : nodeId;
};

async function findWorkflow(userId: string, workflowId: string) {
  const [row] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId), isNull(workflows.deletedAt)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: 'Workflow introuvable.' });
  return row;
}

function assertValidGraph(graph: WorkflowGraph) {
  const errors = graphErrors(graph);
  if (errors.length) throw new HTTPException(400, { message: errors[0] });
}

/**
 * Résultat actif d'un nœud : celui choisi dans le nœud (`activeResultId`), sinon le
 * dernier réussi. Ses médias servent d'entrée aux nœuds suivants.
 */
async function activeOutputs(workflowId: string, graph: WorkflowGraph, nodeIds: string[]): Promise<Map<string, PortValue>> {
  const out = new Map<string, PortValue>();
  if (!nodeIds.length) return out;
  const rows = await db
    .select({ r: workflowNodeResults, assetId: assets.id })
    .from(workflowNodeResults)
    .leftJoin(assets, eq(assets.generationId, workflowNodeResults.generationId))
    .where(
      and(
        eq(workflowNodeResults.workflowId, workflowId),
        inArray(workflowNodeResults.nodeId, nodeIds),
        eq(workflowNodeResults.status, 'succeeded'),
      ),
    )
    .orderBy(desc(workflowNodeResults.createdAt), assets.createdAt);
  const byResult = new Map<string, { r: ResultRow; assetIds: string[] }>();
  for (const { r, assetId } of rows) {
    const entry = byResult.get(r.id) ?? { r, assetIds: [] };
    if (assetId) entry.assetIds.push(assetId);
    byResult.set(r.id, entry);
  }
  for (const nodeId of nodeIds) {
    const chosen = graph.nodes.find(n => n.id === nodeId)?.data.activeResultId;
    const list = [...byResult.values()].filter(e => e.r.nodeId === nodeId);
    const pick = list.find(e => e.r.id === chosen) ?? list[0];
    if (pick) out.set(nodeId, pick.r.text !== null ? { text: pick.r.text } : { assetIds: pick.assetIds });
  }
  return out;
}

/** Image neutre fournie avec l'app (512 × 512, gris). */
const STAND_IN_PATH = fileURLToPath(new URL('../../static/stand-in.png', import.meta.url));

/**
 * Image servant seulement à chiffrer une étape dont l'image d'entrée n'existe pas encore :
 * une image de l'utilisateur, sinon l'image neutre de l'app (enregistrée une fois pour lui,
 * invisible : ni résultat, ni référence).
 */
async function standInImage(userId: string): Promise<string> {
  const [row] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.userId, userId), eq(assets.mediaType, 'image')))
    .orderBy(desc(assets.createdAt))
    .limit(1);
  if (row) return row.id;
  const [created] = await db
    .insert(assets)
    .values({ userId, kind: 'upload', mediaType: 'image', mime: 'image/png', filePath: STAND_IN_PATH, bytes: 1487, width: 512, height: 512 })
    .returning({ id: assets.id });
  return created.id;
}

/** Nœuds payants hors de l'exécution dont elle dépend : ils doivent déjà avoir un résultat. */
function outsideSources(graph: WorkflowGraph, order: string[]) {
  const inRun = new Set(order);
  return [...new Set(order.flatMap(id => paidSources(graph, id)))].filter(id => !inRun.has(id));
}

// ── Devis ─────────────────────────────────────────────────────

export async function quoteRun(user: SessionUser, workflowId: string, graph: WorkflowGraph, nodeIds?: string[]): Promise<WorkflowQuoteResponse> {
  await findWorkflow(user.id, workflowId);
  assertValidGraph(graph);
  const order = runOrder(graph, nodeIds);
  if (!order.length) throw new HTTPException(400, { message: 'Aucune étape à lancer : ajoute un nœud de génération.' });

  const outside = outsideSources(graph, order);
  const known = await activeOutputs(workflowId, graph, outside);
  for (const id of outside) {
    if (!known.has(id)) throw new HTTPException(400, { message: `Lance d’abord « ${label(graph, id)} » : son résultat sert d’entrée.` });
  }
  // Étapes pas encore produites : chiffrées avec une image de remplacement (le prix dépend
  // du modèle et des réglages, pas du contenu de l'image).
  const stand = await standInImage(user.id);
  const pending: PortValue = { assetIds: [stand], text: 'prompt' };
  const valueOf = (id: string, port: string) =>
    staticOutput(graph.nodes.find(n => n.id === id)!, port) ?? known.get(id) ?? (order.includes(id) ? pending : null);

  const nodes: WorkflowQuoteResponse['nodes'] = [];
  for (const nodeId of order) {
    if (isTextNode(graph, nodeId)) {
      const t = textPlan(graph, nodeId, valueOf);
      if (!t.ok) throw new HTTPException(400, { message: `« ${label(graph, nodeId)} » : ${t.reason}` });
      nodes.push({ nodeId, task: 'text', estimatedCost: await estimateChat(user.id, { ...t.plan, system: SYSTEM_PROMPTS[t.plan.kind] }) });
      continue;
    }
    const r = generationPlan(graph, nodeId, valueOf);
    if (!r.ok) throw new HTTPException(400, { message: `« ${label(graph, nodeId)} » : ${r.reason}` });
    const q = await quoteWorkflowGeneration(user, { ...r.plan, threadId: null }).catch((err: unknown) => {
      const message = err instanceof HTTPException ? err.message : 'devis impossible.';
      throw new HTTPException(400, { message: `« ${label(graph, nodeId)} » : ${message}` });
    });
    nodes.push({ nodeId, task: q.task, estimatedCost: q.estimatedCost });
  }
  const total = nodes.reduce((s, n) => s + Number(n.estimatedCost), 0);
  return { estimatedCost: String(Number(total.toFixed(6))), nodes };
}

// ── Lancement ─────────────────────────────────────────────────

/**
 * Graphe à exécuter : celui de l'éditeur (`graph`), ou, depuis un fil, le workflow
 * enregistré avec les valeurs saisies (`inputs`), sans le modifier.
 */
export async function resolveRunGraph(
  userId: string,
  saved: WorkflowGraph,
  req: Pick<WorkflowRunRequest, 'graph' | 'inputs' | 'thread'>,
): Promise<WorkflowGraph> {
  if (req.inputs === undefined && !req.thread) {
    if (!req.graph) throw new HTTPException(400, { message: 'Graphe manquant.' });
    assertValidGraph(req.graph);
    return req.graph;
  }
  const base = normalizeGraph(saved);
  const unusable = threadUsableError(base);
  if (unusable) throw new HTTPException(400, { message: unusable });
  const applied = applyInputs(base, req.inputs ?? {});
  if (!applied.ok) throw new HTTPException(400, { message: applied.reason });
  // Images saisies : seulement celles du compte.
  const ids = [...new Set(Object.values(req.inputs ?? {}).flatMap(v => v.assetIds ?? []))];
  if (ids.length) {
    const owned = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.userId, userId), inArray(assets.id, ids)));
    if (owned.length !== ids.length) throw new HTTPException(400, { message: 'Image introuvable.' });
  }
  return applied.graph;
}

/**
 * Graphe chiffré pour le formulaire d'un fil, avant toute saisie : valeurs types (cf.
 * templateInputs). Le prix est le même quelles que soient les valeurs remplies.
 */
export async function templateRunGraph(userId: string, saved: WorkflowGraph): Promise<WorkflowGraph> {
  const base = normalizeGraph(saved);
  const unusable = threadUsableError(base);
  if (unusable) throw new HTTPException(400, { message: unusable });
  const applied = applyInputs(base, templateInputs(base, await standInImage(userId)));
  if (!applied.ok) throw new HTTPException(400, { message: applied.reason });
  return applied.graph;
}

export async function startRun(user: SessionUser, workflowId: string, req: WorkflowRunRequest): Promise<WorkflowRunStartResponse> {
  const workflow = await findWorkflow(user.id, workflowId);
  const graph = await resolveRunGraph(user.id, workflow.graph, req);
  const [running] = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.status, 'running')))
    .limit(1);
  if (running) throw new HTTPException(409, { message: 'Une exécution est déjà en cours.' });

  // Depuis l'éditeur, le graphe affiché fait foi : enregistré avant le lancement.
  if (req.graph && !req.thread) {
    await db.update(workflows).set({ graph: req.graph, updatedAt: new Date() }).where(eq(workflows.id, workflow.id));
  }
  const quote = await quoteRun(user, workflowId, graph, req.nodeIds);
  const confirmed = req.expectedCost !== undefined ? Number(req.expectedCost) : Number(quote.estimatedCost);

  // Depuis un fil : ce fil (vérifié), ou un nouveau fil au nom du workflow.
  let threadId: string | null = null;
  if (req.thread) {
    if (req.thread.id) {
      const [t] = await db
        .select({ id: threads.id })
        .from(threads)
        .where(and(eq(threads.id, req.thread.id), eq(threads.userId, user.id), isNull(threads.deletedAt)))
        .limit(1);
      if (!t) throw new HTTPException(404, { message: 'Fil introuvable.' });
      threadId = t.id;
    } else {
      const personaId = req.thread.personaId
        ? ((
            await db
              .select({ id: personas.id })
              .from(personas)
              .where(and(eq(personas.id, req.thread.personaId), eq(personas.userId, user.id), isNull(personas.deletedAt)))
              .limit(1)
          )[0]?.id ?? null)
        : null;
      const [t] = await db.insert(threads).values({ userId: user.id, personaId, title: workflow.name }).returning({ id: threads.id });
      threadId = t.id;
    }
    await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId));
  }
  // Valeurs saisies, pour la bulle du fil.
  const inputs: WorkflowRunInput[] = req.thread
    ? workflowInputs(graph).map(i => ({
        nodeId: i.nodeId,
        label: i.label,
        ...(i.kind === 'text' ? { text: i.defaultText } : { assetIds: i.defaultAssetIds }),
      }))
    : [];

  const order = quote.nodes.map(n => n.nodeId);
  const [run] = await db
    .insert(workflowRuns)
    .values({ workflowId, userId: user.id, nodeIds: order, graph, estimatedCost: String(confirmed), threadId, inputs })
    .returning();
  await db.insert(workflowNodeResults).values(order.map(nodeId => ({ runId: run.id, workflowId, nodeId })));
  void executeRun(run.id);
  return { ...(await getState(user.id, workflowId)), threadId };
}

/** Attend la fin d'une génération (suivie en arrière-plan par le service de génération). */
async function waitGeneration(generationId: string): Promise<typeof generations.$inferSelect> {
  const started = Date.now();
  for (;;) {
    const [row] = await db.select().from(generations).where(eq(generations.id, generationId)).limit(1);
    if (!row || row.status === 'succeeded' || row.status === 'failed') return row;
    if (Date.now() - started > 3 * 60 * 60 * 1000) return { ...row, status: 'failed', errorMessage: 'Suivi interrompu : la tâche est trop longue.' };
    await sleep(env.NODE_ENV === 'test' ? 100 : 1000);
  }
}

async function finishResult(id: string, set: Partial<typeof workflowNodeResults.$inferInsert>) {
  await db
    .update(workflowNodeResults)
    .set({ ...set, completedAt: new Date() })
    .where(eq(workflowNodeResults.id, id));
}

/** Exécute (ou reprend après un redémarrage) une exécution. */
export async function executeRun(runId: string): Promise<void> {
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
  if (!run || run.status !== 'running') return;
  const [user] = await db.select().from(users).where(eq(users.id, run.userId)).limit(1);
  const graph = normalizeGraph(run.graph);
  const results = new Map(
    (await db.select().from(workflowNodeResults).where(eq(workflowNodeResults.runId, runId))).map(r => [r.nodeId, r]),
  );
  const outputs = await activeOutputs(run.workflowId, graph, outsideSources(graph, run.nodeIds));
  const cap = Number(run.estimatedCost ?? 0) * COST_MARGIN;
  let spent = 0;
  const valueOf = (id: string, port: string) =>
    staticOutput(graph.nodes.find(n => n.id === id)!, port) ?? outputs.get(id) ?? null;

  const assetIdsOf = async (generationId: string) =>
    (await db.select({ id: assets.id }).from(assets).where(eq(assets.generationId, generationId)).orderBy(assets.createdAt)).map(
      a => a.id,
    );

  /** Nœud de texte IA : un appel au modèle de texte, le texte produit part aux nœuds suivants. */
  async function runTextNode(nodeId: string) {
    const result = results.get(nodeId)!;
    if (await isStopped(runId)) return;
    try {
      const t = textPlan(graph, nodeId, valueOf);
      if (!t.ok) {
        await finishResult(result.id, { status: 'failed', errorMessage: t.reason });
        results.set(nodeId, { ...result, status: 'failed' });
        return;
      }
      await db.update(workflowNodeResults).set({ status: 'running' }).where(eq(workflowNodeResults.id, result.id));
      const request = { ...t.plan, system: SYSTEM_PROMPTS[t.plan.kind] };
      const estimate = Number(await estimateChat(run.userId, request));
      if (estimate > Math.max(0, cap - spent) + 1e-9) {
        throw new HTTPException(402, { message: 'Le coût dépasse le devis confirmé : exécution arrêtée.' });
      }
      const out = await runChat(run.userId, request);
      spent += Number(out.cost ?? estimate);
      outputs.set(nodeId, { text: out.text });
      await finishResult(result.id, { status: 'succeeded', text: out.text, cost: out.cost ?? String(estimate) });
      results.set(nodeId, { ...result, status: 'succeeded' });
    } catch (err) {
      const message = err instanceof HTTPException ? err.message : (err as Error).message;
      await finishResult(result.id, { status: 'failed', errorMessage: message });
      results.set(nodeId, { ...result, status: 'failed' });
    }
  }

  async function runNode(nodeId: string) {
    if (isTextNode(graph, nodeId)) return runTextNode(nodeId);
    const result = results.get(nodeId)!;
    // Arrêt demandé entre-temps : la génération ne part pas (une déjà lancée va au bout).
    if (!result.generationId && (await isStopped(runId))) return;
    try {
      let generationId = result.generationId;
      if (!generationId) {
        const r = generationPlan(graph, nodeId, valueOf);
        if (!r.ok) {
          await finishResult(result.id, { status: 'failed', errorMessage: r.reason });
          results.set(nodeId, { ...result, status: 'failed' });
          return;
        }
        await db.update(workflowNodeResults).set({ status: 'running' }).where(eq(workflowNodeResults.id, result.id));
        const generation: Generation = await createWorkflowGeneration(
          user,
          { ...r.plan, threadId: null },
          { workflowId: run.workflowId, nodeId },
          Math.max(0, cap - spent),
        );
        spent += Number(generation.estimatedCost ?? 0);
        generationId = generation.id;
        await db.update(workflowNodeResults).set({ generationId }).where(eq(workflowNodeResults.id, result.id));
      }
      const done = await waitGeneration(generationId);
      if (done?.status === 'succeeded') {
        outputs.set(nodeId, { assetIds: await assetIdsOf(generationId) });
        await finishResult(result.id, { status: 'succeeded', cost: done.cost ?? done.estimatedCost });
        results.set(nodeId, { ...result, status: 'succeeded' });
      } else {
        await finishResult(result.id, { status: 'failed', errorMessage: done?.errorMessage ?? 'La génération a échoué.', cost: done?.cost ?? null });
        results.set(nodeId, { ...result, status: 'failed' });
      }
    } catch (err) {
      const message = err instanceof HTTPException ? err.message : (err as Error).message;
      await finishResult(result.id, { status: 'failed', errorMessage: message });
      results.set(nodeId, { ...result, status: 'failed' });
    }
  }

  try {
    for (;;) {
      // Arrêtée par l'utilisateur : plus rien ne part (cf. stopRun).
      if (await isStopped(runId)) return;
      const open = run.nodeIds.filter(id => ['pending', 'running'].includes(results.get(id)?.status ?? ''));
      if (!open.length) break;
      const blocked = (id: string) =>
        paidSources(graph, id).some(s => ['failed', 'skipped'].includes(results.get(s)?.status ?? ''));
      const ready = open.filter(
        id => !blocked(id) && paidSources(graph, id).every(s => !results.has(s) || results.get(s)!.status === 'succeeded'),
      );
      // Étape précédente en échec : celles qui en dépendent ne partent pas.
      for (const id of open.filter(blocked)) {
        await finishResult(results.get(id)!.id, { status: 'skipped', errorMessage: 'Une étape précédente a échoué.' });
        results.set(id, { ...results.get(id)!, status: 'skipped' });
      }
      if (!ready.length) {
        // Plus rien ne peut partir (ne devrait pas arriver dans un graphe sans boucle).
        if (!open.some(blocked)) throw new Error('Exécution bloquée : étapes en attente sans entrée prête.');
        continue;
      }
      await Promise.all(ready.map(runNode));
    }
    const failed = run.nodeIds.some(id => results.get(id)?.status !== 'succeeded');
    await db
      .update(workflowRuns)
      .set({ status: failed ? 'failed' : 'succeeded', completedAt: new Date() })
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.status, 'running')));
    // Lancée depuis un fil : le fil remonte dans la liste avec son résultat.
    if (run.threadId) await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, run.threadId));
  } catch (err) {
    if (env.NODE_ENV !== 'test') console.error(`[workflow] ${runId}:`, (err as Error).message);
    await db
      .update(workflowRuns)
      .set({ status: 'failed', errorMessage: (err as Error).message, completedAt: new Date() })
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.status, 'running')));
  }
}

async function isStopped(runId: string): Promise<boolean> {
  const [row] = await db.select({ status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
  return row?.status === 'stopped';
}

/**
 * Arrêt demandé par l'utilisateur : les étapes en attente ne partiront pas. Celles déjà
 * lancées chez SpicyAPI vont au bout (pas d'annulation possible) et gardent leur résultat.
 */
export async function stopRun(userId: string, workflowId: string): Promise<WorkflowStateResponse> {
  await findWorkflow(userId, workflowId);
  const [run] = await db
    .update(workflowRuns)
    .set({ status: 'stopped', completedAt: new Date() })
    .where(and(eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.status, 'running')))
    .returning({ id: workflowRuns.id });
  if (!run) throw new HTTPException(409, { message: 'Aucune exécution en cours.' });
  await db
    .update(workflowNodeResults)
    .set({ status: 'skipped', errorMessage: 'Exécution arrêtée.', completedAt: new Date() })
    .where(and(eq(workflowNodeResults.runId, run.id), eq(workflowNodeResults.status, 'pending')));
  return getState(userId, workflowId);
}

/** Au démarrage : reprend les exécutions interrompues. */
export async function resumeRuns(): Promise<void> {
  const rows = await db.select({ id: workflowRuns.id }).from(workflowRuns).where(eq(workflowRuns.status, 'running'));
  for (const r of rows) void executeRun(r.id);
}

// ── Lecture ───────────────────────────────────────────────────

const toRun = (r: RunRow): WorkflowRun => ({
  id: r.id,
  status: r.status,
  nodeIds: r.nodeIds,
  estimatedCost: r.estimatedCost,
  errorMessage: r.errorMessage,
  createdAt: r.createdAt.toISOString(),
  completedAt: r.completedAt?.toISOString() ?? null,
});

/** Dernière exécution et historique des résultats (200 au plus), du plus récent au plus ancien. */
export async function getState(userId: string, workflowId: string): Promise<WorkflowStateResponse> {
  await findWorkflow(userId, workflowId);
  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, workflowId))
    .orderBy(desc(workflowRuns.createdAt))
    .limit(1);
  const rows = await db
    .select()
    .from(workflowNodeResults)
    .where(eq(workflowNodeResults.workflowId, workflowId))
    .orderBy(desc(workflowNodeResults.createdAt))
    .limit(200);
  const genIds = rows.map(r => r.generationId).filter((id): id is string => Boolean(id));
  const gens = genIds.length ? await loadGenerations(userId, { ids: genIds }) : [];
  const byId = new Map(gens.map(g => [g.id, g]));
  const results: WorkflowNodeResult[] = rows.map(r => ({
    id: r.id,
    runId: r.runId,
    nodeId: r.nodeId,
    status: r.status,
    generation: r.generationId ? (byId.get(r.generationId) ?? null) : null,
    text: r.text,
    cost: r.cost,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  }));
  return { run: run ? toRun(run) : null, results };
}


// ── Exécutions affichées dans un fil ──────────────────────────

/** Exécutions lancées depuis ce fil, avec leurs valeurs saisies et leur résultat final. */
export async function loadThreadRuns(userId: string, threadId: string): Promise<ThreadWorkflowRun[]> {
  const rows = await db
    .select({ run: workflowRuns, name: workflows.name, coverAssetId: workflows.coverAssetId })
    .from(workflowRuns)
    .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
    .where(and(eq(workflowRuns.threadId, threadId), eq(workflowRuns.userId, userId)))
    .orderBy(workflowRuns.createdAt);
  if (!rows.length) return [];

  const results = await db
    .select()
    .from(workflowNodeResults)
    .where(inArray(workflowNodeResults.runId, rows.map(r => r.run.id)));
  const genIds = results.map(r => r.generationId).filter((id): id is string => Boolean(id));
  const gens = new Map((genIds.length ? await loadGenerations(userId, { ids: genIds }) : []).map(g => [g.id, g]));
  const inputIds = [...new Set(rows.flatMap(r => r.run.inputs.flatMap(i => i.assetIds ?? [])))];
  const inputAssets = new Map(
    (inputIds.length ? await db.select().from(assets).where(and(eq(assets.userId, userId), inArray(assets.id, inputIds))) : []).map(a => [
      a.id,
      toAsset(a),
    ]),
  );

  return rows.map(({ run, name, coverAssetId }) => {
    const mine = results.filter(r => r.runId === run.id);
    const finals = new Set(finalNodeIds(normalizeGraph(run.graph)));
    const finalGens = mine
      .filter(r => finals.has(r.nodeId) && r.status === 'succeeded' && r.generationId)
      .map(r => gens.get(r.generationId!))
      .filter((g): g is NonNullable<typeof g> => Boolean(g));
    const outputs = finalGens.flatMap(g => g.outputs);
    const removed = finalGens.length > 0 && finalGens.every(g => g.removedAt);
    const cost = mine.reduce((s, r) => s + Number(r.cost ?? 0), 0);
    return {
      id: run.id,
      workflowId: run.workflowId,
      workflowName: name,
      coverUrl: coverAssetId ? `/api/media/${coverAssetId}` : null,
      status: run.status,
      inputs: run.inputs.map(i => ({ ...i, assets: (i.assetIds ?? []).map(id => inputAssets.get(id)).filter((a): a is NonNullable<typeof a> => Boolean(a)) })),
      outputs,
      removed,
      cost: cost ? String(Number(cost.toFixed(6))) : null,
      errorMessage: run.errorMessage ?? mine.find(r => r.status === 'failed')?.errorMessage ?? null,
      createdAt: run.createdAt.toISOString(),
    };
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Supprimer (ou remettre avec `removedAt` à null) le résultat final d'une exécution lancée
 * depuis un fil : ses générations finales sont marquées, comme « Supprimer le résultat ».
 */
export async function setRunResultRemoved(userId: string, runId: string, removedAt: Date | null): Promise<boolean> {
  if (!UUID_RE.test(runId)) return false;
  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.userId, userId)))
    .limit(1);
  if (!run?.threadId) return false;
  const finals = finalNodeIds(normalizeGraph(run.graph));
  const rows = await db
    .select({ generationId: workflowNodeResults.generationId })
    .from(workflowNodeResults)
    .where(and(eq(workflowNodeResults.runId, run.id), inArray(workflowNodeResults.nodeId, finals.length ? finals : [''])));
  const ids = rows.map(r => r.generationId).filter((id): id is string => Boolean(id));
  if (!ids.length) return false;
  await db.update(generations).set({ removedAt }).where(and(eq(generations.userId, userId), inArray(generations.id, ids)));
  return true;
}
