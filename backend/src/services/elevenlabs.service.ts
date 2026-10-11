/**
 * ElevenLabs (voix des personas). La clé reste côté serveur, chiffrée en base,
 * et n'est jamais envoyée au navigateur. En test (SPICY_FAKE), aucun appel réseau.
 */
import { HTTPException } from 'hono/http-exception';
import type { VoiceLibraryItem, VoiceLibraryResponse } from '@ai-fluence/shared';
import { env } from '../env.js';
import { decryptSecret } from '../lib/crypto.js';
import { getSettingsRow } from './settings.service.js';

export const ELEVENLABS_API = 'https://api.elevenlabs.io';
const TIMEOUT_MS = 15_000;

export async function elevenFetch(apiKey: string, path: string): Promise<Response> {
  const res = await fetch(`${ELEVENLABS_API}${path}`, {
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
        message: `Clé ElevenLabs sans la permission nécessaire : ${detail ?? 'lecture des voix'}. Active « Voices : lecture » sur la clé.`,
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
