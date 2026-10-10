import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Scene } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { places, scenes } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

/** Scènes enregistrées : la combinaison du composer (bulles choisies et 🎲, lieu, texte), réutilisable. */

function toScene(row: typeof scenes.$inferSelect): Scene {
  return {
    id: row.id,
    name: row.name,
    traits: row.traits,
    slots: row.slots,
    placeId: row.placeId,
    prompt: row.prompt,
    createdAt: row.createdAt.toISOString(),
  };
}

const zone = z.enum(['character', 'outfit', 'action', 'place', 'photo']);
const sceneSchema = z.object({
  name: z.string().trim().min(1).max(60),
  traits: z
    .array(
      z.object({
        optionId: z.uuid(),
        categoryId: z.uuid(),
        categoryLabel: z.string().max(100),
        zone,
        label: z.string().max(200).nullable(),
        fragment: z.string().max(500),
        thumbnailUrl: z.string().max(500).nullable(),
      }),
    )
    .max(30),
  slots: z
    .array(
      z.object({
        categoryId: z.uuid(),
        categoryLabel: z.string().max(100),
        zone,
        drawFrom: z.enum(['all', 'favorites', 'pool']),
        pool: z.array(z.uuid()).max(500),
      }),
    )
    .max(30),
  placeId: z.uuid().nullable(),
  prompt: z.string().max(5000),
});

const scenesRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/', async c => {
    const rows = await db.select().from(scenes).where(eq(scenes.userId, c.get('user').id)).orderBy(desc(scenes.updatedAt));
    return c.json({ scenes: rows.map(toScene) });
  })
  .post('/', zValidator('json', sceneSchema), async c => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (body.placeId) {
      const [place] = await db
        .select({ id: places.id })
        .from(places)
        .where(and(eq(places.id, body.placeId), eq(places.userId, user.id)))
        .limit(1);
      if (!place) body.placeId = null;
    }
    const [row] = await db
      .insert(scenes)
      .values({ ...body, userId: user.id })
      .returning();
    return c.json({ scene: toScene(row) }, 201);
  })
  .delete('/:id', async c => {
    await db.delete(scenes).where(and(eq(scenes.id, c.req.param('id')), eq(scenes.userId, c.get('user').id)));
    return c.json({ ok: true });
  });

export default scenesRoutes;
