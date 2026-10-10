import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { CharacterDraft, CharacterSlot, CreatorKind } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, characterDrafts, generations, libraryCategories, personas, places, threads } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { toPersona, toPlace } from '../services/serialize.js';
import type { AppEnv } from '../types.js';

/**
 * Créateur de personnage ou de lieu : une fiche (un emplacement par catégorie de la zone Personnage, ou
 * Lieu & décor), des lots de variantes générés dans un fil masqué, puis « Garder » qui crée le persona ou le lieu.
 */

type DraftRow = typeof characterDrafts.$inferSelect;

/** Prompt neutre des variantes : on juge le personnage (ou le lieu), pas la scène. Prolonge la phrase des traits. */
const DEFAULT_PREVIEW: Record<CreatorKind, string> = {
  character:
    'head and shoulders studio portrait photo, wearing a plain grey t-shirt, plain light grey background, soft even lighting, looking at the camera, realistic photo',
  place: 'wide-angle photo of the whole place, no people, natural daylight, realistic photo',
};
const ZONE: Record<CreatorKind, 'character' | 'place'> = { character: 'character', place: 'place' };

function toDraft(row: DraftRow): CharacterDraft {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    gender: row.gender,
    slots: row.slots,
    previewPrompt: row.previewPrompt,
    family: row.family,
    threadId: row.threadId,
    personaId: row.personaId,
    placeId: row.placeId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Un emplacement par catégorie de la zone (Personnage ou Lieu & décor) qui a des options. */
async function initialSlots(userId: string, start: 'blank' | 'random', kind: CreatorKind): Promise<CharacterSlot[]> {
  const categories = await db
    .select({ id: libraryCategories.id })
    .from(libraryCategories)
    .where(
      and(
        eq(libraryCategories.userId, userId),
        eq(libraryCategories.zone, ZONE[kind]),
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

async function createDraft(userId: string, start: 'blank' | 'random', kind: CreatorKind): Promise<DraftRow> {
  const [thread] = await db
    .insert(threads)
    .values({ userId, title: kind === 'place' ? 'Création de lieu' : 'Création de personnage', hidden: true })
    .returning({ id: threads.id });
  const [row] = await db
    .insert(characterDrafts)
    .values({ userId, kind, slots: await initialSlots(userId, start, kind), previewPrompt: DEFAULT_PREVIEW[kind], threadId: thread.id })
    .returning();
  return row;
}

const slotSchema = z.object({
  categoryId: z.uuid(),
  mode: z.enum(['chosen', 'random', 'empty']),
  optionId: z.uuid().nullable(),
  pool: z.array(z.uuid()).max(500),
  drawFrom: z.enum(['all', 'favorites', 'pool']).optional(),
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
  .get('/drafts/current', zValidator('query', z.object({ kind: z.enum(['character', 'place']).default('character') })), async c => {
    const user = c.get('user');
    const { kind } = c.req.valid('query');
    const [row] = await db
      .select()
      .from(characterDrafts)
      .where(
        and(
          eq(characterDrafts.userId, user.id),
          eq(characterDrafts.kind, kind),
          isNull(characterDrafts.personaId),
          isNull(characterDrafts.placeId),
        ),
      )
      .orderBy(desc(characterDrafts.updatedAt))
      .limit(1);
    return c.json({ draft: toDraft(row ?? (await createDraft(user.id, 'random', kind))) });
  })
  .post(
    '/drafts',
    zValidator(
      'json',
      z.object({ start: z.enum(['blank', 'random']).default('random'), kind: z.enum(['character', 'place']).default('character') }),
    ),
    async c => {
      const { start, kind } = c.req.valid('json');
      return c.json({ draft: toDraft(await createDraft(c.get('user').id, start, kind)) }, 201);
    },
  )
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

      // Lieu : sa fiche (traits Lieu & décor), l'image comme référence et première master.
      if (draft.kind === 'place') {
        const [place] = await db
          .insert(places)
          .values({
            userId: user.id,
            name,
            identity: generation.traits.filter(t => t.zone === 'place'),
            avatarAssetId: image.id,
            defaultImageFamily: draft.family,
          })
          .returning();
        await db.update(assets).set({ placeId: place.id, isMaster: true }).where(eq(assets.id, image.id));
        await db.update(characterDrafts).set({ placeId: place.id, name, updatedAt: new Date() }).where(eq(characterDrafts.id, id));
        return c.json({ place: toPlace(place, [], 1) }, 201);
      }

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
