/**
 * Voix de référence envoyée aux modèles vidéo. Les extraits publics d'ElevenLabs sont trop
 * courts (environ 2 s) : on fait dire une phrase neutre d'une dizaine de secondes par la
 * voix, une seule fois par voix ElevenLabs, partagée par tous (dossier `application/voix`
 * des données de l'app ; au déploiement, ces fichiers passeront sur le CDN).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SpicyClient } from '@spicyapi/sdk';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { voiceSamples } from '../db/schema.js';
import { env } from '../env.js';
import { requireElevenLabsKey, synthesizeSpeech } from './elevenlabs.service.js';
import { callSpicy } from './spicy.service.js';
import { saveFile } from './storage.service.js';

/** Une dizaine de secondes, ton naturel : de quoi donner le timbre au modèle. */
const SAMPLE_TEXT =
  'Bonjour, je suis ravie de te retrouver aujourd’hui. Je vais te raconter une petite histoire, ' +
  'calmement, avec ma voix de tous les jours, comme si nous étions en train de discuter tranquillement.';

const pending = new Map<string, Promise<string>>();

/** Chemin de l'extrait de cette voix, généré au premier besoin (avec la clé ElevenLabs du compte). */
export async function voiceSamplePath(userId: string, voiceId: string): Promise<string> {
  const [row] = await db.select().from(voiceSamples).where(eq(voiceSamples.voiceId, voiceId)).limit(1);
  if (row && existsSync(row.filePath)) return row.filePath;
  const running = pending.get(voiceId);
  if (running) return running;
  const job = (async () => {
    const apiKey = await requireElevenLabsKey(userId);
    const audio = await synthesizeSpeech(apiKey, voiceId, SAMPLE_TEXT);
    const safe = voiceId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const saved = await saveFile(join(env.DATA_DIR, 'application', 'voix', `${safe}.${audio.ext}`), audio.data);
    await db
      .insert(voiceSamples)
      .values({ voiceId, filePath: saved.path, mime: audio.mime, bytes: saved.bytes })
      .onConflictDoUpdate({ target: voiceSamples.voiceId, set: { filePath: saved.path, mime: audio.mime, bytes: saved.bytes } });
    return saved.path;
  })().finally(() => pending.delete(voiceId));
  pending.set(voiceId, job);
  return job;
}

/** Copies déjà envoyées à SpicyAPI (valables 24 h), par compte et par voix. */
const uploads = new Map<string, { uri: string; expiresAt: number }>();
const UPLOAD_SAFETY_MS = 60 * 60 * 1000;

/** URI SpicyAPI de l'extrait de cette voix, prête pour `reference_audio_urls`. */
export async function voiceSampleUri(client: SpicyClient, userId: string, voiceId: string): Promise<string> {
  const key = `${userId}:${voiceId}`;
  const cached = uploads.get(key);
  if (cached && cached.expiresAt - Date.now() > UPLOAD_SAFETY_MS) return cached.uri;
  const path = await voiceSamplePath(userId, voiceId);
  const uploaded = await callSpicy(() => client.uploadFile(path));
  uploads.set(key, { uri: uploaded.uri, expiresAt: new Date(uploaded.expiresAt).getTime() });
  return uploaded.uri;
}
