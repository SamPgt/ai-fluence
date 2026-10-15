/**
 * Librairies de photos libres de droits (Unsplash, Pexels), dans le bouton + du composer.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { LibrarySource, LibraryStatus } from '@sublime/shared';
import { auth } from '../middleware/auth.js';
import { importPexels, pexelsEnabled, searchPexels } from '../services/pexels.service.js';
import { toAsset } from '../services/serialize.js';
import { importUnsplash, searchUnsplash, unsplashEnabled } from '../services/unsplash.service.js';
import type { AppEnv } from '../types.js';

const SOURCES = {
  unsplash: { search: searchUnsplash, import: importUnsplash },
  pexels: { search: searchPexels, import: importPexels },
} satisfies Record<LibrarySource, unknown>;

const sourceSchema = z.object({ source: z.enum(['unsplash', 'pexels']) });

const searchSchema = z.object({
  // Recherche normalisée : « Gym » et « gym » partagent la même entrée de cache.
  query: z
    .string()
    .max(100)
    .optional()
    .transform(q => q?.trim().toLowerCase().replace(/\s+/g, ' ') || undefined),
  page: z.coerce.number().int().min(1).max(100).default(1),
});

const importSchema = z.object({
  photoId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  personaId: z.uuid().nullish(),
});

const libraryRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/status', c => c.json({ unsplash: unsplashEnabled(), pexels: pexelsEnabled() } satisfies LibraryStatus))
  .get('/:source/search', zValidator('param', sourceSchema), zValidator('query', searchSchema), async c =>
    c.json(await SOURCES[c.req.valid('param').source].search(c.req.valid('query'))),
  )
  /** Importe une photo comme asset de l'utilisateur (prête à joindre au composer). */
  .post('/:source/import', zValidator('param', sourceSchema), zValidator('json', importSchema), async c => {
    const { photoId, personaId } = c.req.valid('json');
    const row = await SOURCES[c.req.valid('param').source].import(c.get('user'), photoId, personaId ?? null);
    return c.json({ asset: toAsset(row) }, 201);
  });

export default libraryRoutes;
