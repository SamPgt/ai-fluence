import { randomInt } from 'node:crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  axesFor,
  type CreatorKind,
  type Gender,
  type GenerationTrait,
  type GenerationVariation,
  type MasterAxis,
  type MastersResponse,
  type MasterVariant,
} from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, generations, libraryOptions, personas, places, threads } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { createGeneration, PriceChangedError } from '../services/generation.service.js';
import { toAsset } from '../services/serialize.js';
import type { AppEnv } from '../types.js';

/**
 * Images master d'un persona ou d'un lieu : lots de variations proches de son image de référence
 * (un axe par lot : angles, expressions, moments…), dans un fil masqué ; l'utilisateur marque celles qui « matchent ».
 * Monté sous `/personas` (personnage) et `/places` (lieu).
 */

interface Owner {
  kind: CreatorKind;
  id: string;
  userId: string;
  name: string;
  gender: Gender | null;
  identity: GenerationTrait[];
  avatarAssetId: string | null;
  masterThreadId: string | null;
}

async function loadOwner(kind: CreatorKind, userId: string, id: string): Promise<Owner | undefined> {
  if (kind === 'place') {
    const [row] = await db
      .select()
      .from(places)
      .where(and(eq(places.id, id), eq(places.userId, userId)))
      .limit(1);
    return row && { ...row, kind, gender: null };
  }
  const [row] = await db
    .select()
    .from(personas)
    .where(and(eq(personas.id, id), eq(personas.userId, userId)))
    .limit(1);
  return row && { ...row, kind, gender: row.gender ?? null };
}

/** Fil masqué des variations, créé au premier lot (ou recréé s'il a été supprimé). */
async function masterThread(owner: Owner): Promise<string> {
  if (owner.masterThreadId) {
    const [thread] = await db.select({ id: threads.id }).from(threads).where(eq(threads.id, owner.masterThreadId)).limit(1);
    if (thread) return thread.id;
  }
  const [thread] = await db
    .insert(threads)
    .values({
      userId: owner.userId,
      personaId: owner.kind === 'character' ? owner.id : null,
      title: `Images master · ${owner.name}`,
      hidden: true,
    })
    .returning({ id: threads.id });
  if (owner.kind === 'place') await db.update(places).set({ masterThreadId: thread.id }).where(eq(places.id, owner.id));
  else await db.update(personas).set({ masterThreadId: thread.id }).where(eq(personas.id, owner.id));
  return thread.id;
}

