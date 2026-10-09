import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, inArray, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  getZone,
  type LibraryCategory,
  type LibraryImportResult,
  type LibraryMoveResult,
  type LibraryOption,
} from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { libraryCategories, libraryOptions } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { slug } from '../services/settings.service.js';
import {
  cancelCategoryThumbnails,
  cancelCategoryThumbnailsUnchecked,
  cancelOptionThumbnails,
  cancelOptionsThumbnails,
  generateCategoryThumbnails,
  listThumbnails,
  regenerateOptionThumbnail,
} from '../services/thumbnail.service.js';
import type { AppEnv } from '../types.js';

/**
 * Bibliothèque : catégories d'options (« Coupe de cheveux ») alimentées à la main ou par import
 * de fichiers wildcards (une option par ligne). Chaque option a un fragment anglais pour le modèle
 * et un libellé français facultatif.
 */

type CategoryRow = typeof libraryCategories.$inferSelect;
type OptionRow = typeof libraryOptions.$inferSelect;

function toCategory(row: CategoryRow, optionCount: number): LibraryCategory {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    parentId: row.parentId,
    description: row.description,
    zone: row.zone,
    phrase: row.phrase,
    gendered: row.gendered,
    thumbnailTemplate: row.thumbnailTemplate,
    optionCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function toOption(row: OptionRow): LibraryOption {
  return {
    id: row.id,
    categoryId: row.categoryId,
    fragment: row.fragment,
    label: row.label,
    gender: row.gender ?? null,
    tags: row.tags,
    weight: row.weight,
    source: row.source,
    favorite: row.favorite,
    hidden: row.hidden,
  };
}

const optionCount = sql<number>`(select count(*)::int from library_options o where o.category_id = "library_categories"."id")`;

/** Nom technique unique pour le compte : `Coupe de cheveux` → `coupe_de_cheveux` (puis `_2`, `_3`…). */
async function uniqueKey(userId: string, wanted: string, exceptId?: string): Promise<string> {
  const base = slug(wanted).replace(/-/g, '_') || 'categorie';
  const taken = new Set(
    (await db.select({ id: libraryCategories.id, key: libraryCategories.key }).from(libraryCategories).where(eq(libraryCategories.userId, userId)))
      .filter(r => r.id !== exceptId)
      .map(r => r.key),
  );
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

async function ownedCategory(userId: string, id: string): Promise<CategoryRow | undefined> {
  const [row] = await db
    .select()
    .from(libraryCategories)
    .where(and(eq(libraryCategories.id, id), eq(libraryCategories.userId, userId)))
    .limit(1);
  return row;
}

/**
 * Vérifie un parent : catégorie du compte, de premier niveau, autre que la catégorie elle-même,
 * et la catégorie ne doit pas avoir elle-même de sous-catégories (deux niveaux au plus). Renvoie le parent ou un message.
 */
async function checkParent(userId: string, parentId: string, selfId?: string): Promise<CategoryRow | string> {
  if (parentId === selfId) return 'Une catégorie ne peut pas être sa propre sous-catégorie.';
  const parent = await ownedCategory(userId, parentId);
  if (!parent) return 'Catégorie parente introuvable.';
  if (parent.parentId) return 'Deux niveaux au plus : choisis une catégorie de premier niveau comme parent.';
  if (selfId && (await db.$count(libraryCategories, eq(libraryCategories.parentId, selfId)))) {
    return 'Cette catégorie a déjà des sous-catégories : elle ne peut pas devenir une sous-catégorie.';
  }
  return parent;
}

async function ownedOption(userId: string, id: string): Promise<OptionRow | undefined> {
  const [row] = await db
    .select({ o: libraryOptions })
    .from(libraryOptions)
    .innerJoin(libraryCategories, eq(libraryCategories.id, libraryOptions.categoryId))
    .where(and(eq(libraryOptions.id, id), eq(libraryCategories.userId, userId)))
    .limit(1);
  return row?.o;
}

async function nextPosition(categoryId: string): Promise<number> {
  const [row] = await db.select({ p: max(libraryOptions.position) }).from(libraryOptions).where(eq(libraryOptions.categoryId, categoryId));
  return (row?.p ?? -1) + 1;
}

/**
 * Lignes d'un fichier wildcard : une option par ligne ; lignes vides et commentaires (`#`, `//`) ignorés.
 * Les doublons sont écartés à l'insertion (index unique catégorie + fragment).
 */
export function parseWildcardText(text: string): { lines: string[]; ignored: number } {
  const lines: string[] = [];
  let ignored = 0;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) ignored++;
    else lines.push(line);
  }
  return { lines, ignored };
}

