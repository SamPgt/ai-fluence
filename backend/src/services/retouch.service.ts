/**
 * Retouche au pinceau (outil local) : l'utilisateur peint une zone ratée (une main à trois doigts…) dans la
 * visionneuse ; klein la refait, guidé par une courte consigne, et le résultat arrive comme une nouvelle génération
 * dans le fil de l'image d'origine. Le reste de l'image ne change pas (cf. `buildKleinRetouch`).
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CreateGenerationResponse } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, generations } from '../db/schema.js';
import type { SessionUser } from '../types.js';
import { getCatalog } from './spicy.service.js';
import type { RetouchBox } from './comfy-builders.js';
import { createGeneration } from './generation.service.js';
import { getSettingsRow, mediaDirOf } from './settings.service.js';
import { join, saveFile } from './storage.service.js';

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
  if (!asset.width || !asset.height) throw new HTTPException(400, { message: 'Taille de l’image inconnue.' });
  if (input.mask.type !== 'image/png') throw new HTTPException(400, { message: 'Le masque doit être un PNG.' });
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
    new Uint8Array(await input.mask.arrayBuffer()),
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
