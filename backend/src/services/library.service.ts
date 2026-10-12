/**
 * Socle commun des librairies de photos libres de droits (Unsplash, Pexels),
 * ouvertes depuis le bouton + du composer. Leurs quotas sont serrés, d'où :
 * - chaque réponse gardée 24 h en base (`library_cache`), partagée entre tous
 *   les utilisateurs et conservée au redémarrage ; une seule requête à la fois par URL ;
 * - source en panne ou quota épuisé : la dernière réponse connue est servie, même périmée ;
 * - les liens d'import de chaque photo vue gardés en base : importer ne rappelle pas l'API.
 */
import { HTTPException } from 'hono/http-exception';
import { eq, like, sql } from 'drizzle-orm';
import type { LibrarySource } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { libraryCache } from '../db/schema.js';
import type { SessionUser } from '../types.js';
import { MAX_IMAGE_BYTES } from './storage.service.js';
import { storeUpload } from './upload.service.js';

export const TIMEOUT_MS = 15_000;
export const PER_PAGE = 30;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Formats acceptés à l'import. */
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const LABEL: Record<LibrarySource, string> = { unsplash: 'Unsplash', pexels: 'Pexels' };

// ── Cache en base ─────────────────────────────────────────────

export async function cacheGet<T>(key: string): Promise<{ data: T; fresh: boolean } | null> {
  const [row] = await db.select().from(libraryCache).where(eq(libraryCache.key, key));
  if (!row) return null;
  return { data: row.data as T, fresh: Date.now() - row.fetchedAt.getTime() < CACHE_TTL_MS };
}

export async function cacheSet(entries: { key: string; data: unknown }[]) {
  if (!entries.length) return;
  await db
    .insert(libraryCache)
    .values(entries.map(e => ({ ...e, fetchedAt: new Date() })))
    .onConflictDoUpdate({
      target: libraryCache.key,
      set: { data: sql`excluded.data`, fetchedAt: sql`excluded.fetched_at` },
    });
}

export const cacheList = (prefix: string, limit: number) =>
  db.select().from(libraryCache).where(like(libraryCache.key, `${prefix}%`)).limit(limit);

export const cacheDelete = (key: string) => db.delete(libraryCache).where(eq(libraryCache.key, key));

// ── Appels à une source, avec quota ───────────────────────────

/**
 * Client d'une source : quota suivi (plus aucun appel une fois épuisé, jusqu'à
 * la date donnée par `onResponse`), une seule requête à la fois par chemin.
 */
export function createClient(opts: {
  source: LibrarySource;
  base: string;
  enabled: () => boolean;
  envVar: string;
  headers: () => Record<string, string>;
  /** Lit le quota dans la réponse : date (ms) jusqu'à laquelle ne plus appeler, ou null. */
  blockedUntil: (res: Response) => Promise<number | null>;
}) {
  const label = LABEL[opts.source];
  const inFlight = new Map<string, Promise<unknown>>();
  let blockedUntil = 0;

  const quotaError = () => {
    const minutes = Math.max(1, Math.ceil((blockedUntil - Date.now()) / 60_000));
    const wait = minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${minutes} min`;
    return new HTTPException(429, { message: `Quota ${label} atteint : réessaie dans ${wait}.` });
  };

  function requireKey() {
    if (!opts.enabled()) {
      throw new HTTPException(400, { message: `Librairie ${label} désactivée : ajoute ${opts.envVar} dans backend/.env.` });
    }
  }

  function fetchApi<T>(path: string): Promise<T> {
    const pending = inFlight.get(path);
    if (pending) return pending as Promise<T>;
    const request = (async () => {
      if (Date.now() < blockedUntil) throw quotaError();
      let res: Response;
      try {
        res = await fetch(`${opts.base}${path}`, { headers: opts.headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        throw new HTTPException(502, { message: `${label} est injoignable pour le moment.` });
      }
      const until = await opts.blockedUntil(res);
      if (until) blockedUntil = until;
      if (res.status === 401) throw new HTTPException(502, { message: `Clé ${label} refusée : vérifie ${opts.envVar}.` });
      if (res.status === 404) throw new HTTPException(404, { message: `Photo ${label} introuvable.` });
      if (!res.ok) {
        if (Date.now() < blockedUntil) throw quotaError();
        throw new HTTPException(502, { message: `${label} a répondu ${res.status}.` });
      }
      return (await res.json()) as T;
    })();
    inFlight.set(path, request);
    return request.finally(() => inFlight.delete(path));
  }

  /**
   * Réponse de l'API, depuis le cache si elle a moins de 24 h. Sinon, appel ;
   * en cas d'échec (quota, panne), la dernière réponse connue est servie.
   */
  async function cachedGet<T>(path: string, onFetch?: (data: T) => Promise<void>): Promise<T> {
    requireKey();
    const key = `${opts.source} GET ${path}`;
    const hit = await cacheGet<T>(key);
    if (hit?.fresh) return hit.data;
    try {
      const data = await fetchApi<T>(path);
      await cacheSet([{ key, data }]);
      await onFetch?.(data);
      return data;
    } catch (e) {
      if (hit && e instanceof HTTPException && e.status !== 404) return hit.data;
      throw e;
    }
  }

  return {
    requireKey,
    fetchApi,
    cachedGet,
    /** Oublie l'état en mémoire (tests). */
    reset: () => {
      inFlight.clear();
      blockedUntil = 0;
    },
  };
}

// ── Import ────────────────────────────────────────────────────

/** Télécharge l'image depuis le CDN de la source et l'enregistre comme asset de l'utilisateur. */
export async function importImage(
  user: SessionUser,
  opts: { source: LibrarySource; url: URL; host: string; personaId: string | null },
) {
  const label = LABEL[opts.source];
  if (opts.url.hostname !== opts.host) throw new HTTPException(502, { message: `Image ${label} inattendue.` });
  let res: Response;
  try {
    res = await fetch(opts.url, { signal: AbortSignal.timeout(TIMEOUT_MS * 2) });
  } catch {
    throw new HTTPException(502, { message: `Téléchargement de la photo ${label} impossible.` });
  }
  if (!res.ok) throw new HTTPException(502, { message: `${label} a répondu ${res.status} au téléchargement.` });
  const mime = (res.headers.get('Content-Type') ?? '').split(';')[0].trim();
  if (!IMAGE_MIMES.has(mime)) throw new HTTPException(502, { message: `Format d’image ${label} inattendu.` });
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_IMAGE_BYTES) throw new HTTPException(400, { message: 'Image trop lourde (10 Mo max).' });
  return storeUpload(user, { personaId: opts.personaId, mime, data });
}
