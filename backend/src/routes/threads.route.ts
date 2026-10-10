import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SearchResult, ThreadDetailResponse } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { personas, threads } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { loadGenerations } from '../services/generation.service.js';
import { toThread } from '../services/serialize.js';
import { trashThread } from '../services/trash.service.js';
import type { AppEnv } from '../types.js';

// Sous-requêtes avec noms qualifiés : Drizzle ne préfixe pas les colonnes dans `sql```.
const aggregates = {
  totalCost: sql<string>`(select coalesce(sum(g.cost::numeric) filter (where g.status = 'succeeded'), 0)::text from generations g where g.thread_id = "threads"."id")`,
  generationCount: sql<number>`(select count(*)::int from generations g where g.thread_id = "threads"."id")`,
  coverAssetId: sql<string | null>`(select a.id from assets a inner join generations g on g.id = a.generation_id where g.thread_id = "threads"."id" and a.media_type = 'image' order by a.created_at desc limit 1)`,
};

const threadsRoutes = new Hono<AppEnv>()
  .use(auth)
  // `none` = fils sans persona ; sinon un id de persona (un id mal formé ferait planter Postgres).
  .get('/', zValidator('query', z.object({ personaId: z.union([z.literal('none'), z.uuid()]).optional() })), async c => {
    const { personaId } = c.req.valid('query');
    const where = [eq(threads.userId, c.get('user').id), isNull(threads.deletedAt)];
    if (personaId === 'none') where.push(sql`${threads.personaId} is null`);
    else if (personaId) where.push(eq(threads.personaId, personaId));
    const rows = await db
      .select({ t: threads, ...aggregates })
      .from(threads)
      .where(and(...where))
      .orderBy(desc(threads.isPinned), desc(threads.updatedAt))
      .limit(200);
    return c.json({ threads: rows.map(r => toThread(r.t, r)) });
  })
  .get('/search', zValidator('query', z.object({ q: z.string().trim().min(1).max(200) })), async c => {
    const pattern = `%${c.req.valid('query').q.replace(/[%_]/g, m => `\\${m}`)}%`;
    // Les 30 fils les plus récents qui correspondent (titre ou un de leurs prompts),
    // avec le dernier prompt qui correspond.
    const matchedPrompt = sql<string | null>`(select g.prompt from generations g where g.thread_id = "threads"."id" and g.prompt ilike ${pattern} order by g.created_at desc limit 1)`;
    const rows = await db
      .select({ threadId: threads.id, threadTitle: threads.title, matchedPrompt })
      .from(threads)
      .where(
        and(
          eq(threads.userId, c.get('user').id),
          isNull(threads.deletedAt),
          or(
            ilike(threads.title, pattern),
            sql`exists (select 1 from generations g where g.thread_id = "threads"."id" and g.prompt ilike ${pattern})`,
          ),
        ),
      )
      .orderBy(desc(threads.updatedAt))
      .limit(30);
    const results: SearchResult[] = rows;
    return c.json({ results });
  })
  .get('/:id', async c => {
    const user = c.get('user');
    const [row] = await db
      .select({ t: threads, ...aggregates })
      .from(threads)
      .where(and(eq(threads.id, c.req.param('id')), eq(threads.userId, user.id), isNull(threads.deletedAt)))
      .limit(1);
    if (!row) return c.json({ error: 'Fil introuvable.' }, 404);
    const gens = await loadGenerations(user.id, { threadId: row.t.id });
    return c.json({ thread: toThread(row.t, row), generations: gens } satisfies ThreadDetailResponse);
  })
  .patch(
    '/:id',
    zValidator(
      'json',
      z.object({
        title: z.string().trim().min(1).max(120).optional(),
        isPinned: z.boolean().optional(),
        personaId: z.uuid().nullable().optional(),
      }),
    ),
    async c => {
      const user = c.get('user');
      const patch = c.req.valid('json');
      // Le persona doit être à cet utilisateur (et pas à la corbeille).
      if (patch.personaId) {
        const [p] = await db
          .select({ id: personas.id })
          .from(personas)
          .where(and(eq(personas.id, patch.personaId), eq(personas.userId, user.id), isNull(personas.deletedAt)))
          .limit(1);
        if (!p) return c.json({ error: 'Persona introuvable.' }, 404);
      }
      const owned = and(eq(threads.id, c.req.param('id')), eq(threads.userId, user.id), isNull(threads.deletedAt));
      // Rien à modifier : le fil tel quel (Drizzle refuse une mise à jour vide).
      const [row] = Object.values(patch).some(v => v !== undefined)
        ? await db.update(threads).set(patch).where(owned).returning()
        : await db.select().from(threads).where(owned).limit(1);
      if (!row) return c.json({ error: 'Fil introuvable.' }, 404);
      return c.json({ thread: toThread(row) });
    },
  )
  .delete('/:id', async c => {
    // Corbeille : le fil est masqué 7 jours avant suppression définitive.
    if (!(await trashThread(c.get('user').id, c.req.param('id')))) return c.json({ error: 'Fil introuvable.' }, 404);
    return c.json({ ok: true });
  });

export default threadsRoutes;
