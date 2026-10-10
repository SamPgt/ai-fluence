import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { civitaiEnabled, searchLoras } from '../services/civitai.service.js';
import type { AppEnv } from '../types.js';

const searchSchema = z.object({
  family: z.string().optional(),
  query: z.string().max(100).optional(),
  sort: z.enum(['Most Downloaded', 'Highest Rated', 'Newest']).default('Most Downloaded'),
  nsfw: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  cursor: z.string().max(200).optional(),
});

const civitaiRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/status', c => c.json({ enabled: civitaiEnabled() }))
  .get('/search', zValidator('query', searchSchema), async c => c.json(await searchLoras(c.req.valid('query'))));

export default civitaiRoutes;
