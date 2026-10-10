/**
 * Cœur de l'app : prépare l'input SpicyAPI (tâche, références, LoRA du persona),
 * demande le devis, crée la tâche, puis suit la tâche jusqu'au résultat et
 * télécharge les fichiers dans le dossier local de l'utilisateur.
 *
 * Les modèles locaux (`provider: 'comfy'`) suivent le même chemin : même input, devis gratuit,
 * puis le workflow ComfyUI correspondant est mis en file et suivi à la place de la tâche SpicyAPI.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
  type GenerationTrait,
  type GenerationLora,
  MAX_LORAS_PER_GENERATION,
  type Generation,
  type GenerationRequest,
  type GenerationVariation,
  type LoraEntry,
  type QuoteResponse,
  type UpscaleRequest,
  type InputSchema,
  UPSCALERS,
  type TaskKind,
  type ModelProvider,
} from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, generations, personas, places, promptPresets, threads, users } from '../db/schema.js';
import type { SessionUser } from '../types.js';
import { getSettingsRow, mediaDirOf, slug } from './settings.service.js';
import { callSpicy, clientForUser, getCatalog, getModels, toHttpError } from './spicy.service.js';
import { MAX_SEED, buildGraph, localEndpoint } from './comfy-workflows.js';
import { cancelPrompt, deleteOutputFile, downloadFile, getPromptState, queuePrompt, uploadImage } from './comfy.service.js';
import { resolveTraits } from './traits.service.js';
import { drawSlots, resolveWildcards } from './draw.service.js';
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
  runtime: ModelProvider;
  /** Null pour un modèle local (ComfyUI). */
  client: SpicyClient | null;
  contexts: GenerationContext[];
  loras: GenerationLora[];
  task: TaskKind;
  modelId: string;
  input: Record<string, unknown>;
  finalPrompt: string;
  persona: PersonaRow | null;
  references: AssetRow[];
  /** Image dont le visage est appliqué au résultat (ReActor). */
  face: AssetRow | null;
  traits: GenerationTrait[];
  /** Tirages (🎲, `__…__`, `{a|b}`) : le prompt change d'une image à l'autre. */
  randomized: boolean;
  unknownWildcards: string[];
  dropped: number;
  lorasApplied: number;
}

