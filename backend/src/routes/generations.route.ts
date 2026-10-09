import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { PriceChangedResponse } from '@ai-fluence/shared';
import { auth } from '../middleware/auth.js';
import {
  PriceChangedError,
  createGeneration,
  createUpscale,
  loadGenerations,
  quoteGeneration,
  quoteUpscale,
} from '../services/generation.service.js';
import type { AppEnv } from '../types.js';

const generationSchema = z.object({
  threadId: z.uuid().nullable().optional(),
  personaId: z.uuid().nullable().optional(),
  family: z.string().min(3),
  refMode: z.enum(['start-frame', 'reference']).optional(),
  // Sans espaces ni retours à la ligne aux extrémités (sinon une ligne vide apparaît dans la bulle).
  prompt: z.string().max(5000).trim().default(''),
  params: z.record(z.string(), z.unknown()).default({}),
  referenceAssetIds: z.array(z.uuid()).max(30).default([]),
  contextIds: z.array(z.uuid()).max(20).default([]),
  count: z.number().int().min(1).max(12).optional(),
  loraIds: z.array(z.string().max(64)).max(12).optional(),
  loraWords: z.record(z.string().max(64), z.array(z.string().max(60)).max(20)).optional(),
  expectedCost: z.string().regex(/^\d+(\.\d+)?$/).optional(),
});

const upscaleSchema = z.object({
  assetId: z.uuid(),
  resolution: z.string().max(10).optional(),
  expectedCost: z.string().regex(/^\d+(\.\d+)?$/).optional(),
});

const generationsRoutes = new Hono<AppEnv>()
  .use(auth)
  /** Upscale d'un résultat : devis gratuit, puis création (facturable). */
  .post('/upscale/quote', zValidator('json', upscaleSchema), async c => {
    return c.json({ quote: await quoteUpscale(c.get('user'), c.req.valid('json')) });
  })
  .post('/upscale', zValidator('json', upscaleSchema), async c => {
    try {
      return c.json(await createUpscale(c.get('user'), c.req.valid('json')), 201);
    } catch (err) {
      if (err instanceof PriceChangedError) {
        return c.json({ error: 'price_changed', quote: err.quote } satisfies PriceChangedResponse, 409);
      }
      throw err;
    }
  })
  /** Devis exact, gratuit : affiché avant le clic sur Générer. */
  .post('/quote', zValidator('json', generationSchema), async c => {
    return c.json({ quote: await quoteGeneration(c.get('user'), c.req.valid('json')) });
  })
  /** Création : facturable. */
  .post('/', zValidator('json', generationSchema), async c => {
    try {
      return c.json(await createGeneration(c.get('user'), c.req.valid('json')), 201);
    } catch (err) {
      if (err instanceof PriceChangedError) {
        return c.json({ error: 'price_changed', quote: err.quote } satisfies PriceChangedResponse, 409);
      }
      throw err;
    }
  })
  .get('/:id', async c => {
    const [generation] = await loadGenerations(c.get('user').id, { ids: [c.req.param('id')] });
    if (!generation) return c.json({ error: 'Génération introuvable.' }, 404);
    return c.json({ generation });
  });

export default generationsRoutes;
