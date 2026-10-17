/**
 * Workflows : liste, création, graphe validé à l'enregistrement, renommage, corbeille.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowGraph } from '@sublime/shared';
import { db } from '../db/index.js';
import { workflows } from '../db/schema.js';
import { purge, TRASH_DAYS } from '../services/trash.service.js';
import { call, signup, type Agent } from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function create(me: Agent, name?: string): Promise<Workflow> {
  const res = await me.post('/workflows', name ? { name } : {});
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.workflow;
}

/** Texte relié au prompt d'une génération d'image. */
const graph = (): WorkflowGraph => ({
  nodes: [
    { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: 'une pomme' } },
    { id: 'img', type: 'image-gen', position: { x: 300, y: 0 }, data: { family: 'bytedance/seedream-5.0-flash' } },
  ],
  edges: [{ id: 'e1', source: 't', sourceHandle: 'text', target: 'img', targetHandle: 'prompt' }],
  viewport: { x: 10, y: 20, zoom: 0.8 },
});

describe('authentification', () => {
  it('toutes les routes exigent une session', async () => {
    const id = randomUUID();
    expect((await call('GET', '/workflows')).status).toBe(401);
    expect((await call('POST', '/workflows', {})).status).toBe(401);
    expect((await call('GET', `/workflows/${id}`)).status).toBe(401);
    expect((await call('PATCH', `/workflows/${id}`, { name: 'x' })).status).toBe(401);
    expect((await call('DELETE', `/workflows/${id}`)).status).toBe(401);
  });
});

describe('création et liste', () => {
  it('nouveau workflow : nom par défaut, graphe vide ; liste du plus récent au plus ancien', async () => {
    const me = await signup();
    expect((await me.get('/workflows')).body).toEqual({ workflows: [] });
    const a = await create(me);
    expect(a).toMatchObject({ name: 'Workflow sans titre', nodeCount: 0, graph: { nodes: [], edges: [] } });
    const b = await create(me, '  Photos plage  ');
    expect(b.name).toBe('Photos plage');
    await db.update(workflows).set({ updatedAt: new Date(Date.now() - 60_000) }).where(eq(workflows.id, b.id));
    const list = (await me.get('/workflows')).body.workflows;
    expect(list.map((w: Workflow) => w.id)).toEqual([a.id, b.id]);
    // La liste ne renvoie pas les graphes.
    expect(list[0]).not.toHaveProperty('graph');
  });

  it('nom vide ou trop long refusé', async () => {
    const me = await signup();
    expect((await me.post('/workflows', { name: '   ' })).status).toBe(400);
    expect((await me.post('/workflows', { name: 'x'.repeat(81) })).status).toBe(400);
  });
});

describe('accès', () => {
  it('le workflow d’un autre compte est introuvable, en lecture comme en écriture', async () => {
    const owner = await signup();
    const other = await signup();
    const w = await create(owner);
    expect((await other.get(`/workflows/${w.id}`)).status).toBe(404);
    expect((await other.patch(`/workflows/${w.id}`, { name: 'pris' })).status).toBe(404);
    expect((await other.del(`/workflows/${w.id}`)).status).toBe(404);
    expect((await other.get('/workflows')).body.workflows).toEqual([]);
    expect((await owner.get(`/workflows/${w.id}`)).body.workflow.name).toBe('Workflow sans titre');
  });

  it('id mal formé : 404', async () => {
    const me = await signup();
    expect((await me.get('/workflows/pas-un-uuid')).status).toBe(404);
  });
});

