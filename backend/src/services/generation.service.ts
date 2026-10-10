/**
 * Cœur de l'app : prépare l'input SpicyAPI (tâche, références, LoRA du persona),
 * demande le devis, crée la tâche, puis suit la tâche jusqu'au résultat et
 * télécharge les fichiers dans le dossier local de l'utilisateur.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { SpicyClient, TaskRecord } from '@spicyapi/sdk';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  buildInput,
  getFamily,
  resolveTask,
  type CreateGenerationResponse,
  type GenerationContext,
  type GenerationLora,
  MAX_LORAS_PER_GENERATION,
  type Generation,
  type GenerationRequest,
  type LoraEntry,
  type QuoteResponse,
  type UpscaleRequest,
  type InputSchema,
  UPSCALERS,
  type TaskKind,
} from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { assets, generations, personas, promptPresets, threads, users } from '../db/schema.js';
import type { SessionUser } from '../types.js';
import { getSettingsRow, mediaDirOf, slug } from './settings.service.js';
import { assemblePrompt } from './prompt.js';
import { callSpicy, clientForUser, getCatalog, getModels, toHttpError } from './spicy.service.js';
import { resolveLoraUrl } from './civitai.service.js';
import { dayFolder, extFor, mediaTypeOf, saveFile } from './storage.service.js';
import { toAsset, toGeneration, toThread } from './serialize.js';

type AssetRow = typeof assets.$inferSelect;
type PersonaRow = typeof personas.$inferSelect;

/** Marge avant expiration d'un upload SpicyAPI (valable 24 h). */
const UPLOAD_SAFETY_MS = 60 * 60 * 1000;

async function ensureSpicyUri(client: SpicyClient, asset: AssetRow): Promise<string> {
  if (asset.spicyUri && asset.spicyUriExpiresAt && asset.spicyUriExpiresAt.getTime() - Date.now() > UPLOAD_SAFETY_MS) {
    return asset.spicyUri;
  }
  const uploaded = await callSpicy(() => client.uploadFile(asset.filePath));
  await db
    .update(assets)
    .set({ spicyUri: uploaded.uri, spicyUriExpiresAt: new Date(uploaded.expiresAt) })
    .where(eq(assets.id, asset.id));
  return uploaded.uri;
}

interface Prepared {
  client: SpicyClient;
  contexts: GenerationContext[];
  loras: GenerationLora[];
  task: TaskKind;
  modelId: string;
  input: Record<string, unknown>;
  finalPrompt: string;
  persona: PersonaRow | null;
  references: AssetRow[];
  dropped: number;
  lorasApplied: number;
}

