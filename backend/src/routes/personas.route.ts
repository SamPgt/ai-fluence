import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CONTEXT_BLOCK_MAX } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, personas } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { toPersona } from '../services/serialize.js';
import type { AppEnv } from '../types.js';

const loraSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().max(60).default(''),
  path: z.url({ protocol: /^https$/, message: 'Lien https direct vers le .safetensors' }),
  scale: z.number().min(0).max(4).default(1),
  family: z.string().min(3),
  noise: z.enum(['high', 'low', 'both']).optional(),
  triggerWords: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  previewUrl: z.url({ protocol: /^https$/ }).optional(),
  sourceUrl: z.url({ protocol: /^https$/ }).optional(),
});

const contextBlockSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().max(60).default(''),
  text: z.string().max(CONTEXT_BLOCK_MAX).default(''),
});

const personaSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#8b5cf6'),
  avatarAssetId: z.uuid().nullable().default(null),
  contextBlocks: z.array(contextBlockSchema).max(10).default([]),
  loras: z.array(loraSchema).max(12).default([]),
  defaultImageFamily: z.string().nullable().default(null),
  defaultVideoFamily: z.string().nullable().default(null),
});

/** Garantit un id stable à chaque LoRA et à chaque bloc de contexte. */
const withIds = <T extends { id?: string }>(items: T[]) => items.map(i => ({ ...i, id: i.id || randomUUID() }));

const refCount = sql<number>`(select count(*)::int from assets a where a.persona_id = "personas"."id" and a.is_reference)`;

async function assertAvatar(userId: string, avatarAssetId: string | null | undefined) {
  if (!avatarAssetId) return true;
  const [a] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.id, avatarAssetId), eq(assets.userId, userId)))
    .limit(1);
  return Boolean(a);
}

const personasRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/', async c => {
    const rows = await db
      .select({ p: personas, refs: refCount })
      .from(personas)
      .where(eq(personas.userId, c.get('user').id))
      .orderBy(asc(personas.position), asc(personas.createdAt));
    return c.json({ personas: rows.map(r => toPersona(r.p, r.refs)) });
  })
  .post('/', zValidator('json', personaSchema), async c => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (!(await assertAvatar(user.id, body.avatarAssetId))) return c.json({ error: 'Avatar introuvable.' }, 400);
    const position = await db.$count(personas, eq(personas.userId, user.id));
    const [row] = await db
      .insert(personas)
      .values({
        ...body,
        loras: withIds(body.loras),
        contextBlocks: withIds(body.contextBlocks),
        userId: user.id,
        position,
      })
      .returning();
    return c.json({ persona: toPersona(row) }, 201);
  })
  .patch('/:id', zValidator('json', personaSchema.partial()), async c => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (!(await assertAvatar(user.id, body.avatarAssetId))) return c.json({ error: 'Avatar introuvable.' }, 400);
    const { loras, contextBlocks, ...rest } = body;
    const [row] = await db
      .update(personas)
      .set({
        ...rest,
        ...(loras ? { loras: withIds(loras) } : {}),
        ...(contextBlocks ? { contextBlocks: withIds(contextBlocks) } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(personas.id, c.req.param('id')), eq(personas.userId, user.id)))
      .returning();
    if (!row) return c.json({ error: 'Persona introuvable.' }, 404);
    const [{ refs }] = await db.select({ refs: refCount }).from(personas).where(eq(personas.id, row.id));
    return c.json({ persona: toPersona(row, refs) });
  })
  .delete('/:id', async c => {
    // Les fils et médias sont conservés (persona_id passe à null).
    await db.delete(personas).where(and(eq(personas.id, c.req.param('id')), eq(personas.userId, c.get('user').id)));
    return c.json({ ok: true });
  });

export default personasRoutes;