async function prepare(user: SessionUser, req: GenerationRequest, forCreate = false): Promise<Prepared> {
  const def = getFamily(req.family);
  if (!def) throw new HTTPException(400, { message: 'Modèle inconnu.' });

  const catalog = await getCatalog(user.id);
  const family = catalog.families.find(f => f.id === req.family);
  if (!family?.available) {
    throw new HTTPException(400, { message: `${def.label} : ${family?.unavailableReason ?? 'indisponible'}.` });
  }
  const local = family.runtime === 'comfy';

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

  let face: AssetRow | null = null;
  if (req.faceAssetId) {
    if (!family.supportsFace) {
      throw new HTTPException(400, { message: `${def.label} ne sait pas appliquer un visage.` });
    }
    [face] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, req.faceAssetId), eq(assets.userId, user.id)))
      .limit(1);
    if (!face || face.mediaType !== 'image') throw new HTTPException(400, { message: 'Image du visage introuvable.' });
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

  // En local, les fichiers ne sont envoyés à ComfyUI qu'au lancement : l'input garde une référence à l'asset.
  const client = local ? null : await clientForUser(user.id);
  const [imageUris, videoUris] = client
    ? await Promise.all([
        Promise.all(images.map(a => ensureSpicyUri(client, a))),
        Promise.all(videos.map(a => ensureSpicyUri(client, a))),
      ])
    : [images.map(localAssetRef), videos.map(localAssetRef)];

  // Traits de la bibliothèque (bulles du composer) : une phrase, avant le texte libre.
  // S'y ajoutent la fiche du lieu choisi et un tirage pour chaque bulle 🎲.
  const gender = persona?.gender ?? req.gender ?? null;
  let placeTraitIds: string[] = [];
  if (req.placeId) {
    const [place] = await db
      .select({ identity: places.identity })
      .from(places)
      .where(and(eq(places.id, req.placeId), eq(places.userId, user.id)))
      .limit(1);
    if (!place) throw new HTTPException(404, { message: 'Lieu introuvable.' });
    placeTraitIds = place.identity.map(t => t.optionId);
  }
  const drawn = await drawSlots(user.id, req.traitSlots ?? [], gender);
  const resolved = await resolveTraits(user.id, [...new Set([...(req.traitIds ?? []), ...placeTraitIds, ...drawn])], gender);
  const { sentence } = resolved;
  const traits = resolved.traits.map(t => (drawn.includes(t.optionId) ? { ...t, random: true } : t));
  const wildcards = await resolveWildcards(user.id, req.prompt.trim(), gender);

  // Mots déclencheurs choisis dans le composer, parmi ceux de chaque LoRA (jamais tous d'office).
  const chosenWords = (l: (typeof personaLoras)[number]) =>
    (req.loraWords?.[l.id] ?? []).filter(w => (l.triggerWords ?? []).includes(w) && !l.hiddenWords?.includes(w));
  // Si l'utilisateur l'a déjà écrit dans sa phrase, on ne le rajoute pas.
  const typed = req.prompt.toLowerCase();
  const triggers = [...new Set(personaLoras.flatMap(chosenWords).map(w => w.trim()).filter(Boolean))].filter(
    w => !typed.includes(w.toLowerCase()),
  );
  // La phrase des traits (lieu et tirages compris) se prolonge par le texte libre (« …, reading a book »),
  // ou se termine par un point. C'est la demande : section « Prompt » du prompt structuré.
  const text = wildcards.text;
  const body = sentence ? (text ? `${sentence}, ${text}` : `${sentence}.`) : text;

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

  // Prompt structuré par ordre d'importance : la LoRA d'abord (le mot déclencheur
  // agit mieux en tête), puis la demande, les raccourcis et le contexte général.
  const oneLine = (t: string) => t.trim().replace(/\s+/g, ' ');
  const sections: [string, string][] = [
    ['Lora', triggers.join(', ')],
    ['Prompt (important)', body],
    // « Éditer » : l'image à modifier est toujours la première envoyée. En anglais,
    // mieux suivi par les modèles ; jamais affiché dans la bulle (seul finalPrompt la contient).
    [
      'Images',
      req.editAssetId && images[0]?.id === req.editAssetId
        ? 'Edit image 1: it is the image to modify. Any other images are references only.'
        : '',
    ],
    [
      'Détails',
      contexts
        .filter(c => c.text.trim())
        .map(c => `${c.label.trim() ? `${c.label.trim()} : ` : ''}${oneLine(c.text)}`)
        .join('\n'),
    ],
    [
      'Contexte général',
      blocks.map(b => `- ${b.title.trim() ? `${b.title.trim()} : ` : ''}${oneLine(b.text)}`).join('\n'),
    ],
  ];
  const filled = sections.filter(([, body]) => body);
  // Prompt seul : on l'envoie tel quel, sans titre.
  const finalPrompt =
    filled.length === 1 && filled[0][0] === 'Prompt (important)'
      ? filled[0][1]
      : filled.map(([title, body]) => `# ${title}\n${body}`).join('\n\n');

  const built = buildInput({
    schema: endpoint.schema,
    task: resolution.task,
    prompt: finalPrompt,
    // ComfyUI exige un seed : on le tire ici pour qu'il soit enregistré avec la génération.
    params: local && req.params?.seed == null ? { ...req.params, seed: randomInt(MAX_SEED) } : (req.params ?? {}),
    images: imageUris,
    videos: videoUris,
    loras,
  });

  // Le visage ne passe pas par le schéma : il est ajouté au workflow au lancement.
  if (face) built.input.face_image_url = localAssetRef(face);

  const required = endpoint.schema.required ?? [];
  if (required.includes('prompt') && !built.input.prompt) {
    throw new HTTPException(400, { message: 'Ce modèle a besoin d’un prompt.' });
  }

  return {
    runtime: family.runtime,
    client,
    contexts,
    loras: personaLoras.map(l => ({ id: l.id, label: l.label, triggerWords: chosenWords(l) })),
    task: resolution.task,
    modelId: endpoint.modelId,
    input: built.input,
    finalPrompt,
    persona,
    references,
    face,
    traits,
    randomized: drawn.length > 0 || wildcards.randomized,
    unknownWildcards: wildcards.unknown,
    dropped: built.dropped,
    lorasApplied: built.lorasApplied,
  };
}

/** Référence à un asset local dans l'`input` d'une génération ComfyUI (résolue au lancement). */
function localAssetRef(asset: AssetRow): string {
  return `asset:${asset.id}`;
}

