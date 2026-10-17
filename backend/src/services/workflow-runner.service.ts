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
  textPlan,
  expectedListSize,
  fanOut,
  LIST_LIMITS,
  valueResolver,
  type FanItem,
  type Generation,
  type ListItem,
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
  type WorkflowStoredItem,
} from '@sublime/shared';
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

/** Générations d'un résultat : la sienne, ou celles des éléments du lot (réussis seulement si `succeeded`). */
const generationIdsOf = (r: ResultRow, succeeded = false): string[] =>
  [r.generationId, ...(r.items ?? []).filter(i => !succeeded || i.status === 'succeeded').map(i => i.generationId)].filter(
    (id): id is string => Boolean(id),
  );

/** Médias de ces générations, dans l'ordre de création. */
async function assetsByGeneration(generationIds: string[]): Promise<(generationId: string) => string[]> {
  const rows = generationIds.length
    ? await db
        .select({ id: assets.id, generationId: assets.generationId })
        .from(assets)
        .where(inArray(assets.generationId, generationIds))
        .orderBy(assets.createdAt)
    : [];
  return generationId => rows.filter(a => a.generationId === generationId).map(a => a.id);
}

/** Valeur de sortie d'un résultat : son texte ou ses images, ou la liste des éléments réussis du lot. */
function resultValue(r: ResultRow, assetsOf: (generationId: string) => string[]): PortValue {
  const one = (text: string | null | undefined, generationId: string | null | undefined): Omit<ListItem, 'label'> =>
    text != null ? { text } : { assetIds: generationId ? assetsOf(generationId) : [] };
  if (r.items) return { items: r.items.filter(i => i.status === 'succeeded').map(i => ({ label: i.label, ...one(i.text, i.generationId) })) };
  return one(r.text, r.generationId);
}

/**
 * Résultat actif d'un nœud : celui choisi dans le nœud (`activeResultId`), sinon le
 * dernier réussi. Ses médias servent d'entrée aux nœuds suivants.
 */
