/**
 * Librairie Pexels. La clé PEXELS_API_KEY reste côté backend.
 * Quota : 200 appels par heure et 20 000 par mois (les images du CDN ne
 * comptent pas). Cache et quota : cf. library.service.
 *
 * Règles Pexels suivies : lien visible vers Pexels, photographe crédité avec
 * un lien vers la page de la photo.
 */
import type { LibraryPhoto, LibrarySearchResponse } from '@ai-fluence/shared';
import { env } from '../env.js';
import type { SessionUser } from '../types.js';
import { PER_PAGE, cacheGet, cacheSet, createClient, importImage } from './library.service.js';

const API = 'https://api.pexels.com/v1';
/** Taille importée : assez pour servir de référence, sans dépasser la limite d'upload. */
const IMPORT_WIDTH = 2048;
/** Largeur des vignettes de la grille (3 colonnes, écrans haute densité). */
const THUMB_WIDTH = 600;
const HOUR = 60 * 60 * 1000;

export const pexelsEnabled = () => Boolean(env.PEXELS_API_KEY);

const client = createClient({
  source: 'pexels',
  base: API,
  enabled: pexelsEnabled,
  envVar: 'PEXELS_API_KEY',
  headers: () => ({ Authorization: env.PEXELS_API_KEY ?? '' }),
  blockedUntil: async res => {
    // 429 : quota horaire dépassé (sans en-têtes). Sinon, quota du mois épuisé : jusqu'à sa remise à zéro.
    if (res.status === 429) return Date.now() + HOUR;
    const reset = Number(res.headers.get('X-Ratelimit-Reset'));
    return res.headers.get('X-Ratelimit-Remaining') === '0' && reset ? reset * 1000 : null;
  },
});

/** Oublie l'état en mémoire (tests ; le cache en base est vidé avec la base). */
export const resetPexels = client.reset;

// ── Types de la réponse Pexels (sous-ensemble utilisé) ────────

interface RawPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  avg_color: string | null;
  alt: string | null;
  src: { original: string };
}

interface RawPage {
  photos: RawPhoto[];
  next_page?: string;
}

const photoKey = (id: string) => `pexels photo:${id}`;

/** Garde le lien d'import des photos reçues. */
const savePhotoLinks = (photos: RawPhoto[]) =>
  cacheSet(photos.map(p => ({ key: photoKey(String(p.id)), data: { original: p.src.original } })));

/** Image du CDN Pexels à la largeur voulue. */
function sized(original: string, width: number): URL {
  const url = new URL(original);
  url.search = '';
  url.searchParams.set('auto', 'compress');
  url.searchParams.set('cs', 'tinysrgb');
  url.searchParams.set('w', String(width));
  return url;
}

/** Pseudo du photographe, lu dans son lien de profil (`pexels.com/@pseudo`). */
function username(profileUrl: string): string | null {
  const match = /\/@([^/?#]+)/.exec(profileUrl);
  return match ? decodeURIComponent(match[1]) : null;
}

function toPhoto(p: RawPhoto): LibraryPhoto {
  return {
    id: String(p.id),
    description: (p.alt ?? '').trim(),
    width: p.width,
    height: p.height,
    color: p.avg_color ?? '#2a2a2a',
    thumbUrl: sized(p.src.original, THUMB_WIDTH).href,
    pageUrl: p.url,
    author: { name: p.photographer, username: username(p.photographer_url), profileUrl: p.photographer_url },
  };
}

// ── Recherche ─────────────────────────────────────────────────

/** Sans recherche : la sélection du jour de Pexels. Sinon, recherche. */
export async function searchPexels(args: { query?: string; page: number }): Promise<LibrarySearchResponse> {
  const qs = new URLSearchParams({ page: String(args.page), per_page: String(PER_PAGE) });
  if (args.query) qs.set('query', args.query);
  const raw = await client.cachedGet<RawPage>(`/${args.query ? 'search' : 'curated'}?${qs}`, data =>
    savePhotoLinks(data.photos),
  );
  return { items: raw.photos.map(toPhoto), nextPage: raw.next_page ? args.page + 1 : null };
}

// ── Import ────────────────────────────────────────────────────

/** Télécharge la photo (2048 px de large) et l'enregistre comme asset de l'utilisateur. */
export async function importPexels(user: SessionUser, photoId: string, personaId: string | null) {
  client.requireKey();
  let original = (await cacheGet<{ original: string }>(photoKey(photoId)))?.data.original;
  if (!original) {
    const p = await client.cachedGet<RawPhoto>(`/photos/${encodeURIComponent(photoId)}`, p => savePhotoLinks([p]));
    original = p.src.original;
  }
  const url = sized(original, IMPORT_WIDTH);
  return importImage(user, { source: 'pexels', url, host: 'images.pexels.com', personaId });
}