/** Devis : SpicyAPI pour le cloud, gratuit pour une génération locale. */
async function quoteFor(p: Prepared): Promise<QuoteLike> {
  if (!p.client) {
    return {
      quoteId: 'local',
      estimatedCost: '0',
      maxCharge: '0',
      quantity: '1',
      unit: 'per_image',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }
  const client = p.client;
  return callSpicy(() => client.quoteTask({ model: p.modelId, input: p.input }));
}

/** Montant décimal (chaîne SpicyAPI) multiplié par le nombre d'images d'une série. */
function times(amount: string, count: number): string {
  return count === 1 ? amount : String(Number((Number(amount) * count).toFixed(6)));
}

export async function quoteGeneration(user: SessionUser, req: GenerationRequest): Promise<QuoteResponse> {
  const p = await prepare(user, req);
  return toQuoteResponse(p, await quoteFor(p), req.count ?? 1);
}

export class PriceChangedError extends Error {
  constructor(public quote: QuoteResponse) {
    super('price_changed');
  }
}

/** Réglages propres à une image d'une série (images master : une variante par image). */
export interface PerImage {
  prompt?: string;
  variation?: GenerationVariation;
}

export async function createGeneration(
  user: SessionUser,
  req: GenerationRequest,
  perImage?: (i: number) => PerImage,
): Promise<CreateGenerationResponse> {
  const count = req.count ?? 1;
  // Créateur de personnage : chaque image a son propre tirage de traits.
  const traitsFor = (i: number) => req.traitDraws?.[i] ?? req.traitIds;
  const promptFor = (i: number) => perImage?.(i).prompt ?? req.prompt;
  const p = await prepare(user, { ...req, prompt: promptFor(0), traitIds: traitsFor(0) }, true);
  const quote = await quoteFor(p);

  // Le devis affiché au clic (total de la série) vaut confirmation ; s'il a augmenté entre-temps, on redemande.
  const total = times(quote.estimatedCost, count);
  if (req.expectedCost !== undefined && Number(total) > Number(req.expectedCost) + 1e-9) {
    throw new PriceChangedError(toQuoteResponse(p, quote, count));
  }

  // Série : N générations sœurs, chacune avec sa graine. En local, ComfyUI les exécute l'une après
  // l'autre (sa file est séquentielle) ; côté SpicyAPI, ce sont N tâches.
  const batchId = count > 1 ? randomUUID() : null;
  let threadId = req.threadId ?? null;
  let first: CreateGenerationResponse | null = null;
  for (let i = 0; i < count; i++) {
    // Seed fixé par l'utilisateur : décalé d'une image à l'autre, sinon la série donnerait N fois la même image.
    const params = { ...req.params };
    if (i > 0 && typeof params.seed === 'number') params.seed = (params.seed + i) % MAX_SEED;
    const pi = i === 0 ? p : await prepare(user, { ...req, params, prompt: promptFor(i), traitIds: traitsFor(i) }, true);
    const qi = i === 0 ? quote : await quoteFor(pi);
    const res = await launch(user, pi, qi, {
      threadId,
      personaId: pi.persona?.id ?? null,
      family: req.family,
      prompt: promptFor(i),
      refMode: req.refMode ?? 'start-frame',
      params: i === 0 ? (req.params ?? {}) : params,
      batchId,
      batchIndex: i,
      variation: perImage?.(i).variation ?? null,
    });
    threadId = res.thread.id;
    first ??= res;
  }
  return first!;
}

type Quote = Awaited<ReturnType<SpicyClient['quoteTask']>>;
type QuoteLike = Pick<Quote, 'quoteId' | 'estimatedCost' | 'maxCharge' | 'quantity' | 'unit' | 'expiresAt'>;

function toQuoteResponse(p: Prepared, quote: QuoteLike, count = 1): QuoteResponse {
  return {
    count,
    finalPrompt: p.finalPrompt,
    randomized: p.randomized,
    unknownWildcards: p.unknownWildcards,
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
  quote: QuoteLike,
  meta: {
    threadId: string | null;
    personaId: string | null;
    family: string;
    prompt: string;
    refMode: 'start-frame' | 'reference';
    params: Record<string, unknown>;
    batchId?: string | null;
    batchIndex?: number;
    variation?: GenerationVariation | null;
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
    // Titre lisible : sans la syntaxe des tirages (`{a|b}` → « a », `__tenue__` → « tenue »).
    const readable = meta.prompt
      .replace(/\{(?:\d+(?:\.\d+)?::)?([^{}|]*)[^{}]*\}/g, '$1')
      .replace(/__([a-z0-9_/-]+)__/gi, (_, key: string) => key.replace(/[_/-]+/g, ' '))
      .trim();
    const title = readable.slice(0, 60) || getFamily(meta.family)!.label;
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
      provider: p.runtime,
      modelId: p.modelId,
      task: p.task,
      refMode: meta.refMode,
      params: meta.params,
      input: p.input,
      referenceAssetIds: p.references.map(r => r.id),
      faceAssetId: p.face?.id ?? null,
      traits: p.traits,
      batchId: meta.batchId ?? null,
      batchIndex: meta.batchIndex ?? 0,
      variation: meta.variation ?? null,
      contexts: p.contexts,
      loras: p.loras,
      lorasApplied: p.lorasApplied,
      idempotencyKey,
      estimatedCost: quote.estimatedCost,
    })
    .returning();

  try {
    if (p.client) {
      const accepted = await p.client.createTask(
        { model: p.modelId, input: p.input, quoteId: quote.quoteId, expectedCost: quote.estimatedCost },
        { idempotencyKey },
      );
      await db
        .update(generations)
        .set({ spicyTaskId: accepted.taskId, estimatedCost: accepted.estimatedCost })
        .where(eq(generations.id, row.id));
    } else {
      const comfyPromptId = await submitToComfy(p);
      await db.update(generations).set({ comfyPromptId }).where(eq(generations.id, row.id));
    }
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

// ── ComfyUI (local) ───────────────────────────────────────────

/** Envoie les images d'entrée à ComfyUI, remplit le workflow et le met en file. Renvoie le `prompt_id`. */
async function submitToComfy(p: Prepared): Promise<string> {
  const endpoint = localEndpoint(p.modelId);
  if (!endpoint) throw new Error(`Workflow local introuvable pour ${p.modelId}.`);

  const upload = async (asset: AssetRow) =>
    uploadImage(await readFile(asset.filePath), `ai-fluence-${asset.id}.${extFor(asset.mime)}`, asset.mime);

  // Images d'entrée : l'image de départ (`image_url`) ou les références (`image_urls`), dans l'ordre.
  const refs = [
    ...(typeof p.input.image_url === 'string' ? [p.input.image_url] : []),
    ...(Array.isArray(p.input.image_urls) ? p.input.image_urls.filter((r): r is string => typeof r === 'string') : []),
  ];
  const inputs = refs.map(ref => {
    const asset = p.references.find(a => localAssetRef(a) === ref);
    if (!asset) throw new Error('Image d’entrée introuvable.');
    return asset;
  });
  const images = await Promise.all(inputs.map(upload));
  const imageSizes = inputs.map(a => (a.width && a.height ? { width: a.width, height: a.height } : null));
  const image = endpoint.slots.image ? images[0] : undefined;
  const face = p.face ? await upload(p.face) : undefined;
  return queuePrompt(await buildGraph(endpoint, p.input, { image, face, images, imageSizes }));
}

/** Largeur et hauteur lues dans l'en-tête PNG (ComfyUI enregistre en PNG). */
function pngSize(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 24 || data[0] !== 0x89 || data[1] !== 0x50) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function watchComfy(row: GenerationRow, promptId: string): Promise<void> {
  const endpoint = localEndpoint(row.modelId);
  if (!endpoint) throw new Error(`Workflow local introuvable pour ${row.modelId}.`);
  const started = Date.now();
  let failures = 0;

  while (Date.now() - started < MAX_WATCH_MS) {
    let state: Awaited<ReturnType<typeof getPromptState>>;
    try {
      state = await getPromptState(promptId, endpoint.outputNode);
      failures = 0;
    } catch (err) {
      if (++failures > 20) throw err;
      await sleep(Math.min(30000, 1500 * failures));
      continue;
    }

    if (state.state === 'queued' || state.state === 'running') {
      await db
        .update(generations)
        .set({ status: state.state })
        .where(and(eq(generations.id, row.id), inArray(generations.status, ['queued', 'running'])));
      await sleep(1500);
      continue;
    }

    if (state.state === 'succeeded') {
      const dir = await outputDirOf(row);
      let index = 0;
      for (const file of state.files) {
        const { data, mime } = await downloadFile(file);
        await storeOutput(row, dir, index++, data, mime, pngSize(data) ?? {});
        // Rapatriée dans les médias de l'app : la copie de ComfyUI n'est plus utile.
        await deleteOutputFile(file);
      }
      const seed = typeof row.input.seed === 'number' ? row.input.seed : null;
      await db
        .update(generations)
        .set({ status: 'succeeded', cost: '0', settled: true, seed, durationMs: state.durationMs, completedAt: new Date() })
        .where(eq(generations.id, row.id));
      await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, row.threadId));
    } else {
      await db
        .update(generations)
        .set({
          status: 'failed',
          errorCode: state.state === 'lost' ? 'comfy_lost' : 'comfy_failed',
          errorMessage: 'message' in state ? state.message : 'ComfyUI a redémarré avant la fin de la génération.',
          cost: '0',
          settled: true,
          completedAt: new Date(),
        })
        .where(eq(generations.id, row.id));
    }
    return;
  }
  await db
    .update(generations)
    .set({ status: 'failed', errorCode: 'timeout', errorMessage: 'Suivi interrompu : la génération locale est trop longue.', completedAt: new Date() })
    .where(eq(generations.id, row.id));
}

// ── Suppression ───────────────────────────────────────────────
// Retire de l'app (fil, galerie) sans jamais toucher aux fichiers sur le disque.

/** Avatars qui pointent vers ces images : remis à vide plutôt que laissés cassés. */
async function detachAvatars(assetIds: string[]) {
  if (!assetIds.length) return;
  await db.update(personas).set({ avatarAssetId: null }).where(inArray(personas.avatarAssetId, assetIds));
  await db.update(users).set({ avatarAssetId: null }).where(inArray(users.avatarAssetId, assetIds));
}

/** Supprime une demande et ses résultats. Une génération locale en cours est annulée dans ComfyUI. */
export async function deleteGeneration(user: SessionUser, generationId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(generations)
    .where(and(eq(generations.id, generationId), eq(generations.userId, user.id)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: 'Génération introuvable.' });

  const pending = row.status === 'queued' || row.status === 'running';
  if (pending && row.provider === 'spicy') {
    throw new HTTPException(409, {
      message: 'Génération SpicyAPI en cours : elle ne peut pas être annulée, attends la fin pour la supprimer.',
    });
  }
  if (pending && row.comfyPromptId) await cancelPrompt(row.comfyPromptId).catch(() => undefined);

  const outputs = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.generationId, row.id), eq(assets.kind, 'output')));
  const outputIds = outputs.map(a => a.id);
  await detachAvatars(outputIds);
  if (outputIds.length) await db.delete(assets).where(inArray(assets.id, outputIds));
  await db.delete(generations).where(eq(generations.id, row.id));
}