async function prepare(user: SessionUser, req: GenerationRequest, forCreate = false): Promise<Prepared> {
  const def = getFamily(req.family);
  if (!def) throw new HTTPException(400, { message: 'Modèle inconnu.' });

  const catalog = await getCatalog(user.id);
  const family = catalog.families.find(f => f.id === req.family);
  if (!family?.available) throw new HTTPException(400, { message: `${def.label} n'est pas disponible avec cette clé.` });

  let persona: PersonaRow | null = null;
  if (req.personaId) {
    [persona] = await db
      .select()
      .from(personas)
      .where(and(eq(personas.id, req.personaId), eq(personas.userId, user.id), isNull(personas.deletedAt)))
      .limit(1);
    if (!persona) throw new HTTPException(404, { message: 'Persona introuvable.' });
  }

  let references: AssetRow[] = [];
  if (req.referenceAssetIds.length) {
    const rows = await db
      .select()
      .from(assets)
      .where(and(eq(assets.userId, user.id), inArray(assets.id, req.referenceAssetIds)));
    const byId = new Map(rows.map(r => [r.id, r]));
    references = req.referenceAssetIds.map(id => byId.get(id)).filter((r): r is AssetRow => Boolean(r));
  }

  const images = references.filter(r => r.mediaType === 'image');
  const videos = references.filter(r => r.mediaType === 'video');
  const resolution = resolveTask(
    def.media,
    Object.keys(family.tasks) as TaskKind[],
    { images: images.length, videos: videos.length },
    req.refMode,
  );
  if (!resolution.ok) throw new HTTPException(400, { message: resolution.reason });
  const endpoint = family.tasks[resolution.task]!;

  // LoRA du persona entraînées pour ce modèle et cochées dans le composer (aucune par défaut, 3 max).
  const loraIds = new Set(req.loraIds ?? []);
  const personaLoras = (persona?.loras ?? [])
    .filter(l => l.family === req.family && l.path && loraIds.has(l.id))
    .slice(0, MAX_LORAS_PER_GENERATION);
  // Les liens Civitai sont résolus en lien signé temporaire seulement au lancement (le devis n'en a pas besoin).
  const loras: LoraEntry[] = await Promise.all(
    personaLoras.map(async l => ({
      path: forCreate ? await resolveLoraUrl(l.path) : l.path,
      scale: l.scale,
      noise: l.noise,
    })),
  );

  const client = await clientForUser(user.id);
  const [imageUris, videoUris] = await Promise.all([
    Promise.all(images.map(a => ensureSpicyUri(client, a))),
    Promise.all(videos.map(a => ensureSpicyUri(client, a))),
  ]);

  // Mots déclencheurs choisis dans le composer, parmi ceux de chaque LoRA (jamais tous d'office).
  const chosenWords = (l: (typeof personaLoras)[number]) =>
    (req.loraWords?.[l.id] ?? []).filter(w => (l.triggerWords ?? []).includes(w) && !l.hiddenWords?.includes(w));
  // Si l'utilisateur l'a déjà écrit dans sa phrase, on ne le rajoute pas.
  const typed = req.prompt.toLowerCase();
  const triggers = [...new Set(personaLoras.flatMap(chosenWords).map(w => w.trim()).filter(Boolean))].filter(
    w => !typed.includes(w.toLowerCase()),
  );

  // Contextes activés (raccourcis).
  let contexts: GenerationContext[] = [];
  if (req.contextIds?.length) {
    const rows = await db
      .select({ id: promptPresets.id, label: promptPresets.label, text: promptPresets.text })
      .from(promptPresets)
      .where(and(eq(promptPresets.userId, user.id), inArray(promptPresets.id, req.contextIds)));
    const byId = new Map(rows.map(r => [r.id, r]));
    contexts = req.contextIds.map(id => byId.get(id)).filter((c): c is GenerationContext => Boolean(c));
  }

  // Contexte du persona : toujours envoyé, en lignes étiquetées.
  const blocks = (persona?.contextBlocks ?? []).filter(b => b.text.trim());

  const finalPrompt = assemblePrompt({
    prompt: req.prompt,
    triggers,
    contexts,
    blocks,
    // « Éditer » : l'image à modifier est toujours la première envoyée.
    editFirstImage: Boolean(req.editAssetId && images[0]?.id === req.editAssetId),
  });

  const built = buildInput({
    schema: endpoint.schema,
    task: resolution.task,
    prompt: finalPrompt,
    params: req.params ?? {},
    images: imageUris,
    videos: videoUris,
    loras,
  });

  const required = endpoint.schema.required ?? [];
  if (required.includes('prompt') && !built.input.prompt) {
    throw new HTTPException(400, { message: 'Ce modèle a besoin d’un prompt.' });
  }

  return {
    client,
    contexts,
    loras: personaLoras.map(l => ({ id: l.id, label: l.label, triggerWords: chosenWords(l) })),
    task: resolution.task,
    modelId: endpoint.modelId,
    input: built.input,
    finalPrompt,
    persona,
    references,
    dropped: built.dropped,
    lorasApplied: built.lorasApplied,
  };
}

/** Montant décimal (chaîne SpicyAPI) multiplié par le nombre d'images d'une série. */
function times(amount: string, count: number): string {
  return count === 1 ? amount : String(Number((Number(amount) * count).toFixed(6)));
}

/** Plus grande graine acceptée : on reste sous 2^31 pour tous les modèles. */
const MAX_SEED = 2_147_483_647;

export async function quoteGeneration(user: SessionUser, req: GenerationRequest): Promise<QuoteResponse> {
  const p = await prepare(user, req);
  const quote = await callSpicy(() => p.client.quoteTask({ model: p.modelId, input: p.input }));
  return toQuoteResponse(p, quote, req.count ?? 1);
}

