import { Hono } from 'hono';
import { auth } from '../middleware/auth.js';
import { getCatalog, invalidateCatalog } from '../services/spicy.service.js';
import type { AppEnv } from '../types.js';

const catalogRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/', async c => {
    if (c.req.query('refresh')) invalidateCatalog(c.get('user').id);
    return c.json(await getCatalog(c.get('user').id));
  });

export default catalogRoutes;