/**
 * Supprime un fil, ses demandes et leurs résultats (fil et galerie).
 * Refusé si une génération SpicyAPI tourne encore ; les générations locales en cours sont annulées.
 */
export async function deleteThread(user: SessionUser, threadId: string): Promise<void> {
  const [thread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, user.id)))
    .limit(1);
  if (!thread) throw new HTTPException(404, { message: 'Fil introuvable.' });

  const rows = await db
    .select({ id: generations.id, status: generations.status, provider: generations.provider })
    .from(generations)
    .where(eq(generations.threadId, thread.id));
  if (rows.some(r => r.provider === 'spicy' && (r.status === 'queued' || r.status === 'running'))) {
    throw new HTTPException(409, {
      message: 'Une génération SpicyAPI de ce fil est en cours : attends la fin pour le supprimer.',
    });
  }
  for (const row of rows) await deleteGeneration(user, row.id);
  await db.delete(threads).where(eq(threads.id, thread.id));
}

/** Supprime une image ou une vidéo générée. */
export async function deleteOutput(user: SessionUser, assetId: string): Promise<void> {
  const [asset] = await db
    .select({ id: assets.id, kind: assets.kind })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, user.id)))
    .limit(1);
  if (!asset) throw new HTTPException(404, { message: 'Média introuvable.' });
  if (asset.kind !== 'output') throw new HTTPException(400, { message: 'Seuls les résultats générés peuvent être supprimés.' });
  await detachAvatars([asset.id]);
  await db.delete(assets).where(eq(assets.id, asset.id));
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
      runtime: 'spicy',
      client,
      contexts: [],
      loras: [],
      task: 'upscale',
      modelId: tool.modelId,
      input,
      finalPrompt: '',
      persona: null,
      references: [asset],
      randomized: false,
      unknownWildcards: [],
      face: null,
      traits: [],
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
  return toQuoteResponse(u.p, await quoteFor(u.p));
}

