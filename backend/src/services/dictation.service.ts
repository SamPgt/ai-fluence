/**
 * Dictée du composer : jeton temporaire pour le fournisseur choisi dans Paramétrage.
 * Le navigateur se connecte directement au fournisseur (latence minimale), la clé reste
 * sur le serveur. En test (SPICY_FAKE) : faux jeton, la dictée est simulée côté navigateur.
 */
import { HTTPException } from 'hono/http-exception';
import type { DictationTokenResponse } from '@sublime/shared';
import { env } from '../env.js';
import { createScribeToken } from './elevenlabs.service.js';
import { getSettingsRow } from './settings.service.js';

export async function createDictationToken(userId: string): Promise<DictationTokenResponse> {
  const { dictationProvider: provider } = await getSettingsRow(userId);
  if (env.SPICY_FAKE) return { provider, token: 'fake-dictation-token', fake: true };
  if (provider === 'deepgram') return { provider, token: await createDeepgramToken(), fake: false };
  if (provider === 'cartesia') return { provider, token: await createCartesiaToken(), fake: false };
  return { provider, token: await createScribeToken(userId), fake: false };
}

/** JWT Deepgram de 30 s : juste le temps d'ouvrir la connexion (elle reste ouverte ensuite). */
async function createDeepgramToken(): Promise<string> {
  if (!env.deepgramApiKey) throw new HTTPException(412, { message: 'Deepgram n’est pas configuré sur le serveur.' });
  const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: { Authorization: `Token ${env.deepgramApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl_seconds: 30 }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) throw new HTTPException(502, { message: 'Deepgram ne répond pas.' });
  const body = (await res.json().catch(() => null)) as { access_token?: string; err_msg?: string } | null;
  if (res.status === 403) {
    throw new HTTPException(400, {
      message: 'Clé Deepgram sans permission pour les jetons temporaires : crée une clé au rôle « Member ».',
    });
  }
  if (!res.ok || !body?.access_token) {
    throw new HTTPException(502, { message: `Deepgram a répondu ${res.status}${body?.err_msg ? ` : ${body.err_msg}` : '.'}` });
  }
  return body.access_token;
}

/** Version de l'API Cartesia (en-tête et paramètre de connexion). */
export const CARTESIA_VERSION = '2026-08-14';

/** Jeton Cartesia limité à la transcription, valable 60 s : le temps d'ouvrir la connexion. */
async function createCartesiaToken(): Promise<string> {
  if (!env.cartesiaApiKey) throw new HTTPException(412, { message: 'Cartesia n’est pas configuré sur le serveur.' });
  const res = await fetch('https://api.cartesia.ai/access-token', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.cartesiaApiKey}`,
      'Cartesia-Version': CARTESIA_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ grants: { stt: true }, expires_in: 60 }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) throw new HTTPException(502, { message: 'Cartesia ne répond pas.' });
  const body = (await res.json().catch(() => null)) as { token?: string; message?: string } | null;
  if (!res.ok || !body?.token) {
    throw new HTTPException(502, { message: `Cartesia a répondu ${res.status}${body?.message ? ` : ${body.message}` : '.'}` });
  }
  return body.token;
}