describe('PATCH /workflows/:id', () => {
  it('enregistre le graphe et le cadrage, renomme @smoke', async () => {
    const me = await signup();
    const w = await create(me);
    const res = await me.patch(`/workflows/${w.id}`, { graph: graph(), name: 'Mon flux' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.workflow).toMatchObject({ name: 'Mon flux', nodeCount: 2, graph: graph() });
    expect((await me.get(`/workflows/${w.id}`)).body.workflow.graph).toEqual(graph());
  });

  it('graphe invalide refusé, rien n’est enregistré', async () => {
    const me = await signup();
    const w = await create(me);
    await me.patch(`/workflows/${w.id}`, { graph: graph() });

    const wrongType = graph();
    wrongType.edges[0].targetHandle = 'references';
    const res = await me.patch(`/workflows/${w.id}`, { graph: wrongType });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/texte vers image/);

    const loop = graph();
    loop.nodes.push({ id: 'd', type: 'describe', position: { x: 0, y: 0 }, data: {} });
    loop.edges = [
      { id: 'a', source: 'img', sourceHandle: 'image', target: 'd', targetHandle: 'images' },
      { id: 'b', source: 'd', sourceHandle: 'text', target: 'img', targetHandle: 'prompt' },
    ];
    expect((await me.patch(`/workflows/${w.id}`, { graph: loop })).body.error).toMatch(/boucle/);

    const unknownType = { ...graph(), nodes: [{ id: 'x', type: 'inconnu', position: { x: 0, y: 0 }, data: {} }], edges: [] };
    expect((await me.patch(`/workflows/${w.id}`, { graph: unknownType })).status).toBe(400);

    expect((await me.get(`/workflows/${w.id}`)).body.workflow.graph).toEqual(graph());
  });

  it('graphe incomplet accepté (brouillon) ; graphe trop volumineux refusé', async () => {
    const me = await signup();
    const w = await create(me);
    const draft: WorkflowGraph = { nodes: [{ id: 'v', type: 'video-gen', position: { x: 0, y: 0 }, data: {} }], edges: [] };
    expect((await me.patch(`/workflows/${w.id}`, { graph: draft })).status).toBe(200);
    const huge = { nodes: [{ id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: 'x'.repeat(500_001) } }], edges: [] };
    const res = await me.patch(`/workflows/${w.id}`, { graph: huge });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Workflow trop volumineux.');
  });

  it('corps vide : rien ne change, pas même la date', async () => {
    const me = await signup();
    const w = await create(me);
    const res = await me.patch(`/workflows/${w.id}`, {});
    expect(res.status).toBe(200);
    expect(res.body.workflow.updatedAt).toBe(w.updatedAt);
  });
});