export async function createUpscale(user: SessionUser, req: UpscaleRequest): Promise<CreateGenerationResponse> {
  const u = await prepareUpscale(user, req);
  const quote = await quoteFor(u.p);
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

  const refIds = [...new Set(rows.flatMap(r => (r.faceAssetId ? [...r.referenceAssetIds, r.faceAssetId] : r.referenceAssetIds)))];
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
      (r.faceAssetId && refsById.get(r.faceAssetId)) || null,
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
    if (!row || row.status === 'succeeded' || row.status === 'failed') return;
    if (row.provider === 'comfy') {
      if (row.comfyPromptId) await watchComfy(row, row.comfyPromptId);
      return;
    }
    if (!row.spicyTaskId) return;
    const client = await clientForUser(row.userId);
    const interval = row.task.includes('video') ? 5000 : 2500;
    const started = Date.now();
    let failures = 0;

    while (Date.now() - started < MAX_WATCH_MS) {
      let record: TaskRecord;
      try {
        record = await client.getTask(row.spicyTaskId!);
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
      if (!record.settled) void settleLater(row.id, row.userId, row.spicyTaskId!);
      return;
    }
    await db
      .update(generations)
      .set({ status: 'failed', errorCode: 'timeout', errorMessage: 'Suivi interrompu : la tâche est trop longue.', completedAt: new Date() })
      .where(eq(generations.id, row.id));
  } catch (err) {
    console.error(`[watch] ${generationId}:`, (err as Error).message);
    await db
      .update(generations)
      .set({ status: 'failed', errorCode: 'watch_failed', errorMessage: (err as Error).message, completedAt: new Date() })
      .where(and(eq(generations.id, generationId), inArray(generations.status, ['queued', 'running'])));
  } finally {
    watching.delete(generationId);
  }
}

