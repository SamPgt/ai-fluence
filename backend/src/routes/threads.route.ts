import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SearchResult, ThreadDetailResponse } from '@sublime/shared';
import { db } from '../db/index.js';
import { threads } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { loadGenerations } from '../services/generation.service.js';
import { toThread } from '../services/serialize.js';
import { trashThread } from '../services/trash.service.js';
import { loadThreadRuns } from '../services/workflow-runner.service.js';
import type { AppEnv } from '../types.js';

// Sous-requêtes avec noms qualifiés : Drizzle ne préfixe pas les colonnes dans `sql```.
const aggregates = {
  // Générations du fil, plus les workflows lancés depuis ce fil.
  totalCost: sql<string>`((select coalesce(sum(g.cost::numeric) filter (where g.status = 'succeeded'), 0) from generations g where g.thread_id = "threads"."id") + (select coalesce(sum(r.cost::numeric), 0) from workflow_node_results r inner join workflow_runs wr on wr.id = r.run_id where wr.thread_id = "threads"."id"))::text`,
  generationCount: sql<number>`(select count(*)::int from generations g where g.thread_id = "threads"."id")`,
  // Personas dont une référence a servi dans le fil (générations, entrées des workflows lancés depuis le fil).
  personaIds: sql<string[]>`(select coalesce(json_agg(p.id order by p.position), '[]'::json) from personas p where p.deleted_at is null and exists (select 1 from assets a where a.persona_id = p.id and (exists (select 1 from generations g where g.thread_id = "threads"."id" and g.reference_asset_ids ? a.id::text) or exists (select 1 from workflow_runs wr, jsonb_array_elements(wr.inputs) i where wr.thread_id = "threads"."id" and coalesce(i->'assetIds', '[]'::jsonb) ? a.id::text))))`,
  previewAssetIds: sql<string[]>`(select coalesce(json_agg(x.id), '[]'::json) from (select a.id from assets a inner join generations g on g.id = a.generation_id where g.thread_id = "threads"."id" and g.removed_at is null and a.media_type = 'image' order by a.created_at desc limit 3) x)`,
  coverAssetId: sql<string | null>`(select a.id from assets a inner join generations g on g.id = a.generation_id where g.thread_id = "threads"."id" and g.removed_at is null and a.media_type = 'image' order by a.created_at desc limit 1)`,
};

const threadsRoutes = new Hono<AppEnv>()
  .use(auth)
  // Tous les fils : un fil n'appartient plus à un persona.
  .get('/', async c => {
    const where = [eq(threads.userId, c.get('user').id), isNull(threads.deletedAt)];
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
    const matched = (col: 'prompt' | 'id') =>
      sql.raw(`(select g.${col} from generations g where g.thread_id = "threads"."id" and g.prompt ilike `)
    const matchedPrompt = sql<string | null>`${matched('prompt')}${pattern} order by g.created_at desc limit 1)`;
    const matchedGenerationId = sql<string | null>`${matched('id')}${pattern} order by g.created_at desc limit 1)`;
    const rows = await db
      .select({ threadId: threads.id, threadTitle: threads.title, matchedPrompt, matchedGenerationId })
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
    const [gens, workflowRuns] = await Promise.all([
      loadGenerations(user.id, { threadId: row.t.id }),
      loadThreadRuns(user.id, row.t.id),
    ]);
    return c.json({ thread: toThread(row.t, row), generations: gens, workflowRuns } satisfies ThreadDetailResponse);
  })
  .patch(
    '/:id',
    zValidator(
      'json',
      z.object({
        title: z.string().trim().min(1).max(120).optional(),
        isPinned: z.boolean().optional(),
      }),
    ),
    async c => {
      const user = c.get('user');
      const patch = c.req.valid('json');
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
