import { randomInt } from 'node:crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  MASTER_AXES,
  type GenerationVariation,
  type MasterAxis,
  type MastersResponse,
  type MasterVariant,
} from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, generations, libraryOptions, personas, threads } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { createGeneration, PriceChangedError } from '../services/generation.service.js';
import { toAsset } from '../services/serialize.js';
import type { AppEnv } from '../types.js';

/**
 * Images master d'un persona : lots de variations proches de son image de référence (un axe par lot :
 * angles, expressions…), dans un fil masqué ; l'utilisateur marque celles qui « matchent ».
 */

type PersonaRow = typeof personas.$inferSelect;

const AXES = MASTER_AXES.map(a => a.id) as [MasterAxis, ...MasterAxis[]];

async function ownedPersona(userId: string, id: string): Promise<PersonaRow | undefined> {
  const [row] = await db
    .select()
    .from(personas)
    .where(and(eq(personas.id, id), eq(personas.userId, userId)))
    .limit(1);
  return row;
}

/** Fil masqué des variations du persona, créé au premier lot (ou recréé s'il a été supprimé). */
async function masterThread(persona: PersonaRow): Promise<string> {
  if (persona.masterThreadId) {
    const [thread] = await db.select({ id: threads.id }).from(threads).where(eq(threads.id, persona.masterThreadId)).limit(1);
    if (thread) return thread.id;
  }
  const [thread] = await db
    .insert(threads)
    .values({ userId: persona.userId, personaId: persona.id, title: `Images master · ${persona.name}`, hidden: true })
    .returning({ id: threads.id });
  await db.update(personas).set({ masterThreadId: thread.id }).where(eq(personas.id, persona.id));
  return thread.id;
}

/** Variantes du lot : l'axe parcouru dans un ordre mélangé (sans répétition tant que possible), ou un mélange de tous les axes. */
function drawVariants(axis: MasterAxis | 'mix', count: number): { axis: MasterAxis; variant: MasterVariant }[] {
  const pool =
    axis === 'mix'
      ? MASTER_AXES.flatMap(a => a.variants.map(variant => ({ axis: a.id, variant })))
      : MASTER_AXES.find(a => a.id === axis)!.variants.map(variant => ({ axis, variant }));
  const out: { axis: MasterAxis; variant: MasterVariant }[] = [];
  while (out.length < count) {
    const round = [...pool];
    for (let i = round.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [round[i], round[j]] = [round[j], round[i]];
    }
    out.push(...round.slice(0, count - out.length));
  }
  return out;
}

const SUBJECT = { female: 'a woman', male: 'a man' } as const;

const mastersRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/:id/masters', async c => {
    const persona = await ownedPersona(c.get('user').id, c.req.param('id'));
    if (!persona) return c.json({ error: 'Persona introuvable.' }, 404);
    const rows = await db
      .select({ asset: assets, variation: generations.variation })
      .from(assets)
      .leftJoin(generations, eq(generations.id, assets.generationId))
      .where(and(eq(assets.personaId, persona.id), eq(assets.isMaster, true)))
      .orderBy(asc(assets.createdAt));
    return c.json({
      threadId: persona.masterThreadId,
      masters: rows.map(r => ({
        asset: toAsset(r.asset),
        axis: r.variation?.axis ?? null,
        variantLabel: r.variation?.label ?? null,
      })),
    } satisfies MastersResponse);
  })
  /** Marque (ou retire) une image master. Une master fait aussi partie des références du persona. */
  .patch(
    '/:id/masters/:assetId',
    zValidator('param', z.object({ id: z.uuid(), assetId: z.uuid() })),
    zValidator('json', z.object({ isMaster: z.boolean() })),
    async c => {
      const user = c.get('user');
      const { id, assetId } = c.req.valid('param');
      const { isMaster } = c.req.valid('json');
      const persona = await ownedPersona(user.id, id);
      if (!persona) return c.json({ error: 'Persona introuvable.' }, 404);
      // L'avatar reste une référence même retiré des masters.
      const keepReference = !isMaster && persona.avatarAssetId === assetId;
      const [row] = await db
        .update(assets)
        .set({ isMaster, isReference: isMaster || keepReference, personaId: persona.id })
        .where(and(eq(assets.id, assetId), eq(assets.userId, user.id), eq(assets.mediaType, 'image')))
        .returning();
      if (!row) return c.json({ error: 'Image introuvable.' }, 404);
      return c.json({ asset: toAsset(row) });
    },
  )
  /** Lance un lot de variations : identité du persona + une variante de l'axe par image, visage de la référence. */
  .post(
    '/:id/variations',
    zValidator(
      'json',
      z.object({
        axis: z.enum([...AXES, 'mix']),
        count: z.number().int().min(1).max(12),
        family: z.string().min(3),
        face: z.boolean(),
        params: z.record(z.string(), z.unknown()).default({}),
      }),
    ),
    async c => {
      const user = c.get('user');
      const persona = await ownedPersona(user.id, c.req.param('id'));
      if (!persona) return c.json({ error: 'Persona introuvable.' }, 404);
      const { axis, count, family, face, params } = c.req.valid('json');
      if (face && !persona.avatarAssetId) return c.json({ error: 'Ce persona n’a pas d’image de référence (avatar).' }, 400);

      // Fiche d'identité en phrase (« a woman with afro hair ») ; sans fiche, au moins le genre.
      const optionIds = persona.identity.map(t => t.optionId);
      const existing = optionIds.length
        ? await db.select({ id: libraryOptions.id }).from(libraryOptions).where(inArray(libraryOptions.id, optionIds))
        : [];
      const subject = existing.length ? '' : `${persona.gender ? SUBJECT[persona.gender] : 'a person'}, `;

      const draws = drawVariants(axis, count);
      const threadId = await masterThread(persona);
      try {
        await createGeneration(
          user,
          {
            family,
            threadId,
            personaId: persona.id,
            prompt: '',
            params,
            referenceAssetIds: [],
            faceAssetId: face ? persona.avatarAssetId : null,
            count,
            traitIds: existing.map(o => o.id),
            contextIds: [],
          },
          i => ({
            prompt: `${subject}${draws[i].variant.fragment}`,
            variation: {
              axis: draws[i].axis,
              variantId: draws[i].variant.id,
              label: draws[i].variant.label,
            } satisfies GenerationVariation,
          }),
        );
      } catch (err) {
        if (err instanceof PriceChangedError) return c.json({ error: 'Le prix a changé, relance le lot.' }, 409);
        throw err;
      }
      return c.json({ threadId }, 201);
    },
  );

export default mastersRoutes;