type GenerationRow = typeof generations.$inferSelect;

/** Dossier des résultats : `<médias>/<persona>/<jour>/`. */
async function outputDirOf(row: GenerationRow): Promise<string> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, row.userId)).limit(1);
  const settings = await getSettingsRow(row.userId);
  const baseDir = mediaDirOf(user, settings);
  let personaFolder = 'sans-persona';
  if (row.personaId) {
    const [p] = await db.select({ name: personas.name }).from(personas).where(eq(personas.id, row.personaId)).limit(1);
    if (p) personaFolder = slug(p.name);
  }
  return join(baseDir, personaFolder, dayFolder());
}

/** Écrit un résultat sur le disque et l'enregistre comme asset de la génération. */
async function storeOutput(
  row: GenerationRow,
  dir: string,
  index: number,
  data: Uint8Array,
  mime: string,
  meta: { width?: number | null; height?: number | null; durationSeconds?: number | null } = {},
) {
  const filePath = join(dir, `${row.id.slice(0, 8)}-${index}.${extFor(mime)}`);
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
    width: meta.width ?? null,
    height: meta.height ?? null,
    durationSeconds: meta.durationSeconds ?? null,
  });
}

async function handleSuccess(row: GenerationRow, record: TaskRecord) {
  const dir = await outputDirOf(row);

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
    await storeOutput(row, dir, index++, data, mime, out);
  }

  const seed = typeof record.input?.seed === 'number' ? (record.input.seed as number) : null;
  const durationMs = record.completedAt ? Date.parse(record.completedAt) - Date.parse(record.createdAt) : null;
  await db
    .update(generations)
    .set({
      status: 'succeeded',
      cost: record.cost,
      settled: record.settled,
      seed,
      durationMs,
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
    .select({
      id: generations.id,
      spicyTaskId: generations.spicyTaskId,
      comfyPromptId: generations.comfyPromptId,
      createdAt: generations.createdAt,
    })
    .from(generations)
    .where(inArray(generations.status, ['queued', 'running']));
  for (const g of pending) {
    if (g.spicyTaskId || g.comfyPromptId) void watchGeneration(g.id);
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
