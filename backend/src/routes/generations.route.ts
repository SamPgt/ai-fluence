import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { PriceChangedResponse } from '@ai-fluence/shared';
import { auth } from '../middleware/auth.js';
import {
  PriceChangedError,
  createGeneration,
  loadGenerations,
  quoteGeneration,
} from '../services/generation.service.js';
import type { AppEnv } from '../types.js';

const generationSchema = z.object({
  threadId: z.uuid().nullable().optional(),
  personaId: z.uuid().nullable().optional(),
  family: z.string().min(3),
  refMode: z.enum(['start-frame', 'reference']).optional(),
  prompt: z.string().max(5000).default(''),
  params: z.record(z.string(), z.unknown()).default({}),
  referenceAssetIds: z.array(z.uuid()).max(30).default([]),
  expectedCost: z.string().regex(/^\d+(\.\d+)?$/).optional(),
});

const generationsRoutes = new Hono<AppEnv>()
  .use(auth)
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
