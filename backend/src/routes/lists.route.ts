import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { REWRITE_MAX, quoteRewrite, rewriteItems } from '../services/list-rewrite.service.js';
import type { AppEnv } from '../types.js';

const itemsSchema = z.object({ items: z.array(z.string().trim().min(1).max(500)).min(1).max(REWRITE_MAX) });

/** Listes des workflows : reformulation d'éléments en phrases (devis, puis appel payant). */
const listsRoutes = new Hono<AppEnv>()
  .use(auth)
  .post('/rewrite/quote', zValidator('json', itemsSchema), async c =>
    c.json(await quoteRewrite(c.get('user').id, c.req.valid('json').items)),
  )
  .post('/rewrite', zValidator('json', itemsSchema), async c => c.json(await rewriteItems(c.get('user').id, c.req.valid('json').items)));

export default listsRoutes;
