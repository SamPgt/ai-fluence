import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../types.js';
import { getSessionUser } from '../lib/session.js';

export const auth = createMiddleware<AppEnv>(async (c, next) => {
  const user = await getSessionUser(c);
  if (!user) throw new HTTPException(401, { message: 'Authentification requise' });
  c.set('user', user);
  await next();
});
