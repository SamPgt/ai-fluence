import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { PromptPreset } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { personas, promptPresets } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const DEFAULT_PRESETS: Omit<PromptPreset, 'id' | 'position' | 'enabled' | 'personaId'>[] = [
  { label: 'Photo iPhone', text: 'candid iPhone photo, natural daylight, slight grain, realistic skin texture', media: 'image' },
  { label: 'Lumière dorée', text: 'golden hour lighting, warm tones, soft shadows', media: 'all' },
  { label: 'Studio', text: 'studio portrait, softbox lighting, clean background, sharp focus', media: 'image' },
  { label: 'Ciné 35mm', text: 'cinematic shot, 35mm film, shallow depth of field, film grain', media: 'all' },
  { label: 'Selfie miroir', text: 'mirror selfie, phone in hand, casual outfit, bedroom background', media: 'image' },
  { label: 'Travelling', text: 'slow dolly in, smooth camera movement', media: 'video' },
  { label: 'Plan drone', text: 'aerial drone shot, wide establishing view', media: 'video' },
  { label: 'Anime', text: 'anime style, vibrant colors, clean line art', media: 'all' },
];

export async function seedDefaultPresets(userId: string) {
  await db.insert(promptPresets).values(DEFAULT_PRESETS.map((p, position) => ({ ...p, userId, position })));
}

function toPreset(r: typeof promptPresets.$inferSelect): PromptPreset {
  return {
    id: r.id,
    label: r.label,
    text: r.text,
    media: r.media,
    enabled: r.enabled,
    personaId: r.personaId,
    position: r.position,
  };
}

const presetSchema = z.object({
  label: z.string().trim().min(1).max(40),
  text: z.string().trim().min(1).max(1000),
  media: z.enum(['image', 'video', 'all']).default('all'),
  enabled: z.boolean().default(true),
  /** Persona propriétaire ; absent ou null = disponible pour tous les personas. */
  personaId: z.uuid().nullable().default(null),
});

const presetsRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/', async c => {
    const rows = await db
      .select()
      .from(promptPresets)
      .where(eq(promptPresets.userId, c.get('user').id))
      .orderBy(asc(promptPresets.position), asc(promptPresets.createdAt));
    return c.json({ presets: rows.map(toPreset) });
  })
  .post('/', zValidator('json', presetSchema), async c => {
    const userId = c.get('user').id;
    const { personaId } = c.req.valid('json');
    if (personaId) {
      const [owned] = await db
        .select({ id: personas.id })
        .from(personas)
        .where(and(eq(personas.id, personaId), eq(personas.userId, userId)))
        .limit(1);
      if (!owned) return c.json({ error: 'Persona introuvable.' }, 404);
    }
    const count = await db.$count(promptPresets, eq(promptPresets.userId, userId));
    const [row] = await db
      .insert(promptPresets)
      .values({ ...c.req.valid('json'), userId, position: count })
      .returning();
    return c.json({ preset: toPreset(row) }, 201);
  })
  .patch(
    '/:id',
    zValidator(
      'json',
      z.object({
        label: z.string().trim().min(1).max(40).optional(),
        text: z.string().trim().min(1).max(1000).optional(),
        media: z.enum(['image', 'video', 'all']).optional(),
        enabled: z.boolean().optional(),
      }),
    ),
    async c => {
    const [row] = await db
      .update(promptPresets)
      .set(c.req.valid('json'))
      .where(and(eq(promptPresets.id, c.req.param('id')), eq(promptPresets.userId, c.get('user').id)))
      .returning();
    if (!row) return c.json({ error: 'Raccourci introuvable.' }, 404);
    return c.json({ preset: toPreset(row) });
  })
  .delete('/:id', async c => {
    await db
      .delete(promptPresets)
      .where(and(eq(promptPresets.id, c.req.param('id')), eq(promptPresets.userId, c.get('user').id)));
    return c.json({ ok: true });
  });

export default presetsRoutes;
