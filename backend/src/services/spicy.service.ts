import { SpicyApiError, SpicyClient, SpicyTransportError, type ApiModel } from '@spicyapi/sdk';
import { HTTPException } from 'hono/http-exception';
import {
  ENDPOINT_SUFFIX_TO_TASK,
  deriveBadges,
  MODEL_FAMILIES,
  type CatalogFamily,
  type CatalogResponse,
  type InputSchema,
} from '@ai-fluence/shared';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { requireApiKey } from './settings.service.js';
import { fakeSpicyClient } from './spicy.fake.js';

export function clientFor(apiKey: string): SpicyClient {
  // Tests : faux client, sans réseau ni coût.
  if (env.SPICY_FAKE) return fakeSpicyClient;
  return new SpicyClient({ apiKey, apiBaseUrl: env.SPICY_API_BASE_URL });
}

export async function clientForUser(userId: string): Promise<SpicyClient> {
  return clientFor(await requireApiKey(userId));
}

// ── Catalogue (mis en cache par utilisateur, 10 min) ──────────

const CATALOG_TTL_MS = 10 * 60 * 1000;
const catalogCache = new Map<string, { at: number; models: ApiModel[] }>();

export function invalidateCatalog(userId: string) {
  catalogCache.delete(userId);
}

export async function getModels(userId: string): Promise<ApiModel[]> {
  const cached = catalogCache.get(userId);
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.models;
  const client = await clientForUser(userId);
  const list = await callSpicy(() => client.listModels({ includeSchema: true }));
  catalogCache.set(userId, { at: Date.now(), models: list.items });
  return list.items;
}

/** Durée médiane (secondes) des 50 dernières générations réussies de chaque modèle. */
async function typicalDurations(userId: string): Promise<Map<string, number>> {
  const rows = await db.execute<{ family: string; seconds: number }>(sql`
    select family, percentile_cont(0.5) within group (order by seconds)::float as seconds
    from (
      select family, extract(epoch from (completed_at - created_at)) as seconds,
             row_number() over (partition by family order by created_at desc) as n
      from generations
      where user_id = ${userId} and status = 'succeeded' and completed_at is not null
    ) last
    where n <= 50
    group by family`);
  return new Map((rows as unknown as { family: string; seconds: number }[]).map(r => [r.family, Math.round(r.seconds)]));
}

export async function getCatalog(userId: string): Promise<CatalogResponse> {
  const [models, durations] = await Promise.all([getModels(userId), typicalDurations(userId)]);
  const families: CatalogFamily[] = MODEL_FAMILIES.map(def => {
    const tasks: CatalogFamily['tasks'] = {};
    for (const m of models) {
      if (!m.model.startsWith(`${def.id}/`)) continue;
      const suffix = m.model.slice(def.id.length + 1);
      const task = ENDPOINT_SUFFIX_TO_TASK[suffix];
      if (!task || !m.enabled) continue;
      tasks[task] = {
        modelId: m.model,
        schema: (m.inputSchema ?? {}) as InputSchema,
        startingPrice: m.startingPrice
          ? { price: m.startingPrice.price, unit: m.startingPrice.unit, variant: m.startingPrice.variant ?? '' }
          : null,
        policyTier: m.policyTier ?? null,
      };
    }
    // Badges recalculés depuis les schémas live : toujours justes, même si le catalogue évolue.
    const badges = Object.keys(tasks).length ? deriveBadges(tasks, def.badges) : def.badges;
    return {
      ...def,
      badges,
      tasks,
      available: Object.keys(tasks).length > 0,
      typicalSeconds: durations.get(def.id) ?? null,
    };
  });
  const textModels = models.filter(m => m.modality === 'text' && m.enabled).map(m => m.model);
  return { families, textModels };
}

// ── Erreurs ───────────────────────────────────────────────────

/** Messages clairs pour les codes métier qui demandent une action précise. */
const BUSINESS_MESSAGES: Record<number, string> = {
  40003: 'Le fichier envoyé ne correspond pas à son ticket d’upload. Réessaie.',
  40004: 'Cette combinaison de paramètres n’est pas disponible pour ce modèle. Change un paramètre.',
  40310: 'Ton compte SpicyAPI doit vérifier son adresse e-mail dans la Console avant de générer.',
  40901: 'Le prix a changé, relance pour voir le nouveau devis.',
  50301: 'Ce modèle est momentanément indisponible.',
};

/** Exécute un appel SDK et convertit ses erreurs en HTTPException lisibles. */
export async function callSpicy<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toHttpError(err);
  }
}

export function toHttpError(err: unknown): HTTPException {
  if (err instanceof HTTPException) return err;
  if (err instanceof SpicyApiError) {
    const msg = (err.code && BUSINESS_MESSAGES[err.code]) || err.message;
    const status = err.status === 401 ? 401 : err.status === 402 ? 402 : err.status >= 500 ? 502 : 400;
    // 401 SpicyAPI = clé invalide, pas session expirée : on renvoie 400 pour ne pas déconnecter.
    return new HTTPException(status === 401 ? 400 : (status as 400 | 402 | 502), {
      message: status === 401 ? 'Clé API SpicyAPI refusée. Vérifie-la dans Paramètres.' : msg,
      cause: err,
    });
  }
  if (err instanceof SpicyTransportError) {
    return new HTTPException(502, { message: 'SpicyAPI est injoignable pour le moment.', cause: err });
  }
  return new HTTPException(500, { message: (err as Error)?.message ?? 'Erreur inconnue', cause: err });
}
