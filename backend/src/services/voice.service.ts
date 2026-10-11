/**
 * Voix des personnages (vidéos parlées). Outil local, comme ComfyUI : actif seulement si `VOICE_URL`
 * (serveur de voix, cf. `voice-server/`) et `COMFYUI_URL` sont renseignés.
 *
 * - Créer une voix : LTX-2.3 anime l'image du personnage qui parle (voix inventée d'après le prompt),
 *   on en garde la piste audio comme extrait de référence, proposé avant d'être adopté.
 * - Faire parler : le serveur de voix (Chatterbox) dit un texte en imitant l'extrait de référence.
 *
 * La création est suivie sans boucle en arrière-plan : son état est relu dans ComfyUI à chaque lecture
 * de la voix (la page du personnage interroge tant qu'elle est en cours).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { HTTPException } from 'hono/http-exception';
import { and, eq, isNull } from 'drizzle-orm';
import type { PersonaVoice } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, personas, type PersonaVoiceRow } from '../db/schema.js';
import { env } from '../env.js';
import { buildLtx } from './comfy-builders.js';
import { LTX_FILES, resolveRequirements } from './comfy-workflows.js';
import { deleteOutputFile, downloadFile, freeComfyMemory, getPromptState, isComfyRunning, queuePrompt, uploadImage } from './comfy.service.js';
import { mediaUrl } from './serialize.js';
import { getSettingsRow, mediaDirOf, slug } from './settings.service.js';
import { extFor, join, saveFile } from './storage.service.js';
import type { SessionUser } from '../types.js';

type PersonaRow = typeof personas.$inferSelect;

/** Expressivité par défaut de Chatterbox (0,25 calme → 1 très expressive). */
const DEFAULT_EXAGGERATION = 0.6;
/** Le chargement du modèle peut prendre ~20 s ; une phrase longue ~10 s de plus. */
const TTS_TIMEOUT_MS = 3 * 60_000;
const LAUNCH_TIMEOUT_MS = 90_000;
/** Nœuds de sortie du workflow de création (cf. `buildLtx`) : la vidéo et la piste seule. */
const VIDEO_NODE = '9000';
const AUDIO_NODE = '9001';

export function isVoiceEnabled(): boolean {
  return Boolean(env.VOICE_URL && env.COMFYUI_URL);
}

// ── Serveur de voix ───────────────────────────────────────────

