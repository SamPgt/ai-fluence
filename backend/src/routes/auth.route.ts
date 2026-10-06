import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthResponse, User } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, users } from '../db/schema.js';
import { createSession, destroySession, getSessionUser } from '../lib/session.js';
import { auth } from '../middleware/auth.js';
import { mediaUrl } from '../services/serialize.js';
import { seedDefaultPresets } from './presets.route.js';
import type { AppEnv, SessionUser } from '../types.js';

const signupSchema = z.object({
  email: z.email().transform(v => v.toLowerCase().trim()),
  name: z.string().trim().min(1).max(60),
  password: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères.').max(200),
});

const loginSchema = z.object({
  email: z.email().transform(v => v.toLowerCase().trim()),
  password: z.string().min(1),
});

function toUser(u: SessionUser): User {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarAssetId ? mediaUrl(u.avatarAssetId) : null,
    createdAt: u.createdAt.toISOString(),
  };
}

const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  avatarAssetId: z.uuid().nullable().optional(),
});

const authRoutes = new Hono<AppEnv>()
  .post('/signup', zValidator('json', signupSchema), async c => {
    const { email, name, password } = c.req.valid('json');
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return c.json({ error: 'Un compte existe déjà avec cet e-mail.' }, 409);

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db.insert(users).values({ email, name, passwordHash }).returning();
    await seedDefaultPresets(user.id);
    await createSession(c, user.id);
    return c.json({ user: toUser(user) } satisfies AuthResponse, 201);
  })
  .post('/login', zValidator('json', loginSchema), async c => {
    const { email, password } = c.req.valid('json');
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return c.json({ error: 'E-mail ou mot de passe incorrect.' }, 401);
    }
    await createSession(c, user.id);
    return c.json({ user: toUser(user) } satisfies AuthResponse);
  })
  .post('/logout', async c => {
    await destroySession(c);
    return c.json({ ok: true });
  })
  .get('/me', async c => {
    const user = await getSessionUser(c);
    return c.json({ user: user ? toUser(user) : null });
  })
  .patch('/me', auth, zValidator('json', updateMeSchema), async c => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (body.avatarAssetId) {
      const [owned] = await db
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.id, body.avatarAssetId), eq(assets.userId, user.id), eq(assets.mediaType, 'image')))
        .limit(1);
      if (!owned) return c.json({ error: 'Image introuvable.' }, 400);
    }
    const [row] = await db.update(users).set(body).where(eq(users.id, user.id)).returning();
    return c.json({ user: toUser(row) } satisfies AuthResponse);
  });

export default authRoutes;
