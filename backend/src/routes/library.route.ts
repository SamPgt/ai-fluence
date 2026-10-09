import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getZone, type LibraryCategory, type LibraryImportResult, type LibraryOption } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { libraryCategories, libraryOptions } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { slug } from '../services/settings.service.js';
import {
  cancelCategoryThumbnails,
  cancelCategoryThumbnailsUnchecked,
  cancelOptionThumbnails,
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
});
const categoryCreate = categoryFields.partial().required({ label: true }).transform(b => ({
  ...b,
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
    // Déplacée vers une zone sans genre (Lieu & décor, Photo) : la catégorie cesse d'être genrée.
    if (getZone(body.zone ?? current.zone).gender === 'none') body.gendered = false;
    const key = body.key !== undefined ? await uniqueKey(user.id, body.key || body.label || 'categorie', id) : undefined;
    const [row] = await db
      .update(libraryCategories)
      .set({ ...body, ...(key ? { key } : {}), updatedAt: new Date() })
      .where(eq(libraryCategories.id, id))
      .returning();
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