describe('couverture', () => {
  it('choisie, elle s’affiche ; retirée, la liste montre la dernière image produite ; jamais l’image d’un autre', async () => {
    const me = await signup();
    const other = await signup();
    const w = await create(me);
    expect(w).toMatchObject({ coverAssetId: null, coverUrl: null });

    const cover = await me.uploadAsset();
    const res = await me.patch(`/workflows/${w.id}`, { coverAssetId: cover.id, name: 'Avec couverture' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.workflow).toMatchObject({ coverAssetId: cover.id, coverUrl: `/api/media/${cover.id}`, name: 'Avec couverture' });
    expect((await me.get('/workflows')).body.workflows[0].coverUrl).toBe(`/api/media/${cover.id}`);

    const theirs = await other.uploadAsset();
    expect((await me.patch(`/workflows/${w.id}`, { coverAssetId: theirs.id })).status).toBe(400);

    // Sans couverture choisie : la dernière image produite par le workflow.
    await me.post(`/workflows/${w.id}/runs`, {
      graph: {
        nodes: [
          { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: 'une pomme' } },
          { id: 'g', type: 'image-gen', position: { x: 300, y: 0 }, data: { family: 'bytedance/seedream-5.0-flash', params: {} } },
        ],
        edges: [{ id: 'e', source: 't', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' }],
      },
    });
    let state;
    for (let i = 0; i < 100 && state?.run?.status !== 'succeeded'; i++) {
      await new Promise(r => setTimeout(r, 100));
      state = (await me.get(`/workflows/${w.id}/state`)).body;
    }
    const output = state.results[0].generation.outputs[0].id;
    const cleared = await me.patch(`/workflows/${w.id}`, { coverAssetId: null });
    expect(cleared.body.workflow).toMatchObject({ coverAssetId: null, coverUrl: `/api/media/${output}` });
  });
});

describe('anciens graphes', () => {
  it('un nœud Persona enregistré avant sa suppression est lu comme une Image source', async () => {
    const me = await signup();
    const w = await create(me);
    const legacy = {
      nodes: [
        { id: 'p', type: 'persona', position: { x: 0, y: 0 }, data: { personaId: 'x', referenceIds: ['r1'] } },
        { id: 'g', type: 'image-gen', position: { x: 300, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'a', source: 'p', sourceHandle: 'images', target: 'g', targetHandle: 'references' },
        { id: 'b', source: 'p', sourceHandle: 'persona', target: 'g', targetHandle: 'persona' },
      ],
    };
    await db.update(workflows).set({ graph: legacy as unknown as WorkflowGraph }).where(eq(workflows.id, w.id));
    const graph = (await me.get(`/workflows/${w.id}`)).body.workflow.graph as WorkflowGraph;
    expect(graph.nodes[0]).toMatchObject({ type: 'image-source', data: { assetIds: ['r1'] } });
    expect(graph.edges).toEqual([{ id: 'a', source: 'p', sourceHandle: 'image', target: 'g', targetHandle: 'references' }]);
    // Renvoyé tel quel, il s'enregistre.
    expect((await me.patch(`/workflows/${w.id}`, { graph })).status).toBe(200);
  });
});

describe('corbeille', () => {
  it('mise à la corbeille, listée, restaurée', async () => {
    const me = await signup();
    const w = await create(me, 'À jeter');
    await me.patch(`/workflows/${w.id}`, { graph: graph() });
    expect((await me.del(`/workflows/${w.id}`)).status).toBe(200);
    expect((await me.get('/workflows')).body.workflows).toEqual([]);
    expect((await me.get(`/workflows/${w.id}`)).status).toBe(404);
    expect((await me.del(`/workflows/${w.id}`)).status).toBe(404);

    const trash = (await me.get('/trash')).body;
    expect(trash.workflows).toEqual([
      expect.objectContaining({ id: w.id, name: 'À jeter', nodeCount: 2 }),
    ]);

    expect((await me.post(`/trash/workflows/${w.id}/restore`)).status).toBe(200);
    expect((await me.get(`/workflows/${w.id}`)).body.workflow.graph).toEqual(graph());
    expect((await me.post(`/trash/workflows/${w.id}/restore`)).status).toBe(404);
  });

  it('suppression définitive, une par une ou en vidant la corbeille ; jamais celle d’un autre', async () => {
    const me = await signup();
    const other = await signup();
    const a = await create(me);
    const b = await create(me);
    const theirs = await create(other);
    for (const w of [a, b]) await me.del(`/workflows/${w.id}`);
    await other.del(`/workflows/${theirs.id}`);

    expect((await other.del(`/trash/workflows/${a.id}`)).body.workflows).toBe(0);
    expect((await me.del(`/trash/workflows/${a.id}`)).body).toMatchObject({ workflows: 1 });
    expect((await me.del('/trash')).body).toMatchObject({ workflows: 1 });
    expect((await me.get('/trash')).body.workflows).toEqual([]);
    expect((await other.get('/trash')).body.workflows.map((w: Workflow) => w.id)).toEqual([theirs.id]);
  });

  it('nettoyage automatique après 7 jours', async () => {
    const me = await signup();
    const old = await create(me);
    const recent = await create(me);
    await me.del(`/workflows/${old.id}`);
    await me.del(`/workflows/${recent.id}`);
    await db
      .update(workflows)
      .set({ deletedAt: new Date(Date.now() - (TRASH_DAYS + 1) * DAY_MS) })
      .where(eq(workflows.id, old.id));
    expect((await purge({ expired: true })).workflows).toBe(1);
    expect((await me.get('/trash')).body.workflows.map((w: Workflow) => w.id)).toEqual([recent.id]);
  });
});
