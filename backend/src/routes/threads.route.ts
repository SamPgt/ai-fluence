import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SearchResult, ThreadDetailResponse } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { generations, threads } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { deleteThread, loadGenerations } from '../services/generation.service.js';
import { toThread } from '../services/serialize.js';
import type { AppEnv } from '../types.js';

// Sous-requêtes avec noms qualifiés : Drizzle ne préfixe pas les colonnes dans `sql```.
const aggregates = {
  totalCost: sql<string>`(select coalesce(sum(g.cost::numeric) filter (where g.status = 'succeeded'), 0)::text from generations g where g.thread_id = "threads"."id")`,
  generationCount: sql<number>`(select count(*)::int from generations g where g.thread_id = "threads"."id")`,
  coverAssetId: sql<string | null>`(select a.id from assets a inner join generations g on g.id = a.generation_id where g.thread_id = "threads"."id" and a.media_type = 'image' order by a.created_at desc limit 1)`,
};

const threadsRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/', zValidator('query', z.object({ personaId: z.string().optional() })), async c => {
    const { personaId } = c.req.valid('query');
    const where = [eq(threads.userId, c.get('user').id)];
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
    const rows = await db
      .selectDistinctOn([threads.id], {
        threadId: threads.id,
        threadTitle: threads.title,
        matchedPrompt: generations.prompt,
        updatedAt: threads.updatedAt,
      })
      .from(threads)
      .leftJoin(generations, and(eq(generations.threadId, threads.id), ilike(generations.prompt, pattern)))
      .where(
        and(eq(threads.userId, c.get('user').id), or(ilike(threads.title, pattern), ilike(generations.prompt, pattern))),
      )
      .orderBy(threads.id)
      .limit(30);
    const results: SearchResult[] = rows
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(r => ({ threadId: r.threadId, threadTitle: r.threadTitle, matchedPrompt: r.matchedPrompt }));
    return c.json({ results });
  })
  .get('/:id', async c => {
    const user = c.get('user');
    const [row] = await db
      .select({ t: threads, ...aggregates })
      .from(threads)
      .where(and(eq(threads.id, c.req.param('id')), eq(threads.userId, user.id)))
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
      const [row] = await db
        .update(threads)
        .set(c.req.valid('json'))
        .where(and(eq(threads.id, c.req.param('id')), eq(threads.userId, c.get('user').id)))
        .returning();
      if (!row) return c.json({ error: 'Fil introuvable.' }, 404);
      return c.json({ thread: toThread(row) });
    },
  )
  .delete('/:id', async c => {
    // Retire le fil, ses demandes et leurs résultats (galerie comprise) ; les fichiers restent dans le dossier local.
    await deleteThread(c.get('user'), c.req.param('id'));
    return c.json({ ok: true });
  });

export default threadsRoutes;
