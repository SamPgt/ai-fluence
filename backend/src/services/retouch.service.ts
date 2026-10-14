/**
 * Retouche au pinceau (outil local) : l'utilisateur peint une zone ratée (une main à trois doigts…) dans la
 * visionneuse ; klein la refait, guidé par une courte consigne, et le résultat arrive comme une nouvelle génération
 * dans le fil de l'image d'origine. Le reste de l'image ne change pas (cf. `buildKleinRetouch`).
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CreateGenerationResponse } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, generations, users } from '../db/schema.js';
import type { SessionUser } from '../types.js';
import { getCatalog } from './spicy.service.js';
import type { AutofixKind, RetouchBox } from './comfy-builders.js';
import { hasNodes, queuePrompt, uploadImage, waitForText } from './comfy.service.js';
import { createGeneration } from './generation.service.js';
import { getSettingsRow, mediaDirOf } from './settings.service.js';
import { extFor, join, saveFile } from './storage.service.js';

/** klein 9B suit mieux la consigne ; 4B en repli. */
const FAMILIES = ['local/flux2-klein-9b', 'local/flux2-klein-4b'];
/** Sans consigne : la zone est refaite au plus naturel. */
const DEFAULT_PROMPT = 'natural, anatomically correct, realistic details that blend with the rest of the photo';

export async function retouchFamily(userId: string): Promise<string | null> {
  const catalog = await getCatalog(userId);
  return FAMILIES.find(id => catalog.families.find(f => f.id === id)?.available) ?? null;
}

export async function retouchImage(
  user: SessionUser,
  input: { assetId: string; prompt: string; box: RetouchBox; mask: File },
): Promise<CreateGenerationResponse> {
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, input.assetId), eq(assets.userId, user.id)))
    .limit(1);
  if (!asset || asset.mediaType !== 'image') throw new HTTPException(404, { message: 'Image introuvable.' });
  if (input.mask.type !== 'image/png') throw new HTTPException(400, { message: 'Le masque doit être un PNG.' });
  const maskData = new Uint8Array(await input.mask.arrayBuffer());
  // Image importée : sa taille n'était pas connue ; le masque est à la taille de l'image (en-tête PNG).
  if (!asset.width || !asset.height) {
    const view = new DataView(maskData.buffer, maskData.byteOffset, maskData.byteLength);
    if (maskData.length < 24 || maskData[1] !== 0x50) throw new HTTPException(400, { message: 'Masque illisible.' });
    asset.width = view.getUint32(16);
    asset.height = view.getUint32(20);
    await db.update(assets).set({ width: asset.width, height: asset.height }).where(eq(assets.id, asset.id));
  }
  const family = await retouchFamily(user.id);
  if (!family) throw new HTTPException(400, { message: 'Retouche : il faut FLUX.2 klein en local (ComfyUI démarré).' });

  // Le résultat rejoint le fil de l'image d'origine (un nouveau fil pour une image importée).
  const [source] = asset.generationId
    ? await db
        .select({ threadId: generations.threadId, personaId: generations.personaId })
        .from(generations)
        .where(eq(generations.id, asset.generationId))
        .limit(1)
    : [];

  const saved = await saveFile(
    join(mediaDirOf(user, await getSettingsRow(user.id)), 'retouches', `masque-${randomUUID().slice(0, 12)}.png`),
    maskData,
  );
  const [mask] = await db
    .insert(assets)
    .values({
      userId: user.id,
      personaId: asset.personaId,
      kind: 'mask',
      mediaType: 'image',
      mime: 'image/png',
      filePath: saved.path,
      bytes: saved.bytes,
      width: asset.width,
      height: asset.height,
    })
    .returning({ id: assets.id });

  return createGeneration(user, {
    family,
    threadId: source?.threadId ?? null,
    personaId: source?.personaId ?? asset.personaId,
    prompt: input.prompt.trim() || DEFAULT_PROMPT,
    params: { retouch: { mask: `asset:${mask.id}`, box: input.box } },
    referenceAssetIds: [asset.id],
    count: 1,
  });
}

// ── Correction automatique : visages, mains, pieds ─────────────────────────────

/** Nœud de détection d'AI Fluence (`comfyui-nodes/ai_fluence`, à copier dans `ComfyUI/custom_nodes`). */
const DETECT_NODE = 'AIFluenceDetectParts';
const LABELS: Record<AutofixKind, [string, string]> = { face: ['visage', 'visages'], hand: ['main', 'mains'], foot: ['pied', 'pieds'] };

export interface Part extends RetouchBox {
  kind: AutofixKind;
}

/** Cadres d'une même partie qui se chevauchent (deux pieds collés, un visage vu deux fois) : fusionnés. */
function mergeOverlaps(parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const hit = out.find(
      o => o.kind === p.kind && p.x < o.x + o.width && o.x < p.x + p.width && p.y < o.y + o.height && o.y < p.y + p.height,
    );
    if (!hit) {
      out.push({ ...p });
      continue;
    }
    const x1 = Math.max(hit.x + hit.width, p.x + p.width);
    const y1 = Math.max(hit.y + hit.height, p.y + p.height);
    hit.x = Math.min(hit.x, p.x);
    hit.y = Math.min(hit.y, p.y);
    hit.width = x1 - hit.x;
    hit.height = y1 - hit.y;
  }
  return out;
}