export class PriceChangedError extends Error {
  constructor(public quote: QuoteResponse) {
    super('price_changed');
  }
}

export async function createGeneration(
  user: SessionUser,
  req: GenerationRequest,
): Promise<CreateGenerationResponse> {
  const count = req.count ?? 1;
  const p = await prepare(user, req, true);
  const quote = await callSpicy(() => p.client.quoteTask({ model: p.modelId, input: p.input }));

  // Le devis affiché au clic (total de la série) vaut confirmation ; s'il a augmenté entre-temps, on redemande.
  const total = times(quote.estimatedCost, count);
  if (req.expectedCost !== undefined && Number(total) > Number(req.expectedCost) + 1e-9) {
    throw new PriceChangedError(toQuoteResponse(p, quote, count));
  }

  // Série : N générations sœurs (N tâches SpicyAPI), chacune avec sa graine.
  const batchId = count > 1 ? randomUUID() : null;
  let threadId = req.threadId ?? null;
  let first: CreateGenerationResponse | null = null;
  for (let i = 0; i < count; i++) {
    // Seed fixé par l'utilisateur : décalé d'une image à l'autre, sinon la série donnerait N fois la même image.
    const params = { ...req.params };
    if (i > 0 && typeof params.seed === 'number') params.seed = (params.seed + i) % MAX_SEED;
    const pi = i === 0 ? p : await prepare(user, { ...req, params }, true);
    const qi = i === 0 ? quote : await callSpicy(() => pi.client.quoteTask({ model: pi.modelId, input: pi.input }));
    const res = await launch(user, pi, qi, {
      threadId,
      personaId: pi.persona?.id ?? null,
      family: req.family,
      prompt: req.prompt,
      refMode: req.refMode ?? 'start-frame',
      params: i === 0 ? (req.params ?? {}) : params,
      batchId,
      batchIndex: i,
    });
    threadId = res.thread.id;
    first ??= res;
  }
  return first!;
}

type Quote = Awaited<ReturnType<SpicyClient['quoteTask']>>;

function toQuoteResponse(p: Prepared, quote: Quote, count = 1): QuoteResponse {
  return {
    count,
    task: p.task,
    modelId: p.modelId,
    estimatedCost: times(quote.estimatedCost, count),
    maxCharge: times(quote.maxCharge, count),
    quantity: quote.quantity,
    unit: quote.unit,
    expiresAt: quote.expiresAt,
    dropped: p.dropped,
    lorasApplied: p.lorasApplied,
  };
}

/** Crée (ou reprend) le fil, enregistre la génération, lance la tâche et démarre son suivi. */
async function launch(
  user: SessionUser,
  p: Prepared,
  quote: Quote,
  meta: {
    threadId: string | null;
    personaId: string | null;
    family: string;
    prompt: string;
    refMode: 'start-frame' | 'reference';
    params: Record<string, unknown>;
    batchId?: string | null;
    batchIndex?: number;
  },
): Promise<CreateGenerationResponse> {
  // Fil : existant (vérifié) ou créé à partir du prompt.
  let thread: typeof threads.$inferSelect | undefined;
  if (meta.threadId) {
    [thread] = await db
      .select()
      .from(threads)
      .where(and(eq(threads.id, meta.threadId), eq(threads.userId, user.id), isNull(threads.deletedAt)))
      .limit(1);
    if (!thread) throw new HTTPException(404, { message: 'Fil introuvable.' });
  } else {
    const title = meta.prompt.trim().slice(0, 60) || getFamily(meta.family)!.label;
    [thread] = await db
      .insert(threads)
      .values({ userId: user.id, personaId: meta.personaId, title })
      .returning();
  }

  const idempotencyKey = randomUUID();
  const [row] = await db
    .insert(generations)
    .values({
      threadId: thread.id,
      userId: user.id,
      personaId: meta.personaId ?? thread.personaId,
      prompt: meta.prompt,
      finalPrompt: p.finalPrompt,
      family: meta.family,
      modelId: p.modelId,
      task: p.task,
      refMode: meta.refMode,
      params: meta.params,
      input: p.input,
      referenceAssetIds: p.references.map(r => r.id),
      batchId: meta.batchId ?? null,
      batchIndex: meta.batchIndex ?? 0,
      contexts: p.contexts,
      loras: p.loras,
      lorasApplied: p.lorasApplied,
      idempotencyKey,
      estimatedCost: quote.estimatedCost,
    })
    .returning();

  try {
    const accepted = await p.client.createTask(
      { model: p.modelId, input: p.input, quoteId: quote.quoteId, expectedCost: quote.estimatedCost },
      { idempotencyKey },
    );
    await db
      .update(generations)
      .set({ spicyTaskId: accepted.taskId, estimatedCost: accepted.estimatedCost })
      .where(eq(generations.id, row.id));
  } catch (err) {
    const httpErr = toHttpError(err);
    await db
      .update(generations)
      .set({ status: 'failed', errorCode: 'create_failed', errorMessage: httpErr.message, completedAt: new Date() })
      .where(eq(generations.id, row.id));
  }

  await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, thread.id));
  void watchGeneration(row.id);

  const [generation] = await loadGenerations(user.id, { ids: [row.id] });
  return { generation, thread: toThread(thread) };
}