async function health(): Promise<boolean> {
  try {
    const res = await fetch(new URL('/health', env.VOICE_URL), { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

let launching: Promise<void> | null = null;

/** Lance le serveur de voix s'il ne répond pas (commande `VOICE_LAUNCH`, jamais une valeur venue d'une requête). */
async function ensureServer(): Promise<void> {
  if (!env.VOICE_URL) throw new HTTPException(400, { message: 'Serveur de voix non configuré (VOICE_URL).' });
  if (await health()) return;
  if (!env.VOICE_LAUNCH) throw new HTTPException(503, { message: 'Le serveur de voix ne répond pas (VOICE_URL).' });
  launching ??= (async () => {
    // Détaché : il survit aux redémarrages du backend, comme ComfyUI.
    const child = spawn(env.VOICE_LAUNCH!, { shell: true, detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    const started = Date.now();
    while (Date.now() - started < LAUNCH_TIMEOUT_MS) {
      if (await health()) return;
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new HTTPException(503, { message: 'Le serveur de voix ne démarre pas (VOICE_LAUNCH).' });
  })().finally(() => {
    launching = null;
  });
  return launching;
}

async function voicePost(path: string, body: unknown, timeoutMs = 30_000): Promise<Response> {
  await ensureServer();
  const res = await fetch(new URL(path, env.VOICE_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new HTTPException(502, { message: `Serveur de voix : ${err?.error ?? `HTTP ${res.status}`}` });
  }
  return res;
}

/** Libère la VRAM du serveur de voix avant une génération vidéo (sans le démarrer s'il est arrêté). */
export async function unloadVoice(): Promise<void> {
  if (!env.VOICE_URL || !(await health())) return;
  await fetch(new URL('/unload', env.VOICE_URL), { method: 'POST', signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}

/** Format et position des échantillons d'un WAV PCM (en-tête RIFF). */
function wavLayout(data: Uint8Array): { byteRate: number; blockAlign: number; dataStart: number; dataSize: number; fmt: Uint8Array } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 12;
  let fmt: Uint8Array | null = null;
  while (offset + 8 <= data.byteLength) {
    const id = String.fromCharCode(...data.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') fmt = data.subarray(offset + 8, offset + 8 + size);
    if (id === 'data' && fmt) {
      const fmtView = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
      return { byteRate: fmtView.getUint32(8, true), blockAlign: fmtView.getUint16(12, true), dataStart: offset + 8, dataSize: size, fmt };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('Fichier audio illisible (WAV attendu).');
}

/** Durée d'un WAV PCM. */
export function wavSeconds(data: Uint8Array): number {
  const { byteRate, dataSize } = wavLayout(data);
  return dataSize / byteRate;
}

/** Ajoute du silence avant et après un WAV PCM. */
export function padWav(data: Uint8Array, leadSeconds: number, tailSeconds: number): Uint8Array {
  const { byteRate, blockAlign, dataStart, dataSize, fmt } = wavLayout(data);
  const silence = (s: number) => Math.round((s * byteRate) / blockAlign) * blockAlign;
  const lead = silence(leadSeconds);
  const tail = silence(tailSeconds);
  const size = lead + dataSize + tail;
  const out = new Uint8Array(12 + 8 + fmt.byteLength + 8 + size);
  const view = new DataView(out.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, out.byteLength - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, fmt.byteLength, true);
  out.set(fmt, 20);
  const dataAt = 20 + fmt.byteLength;
  ascii(dataAt, 'data');
  view.setUint32(dataAt + 4, size, true);
  out.set(data.subarray(dataStart, dataStart + dataSize), dataAt + 8 + lead);
  return out;
}

/** Fait dire un texte avec la voix d'un extrait de référence. Renvoie un WAV. */
async function synthesize(text: string, referencePath: string, exaggeration: number): Promise<Uint8Array> {
  // ComfyUI garde ses modèles en VRAM (LTX : ~10 Go) : sans place, le modèle de voix ne se charge pas.
  await freeComfyMemory().catch(() => undefined);
  const res = await voicePost('/tts', { text, reference: referencePath, exaggeration, language: 'fr' }, TTS_TIMEOUT_MS);
  return new Uint8Array(await res.arrayBuffer());
}

// ── Voix d'un personnage ──────────────────────────────────────

async function ownedPersona(userId: string, personaId: string): Promise<PersonaRow> {
  const [row] = await db
    .select()
    .from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId), isNull(personas.deletedAt)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: 'Personnage introuvable.' });
  return row;
}

async function assetRow(id: string | null | undefined) {
  if (!id) return null;
  const [row] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return row ?? null;
}

function voiceOf(row: PersonaRow): PersonaVoiceRow {
  return row.voice ?? { assetId: null, exaggeration: DEFAULT_EXAGGERATION };
}

async function saveVoice(personaId: string, voice: PersonaVoiceRow) {
  await db.update(personas).set({ voice, updatedAt: new Date() }).where(eq(personas.id, personaId));
}

async function voiceDir(user: Pick<SessionUser, 'id' | 'email'>, persona: PersonaRow): Promise<string> {
  return join(mediaDirOf(user, await getSettingsRow(user.id)), slug(persona.name), 'voix');
}

async function toVoice(voice: PersonaVoiceRow): Promise<PersonaVoice> {
  const current = await assetRow(voice.assetId);
  return {
    enabled: isVoiceEnabled(),
    url: current ? mediaUrl(current.id) : null,
    durationSeconds: current?.durationSeconds ?? null,
    exaggeration: voice.exaggeration,
    candidate: voice.candidateAssetId
      ? { audioUrl: mediaUrl(voice.candidateAssetId), videoUrl: voice.candidateVideoAssetId ? mediaUrl(voice.candidateVideoAssetId) : null }
      : null,
    job: voice.job
      ? { state: voice.job.error ? 'failed' : 'running', startedAt: voice.job.startedAt, error: voice.job.error ?? null }
      : null,
  };
}

/** État de la voix ; une création en cours est relue dans ComfyUI (et rapatriée si elle est terminée). */
export async function getVoice(user: SessionUser, personaId: string): Promise<PersonaVoice> {
  const persona = await ownedPersona(user.id, personaId);
  const voice = voiceOf(persona);
  if (voice.job && !voice.job.error) await followCreation(user, persona, voice).catch(err => {
    voice.job = { ...voice.job!, error: err instanceof Error ? err.message : String(err) };
    return saveVoice(persona.id, voice);
  });
  return toVoice(voice);
}

async function followCreation(user: SessionUser, persona: PersonaRow, voice: PersonaVoiceRow) {
  const state = await getPromptState(voice.job!.promptId, AUDIO_NODE);
  if (state.state === 'queued' || state.state === 'running') return;
  if (state.state !== 'succeeded') {
    voice.job = { ...voice.job!, error: 'message' in state ? state.message : 'ComfyUI a redémarré avant la fin.' };
    return saveVoice(persona.id, voice);
  }

  const dir = await voiceDir(user, persona);
  const stamp = Date.now();
  // La vidéo d'origine : pour réentendre la voix en situation.
  let videoAssetId: string | null = null;
  const video = state.outputs[VIDEO_NODE]?.[0];
  if (video) {
    const { data, mime } = await downloadFile(video);
    const saved = await saveFile(join(dir, `creation-${stamp}.${extFor(mime)}`), data);
    const [row] = await db
      .insert(assets)
      .values({ userId: user.id, personaId: persona.id, kind: 'voice', mediaType: 'video', mime, filePath: saved.path, bytes: saved.bytes })
      .returning({ id: assets.id });
    videoAssetId = row.id;
    await deleteOutputFile(video);
  }

  // La piste seule, puis l'extrait de référence (sans silences aux bords, 10 s au plus).
  const audio = state.outputs[AUDIO_NODE]?.[0];
  if (!audio) throw new Error('ComfyUI n’a pas produit de piste audio.');
  const raw = await downloadFile(audio);
  const rawSaved = await saveFile(join(dir, `creation-${stamp}-piste.${audio.filename.split('.').pop() ?? 'flac'}`), raw.data);
  await deleteOutputFile(audio);
  const refPath = join(dir, `voix-${stamp}.wav`);
  const res = await voicePost('/reference', { source: rawSaved.path, output: refPath, max_seconds: 10 });
  const { duration } = (await res.json()) as { duration: number };
  const ref = await readFile(refPath);
  const [refRow] = await db
    .insert(assets)
    .values({
      userId: user.id,
      personaId: persona.id,
      kind: 'voice',
      mediaType: 'audio',
      mime: 'audio/wav',
      filePath: refPath,
      bytes: ref.byteLength,
      durationSeconds: duration,
    })
    .returning({ id: assets.id });

  voice.candidateAssetId = refRow.id;
  voice.candidateVideoAssetId = videoAssetId;
  voice.job = null;
  await saveVoice(persona.id, voice);
}

const SUBJECT: Record<string, string> = { female: 'A young woman', male: 'A young man' };

/**
 * Lance la création d'une voix : LTX anime l'image du personnage qui raconte sa journée face caméra,
 * d'une voix décrite par `description` (facultatif, en français ou en anglais).
 */
export async function createVoice(user: SessionUser, personaId: string, description: string): Promise<PersonaVoice> {
  if (!isVoiceEnabled()) throw new HTTPException(400, { message: 'Voix non configurée (VOICE_URL, COMFYUI_URL).' });
  const persona = await ownedPersona(user.id, personaId);
  const voice = voiceOf(persona);
  if (voice.job && !voice.job.error) throw new HTTPException(409, { message: 'Une création de voix est déjà en cours.' });
  const avatar = await assetRow(persona.avatarAssetId);
  if (!avatar || avatar.mediaType !== 'image') {
    throw new HTTPException(400, { message: 'Il faut d’abord une image de référence (avatar) pour ce personnage.' });
  }
  if (!(await isComfyRunning())) throw new HTTPException(503, { message: 'Démarre ComfyUI pour créer une voix.' });
  const { files, missing } = await resolveRequirements({ requires: LTX_FILES } as Parameters<typeof resolveRequirements>[0]);
  if (missing.length) throw new HTTPException(400, { message: `Fichiers LTX-2.3 manquants dans ComfyUI : ${missing.join(', ')}.` });

  const image = await uploadImage(await readFile(avatar.filePath), `ai-fluence-${avatar.id}.${extFor(avatar.mime)}`, avatar.mime);
  const subject = SUBJECT[persona.gender ?? ''] ?? 'A person';
  const voiceLine = description.trim() ? ` Voice: ${description.trim()}.` : ' Natural, warm, friendly voice.';
  const prompt =
    `${subject} looks at the camera and talks casually in French, relaxed and smiling, like a vlogger telling about the day: ` +
    `"Coucou ! Alors aujourd'hui, je vais vous raconter ma journée, et franchement, c'était vraiment une super journée."` +
    `${voiceLine} Clear speech, close microphone, quiet room, no music. Natural smartphone video.`;
  // La VRAM du serveur de voix est rendue avant le gros modèle vidéo.
  await unloadVoice();
  const graph = buildLtx(
    // 512p : testé en 256p (2026-10-11), la vidéo se calcule ~2 fois plus vite, mais la voix sort nettement
    // moins bonne (plus robotique) : le son de LTX dépend de la qualité de l'image générée avec lui.
    { prompt, resolution: '512p', duration_seconds: 7 },
    { images: [image], imageSizes: [avatar.width && avatar.height ? { width: avatar.width, height: avatar.height } : null], files },
    { saveAudio: true },
  );
  const promptId = await queuePrompt(graph);
  voice.job = { promptId, startedAt: new Date().toISOString(), error: null };
  await saveVoice(persona.id, voice);
  return toVoice(voice);
}

/** Adopte la voix proposée, ou l'écarte. */
export async function decideCandidate(user: SessionUser, personaId: string, keep: boolean): Promise<PersonaVoice> {
  const persona = await ownedPersona(user.id, personaId);
  const voice = voiceOf(persona);
  if (!voice.candidateAssetId) throw new HTTPException(400, { message: 'Aucune voix proposée.' });
  if (keep) voice.assetId = voice.candidateAssetId;
  voice.candidateAssetId = null;
  voice.candidateVideoAssetId = null;
  await saveVoice(persona.id, voice);
  return toVoice(voice);
}

export async function updateVoice(user: SessionUser, personaId: string, patch: { exaggeration?: number; clearJob?: boolean }) {
  const persona = await ownedPersona(user.id, personaId);
  const voice = voiceOf(persona);
  if (patch.exaggeration !== undefined) voice.exaggeration = patch.exaggeration;
  if (patch.clearJob && voice.job?.error) voice.job = null;
  await saveVoice(persona.id, voice);
  return toVoice(voice);
}

/** Essai de la voix (adoptée, ou proposée avec `candidate`) : renvoie un WAV, rien n'est enregistré. */
export async function previewVoice(
  user: SessionUser,
  personaId: string,
  body: { text: string; exaggeration?: number; candidate?: boolean },
): Promise<Uint8Array> {
  const persona = await ownedPersona(user.id, personaId);
  const voice = voiceOf(persona);
  const ref = await assetRow(body.candidate ? voice.candidateAssetId : voice.assetId);
  if (!ref) throw new HTTPException(400, { message: body.candidate ? 'Aucune voix proposée.' : 'Ce personnage n’a pas encore de voix.' });
  return synthesize(body.text, ref.filePath, body.exaggeration ?? voice.exaggeration);
}

/** Morceaux d'un texte long, coupés aux fins de phrase (Chatterbox plafonne à ~40 s de parole par appel). */
function speechChunks(text: string, max = 250): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]+["»”’)]*\s*|[^.!?…]+$/g)?.map(t => t.trim()).filter(Boolean) ?? [text];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const last = chunks.at(-1);
    if (last && last.length + sentence.length + 1 <= max) chunks[chunks.length - 1] = `${last} ${sentence}`;
    else chunks.push(sentence);
  }
  return chunks;
}

/** Recolle des WAV de même format ; `gaps[i]` : silence (en secondes) entre la partie i et la suivante. */
function joinWavs(parts: Uint8Array[], gaps: number | number[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  const layouts = parts.map(wavLayout);
  const { byteRate, blockAlign } = layouts[0];
  const gapBytes = (i: number) => {
    const seconds = Array.isArray(gaps) ? (gaps[i] ?? 0) : gaps;
    return Math.round((seconds * byteRate) / blockAlign) * blockAlign;
  };
  const total = layouts.reduce((n, l, i) => n + l.dataSize + (i < parts.length - 1 ? gapBytes(i) : 0), 0);
  const pcm = new Uint8Array(total);
  let at = 0;
  parts.forEach((part, i) => {
    const { dataStart, dataSize } = layouts[i];
    pcm.set(part.subarray(dataStart, dataStart + dataSize), at);
    at += dataSize + (i < parts.length - 1 ? gapBytes(i) : 0);
  });
  // Un WAV sans échantillons au format du premier, rallongé du silence nécessaire, puis rempli.
  const empty = new Uint8Array(parts[0].subarray(0, layouts[0].dataStart));
  const out = padWav(withDataSize(empty, 0), 0, pcm.byteLength / byteRate);
  out.set(pcm, out.byteLength - pcm.byteLength);
  return out;
}

/** Balise de pause du texte dit : `[2s]`, `[1.5 s]`, `[pause 2s]` ; `[pause]` seul vaut 1 s. */
const PAUSE = /\[\s*(?:pause\s*)?(?:(\d+(?:[.,]\d+)?)\s*s?)?\s*\]/gi;

/**
 * Texte dit découpé en phrases et en silences exacts. Les balises de pause ne dépendent pas du modèle de voix
 * (qui suit la ponctuation à sa façon) : chaque morceau de texte est dit à part, et l'app pose les silences.
 */
export function parseSpeech(text: string): { lead: number; tail: number; pieces: { text: string; pauseBefore: number }[] } {
  const pieces: { text: string; pauseBefore: number }[] = [];
  let pending = 0;
  let lead = 0;
  let last = 0;
  const pushText = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (!pieces.length) lead = pending;
    pieces.push({ text: t, pauseBefore: pieces.length ? pending : 0 });
    pending = 0;
  };
  for (const m of text.matchAll(PAUSE)) {
    pushText(text.slice(last, m.index));
    pending += m[1] ? Math.min(30, Number(m[1].replace(',', '.'))) : 1;
    last = m.index! + m[0].length;
  }
  pushText(text.slice(last));
  if (!pieces.length) lead = 0;
  return { lead, tail: pending, pieces };
}

/** Le texte dit commence (ou finit) par une pause choisie : l'app n'ajoute pas la sienne. */
export function speechEdges(text: string): { lead: boolean; tail: boolean } {
  const t = text.trim();
  return { lead: /^\[\s*(?:pause[^\]]*|\d[^\]]*)\]/i.test(t), tail: /\[\s*(?:pause[^\]]*|\d[^\]]*)\]$/i.test(t) };
}

/** En-tête WAV dont le bloc `data` annonce `size` octets. */
function withDataSize(header: Uint8Array, size: number): Uint8Array {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  view.setUint32(header.byteLength - 4, size, true);
  return header;
}

/**
 * Empreinte d'une piste de texte dit : la voix, l'expressivité et le texte. Inscrite dans le nom du fichier
 * écouté depuis le composer, elle permet de réutiliser cette piste telle quelle pour la vidéo, tant que rien
 * n'a changé.
 */
function speechKey(voiceAssetId: string, exaggeration: number, text: string): string {
  return createHash('sha1').update(`${voiceAssetId}|${exaggeration}|${text.trim()}`).digest('hex').slice(0, 16);
}

async function speakerOf(personaId: string | null) {
  if (!isVoiceEnabled()) {
    throw new HTTPException(400, {
      message: 'Les vidéos parlées demandent le serveur de voix : renseigne VOICE_URL dans backend/.env (cf. README, « Vidéos parlées »).',
    });
  }
  if (!personaId) {
    throw new HTTPException(400, { message: 'Un « Texte dit » a besoin d’un personnage : choisis-en un, c’est sa voix qui parlera.' });
  }
  const [persona] = await db.select().from(personas).where(eq(personas.id, personaId)).limit(1);
  const voice = persona ? voiceOf(persona) : null;
  const ref = await assetRow(voice?.assetId);
  if (!persona || !voice || !ref) {
    const name = persona?.name ?? 'Ce personnage';
    throw new HTTPException(400, {
      message:
        `${name} n’a pas encore de voix. Crée-la sur sa page : Personnages → ${name} → carte « Voix » → « Créer une voix » ` +
        '(~5 min), puis « Garder cette voix ». Ou retire le « Texte dit » pour que LTX invente le son.',
    });
  }
  return { persona, voice, ref };
}

/** Vérifie, avant de lancer une vidéo parlée, que le personnage a une voix (erreur explicite sinon). */
export async function assertCanSpeak(personaId: string | null): Promise<void> {
  await speakerOf(personaId);
}

/** Texte dit complet : chaque morceau entre deux pauses est dit à part, puis les silences exacts sont posés. */
async function synthesizeLong(text: string, referencePath: string, exaggeration: number): Promise<Uint8Array> {
  const { lead, tail, pieces } = parseSpeech(text);
  if (!pieces.length) throw new HTTPException(400, { message: 'Le « Texte dit » ne contient que des pauses.' });
  const parts: Uint8Array[] = [];
  for (const piece of pieces) {
    const chunks: Uint8Array[] = [];
    for (const chunk of speechChunks(piece.text)) chunks.push(await synthesize(chunk, referencePath, exaggeration));
    parts.push(joinWavs(chunks, 0.25));
  }
  const joined = joinWavs(parts, pieces.slice(1).map(p => p.pauseBefore));
  return lead || tail ? padWav(joined, lead, tail) : joined;
}

/**
 * Texte dit d'une vidéo parlée : la piste WAV avec la voix du personnage et sa durée (sans silences ajoutés).
 * `listenedAssetId` : la piste écoutée depuis le composer, reprise telle quelle si elle correspond encore
 * (même voix, même expressivité, même texte) ; sinon la piste est refaite.
 */
export async function speechFor(
  personaId: string | null,
  text: string,
  listenedAssetId?: string | null,
): Promise<{ data: Uint8Array; seconds: number }> {
  const { voice, ref } = await speakerOf(personaId);
  const listened = await assetRow(listenedAssetId);
  if (listened && listened.kind === 'voice' && listened.personaId === personaId) {
    if (listened.filePath.includes(speechKey(ref.id, voice.exaggeration, text))) {
      const data = new Uint8Array(await readFile(listened.filePath));
      return { data, seconds: wavSeconds(data) };
    }
  }
  const data = await synthesizeLong(text, ref.filePath, voice.exaggeration);
  return { data, seconds: wavSeconds(data) };
}

/**
 * Écoute du texte dit depuis le composer, avant de lancer la vidéo : la piste est enregistrée (média `voice`)
 * pour être reprise telle quelle par la génération.
 */
export async function listenSpeech(
  user: SessionUser,
  personaId: string,
  text: string,
): Promise<{ assetId: string; url: string; seconds: number }> {
  const persona = await ownedPersona(user.id, personaId);
  const { voice, ref } = await speakerOf(persona.id);
  const key = speechKey(ref.id, voice.exaggeration, text);
  const data = await synthesizeLong(text, ref.filePath, voice.exaggeration);
  const seconds = wavSeconds(data);
  const saved = await saveFile(join(await voiceDir(user, persona), `texte-${Date.now()}-${key}.wav`), data);
  const [row] = await db
    .insert(assets)
    .values({
      userId: user.id,
      personaId: persona.id,
      kind: 'voice',
      mediaType: 'audio',
      mime: 'audio/wav',
      filePath: saved.path,
      bytes: saved.bytes,
      durationSeconds: seconds,
    })
    .returning({ id: assets.id });
  return { assetId: row.id, url: mediaUrl(row.id), seconds };
}

