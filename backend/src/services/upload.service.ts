/**
 * Enregistrement d'un fichier importé (upload depuis l'ordinateur ou une
 * librairie en ligne) comme asset `upload` de l'utilisateur.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { assets, personas } from '../db/schema.js';
import type { SessionUser } from '../types.js';
import { getSettingsRow, mediaDirOf, slug } from './settings.service.js';
import { extFor, join, mediaTypeOf, saveFile } from './storage.service.js';

export async function ownedPersona(userId: string, personaId: string | null | undefined) {
  if (!personaId) return null;
  const [p] = await db
    .select()
    .from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)))
    .limit(1);
  return p ?? null;
}

/** Range le fichier dans `references/<persona>` (ou `divers`) et crée l'asset. */
export async function storeUpload(
  user: SessionUser,
  opts: { personaId: string | null; mime: string; data: Uint8Array; isReference?: boolean },
) {
  const persona = await ownedPersona(user.id, opts.personaId);
  const dir = join(mediaDirOf(user, await getSettingsRow(user.id)), 'references', persona ? slug(persona.name) : 'divers');
  const saved = await saveFile(join(dir, `${randomUUID().slice(0, 12)}.${extFor(opts.mime)}`), opts.data);
  const [row] = await db
    .insert(assets)
    .values({
      userId: user.id,
      personaId: persona?.id ?? null,
      kind: 'upload',
      mediaType: mediaTypeOf(opts.mime),
      mime: opts.mime,
      filePath: saved.path,
      bytes: saved.bytes,
      // Référence d'un persona, ou de Général sans persona (jamais d'un persona inconnu).
      isReference: Boolean(opts.isReference && (persona || !opts.personaId)),
    })
    .returning();
  return row;
}