// ── Upscale ───────────────────────────────────────────────────

interface PreparedUpscale {
  p: Prepared;
  threadId: string;
  personaId: string | null;
  family: string;
  resolution: string;
}

/** Upscale d'un résultat : même fil que l'original, sans prompt. */
async function prepareUpscale(user: SessionUser, req: UpscaleRequest): Promise<PreparedUpscale> {
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, req.assetId), eq(assets.userId, user.id)))
    .limit(1);
  if (!asset) throw new HTTPException(404, { message: 'Média introuvable.' });
  if (!asset.generationId) throw new HTTPException(400, { message: 'Seuls les résultats générés peuvent être upscalés.' });
  const [source] = await db
    .select({ threadId: generations.threadId, personaId: generations.personaId })
    .from(generations)
    .where(eq(generations.id, asset.generationId))
    .limit(1);
  if (!source) throw new HTTPException(404, { message: 'Génération d’origine introuvable.' });

  const tool = UPSCALERS[asset.mediaType];
  const model = (await getModels(user.id)).find(m => m.model === tool.modelId);
  if (!model?.enabled) throw new HTTPException(400, { message: `${tool.label} n'est pas disponible avec cette clé.` });

  const schema = (model.inputSchema ?? {}) as InputSchema;
  const props = schema.properties ?? {};
  const resolutions = (props.resolution?.enum as string[] | undefined) ?? [];
  const resolution = req.resolution && resolutions.includes(req.resolution) ? req.resolution : tool.defaultResolution;

  const client = await clientForUser(user.id);
  const uri = await ensureSpicyUri(client, asset);
  const input: Record<string, unknown> = {
    [asset.mediaType === 'video' ? 'video_url' : 'image_url']: uri,
    ...(props.resolution ? { resolution } : {}),
  };

  return {
    p: {
      client,
      contexts: [],
      loras: [],
      task: 'upscale',
      modelId: tool.modelId,
      input,
      finalPrompt: '',
      persona: null,
      references: [asset],
      dropped: 0,
      lorasApplied: 0,
    },
    threadId: source.threadId,
    personaId: source.personaId,
    family: tool.family,
    resolution,
  };
}

export async function quoteUpscale(user: SessionUser, req: UpscaleRequest): Promise<QuoteResponse> {
  const u = await prepareUpscale(user, req);
  const quote = await callSpicy(() => u.p.client.quoteTask({ model: u.p.modelId, input: u.p.input }));
  return toQuoteResponse(u.p, quote);
}

export async function createUpscale(user: SessionUser, req: UpscaleRequest): Promise<CreateGenerationResponse> {
  const u = await prepareUpscale(user, req);
  const quote = await callSpicy(() => u.p.client.quoteTask({ model: u.p.modelId, input: u.p.input }));
  if (req.expectedCost !== undefined && Number(quote.estimatedCost) > Number(req.expectedCost) + 1e-9) {
    throw new PriceChangedError(toQuoteResponse(u.p, quote));
  }
  return launch(user, u.p, quote, {
    threadId: u.threadId,
    personaId: u.personaId,
    family: u.family,
    prompt: '',
    refMode: 'start-frame',
    params: { resolution: u.resolution },
  });
}