// Champs sans valeur par défaut : avec Zod 4, `.partial()` appliquerait les défauts aux champs absents
// et une mise à jour partielle écraserait la zone, la description… Les défauts ne valent qu'à la création.
const categoryFields = z.object({
  label: z.string().trim().min(1).max(60),
  key: z.string().trim().max(60),
  description: z.string().max(500),
  zone: z.enum(['character', 'outfit', 'action', 'place', 'photo']),
  gendered: z.boolean(),
  thumbnailTemplate: z.string().max(1000),
  phrase: z.string().trim().max(200),
  parentId: z.uuid().nullable(),
});
const categoryCreate = categoryFields.partial().required({ label: true }).transform(b => ({
  ...b,
  parentId: b.parentId ?? null,
  description: b.description ?? '',
  zone: b.zone ?? ('character' as const),
  gendered: b.gendered ?? false,
  thumbnailTemplate: b.thumbnailTemplate ?? '',
  phrase: b.phrase ?? '',
}));
const categoryUpdate = categoryFields.partial();

const optionFields = z.object({
  fragment: z.string().trim().min(1).max(500),
  label: z.string().trim().max(80).nullable(),
  gender: z.enum(['female', 'male']).nullable(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20),
  weight: z.number().min(0).max(100),
  favorite: z.boolean(),
  hidden: z.boolean(),
});
const optionCreate = optionFields.partial().required({ fragment: true });
const optionUpdate = optionFields.partial();

const idParam = zValidator('param', z.object({ id: z.uuid() }));

const libraryRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/categories', async c => {
    const rows = await db
      .select({ cat: libraryCategories, count: optionCount })
      .from(libraryCategories)
      .where(eq(libraryCategories.userId, c.get('user').id))
      .orderBy(asc(libraryCategories.position), asc(libraryCategories.createdAt));
    return c.json({ categories: rows.map(r => toCategory(r.cat, r.count)) });
  })
  .post('/categories', zValidator('json', categoryCreate), async c => {
    const user = c.get('user');
    const body = c.req.valid('json');
    // Sous-catégorie : même zone que le parent ; genre, tournure et gabarit hérités s'ils ne sont pas précisés.
    if (body.parentId) {
      const parent = await checkParent(user.id, body.parentId);
      if (typeof parent === 'string') return c.json({ error: parent }, 400);
      body.zone = parent.zone;
      body.gendered ||= parent.gendered;
      body.phrase ||= parent.phrase;
      body.thumbnailTemplate ||= parent.thumbnailTemplate;
    }
    const key = await uniqueKey(user.id, body.key || body.label);
    const position = await db.$count(libraryCategories, eq(libraryCategories.userId, user.id));
    const gendered = body.gendered && getZone(body.zone).gender !== 'none';
    const [row] = await db
      .insert(libraryCategories)
      .values({ ...body, gendered, key, userId: user.id, position })
      .returning();
    return c.json({ category: toCategory(row, 0) }, 201);
  })
  .patch('/categories/:id', idParam, zValidator('json', categoryUpdate), async c => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const current = await ownedCategory(user.id, id);
    if (!current) return c.json({ error: 'Catégorie introuvable.' }, 404);
    // Rangée sous un parent : elle prend sa zone. Une sous-catégorie ne change pas de zone seule.
    const parentId = body.parentId !== undefined ? body.parentId : current.parentId;
    if (parentId) {
      const parent = await checkParent(user.id, parentId, id);
      if (typeof parent === 'string') return c.json({ error: parent }, 400);
      body.zone = parent.zone;
    }
    // Déplacée vers une zone sans genre (Lieu & décor, Photo) : la catégorie cesse d'être genrée.
    if (getZone(body.zone ?? current.zone).gender === 'none') body.gendered = false;
    const key = body.key !== undefined ? await uniqueKey(user.id, body.key || body.label || 'categorie', id) : undefined;
    const [row] = await db
      .update(libraryCategories)
      .set({ ...body, ...(key ? { key } : {}), updatedAt: new Date() })
      .where(eq(libraryCategories.id, id))
      .returning();
    // Une catégorie qui change de zone emmène ses sous-catégories.
    if (body.zone && body.zone !== current.zone && !row.parentId) {
      await db
        .update(libraryCategories)
        .set({ zone: body.zone, ...(getZone(body.zone).gender === 'none' ? { gendered: false } : {}), updatedAt: new Date() })
        .where(eq(libraryCategories.parentId, id));
    }
    const [{ count }] = await db.select({ count: optionCount }).from(libraryCategories).where(eq(libraryCategories.id, id));
    return c.json({ category: toCategory(row, count) });
  })
  .delete('/categories/:id', idParam, async c => {
    const { id } = c.req.valid('param');
    if (await ownedCategory(c.get('user').id, id)) await cancelCategoryThumbnailsUnchecked(id);
    await db.delete(libraryCategories).where(and(eq(libraryCategories.id, id), eq(libraryCategories.userId, c.get('user').id)));
    return c.json({ ok: true });
  })
  .get('/categories/:id/options', idParam, async c => {
    const { id } = c.req.valid('param');
    if (!(await ownedCategory(c.get('user').id, id))) return c.json({ error: 'Catégorie introuvable.' }, 404);
    const rows = await db
      .select()
      .from(libraryOptions)
      .where(eq(libraryOptions.categoryId, id))
      .orderBy(asc(libraryOptions.position), asc(libraryOptions.createdAt));
    return c.json({ options: rows.map(toOption) });
  })
  .post('/categories/:id/options', idParam, zValidator('json', optionCreate), async c => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!(await ownedCategory(c.get('user').id, id))) return c.json({ error: 'Catégorie introuvable.' }, 404);
    const [row] = await db
      .insert(libraryOptions)
      .values({ ...body, label: body.label || null, categoryId: id, position: await nextPosition(id) })
      .onConflictDoNothing()
      .returning();
    if (!row) return c.json({ error: 'Cette option existe déjà dans la catégorie.' }, 409);
    return c.json({ option: toOption(row) }, 201);
  })
  /** Import d'un fichier wildcard (son contenu texte) : une option par ligne, doublons ignorés. */
  .post(
    '/categories/:id/import',
    idParam,
    zValidator(
      'json',
      z.object({
        text: z.string().max(2_000_000),
        source: z.string().trim().max(200).default(''),
        /** Genre de toutes les options du fichier ; null = pour les deux. */
        gender: z.enum(['female', 'male']).nullable().default(null),
      }),
    ),
    async c => {
      const { id } = c.req.valid('param');
      const { text, source, gender } = c.req.valid('json');
      const category = await ownedCategory(c.get('user').id, id);
      if (!category) return c.json({ error: 'Catégorie introuvable.' }, 404);
      if (gender && getZone(category.zone).gender === 'none') {
        return c.json({ error: `La zone « ${getZone(category.zone).label} » n'a pas d'options réservées à un genre.` }, 400);
      }
      // Des options réservées à un genre rendent la catégorie genrée (miniatures femme / homme).
      if (gender && !category.gendered) {
        await db.update(libraryCategories).set({ gendered: true, updatedAt: new Date() }).where(eq(libraryCategories.id, id));
      }
      const { lines, ignored } = parseWildcardText(text);
      let added = 0;
      if (lines.length) {
        const start = await nextPosition(id);
        // Par paquets : un fichier peut compter des milliers de lignes.
        for (let i = 0; i < lines.length; i += 500) {
          const rows = await db
            .insert(libraryOptions)
            .values(lines.slice(i, i + 500).map((fragment, j) => ({ categoryId: id, fragment, source, gender, position: start + i + j })))
            .onConflictDoNothing()
            .returning({ id: libraryOptions.id });
          added += rows.length;
        }
      }
      return c.json({ result: { added, duplicates: lines.length - added, ignored } satisfies LibraryImportResult });
    },
  )
  // ── Miniatures ──
  .get('/categories/:id/thumbnails', idParam, async c => {
    return c.json({ thumbnails: await listThumbnails(c.get('user').id, c.req.valid('param').id) });
  })
  /** Génère les miniatures manquantes (ou toutes) de la catégorie, en local, l'une après l'autre. */
  .post(
    '/categories/:id/thumbnails',
    idParam,
    zValidator('json', z.object({ mode: z.enum(['missing', 'all']).default('missing') })),
    async c => {
      const queued = await generateCategoryThumbnails(c.get('user').id, c.req.valid('param').id, c.req.valid('json').mode);
      return c.json({ queued });
    },
  )
  .post('/categories/:id/thumbnails/cancel', idParam, async c => {
    return c.json({ cancelled: await cancelCategoryThumbnails(c.get('user').id, c.req.valid('param').id) });
  })
  .post(
    '/options/:id/thumbnails',
    idParam,
    zValidator('json', z.object({ gender: z.enum(['female', 'male', 'any']).optional() })),
    async c => {
      return c.json({ queued: await regenerateOptionThumbnail(c.get('user').id, c.req.valid('param').id, c.req.valid('json').gender) });
    },
  )
  /**
   * Déplace des options vers une autre catégorie (découper « Vêtements » en « Hauts », « Bas »…).
   * Les miniatures suivent l'option. Un fragment déjà présent dans la destination reste en place.
   */
  .post(
    '/options/move',
    zValidator('json', z.object({ optionIds: z.array(z.uuid()).min(1).max(5000), categoryId: z.uuid() })),
    async c => {
      const user = c.get('user');
      const { optionIds, categoryId } = c.req.valid('json');
      const target = await ownedCategory(user.id, categoryId);
      if (!target) return c.json({ error: 'Catégorie de destination introuvable.' }, 404);
      const rows = await db
        .select({ o: libraryOptions })
        .from(libraryOptions)
        .innerJoin(libraryCategories, eq(libraryCategories.id, libraryOptions.categoryId))
        .where(and(inArray(libraryOptions.id, optionIds), eq(libraryCategories.userId, user.id)));
      const taken = new Set(
        (await db.select({ f: libraryOptions.fragment }).from(libraryOptions).where(eq(libraryOptions.categoryId, categoryId))).map(r => r.f),
      );
      const moving: OptionRow[] = [];
      for (const { o } of rows) {
        if (o.categoryId === categoryId || taken.has(o.fragment)) continue;
        taken.add(o.fragment);
        moving.push(o);
      }
      // Zone sans genre (lieux, ambiances) : les options perdent leur genre ; sinon, une option réservée rend la catégorie genrée.
      const genderless = getZone(target.zone).gender === 'none';
      if (!genderless && !target.gendered && moving.some(o => o.gender)) {
        await db.update(libraryCategories).set({ gendered: true, updatedAt: new Date() }).where(eq(libraryCategories.id, categoryId));
      }
      if (moving.length) {
        const start = await nextPosition(categoryId);
        await db.transaction(async tx => {
          for (const [i, o] of moving.entries()) {
            await tx
              .update(libraryOptions)
              .set({ categoryId, position: start + i, ...(genderless ? { gender: null } : {}) })
              .where(eq(libraryOptions.id, o.id));
          }
        });
      }
      const alreadyThere = rows.filter(r => r.o.categoryId === categoryId).length;
      return c.json({
        result: { moved: moving.length, duplicates: rows.length - moving.length - alreadyThere } satisfies LibraryMoveResult,
      });
    },
  )
  /** Favori ou masquage de plusieurs options d'un coup. */
  .post(
    '/options/flag',
    zValidator(
      'json',
      z
        .object({ optionIds: z.array(z.uuid()).min(1).max(5000), favorite: z.boolean().optional(), hidden: z.boolean().optional() })
        .refine(b => b.favorite !== undefined || b.hidden !== undefined),
    ),
    async c => {
      const { optionIds, favorite, hidden } = c.req.valid('json');
      const owned = db
        .select({ id: libraryOptions.id })
        .from(libraryOptions)
        .innerJoin(libraryCategories, eq(libraryCategories.id, libraryOptions.categoryId))
        .where(and(inArray(libraryOptions.id, optionIds), eq(libraryCategories.userId, c.get('user').id)));
      const rows = await db
        .update(libraryOptions)
        .set({ ...(favorite !== undefined ? { favorite } : {}), ...(hidden !== undefined ? { hidden } : {}) })
        .where(inArray(libraryOptions.id, owned))
        .returning({ id: libraryOptions.id });
      return c.json({ updated: rows.length });
    },
  )
  /** Supprime plusieurs options d'un coup (et leurs miniatures en attente). */
  .post('/options/delete', zValidator('json', z.object({ optionIds: z.array(z.uuid()).min(1).max(5000) })), async c => {
    const user = c.get('user');
    const rows = await db
      .select({ id: libraryOptions.id })
      .from(libraryOptions)
      .innerJoin(libraryCategories, eq(libraryCategories.id, libraryOptions.categoryId))
      .where(and(inArray(libraryOptions.id, c.req.valid('json').optionIds), eq(libraryCategories.userId, user.id)));
    const ids = rows.map(r => r.id);
    await cancelOptionsThumbnails(ids);
    if (ids.length) await db.delete(libraryOptions).where(inArray(libraryOptions.id, ids));
    return c.json({ deleted: ids.length });
  })
  .patch('/options/:id', idParam, zValidator('json', optionUpdate), async c => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!(await ownedOption(c.get('user').id, id))) return c.json({ error: 'Option introuvable.' }, 404);
    try {
      const [row] = await db
        .update(libraryOptions)
        .set({ ...body, ...(body.label !== undefined ? { label: body.label || null } : {}) })
        .where(eq(libraryOptions.id, id))
        .returning();
      return c.json({ option: toOption(row) });
    } catch {
      return c.json({ error: 'Cette option existe déjà dans la catégorie.' }, 409);
    }
  })
  .delete('/options/:id', idParam, async c => {
    const { id } = c.req.valid('param');
    if (!(await ownedOption(c.get('user').id, id))) return c.json({ error: 'Option introuvable.' }, 404);
    await cancelOptionThumbnails(id);
    await db.delete(libraryOptions).where(eq(libraryOptions.id, id));
    return c.json({ ok: true });
  });

export default libraryRoutes;