async function ownedImage(userId: string, assetId: string) {
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
    .limit(1);
  if (!asset || asset.mediaType !== 'image') throw new HTTPException(404, { message: 'Image introuvable.' });
  return asset;
}

/**
 * Étape 1 : repère les visages, mains et pieds (nœud AI Fluence dans ComfyUI, sur le processeur, ~1 s). Les zones
 * sont montrées à l'utilisateur, qui décoche les fausses (un sac en cuir vu comme une main) avant la correction.
 */
export async function detectParts(
  user: SessionUser,
  input: { assetId: string; kinds: AutofixKind[] },
): Promise<{ width: number; height: number; parts: (Part & { conf: number })[] }> {
  const asset = await ownedImage(user.id, input.assetId);
  if (!(await hasNodes([DETECT_NODE]))) {
    throw new HTTPException(400, {
      message: 'Nœud de détection absent de ComfyUI : copie comfyui-nodes/ai_fluence dans ComfyUI/custom_nodes, puis redémarre ComfyUI.',
    });
  }
  const image = await uploadImage(await readFile(asset.filePath), `ai-fluence-${asset.id}.${extFor(asset.mime)}`, asset.mime);
  const promptId = await queuePrompt({
    '1': { class_type: 'LoadImage', inputs: { image } },
    '2': { class_type: DETECT_NODE, inputs: { image: ['1', 0], parts: input.kinds.join(','), confidence: 0.3 } },
    '3': { class_type: 'PreviewAny', inputs: { source: ['2', 0] } },
  });
  const detected = JSON.parse(await waitForText(promptId, '3')) as { width: number; height: number; parts: (Part & { conf: number })[] };
  // Image importée : sa taille n'était pas connue, la détection la donne (la retouche en a besoin).
  if (!asset.width || !asset.height) {
    await db.update(assets).set({ width: detected.width, height: detected.height }).where(eq(assets.id, asset.id));
  }
  const parts = mergeOverlaps(detected.parts.filter(p => input.kinds.includes(p.kind))) as (Part & { conf: number })[];
  return { width: detected.width, height: detected.height, parts };
}

/**
 * Correction automatique après une génération (option « Correction auto ») : sans confirmation possible, on ne garde
 * que les détections fiables. Visages et pieds (pose) le sont ; une main seulement à partir de 0,8 (un sac en cuir
 * avait été vu comme une main à 0,70).
 */
export async function autoCorrect(userId: string, assetId: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;
  const session = { id: user.id, email: user.email, name: user.name, avatarAssetId: user.avatarAssetId, createdAt: user.createdAt };
  const detected = await detectParts(session, { assetId, kinds: ['face', 'hand', 'foot'] });
  const parts = detected.parts.filter(p => p.kind !== 'hand' || p.conf >= 0.8);
  if (parts.length) await autofixImage(session, { assetId, parts });
}

/** Étape 2 : les zones gardées sont refaites par klein l'une après l'autre ; une nouvelle génération dans le fil. */
export async function autofixImage(
  user: SessionUser,
  input: { assetId: string; parts: Part[] },
): Promise<CreateGenerationResponse & { found: string }> {
  const asset = await ownedImage(user.id, input.assetId);
  const family = await retouchFamily(user.id);
  if (!family) throw new HTTPException(400, { message: 'Correction : il faut FLUX.2 klein en local (ComfyUI démarré).' });
  if (!input.parts.length) throw new HTTPException(400, { message: 'Aucune zone à corriger.' });
  if (!(await hasNodes([DETECT_NODE, 'AIFluenceColorMatch']))) {
    throw new HTTPException(400, {
      message: 'Nœuds AI Fluence absents ou anciens dans ComfyUI : recopie comfyui-nodes/ai_fluence dans ComfyUI/custom_nodes, puis redémarre ComfyUI.',
    });
  }

  const [source] = asset.generationId
    ? await db
        .select({ threadId: generations.threadId, personaId: generations.personaId })
        .from(generations)
        .where(eq(generations.id, asset.generationId))
        .limit(1)
    : [];
  const counts = (Object.keys(LABELS) as AutofixKind[])
    .map(kind => [kind, input.parts.filter(p => p.kind === kind).length] as const)
    .filter(([, n]) => n > 0);
  const found = counts.map(([kind, n]) => `${n} ${LABELS[kind][n > 1 ? 1 : 0]}`).join(', ');
  const res = await createGeneration(user, {
    family,
    threadId: source?.threadId ?? null,
    personaId: source?.personaId ?? asset.personaId,
    prompt: `Correction automatique : ${found}`,
    params: { autofix: { parts: input.parts.map(({ kind, x, y, width, height }) => ({ kind, x, y, width, height })) } },
    referenceAssetIds: [asset.id],
    count: 1,
  });
  return { ...res, found };
}