// ── Lecture ───────────────────────────────────────────────────

export async function loadGenerations(
  userId: string,
  filter: { threadId?: string; ids?: string[] },
): Promise<Generation[]> {
  const where = [eq(generations.userId, userId)];
  if (filter.threadId) where.push(eq(generations.threadId, filter.threadId));
  if (filter.ids) where.push(inArray(generations.id, filter.ids));
  const rows = await db
    .select()
    .from(generations)
    .where(and(...where))
    .orderBy(asc(generations.createdAt));
  if (!rows.length) return [];

  const refIds = [...new Set(rows.flatMap(r => r.referenceAssetIds))];
  const [refRows, outputRows] = await Promise.all([
    refIds.length ? db.select().from(assets).where(inArray(assets.id, refIds)) : Promise.resolve([]),
    db
      .select()
      .from(assets)
      .where(inArray(assets.generationId, rows.map(r => r.id)))
      .orderBy(asc(assets.createdAt)),
  ]);
  const refsById = new Map(refRows.map(a => [a.id, toAsset(a)]));
  return rows.map(r =>
    toGeneration(
      r,
      r.referenceAssetIds.map(id => refsById.get(id)).filter(Boolean) as ReturnType<typeof toAsset>[],
      outputRows.filter(a => a.generationId === r.id && a.kind === 'output').map(toAsset),
    ),
  );
}

// ── Suivi des tâches ──────────────────────────────────────────

const watching = new Set<string>();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const MAX_WATCH_MS = 3 * 60 * 60 * 1000;

export async function watchGeneration(generationId: string): Promise<void> {
  if (watching.has(generationId)) return;
  watching.add(generationId);
  try {
    const [row] = await db.select().from(generations).where(eq(generations.id, generationId)).limit(1);
    if (!row?.spicyTaskId || row.status === 'succeeded' || row.status === 'failed') return;
    const client = await clientForUser(row.userId);
    const interval = row.task.includes('video') ? 5000 : 2500;
    const started = Date.now();
    let failures = 0;

    while (Date.now() - started < MAX_WATCH_MS) {
      let record: TaskRecord;
      try {
        record = await client.getTask(row.spicyTaskId);
        failures = 0;
      } catch (err) {
        if (++failures > 20) throw err;
        await sleep(Math.min(30000, interval * failures));
        continue;
      }

      if (record.state === 'running' || record.state === 'queued') {
        await db
          .update(generations)
          .set({ status: record.state, estimatedCost: record.cost })
          .where(and(eq(generations.id, row.id), inArray(generations.status, ['queued', 'running'])));
        await sleep(interval);
        continue;
      }

      if (record.state === 'succeeded') {
        const pending = record.output?.assets?.some(a => a.pending);
        if (pending) {
          await sleep(interval);
          continue;
        }
        await handleSuccess(row, record);
      } else {
        await db
          .update(generations)
          .set({
            status: 'failed',
            errorCode: record.errorCode ?? record.state,
            errorMessage:
              record.errorMessage ?? (record.state === 'expired' ? 'La tâche a expiré.' : 'La génération a échoué.'),
            cost: record.cost,
            settled: record.settled,
            completedAt: new Date(),
          })
          .where(eq(generations.id, row.id));
      }
      if (!record.settled) void settleLater(row.id, row.userId, row.spicyTaskId);
      return;
    }
    await db
      .update(generations)
      .set({ status: 'failed', errorCode: 'timeout', errorMessage: 'Suivi interrompu : la tâche est trop longue.', completedAt: new Date() })
      .where(eq(generations.id, row.id));
  } catch (err) {
    // Pas de bruit dans la sortie des tests (les échecs simulés sont attendus).
    if (env.NODE_ENV !== 'test') console.error(`[watch] ${generationId}:`, (err as Error).message);
    await db
      .update(generations)
      .set({ status: 'failed', errorCode: 'watch_failed', errorMessage: (err as Error).message, completedAt: new Date() })
      .where(and(eq(generations.id, generationId), inArray(generations.status, ['queued', 'running'])));
  } finally {
    watching.delete(generationId);
  }
}

