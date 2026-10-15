/**
 * ElevenLabs (voix des personas). La clé reste côté serveur, chiffrée en base,
 * et n'est jamais envoyée au navigateur. En test (SPICY_FAKE), aucun appel réseau.
 */
import { HTTPException } from 'hono/http-exception';
import type { VoiceLibraryItem, VoiceLibraryResponse } from '@sublime/shared';
import { env } from '../env.js';
import { decryptSecret } from '../lib/crypto.js';
import { getSettingsRow } from './settings.service.js';

export const ELEVENLABS_API = 'https://api.elevenlabs.io';
const TIMEOUT_MS = 15_000;

export async function elevenFetch(
  apiKey: string,
  path: string,
  { method = 'GET', permission = 'lecture des voix' }: { method?: 'GET' | 'POST'; permission?: string } = {},
): Promise<Response> {
  const res = await fetch(`${ELEVENLABS_API}${path}`, {
    method,
    headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!res) throw new HTTPException(502, { message: 'ElevenLabs ne répond pas.' });
  if (!res.ok) {
    // Message d'ElevenLabs (clé invalide, permission manquante…), jamais la clé.
    const body = (await res.json().catch(() => null)) as {
      detail?: { status?: string; message?: string } | string;
    } | null;
    const detail = typeof body?.detail === 'string' ? body.detail : body?.detail?.message;
    const status = typeof body?.detail === 'object' ? body?.detail?.status : undefined;
    if (res.status === 401 && status === 'missing_permissions') {
      throw new HTTPException(400, {
        message: `Clé ElevenLabs sans la permission nécessaire : ${detail ?? permission}. Active-la sur la clé dans ElevenLabs.`,
      });
    }
    if (res.status === 401)
      throw new HTTPException(400, {
        message: `Clé ElevenLabs refusée${detail ? ` : ${detail}` : '.'}`,
      });
    throw new HTTPException(502, {
      message: `ElevenLabs a répondu ${res.status}${detail ? ` : ${detail}` : '.'}`,
    });
  }
  return res;
}

/** Vérifie une clé avant de l'enregistrer (appel gratuit). */
export async function checkElevenLabsKey(apiKey: string): Promise<void> {
  if (env.SPICY_FAKE) return;
  // Lecture des voix : c'est la permission dont l'app a besoin.
  await elevenFetch(apiKey, '/v2/voices?page_size=1');
}

export async function requireElevenLabsKey(userId: string): Promise<string> {
  const row = await getSettingsRow(userId);
  if (!row.elevenLabsApiKeyEnc) {
    throw new HTTPException(412, {
      message: 'Aucune clé ElevenLabs. Ajoute-la dans Paramètres → Clés API.',
    });
  }
  return decryptSecret(row.elevenLabsApiKeyEnc);
}

// ── Synthèse vocale ───────────────────────────────────────────

/** Modèle multilingue : la même voix parle français comme anglais. */
const TTS_MODEL = 'eleven_multilingual_v2';

/** WAV silencieux (tests : aucun appel réseau). */
function silentWav(seconds: number): Uint8Array {
  const rate = 8000;
  const samples = rate * seconds;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples * 2, true);
  return new Uint8Array(buf);
}

/**
 * Fait dire `text` par une voix ElevenLabs (coût : crédits ElevenLabs, au caractère).
 * Demande la permission « Text to Speech » sur la clé.
 */
