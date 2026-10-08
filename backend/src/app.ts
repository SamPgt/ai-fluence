import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { HTTPException } from 'hono/http-exception';
import { env } from './env.js';
import authRoutes from './routes/auth.route.js';
import settingsRoutes from './routes/settings.route.js';
import catalogRoutes from './routes/catalog.route.js';
import { assetsRoutes, mediaRoutes } from './routes/assets.route.js';
import personasRoutes from './routes/personas.route.js';
import threadsRoutes from './routes/threads.route.js';
import generationsRoutes from './routes/generations.route.js';
import presetsRoutes from './routes/presets.route.js';
import promptsRoutes from './routes/prompts.route.js';
import civitaiRoutes from './routes/civitai.route.js';
import type { AppEnv } from './types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = new Hono<AppEnv>()
  .use('*', logger())
  .use(
    '*',
    cors({
      origin: env.CLIENT_URL,
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      credentials: true,
    }),
  )
  // Un `:id` qui n'est pas un UUID ferait planter Postgres : on répond 404 avant.
  .use('*', async (c, next) => {
    const segments = c.req.path.split('/');
    const idx = segments.findIndex(s => ['media', 'threads', 'generations', 'personas', 'assets', 'presets'].includes(s));
    const id = idx >= 0 ? segments[idx + 1] : undefined;
    if (id && !['search', 'references', 'gallery', 'quote', 'upscale'].includes(id) && !UUID_RE.test(id)) {
      return c.json({ error: 'Introuvable.' }, 404);
    }
    await next();
  })
  .get('/health', c => c.json({ status: 'ok' }))
  .route('/auth', authRoutes)
  .route('/settings', settingsRoutes)
  .route('/catalog', catalogRoutes)
  .route('/assets', assetsRoutes)
  .route('/media', mediaRoutes)
  .route('/personas', personasRoutes)
  .route('/threads', threadsRoutes)
  .route('/generations', generationsRoutes)
  .route('/presets', presetsRoutes)
  .route('/prompts', promptsRoutes)
  .route('/civitai', civitaiRoutes);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    if (err.status >= 500) console.error(`[${c.req.method} ${c.req.path}]`, err.message, err.cause ?? '');
    return c.json({ error: err.message }, err.status);
  }
  console.error(`[${c.req.method} ${c.req.path}]`, err);
  return c.json({ error: 'Erreur interne du serveur.' }, 500);
});

export default app;