async function handleSuccess(row: typeof generations.$inferSelect, record: TaskRecord) {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, row.userId)).limit(1);
  const settings = await getSettingsRow(row.userId);
  const baseDir = mediaDirOf(user, settings);
  let personaFolder = 'sans-persona';
  if (row.personaId) {
    const [p] = await db.select({ name: personas.name }).from(personas).where(eq(personas.id, row.personaId)).limit(1);
    if (p) personaFolder = slug(p.name);
  }
  const dir = join(baseDir, personaFolder, dayFolder());

  const outputs = (record.output?.assets ?? []).filter(a => a.url && !a.unavailable);
  if (!outputs.length) throw new Error('La tâche a réussi mais aucun fichier n’est disponible.');

  let index = 0;
  for (const out of outputs) {
    const mime = out.mime ?? 'application/octet-stream';
    let data: Uint8Array | null = null;
    for (let attempt = 0; attempt < 3 && !data; attempt++) {
      // Jamais de clé API sur les URL signées.
      const res = await fetch(out.url!).catch(() => null);
      if (res?.ok) data = new Uint8Array(await res.arrayBuffer());
      else await sleep(2000);
    }
    if (!data) throw new Error('Téléchargement du résultat impossible.');
    const filePath = join(dir, `${row.id.slice(0, 8)}-${index++}.${extFor(mime)}`);
    const saved = await saveFile(filePath, data);
    await db.insert(assets).values({
      userId: row.userId,
      personaId: row.personaId,
      generationId: row.id,
      kind: 'output',
      mediaType: mediaTypeOf(mime),
      mime,
      filePath: saved.path,
      bytes: saved.bytes,
      width: out.width ?? null,
      height: out.height ?? null,
      durationSeconds: out.durationSeconds ?? null,
    });
  }

  const seed = typeof record.input?.seed === 'number' ? (record.input.seed as number) : null;
  await db
    .update(generations)
    .set({
      status: 'succeeded',
      cost: record.cost,
      settled: record.settled,
      seed,
      completedAt: record.completedAt ? new Date(record.completedAt) : new Date(),
    })
    .where(eq(generations.id, row.id));
  await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, row.threadId));
}

/** Le coût final peut arriver après la fin de la tâche : on le relit quelques fois. */
async function settleLater(generationId: string, userId: string, taskId: string) {
  const client = await clientForUser(userId).catch(() => null);
  if (!client) return;
  for (let i = 0; i < 10; i++) {
    await sleep(20000);
    const record = await client.getTask(taskId).catch(() => null);
    if (record?.settled) {
      await db.update(generations).set({ cost: record.cost, settled: true }).where(eq(generations.id, generationId));
      return;
    }
  }
}

/** Au démarrage : reprend le suivi des tâches en cours, termine celles jamais acceptées. */
export async function resumeWatchers(): Promise<void> {
  const pending = await db
    .select({ id: generations.id, spicyTaskId: generations.spicyTaskId, createdAt: generations.createdAt })
    .from(generations)
    .where(inArray(generations.status, ['queued', 'running']));
  for (const g of pending) {
    if (g.spicyTaskId) void watchGeneration(g.id);
    else if (Date.now() - g.createdAt.getTime() > 5 * 60 * 1000) {
      await db
        .update(generations)
        .set({ status: 'failed', errorCode: 'interrupted', errorMessage: 'Création interrompue (serveur redémarré).', completedAt: new Date() })
        .where(eq(generations.id, g.id));
    }
  }
  const unsettled = await db
    .select({ id: generations.id, userId: generations.userId, spicyTaskId: generations.spicyTaskId })
    .from(generations)
    .where(and(eq(generations.settled, false), isNotNull(generations.spicyTaskId), inArray(generations.status, ['succeeded', 'failed'])));
  for (const g of unsettled) void settleLater(g.id, g.userId, g.spicyTaskId!);
  if (pending.length) console.log(`↻ Reprise du suivi de ${pending.length} génération(s)`);
}