export async function synthesizeSpeech(
  apiKey: string,
  voiceId: string,
  text: string,
): Promise<{ data: Uint8Array; mime: string; ext: string }> {
  if (env.SPICY_FAKE) return { data: silentWav(10), mime: 'audio/wav', ext: 'wav' };
  const res = await fetch(
    `${ELEVENLABS_API}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: TTS_MODEL }),
      signal: AbortSignal.timeout(60_000),
    },
  ).catch(() => null);
  if (!res) throw new HTTPException(502, { message: 'ElevenLabs ne répond pas.' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: { status?: string; message?: string } | string } | null;
    const detail = typeof body?.detail === 'string' ? body.detail : body?.detail?.message;
    const status = typeof body?.detail === 'object' ? body?.detail?.status : undefined;
    if (res.status === 401 && status === 'missing_permissions') {
      throw new HTTPException(400, {
        message: 'Clé ElevenLabs sans la permission « Text to Speech » : active-la sur la clé pour envoyer les voix aux modèles.',
      });
    }
    // Voix de la bibliothèque communautaire : réservées aux abonnements payants.
    if (/creator tier/i.test(detail ?? '')) {
      throw new HTTPException(400, {
        message:
          'Cette voix de la bibliothèque ElevenLabs demande l’abonnement Creator (ou supérieur) pour être utilisée par l’app. Choisis une voix par défaut d’ElevenLabs, ou passe au plan Creator.',
      });
    }
    throw new HTTPException(502, { message: `ElevenLabs a répondu ${res.status}${detail ? ` : ${detail}` : '.'}` });
  }
  return { data: new Uint8Array(await res.arrayBuffer()), mime: 'audio/mpeg', ext: 'mp3' };
}

// ── Catalogue de voix ─────────────────────────────────────────

export interface VoiceLibraryQuery {
  /** default : voix proposées par ElevenLabs ; library : bibliothèque communautaire ; all : les deux. */
  source: 'all' | 'default' | 'library';
  search?: string;
  gender?: string;
  age?: string;
  language?: string;
  useCase?: string;
  page: number;
}

// Assez pour filtrer à l'écran (recherche par mots) sans pagination pour l'instant.
const PAGE_SIZE = 100;
const clean = (labels: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(labels).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== ''),
  );

type DefaultVoice = {
  voice_id: string;
  name: string;
  preview_url?: string | null;
  labels?: Record<string, unknown>;
  description?: string | null;
  category?: string;
};
type SharedVoice = {
  voice_id: string;
  public_owner_id?: string;
  name: string;
  preview_url?: string | null;
  description?: string | null;
  category?: string;
  gender?: string;
  age?: string;
  accent?: string;
  language?: string;
  locale?: string;
  use_case?: string;
  descriptive?: string;
};

/** Tests (SPICY_FAKE) : quelques voix fixes, sans réseau. */
const FAKE_VOICES: VoiceLibraryItem[] = [
  {
    voiceId: 'fake-sarah',
    source: 'default',
    name: 'Sarah',
    previewUrl: null,
    labels: { gender: 'female', age: 'young', use_case: 'social_media', accent: 'american' },
  },
  {
    voiceId: 'fake-george',
    source: 'default',
    name: 'George',
    previewUrl: null,
    labels: { gender: 'male', age: 'middle_aged', use_case: 'narrative_story', accent: 'british' },
  },
  {
    voiceId: 'fake-river',
    source: 'library',
    name: 'River',
    previewUrl: null,
    labels: { gender: 'neutral', age: 'young', use_case: 'conversational', locale: 'fr-FR' },
  },
];

export async function listVoiceLibrary(apiKey: string, q: VoiceLibraryQuery): Promise<VoiceLibraryResponse> {
  if (env.SPICY_FAKE) {
    const s = q.search?.toLowerCase();
    return {
      voices: FAKE_VOICES.filter(
        v =>
          (q.source === 'all' || v.source === q.source) &&
          (!s || v.name.toLowerCase().includes(s)) &&
          (!q.gender || v.labels.gender === q.gender),
      ),
      hasMore: false,
    };
  }
  if (q.source === 'all') {
    // Les deux catalogues : voix ElevenLabs d'abord, sans doublon.
    const [own, shared] = await Promise.all([
      listVoiceLibrary(apiKey, { ...q, source: 'default' }),
      listVoiceLibrary(apiKey, { ...q, source: 'library' }),
    ]);
    const seen = new Set(own.voices.map(v => v.voiceId));
    return { voices: [...own.voices, ...shared.voices.filter(v => !seen.has(v.voiceId))], hasMore: shared.hasMore };
  }
  if (q.source === 'default') {
    // Voix par défaut : liste courte, filtrée ici sur leurs caractéristiques.
    const params = new URLSearchParams({ voice_type: 'default', page_size: '100' });
    if (q.search) params.set('search', q.search);
    const body = (await (await elevenFetch(apiKey, `/v2/voices?${params}`)).json()) as { voices?: DefaultVoice[] };
    const voices: VoiceLibraryItem[] = (body.voices ?? [])
      .map(v => ({
        voiceId: v.voice_id,
        source: 'default' as const,
        name: v.name,
        previewUrl: v.preview_url ?? null,
        labels: clean(v.labels ?? {}),
        ...(v.description ? { description: v.description } : {}),
        category: v.category,
      }))
      .filter(
        v =>
          (!q.gender || v.labels.gender === q.gender) &&
          (!q.age || v.labels.age?.replace('-', '_') === q.age) &&
          (!q.useCase || v.labels.use_case === q.useCase) &&
          (!q.language || !v.labels.language || v.labels.language === q.language),
      );
    return { voices, hasMore: false };
  }
  const params = new URLSearchParams({ page_size: String(PAGE_SIZE), page: String(q.page) });
  if (q.search) params.set('search', q.search);
  if (q.gender) params.set('gender', q.gender);
  if (q.age) params.set('age', q.age);
  if (q.language) params.set('language', q.language);
  if (q.useCase) params.set('use_cases', q.useCase);
  const body = (await (await elevenFetch(apiKey, `/v1/shared-voices?${params}`)).json()) as {
    voices?: SharedVoice[];
    has_more?: boolean;
  };
  return {
    voices: (body.voices ?? []).map(v => ({
      voiceId: v.voice_id,
      source: 'library' as const,
      ...(v.public_owner_id ? { publicOwnerId: v.public_owner_id } : {}),
      name: v.name,
      previewUrl: v.preview_url ?? null,
      labels: clean({
        gender: v.gender,
        age: v.age,
        accent: v.accent,
        language: v.language,
        locale: v.locale,
        use_case: v.use_case,
        descriptive: v.descriptive,
      }),
      ...(v.description ? { description: v.description } : {}),
      category: v.category,
    })),
    hasMore: Boolean(body.has_more),
  };
}

// ── Dictée (speech to text en direct) ─────────────────────────

/**
 * Jeton à usage unique (15 min) pour Scribe v2 Realtime : le navigateur se connecte
 * directement à ElevenLabs avec lui, la clé reste sur le serveur. Création gratuite ;
 * la transcription est décomptée du forfait ElevenLabs (temps réel inclus dès Free).
 */
export async function createScribeToken(userId: string): Promise<string> {
  const apiKey = await requireElevenLabsKey(userId);
  const res = await elevenFetch(apiKey, '/v1/single-use-token/realtime_scribe', {
    method: 'POST',
    permission: 'Speech to Text',
  });
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new HTTPException(502, { message: 'ElevenLabs n’a pas renvoyé de jeton.' });
  return body.token;
}
