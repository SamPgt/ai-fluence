import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  WORKFLOW_LIMITS,
  WORKFLOW_NODE_TYPES,
  graphErrors,
  normalizeGraph,
  type Workflow,
  type WorkflowGraph,
  type WorkflowSummary,
} from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, workflows } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { trashWorkflow } from '../services/trash.service.js';
import { getState, quoteRun, startRun, stopRun } from '../services/workflow-runner.service.js';
import type { AppEnv } from '../types.js';

type WorkflowRow = typeof workflows.$inferSelect;

/** Taille maximale d'un graphe enregistré (JSON), réglages des nœuds compris. */
const MAX_GRAPH_CHARS = 500_000;

const id = z.string().min(1).max(64);
const coord = z.number().finite();

const graphSchema = z.object({
  nodes: z
    .array(
      z.object({
        id,
        type: z.enum(WORKFLOW_NODE_TYPES as [string, ...string[]]),
        position: z.object({ x: coord, y: coord }),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .max(WORKFLOW_LIMITS.nodes),
  edges: z
    .array(z.object({ id, source: id, sourceHandle: id, target: id, targetHandle: id }))
    .max(WORKFLOW_LIMITS.edges),
  viewport: z.object({ x: coord, y: coord, zoom: z.number().positive().max(10) }).optional(),
});

const name = z.string().trim().min(1).max(WORKFLOW_LIMITS.nameLength);

/** Dernière image produite par le workflow : sa couverture quand aucune n'est choisie. */
const latestImage = sql<string | null>`(select a.id from assets a inner join generations g on g.id = a.generation_id where g.workflow_id = "workflows"."id" and g.removed_at is null and a.media_type = 'image' order by a.created_at desc limit 1)`;

type WithCover = { w: WorkflowRow; latest: string | null };

const toSummary = ({ w, latest }: WithCover): WorkflowSummary => {
  const cover = w.coverAssetId ?? latest;
  return {
    id: w.id,
    name: w.name,
    nodeCount: w.graph.nodes.length,
    coverAssetId: w.coverAssetId,
    coverUrl: cover ? `/api/media/${cover}` : null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
};

// Anciens graphes (nœud Persona) convertis à la lecture : ils s'enregistrent ensuite à jour.
const toWorkflow = (row: WithCover): Workflow => ({ ...toSummary(row), graph: normalizeGraph(row.w.graph) });

async function findOwned(userId: string, workflowId: string): Promise<WithCover | undefined> {
  const [row] = await db
    .select({ w: workflows, latest: latestImage })
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId), isNull(workflows.deletedAt)))
    .limit(1);
  return row;
}

const workflowsRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/', async c => {
    const rows = await db
      .select({ w: workflows, latest: latestImage })
      .from(workflows)
      .where(and(eq(workflows.userId, c.get('user').id), isNull(workflows.deletedAt)))
      .orderBy(desc(workflows.updatedAt))
      .limit(200);
    return c.json({ workflows: rows.map(toSummary) });
  })
  .post('/', zValidator('json', z.object({ name: name.optional() })), async c => {
    const [row] = await db
      .insert(workflows)
      .values({ userId: c.get('user').id, name: c.req.valid('json').name ?? 'Workflow sans titre' })
      .returning();
    return c.json({ workflow: toWorkflow({ w: row, latest: null }) }, 201);
  })
  .get('/:id', async c => {
    const row = await findOwned(c.get('user').id, c.req.param('id'));
    if (!row) return c.json({ error: 'Workflow introuvable.' }, 404);
    return c.json({ workflow: toWorkflow(row) });
  })
  .patch(
    '/:id',
    zValidator('json', z.object({ name: name.optional(), graph: graphSchema.optional(), coverAssetId: z.uuid().nullable().optional() })),
    async c => {
    const body = c.req.valid('json');
    const found = await findOwned(c.get('user').id, c.req.param('id'));
    if (!found) return c.json({ error: 'Workflow introuvable.' }, 404);
    const row = found.w;
    if (body.coverAssetId) {
      // Couverture : une image du compte.
      const [asset] = await db
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.id, body.coverAssetId), eq(assets.userId, c.get('user').id), eq(assets.mediaType, 'image')))
        .limit(1);
      if (!asset) return c.json({ error: 'Image de couverture introuvable.' }, 400);
    }
    if (body.graph) {
      if (JSON.stringify(body.graph).length > MAX_GRAPH_CHARS) return c.json({ error: 'Workflow trop volumineux.' }, 400);
      const errors = graphErrors(body.graph as WorkflowGraph);
      if (errors.length) return c.json({ error: errors[0], errors }, 400);
    }
    if (body.name === undefined && body.graph === undefined && body.coverAssetId === undefined) {
      return c.json({ workflow: toWorkflow(found) });
    }
    await db
      .update(workflows)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.graph !== undefined ? { graph: body.graph as WorkflowGraph } : {}),
        ...(body.coverAssetId !== undefined ? { coverAssetId: body.coverAssetId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, row.id));
    return c.json({ workflow: toWorkflow((await findOwned(c.get('user').id, row.id))!) });
    },
  )
  /** Devis d'une exécution (tous les nœuds payants, ou ceux donnés). */
  .post(
    '/:id/quote',
    zValidator('json', z.object({ graph: graphSchema, nodeIds: z.array(id).max(WORKFLOW_LIMITS.nodes).optional() })),
    async c => {
      const body = c.req.valid('json');
      return c.json(await quoteRun(c.get('user'), c.req.param('id'), body.graph as WorkflowGraph, body.nodeIds));
    },
  )
  /** Lancement : le graphe affiché est enregistré, puis exécuté en arrière-plan. */
  .post(
    '/:id/runs',
    zValidator(
      'json',
      z.object({
        graph: graphSchema,
        nodeIds: z.array(id).max(WORKFLOW_LIMITS.nodes).optional(),
        expectedCost: z.string().regex(/^\d+(\.\d+)?$/).optional(),
      }),
    ),
    async c => {
      const body = c.req.valid('json');
      if (JSON.stringify(body.graph).length > MAX_GRAPH_CHARS) return c.json({ error: 'Workflow trop volumineux.' }, 400);
      const state = await startRun(c.get('user'), c.req.param('id'), { ...body, graph: body.graph as WorkflowGraph });
      return c.json(state, 201);
    },
  )
  /** Arrêter l'exécution en cours : les étapes en attente ne partent pas. */
  .post('/:id/stop', async c => c.json(await stopRun(c.get('user').id, c.req.param('id'))))
  /** Dernière exécution et résultats des nœuds. */
  .get('/:id/state', async c => c.json(await getState(c.get('user').id, c.req.param('id'))))
  /** Mise à la corbeille (7 jours). */
  .delete('/:id', async c => {
    if (!(await trashWorkflow(c.get('user').id, c.req.param('id')))) return c.json({ error: 'Workflow introuvable.' }, 404);
    return c.json({ ok: true });
  });

export default workflowsRoutes;
