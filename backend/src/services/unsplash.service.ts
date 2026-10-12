/**
 * Librairie Unsplash. La clé UNSPLASH_ACCESS_KEY reste côté backend.
 * Quota : 50 appels JSON par heure en mode démo, 1 000 une fois l'app validée
 * (les images du CDN ne comptent pas). Cache et quota : cf. library.service.
 *
 * Règles Unsplash suivies : images affichées depuis leur CDN, photographe et
 * Unsplash crédités, et `download_location` appelé à chaque import (retenté
 * plus tard si le quota est épuisé, sans bloquer l'import).
 */
import { randomUUID } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import type { LibraryPhoto, LibrarySearchResponse } from '@ai-fluence/shared';
import { env } from '../env.js';
import type { SessionUser } from '../types.js';
import { PER_PAGE, cacheDelete, cacheGet, cacheList, cacheSet, createClient, importImage } from './library.service.js';

const API = 'https://api.unsplash.com';
/** Téléchargements en attente de signalement, envoyés par lot après un import réussi. */
const TRACK_BATCH = 5;
/** Liens de suivi exigés par Unsplash sur l'attribution. */
const UTM = 'utm_source=ai_fluence&utm_medium=referral';
/** Taille importée : assez pour servir de référence, sans dépasser la limite d'upload. */
const IMPORT_WIDTH = 2048;
const HOUR = 60 * 60 * 1000;

export const unsplashEnabled = () => Boolean(env.UNSPLASH_ACCESS_KEY);

const client = createClient({
  source: 'unsplash',
  base: API,
  enabled: unsplashEnabled,
  envVar: 'UNSPLASH_ACCESS_KEY',
  headers: () => ({ Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' }),
  // Quota par heure : plus d'appel avant l'heure pleine suivante.
  blockedUntil: async res => {
    const exhausted =
      res.headers.get('X-Ratelimit-Remaining') === '0' ||
      (res.status === 403 && /rate limit/i.test(await res.clone().text()));
    return exhausted ? Date.now() + HOUR - (Date.now() % HOUR) : null;
  },
});

/** Oublie l'état en mémoire (tests ; le cache en base est vidé avec la base). */
export const resetUnsplash = client.reset;

// ── Types de la réponse Unsplash (sous-ensemble utilisé) ──────

interface RawPhoto {
  id: string;
  width: number;
  height: number;
  color: string | null;
  description: string | null;
  alt_description: string | null;
  urls: { raw: string; small: string };
  links: { html: string; download_location: string };
  user: { name: string; username: string; links: { html: string } };
}

interface PhotoLinks {
  raw: string;
  downloadLocation: string;
}

const photoKey = (id: string) => `unsplash photo:${id}`;

/** Garde les liens d'import des photos reçues. */
const savePhotoLinks = (photos: RawPhoto[]) =>
  cacheSet(
    photos.map(p => ({
      key: photoKey(p.id),
      data: { raw: p.urls.raw, downloadLocation: p.links.download_location } satisfies PhotoLinks,
    })),
  );

const withUtm = (url: string) => `${url}${url.includes('?') ? '&' : '?'}${UTM}`;

function toPhoto(p: RawPhoto): LibraryPhoto {
  return {
    id: p.id,
    description: (p.description || p.alt_description || '').trim(),
    width: p.width,
    height: p.height,
    color: p.color ?? '#2a2a2a',
    thumbUrl: p.urls.small,
    pageUrl: withUtm(p.links.html),
    author: { name: p.user.name, username: p.user.username, profileUrl: withUtm(p.user.links.html) },
  };
}

// ── Recherche ─────────────────────────────────────────────────

/** Sans recherche : les photos populaires. Sinon, recherche (contenu filtré). */
export async function searchUnsplash(args: { query?: string; page: number }): Promise<LibrarySearchResponse> {
  const qs = new URLSearchParams({ page: String(args.page), per_page: String(PER_PAGE) });
  if (!args.query) {
    qs.set('order_by', 'popular');
    const raw = await client.cachedGet<RawPhoto[]>(`/photos?${qs}`, savePhotoLinks);
    return { items: raw.map(toPhoto), nextPage: raw.length === PER_PAGE ? args.page + 1 : null };
  }
  qs.set('query', args.query);
  qs.set('content_filter', 'high');
  const raw = await client.cachedGet<{ results: RawPhoto[]; total_pages: number }>(`/search/photos?${qs}`, data =>
    savePhotoLinks(data.results),
  );
  return { items: raw.results.map(toPhoto), nextPage: args.page < raw.total_pages ? args.page + 1 : null };
}

// ── Import ────────────────────────────────────────────────────

/** Chemin du lien `download_location`, vérifié (toujours sur l'API Unsplash). */
function trackingPath(downloadLocation: string): string {
  const url = new URL(downloadLocation);
  if (url.origin !== API) throw new HTTPException(502, { message: 'Lien de téléchargement Unsplash inattendu.' });
  return `${url.pathname}${url.search}`;
}

/**
 * Signale un téléchargement à Unsplash (exigé à chaque import). Sans quota ou
 * sans réseau, il est gardé en base et renvoyé après le prochain import réussi.
 */
async function trackDownload(path: string) {
  try {
    await client.fetchApi(path);
  } catch {
    await cacheSet([{ key: `unsplash track:${randomUUID()}`, data: { path } }]);
    return;
  }
  for (const row of await cacheList('unsplash track:', TRACK_BATCH)) {
    try {
      await client.fetchApi((row.data as { path: string }).path);
      await cacheDelete(row.key);
    } catch {
      return;
    }
  }
}

/** Télécharge la photo (2048 px de large, JPEG) et l'enregistre comme asset de l'utilisateur. */
export async function importUnsplash(user: SessionUser, photoId: string, personaId: string | null) {
  client.requireKey();
  let links = (await cacheGet<PhotoLinks>(photoKey(photoId)))?.data;
  if (!links) {
    const p = await client.cachedGet<RawPhoto>(`/photos/${encodeURIComponent(photoId)}`, p => savePhotoLinks([p]));
    links = { raw: p.urls.raw, downloadLocation: p.links.download_location };
  }
  const tracking = trackingPath(links.downloadLocation);
  const url = new URL(links.raw);
  url.searchParams.set('w', String(IMPORT_WIDTH));
  url.searchParams.set('fm', 'jpg');
  url.searchParams.set('q', '85');
  const asset = await importImage(user, { source: 'unsplash', url, host: 'images.unsplash.com', personaId });
  await trackDownload(tracking);
  return asset;
}
