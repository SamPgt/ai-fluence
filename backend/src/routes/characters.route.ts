import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { CharacterDraft, CharacterSlot } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, characterDrafts, generations, libraryCategories, personas, threads } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { toPersona } from '../services/serialize.js';
import type { AppEnv } from '../types.js';

/**
 * Créateur de personnage : une fiche d'identité (un emplacement par catégorie de la zone Personnage),
 * des lots de variantes générés dans un fil masqué, puis « Garder ce personnage » qui crée le persona.
 */

type DraftRow = typeof characterDrafts.$inferSelect;

/** Prompt neutre des variantes : on juge le personnage, pas la scène. Prolonge la phrase des traits. */
const DEFAULT_PREVIEW =
  'head and shoulders studio portrait photo, wearing a plain grey t-shirt, plain light grey background, soft even lighting, looking at the camera, realistic photo';

function toDraft(row: DraftRow): CharacterDraft {
  return {
    id: row.id,
    name: row.name,
    gender: row.gender,
    slots: row.slots,
    previewPrompt: row.previewPrompt,
    family: row.family,
    threadId: row.threadId,
    personaId: row.personaId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Un emplacement par catégorie de la zone Personnage qui a des options. */
async function initialSlots(userId: string, start: 'blank' | 'random'): Promise<CharacterSlot[]> {
  const categories = await db
    .select({ id: libraryCategories.id })
    .from(libraryCategories)
    .where(
      and(
        eq(libraryCategories.userId, userId),
        eq(libraryCategories.zone, 'character'),
        sql`exists (select 1 from library_options o where o.category_id = ${libraryCategories.id})`,
      ),
    )
    .orderBy(libraryCategories.position);
  return categories.map(c => ({
    categoryId: c.id,
    mode: start === 'random' ? 'random' : 'empty',
    optionId: null,
    pool: [],
    locked: false,
  }));
}

async function createDraft(userId: string, start: 'blank' | 'random'): Promise<DraftRow> {
  const [thread] = await db
    .insert(threads)
    .values({ userId, title: 'Création de personnage', hidden: true })
    .returning({ id: threads.id });
  const [row] = await db
    .insert(characterDrafts)
    .values({ userId, slots: await initialSlots(userId, start), previewPrompt: DEFAULT_PREVIEW, threadId: thread.id })
    .returning();
  return row;
}

const slotSchema = z.object({
  categoryId: z.uuid(),
  mode: z.enum(['chosen', 'random', 'empty']),
  optionId: z.uuid().nullable(),
  pool: z.array(z.uuid()).max(500),
  locked: z.boolean(),
});

// Sans valeurs par défaut : une mise à jour partielle ne touche qu'aux champs envoyés (cf. Zod 4 et `.partial()`).
const draftUpdate = z
  .object({
    name: z.string().trim().max(40),
    gender: z.enum(['female', 'male']),
    slots: z.array(slotSchema).max(50),
    previewPrompt: z.string().trim().min(1).max(1000),
    family: z.string().nullable(),
  })
  .partial();

const idParam = zValidator('param', z.object({ id: z.uuid() }));

async function ownedDraft(userId: string, id: string): Promise<DraftRow | undefined> {
  const [row] = await db
    .select()
    .from(characterDrafts)
    .where(and(eq(characterDrafts.id, id), eq(characterDrafts.userId, userId)))
    .limit(1);
  return row;
}

const charactersRoutes = new Hono<AppEnv>()
  .use(auth)
  /** Création en cours (la plus récente pas encore gardée), ou une nouvelle en « aléatoire complet ». */
  .get('/drafts/current', async c => {
    const user = c.get('user');
    const [row] = await db
      .select()
      .from(characterDrafts)
      .where(and(eq(characterDrafts.userId, user.id), isNull(characterDrafts.personaId)))
      .orderBy(desc(characterDrafts.updatedAt))
      .limit(1);
    return c.json({ draft: toDraft(row ?? (await createDraft(user.id, 'random'))) });
  })
  .post('/drafts', zValidator('json', z.object({ start: z.enum(['blank', 'random']).default('random') })), async c => {
    return c.json({ draft: toDraft(await createDraft(c.get('user').id, c.req.valid('json').start)) }, 201);
  })
  .patch('/drafts/:id', idParam, zValidator('json', draftUpdate), async c => {
    const { id } = c.req.valid('param');
    if (!(await ownedDraft(c.get('user').id, id))) return c.json({ error: 'Création introuvable.' }, 404);
    const [row] = await db
      .update(characterDrafts)
      .set({ ...c.req.valid('json'), updatedAt: new Date() })
      .where(eq(characterDrafts.id, id))
      .returning();
    return c.json({ draft: toDraft(row) });
  })
  /**
   * « Garder ce personnage » : crée le persona depuis une variante. Son image devient l'avatar et la première
   * référence (et première image master) ; ses traits de la zone Personnage deviennent sa fiche d'identité.
   */
  .post(
    '/drafts/:id/keep',
    idParam,
    zValidator('json', z.object({ generationId: z.uuid(), name: z.string().trim().min(1).max(40) })),
    async c => {
      const user = c.get('user');
      const { id } = c.req.valid('param');
      const { generationId, name } = c.req.valid('json');
      const draft = await ownedDraft(user.id, id);
      if (!draft) return c.json({ error: 'Création introuvable.' }, 404);
      const [generation] = await db
        .select()
        .from(generations)
        .where(and(eq(generations.id, generationId), eq(generations.threadId, draft.threadId), eq(generations.status, 'succeeded')))
        .limit(1);
      if (!generation) return c.json({ error: 'Variante introuvable.' }, 404);
      const [image] = await db
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.generationId, generation.id), eq(assets.kind, 'output')))
        .limit(1);
      if (!image) return c.json({ error: 'Cette variante n’a plus d’image.' }, 400);

      const position = await db.$count(personas, eq(personas.userId, user.id));
      const [persona] = await db
        .insert(personas)
        .values({
          userId: user.id,
          name,
          gender: draft.gender,
          identity: generation.traits.filter(t => t.zone === 'character'),
          avatarAssetId: image.id,
          defaultImageFamily: draft.family,
          position,
        })
        .returning();
      await db.update(assets).set({ personaId: persona.id, isReference: true, isMaster: true }).where(eq(assets.id, image.id));
      await db.update(characterDrafts).set({ personaId: persona.id, name, updatedAt: new Date() }).where(eq(characterDrafts.id, id));
      return c.json({ persona: toPersona(persona, 1) }, 201);
    },
  );

export default charactersRoutes;