/** Variantes du lot : l'axe parcouru dans un ordre mélangé (sans répétition tant que possible), ou un mélange de tous les axes. */
function drawVariants(kind: CreatorKind, axis: MasterAxis | 'mix', count: number): { axis: MasterAxis; variant: MasterVariant }[] {
  const axes = axesFor(kind);
  const pool =
    axis === 'mix'
      ? axes.flatMap(a => a.variants.map(variant => ({ axis: a.id, variant })))
      : axes.find(a => a.id === axis)!.variants.map(variant => ({ axis, variant }));
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

export function mastersRoutes(kind: CreatorKind) {
  const ownerColumn = kind === 'place' ? assets.placeId : assets.personaId;
  const axisIds = axesFor(kind).map(a => a.id) as [MasterAxis, ...MasterAxis[]];

  return new Hono<AppEnv>()
    .use(auth)
    .get('/:id/masters', async c => {
      const owner = await loadOwner(kind, c.get('user').id, c.req.param('id'));
      if (!owner) return c.json({ error: 'Introuvable.' }, 404);
      const rows = await db
        .select({ asset: assets, variation: generations.variation })
        .from(assets)
        .leftJoin(generations, eq(generations.id, assets.generationId))
        .where(and(eq(ownerColumn, owner.id), eq(assets.isMaster, true)))
        .orderBy(asc(assets.createdAt));
      return c.json({
        threadId: owner.masterThreadId,
        masters: rows.map(r => ({
          asset: toAsset(r.asset),
          axis: r.variation?.axis ?? null,
          variantLabel: r.variation?.label ?? null,
        })),
      } satisfies MastersResponse);
    })
    /** Marque (ou retire) une image master. Celle d'un persona fait aussi partie de ses références. */
    .patch(
      '/:id/masters/:assetId',
      zValidator('param', z.object({ id: z.uuid(), assetId: z.uuid() })),
      zValidator('json', z.object({ isMaster: z.boolean() })),
      async c => {
        const user = c.get('user');
        const { id, assetId } = c.req.valid('param');
        const { isMaster } = c.req.valid('json');
        const owner = await loadOwner(kind, user.id, id);
        if (!owner) return c.json({ error: 'Introuvable.' }, 404);
        // L'avatar d'un persona reste une référence même retiré des masters.
        const set =
          kind === 'place'
            ? { isMaster, placeId: owner.id }
            : { isMaster, isReference: isMaster || owner.avatarAssetId === assetId, personaId: owner.id };
        const [row] = await db
          .update(assets)
          .set(set)
          .where(and(eq(assets.id, assetId), eq(assets.userId, user.id), eq(assets.mediaType, 'image')))
          .returning();
        if (!row) return c.json({ error: 'Image introuvable.' }, 404);
        return c.json({ asset: toAsset(row) });
      },
    )
    /**
     * Lance un lot de variations : fiche + une variante de l'axe par image. Personnage : visage de la référence
     * (ReActor). Lieu : image → image depuis la référence, à la force demandée.
     */
    .post(
      '/:id/variations',
      zValidator(
        'json',
        z.object({
          axis: z.enum([...axisIds, 'mix']),
          count: z.number().int().min(1).max(12),
          family: z.string().min(3),
          face: z.boolean().default(false),
          strength: z.number().min(0.3).max(0.95).optional(),
          /** Modèle à références (klein, Qwen Edit…) : l'image de référence est donnée au modèle comme « image 1 ». */
          reference: z.boolean().default(false),
          params: z.record(z.string(), z.unknown()).default({}),
        }),
      ),
      async c => {
        const user = c.get('user');
        const owner = await loadOwner(kind, user.id, c.req.param('id'));
        if (!owner) return c.json({ error: 'Introuvable.' }, 404);
        const { axis, count, family, face, strength, params, reference } = c.req.valid('json');
        const fromReference = kind === 'place' && strength !== undefined;
        if ((face || fromReference || reference) && !owner.avatarAssetId) {
          return c.json({ error: 'Pas d’image de référence.' }, 400);
        }

        // Fiche en phrase (« a woman with afro hair », « a cozy bedroom… ») ; sans fiche, au moins le genre (personnage).
        const optionIds = owner.identity.map(t => t.optionId);
        const existing = optionIds.length
          ? await db.select({ id: libraryOptions.id }).from(libraryOptions).where(inArray(libraryOptions.id, optionIds))
          : [];
        const subject =
          existing.length || kind === 'place' ? '' : `${owner.gender ? SUBJECT[owner.gender] : 'a person'}, `;
        // Avec une référence, le prompt la désigne : c'est ce qui garde le visage ou la pièce d'une image à l'autre.
        const lead = reference ? (kind === 'place' ? 'the same place as in image 1, ' : 'the same person as in image 1, same face and hair, ') : '';

        const draws = drawVariants(kind, axis, count);
        const threadId = await masterThread(owner);
        try {
          await createGeneration(
            user,
            {
              family,
              threadId,
              personaId: kind === 'character' ? owner.id : null,
              prompt: '',
              params: fromReference ? { ...params, strength } : params,
              referenceAssetIds: fromReference || reference ? [owner.avatarAssetId!] : [],
              faceAssetId: kind === 'character' && face ? owner.avatarAssetId : null,
              count,
              traitIds: existing.map(o => o.id),
              contextIds: [],
            },
            i => ({
              prompt: `${subject}${lead}${draws[i].variant.fragment}`,
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
}
