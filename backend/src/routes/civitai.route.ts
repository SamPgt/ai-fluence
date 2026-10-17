import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { HTTPException } from 'hono/http-exception';
import { civitaiEnabled, searchLoras, searchWildcards, wildcardListsOf } from '../services/civitai.service.js';
import type { AppEnv } from '../types.js';

const searchSchema = z.object({
  family: z.string().optional(),
  query: z.string().max(100).optional(),
  sort: z.enum(['Most Downloaded', 'Highest Rated', 'Newest']).default('Most Downloaded'),
  nsfw: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  cursor: z.string().max(200).optional(),
});

const wildcardSearchSchema = z.object({
  query: z.string().max(100).optional(),
  cursor: z.string().max(200).optional(),
});

/** Wildcards : la clé Civitai est nécessaire pour télécharger les archives. */
const requireKey = () => {
  if (!civitaiEnabled()) throw new HTTPException(503, { message: 'Civitai n’est pas configuré (clé CIVITAI_KEY).' });
};

const civitaiRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/status', c => c.json({ enabled: civitaiEnabled() }))
  .get('/search', zValidator('query', searchSchema), async c => c.json(await searchLoras(c.req.valid('query'))))
  .get('/wildcards', zValidator('query', wildcardSearchSchema), async c => {
    requireKey();
    return c.json(await searchWildcards(c.req.valid('query')));
  })
  .get('/wildcards/:versionId{[0-9]{1,12}}', async c => {
    requireKey();
    return c.json(await wildcardListsOf(Number(c.req.param('versionId'))));
  });

export default civitaiRoutes;