async function activeOutputs(workflowId: string, graph: WorkflowGraph, nodeIds: string[]): Promise<Map<string, PortValue>> {
  const out = new Map<string, PortValue>();
  if (!nodeIds.length) return out;
  const rows = await db
    .select()
    .from(workflowNodeResults)
    .where(
      and(
        eq(workflowNodeResults.workflowId, workflowId),
        inArray(workflowNodeResults.nodeId, nodeIds),
        eq(workflowNodeResults.status, 'succeeded'),
      ),
    )
    .orderBy(desc(workflowNodeResults.createdAt));
  const picks = nodeIds.flatMap(nodeId => {
    const chosen = graph.nodes.find(n => n.id === nodeId)?.data.activeResultId;
    const list = rows.filter(r => r.nodeId === nodeId);
    const pick = list.find(r => r.id === chosen) ?? list[0];
    return pick ? [pick] : [];
  });
  const assetsOf = await assetsByGeneration(picks.flatMap(r => generationIdsOf(r, true)));
  for (const r of picks) out.set(r.nodeId, resultValue(r, assetsOf));
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
  // Une étape qui produira une liste compte pour le nombre d'éléments attendu.
  const stand = await standInImage(user.id);
  const pending: PortValue = { assetIds: [stand], text: 'prompt' };
  const pendingFor = (id: string): PortValue => {
    const size = expectedListSize(graph, id);
    return size === null ? pending : { items: Array.from({ length: size }, () => ({ label: 'élément', ...pending })) };
  };
  const standIn = (id: string) => !known.has(id) && order.includes(id);
  const valueOf = valueResolver(graph, id => known.get(id) ?? (standIn(id) ? pendingFor(id) : null), { standIn });

  const nodes: WorkflowQuoteResponse['nodes'] = [];
  for (const nodeId of order) {
    const fail = (reason: string) => new HTTPException(400, { message: `« ${label(graph, nodeId)} » : ${reason}` });
    // Une passe chiffrée, multipliée par le nombre d'éléments de la liste reçue.
    const fan = fanOut(graph, nodeId, valueOf);
    if (!fan) throw fail('Une étape précédente n’a pas encore de résultat.');
    if (!fan.items.length) throw fail('la liste est vide.');
    if (fan.items.length > LIST_LIMITS.max) throw fail(`${fan.items.length} éléments actifs, ${LIST_LIMITS.max} au plus.`);
    const first = fan.items[0].valueOf;
    const count = fan.items.length;
    const times = (cost: string) => String(Number((Number(cost) * count).toFixed(6)));
    if (isTextNode(graph, nodeId)) {
      const t = textPlan(graph, nodeId, first);
      if (!t.ok) throw fail(t.reason);
      const one = await estimateChat(user.id, { ...t.plan, system: SYSTEM_PROMPTS[t.plan.kind] });
      nodes.push({ nodeId, task: 'text', estimatedCost: times(one), count });
      continue;
    }
    const r = generationPlan(graph, nodeId, first);
    if (!r.ok) throw fail(r.reason);
    const q = await quoteWorkflowGeneration(user, { ...r.plan, threadId: null }).catch((err: unknown) => {
      throw fail(err instanceof HTTPException ? err.message : 'devis impossible.');
    });
    nodes.push({ nodeId, task: q.task, estimatedCost: times(q.estimatedCost), count });
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
      const [t] = await db.insert(threads).values({ userId: user.id, title: workflow.name }).returning({ id: threads.id });
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
  const valueOf = valueResolver(graph, id => outputs.get(id));

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

  /**
   * Nœud qui reçoit une liste : une passe par élément, toutes dans le même résultat (le lot).
   * Les demandes partent une à une (le plafond de coût reste juste), puis s'exécutent
   * ensemble. Le lot réussit si au moins un élément réussit ; les autres sont écartés.
   */
  async function runListNode(nodeId: string, fan: FanItem[]) {
    const result = results.get(nodeId)!;
    const text = isTextNode(graph, nodeId);
    // Reprise après un redémarrage : les éléments déjà lancés gardent leur génération.
    const items: WorkflowStoredItem[] =
      result.items?.length === fan.length ? result.items.map(i => ({ ...i })) : fan.map(f => ({ label: f.label, status: 'pending' }));
    let saving = Promise.resolve();
    const save = () => {
      const snapshot = items.map(i => ({ ...i }));
      saving = saving.then(async () => {
        await db.update(workflowNodeResults).set({ items: snapshot }).where(eq(workflowNodeResults.id, result.id));
      });
      return saving;
    };
    let gate: Promise<unknown> = Promise.resolve();
    const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
      const p = gate.then(fn);
      gate = p.catch(() => {});
      return p;
    };
    await db.update(workflowNodeResults).set({ status: 'running', items }).where(eq(workflowNodeResults.id, result.id));

    await Promise.all(
      fan.map(async (f, i) => {
        const item = items[i];
        if (['succeeded', 'failed', 'skipped'].includes(item.status)) return;
        try {
          if (text) {
            const started = await oneAtATime(async () => {
              if (await isStopped(runId)) return null;
              const t = textPlan(graph, nodeId, f.valueOf);
              if (!t.ok) throw new Error(t.reason);
              const request = { ...t.plan, system: SYSTEM_PROMPTS[t.plan.kind] };
              const estimate = Number(await estimateChat(run.userId, request));
              if (estimate > Math.max(0, cap - spent) + 1e-9) {
                throw new HTTPException(402, { message: 'Le coût dépasse le devis confirmé : exécution arrêtée.' });
              }
              spent += estimate;
              item.status = 'running';
              void save();
              return { request, estimate };
            });
            if (!started) {
              Object.assign(item, { status: 'skipped', errorMessage: 'Exécution arrêtée.' });
            } else {
              const out = await runChat(run.userId, started.request);
              spent += Number(out.cost ?? started.estimate) - started.estimate;
              Object.assign(item, { status: 'succeeded', text: out.text, cost: out.cost ?? String(started.estimate) });
            }
          } else {
            if (!item.generationId) {
              const started = await oneAtATime(async () => {
                if (await isStopped(runId)) return false;
                const r = generationPlan(graph, nodeId, f.valueOf);
                if (!r.ok) throw new Error(r.reason);
                const generation: Generation = await createWorkflowGeneration(
                  user,
                  { ...r.plan, threadId: null },
                  { workflowId: run.workflowId, nodeId },
                  Math.max(0, cap - spent),
                );
                spent += Number(generation.estimatedCost ?? 0);
                Object.assign(item, { status: 'running', generationId: generation.id });
                await save();
                return true;
              });
              if (!started) {
                Object.assign(item, { status: 'skipped', errorMessage: 'Exécution arrêtée.' });
                await save();
                return;
              }
            }
            const done = await waitGeneration(item.generationId!);
            if (done?.status === 'succeeded') Object.assign(item, { status: 'succeeded', cost: done.cost ?? done.estimatedCost });
            else {
              Object.assign(item, { status: 'failed', errorMessage: done?.errorMessage ?? 'La génération a échoué.', cost: done?.cost ?? null });
            }
          }
        } catch (err) {
          Object.assign(item, { status: 'failed', errorMessage: (err as Error).message });
        }
        await save();
      }),
    );
    await saving;

    const ok = items.filter(i => i.status === 'succeeded');
    const failed = items.filter(i => i.status === 'failed');
    const cost = items.reduce((s, i) => s + Number(i.cost ?? 0), 0);
    const row = { ...result, items };
    if (ok.length) outputs.set(nodeId, resultValue(row, await assetsByGeneration(generationIdsOf(row, true))));
    const status = ok.length ? 'succeeded' : failed.length ? 'failed' : 'skipped';
    const errorMessage = failed.length
      ? ok.length
        ? `${failed.length} sur ${items.length} en échec : ${failed[0].errorMessage}`
        : (failed[0].errorMessage ?? 'Échec.')
      : status === 'skipped'
        ? 'Exécution arrêtée.'
        : null;
    await finishResult(result.id, { status, items, cost: cost ? String(Number(cost.toFixed(6))) : null, errorMessage });
    results.set(nodeId, { ...row, status });
  }

  async function runNode(nodeId: string) {
    const fan = fanOut(graph, nodeId, valueOf);
    if (fan?.list) return runListNode(nodeId, fan.items);
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
  const genIds = rows.flatMap(r => generationIdsOf(r));
  const gens = genIds.length ? await loadGenerations(userId, { ids: genIds }) : [];
  const byId = new Map(gens.map(g => [g.id, g]));
  const results: WorkflowNodeResult[] = rows.map(r => ({
    id: r.id,
    runId: r.runId,
    nodeId: r.nodeId,
    status: r.status,
    generation: r.generationId ? (byId.get(r.generationId) ?? null) : null,
    text: r.text,
    items:
      r.items?.map(i => ({
        label: i.label,
        status: i.status,
        generation: i.generationId ? (byId.get(i.generationId) ?? null) : null,
        text: i.text ?? null,
        cost: i.cost ?? null,
        errorMessage: i.errorMessage ?? null,
      })) ?? null,
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
  const genIds = results.flatMap(r => generationIdsOf(r));
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
      .filter(r => finals.has(r.nodeId) && r.status === 'succeeded')
      .flatMap(r => generationIdsOf(r, true))
      .map(id => gens.get(id))
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
    .select()
    .from(workflowNodeResults)
    .where(and(eq(workflowNodeResults.runId, run.id), inArray(workflowNodeResults.nodeId, finals.length ? finals : [''])));
  const ids = rows.flatMap(r => generationIdsOf(r));
  if (!ids.length) return false;
  await db.update(generations).set({ removedAt }).where(and(eq(generations.userId, userId), inArray(generations.id, ids)));
  return true;
}
