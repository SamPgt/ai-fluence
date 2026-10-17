/**
 * Listes dans les workflows (faux SpicyAPI) : une passe par élément, rangées dans un même
 * résultat (le lot), devis multiplié, listes en chaîne, échec partiel, lot actif.
 */
import { describe, expect, it } from 'vitest';
import type { WorkflowGraph, WorkflowNodeResult, WorkflowStateResponse } from '@sublime/shared';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflows } from '../db/schema.js';
import { settle, signup, type Agent } from './helpers.js';

const SEEDREAM = 'bytedance/seedream-5.0-flash';
const SEEDANCE = 'bytedance/seedance-2.0-mini';

/** Liste → image → vidéo (une vidéo par image), avec un texte pour la vidéo. */
const listChain = (items = 'robe rouge\njean bleu\nshort blanc'): WorkflowGraph => ({
  nodes: [
    { id: 'l', type: 'list', position: { x: 0, y: 0 }, data: { items } },
    { id: 't', type: 'text', position: { x: 0, y: 200 }, data: { text: 'elle marche' } },
    { id: 'img', type: 'image-gen', position: { x: 300, y: 0 }, data: { family: SEEDREAM, params: {} } },
    { id: 'vid', type: 'video-gen', position: { x: 600, y: 0 }, data: { family: SEEDANCE, params: {} } },
  ],
  edges: [
    { id: 'e1', source: 'l', sourceHandle: 'items', target: 'img', targetHandle: 'lists' },
    { id: 'e2', source: 't', sourceHandle: 'text', target: 'vid', targetHandle: 'prompt' },
    { id: 'e3', source: 'img', sourceHandle: 'image', target: 'vid', targetHandle: 'start' },
  ],
});

async function createWorkflow(me: Agent) {
  return (await me.post('/workflows', { name: 'Listes' })).body.workflow as { id: string };
}

async function waitRun(me: Agent, id: string): Promise<WorkflowStateResponse> {
  for (let i = 0; i < 150; i++) {
    const state = (await me.get(`/workflows/${id}/state`)).body as WorkflowStateResponse;
    if (state.run && state.run.status !== 'running') {
      await settle();
      return state;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Exécution toujours en cours');
}

const latest = (state: WorkflowStateResponse, nodeId: string) => state.results.find(r => r.nodeId === nodeId)!;
const outputsOf = (r: WorkflowNodeResult) => r.items!.map(i => i.generation?.outputs.map(a => a.id) ?? []);

describe('listes', () => {
  it('une génération par élément, en chaîne : 3 images puis 3 vidéos, devis × 3 @smoke', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    const single = await me.post(`/workflows/${w.id}/quote`, { graph: listChain('robe rouge') });
    const quote = await me.post(`/workflows/${w.id}/quote`, { graph: listChain() });
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    expect(quote.body.nodes.map((n: { nodeId: string; count: number }) => [n.nodeId, n.count])).toEqual([
      ['img', 3],
      ['vid', 3],
    ]);
    expect(Number(quote.body.estimatedCost)).toBeCloseTo(Number(single.body.estimatedCost) * 3, 5);

    await me.post(`/workflows/${w.id}/runs`, { graph: listChain(), expectedCost: quote.body.estimatedCost });
    const state = await waitRun(me, w.id);
    expect(state.run!.status).toBe('succeeded');
    // Un seul résultat par nœud : le lot, un élément par passe, dans l'ordre de la liste.
    expect(state.results.filter(r => r.nodeId === 'img')).toHaveLength(1);
    const img = latest(state, 'img');
    expect(img.items!.map(i => [i.label, i.status, i.generation?.prompt])).toEqual([
      ['robe rouge', 'succeeded', 'robe rouge'],
      ['jean bleu', 'succeeded', 'jean bleu'],
      ['short blanc', 'succeeded', 'short blanc'],
    ]);
    // Chaque vidéo part de l'image de son élément, et garde son libellé.
    const vid = latest(state, 'vid');
    expect(vid.items!.map(i => i.label)).toEqual(['robe rouge', 'jean bleu', 'short blanc']);
    expect(vid.items!.map(i => i.generation!.references.map(a => a.id))).toEqual(outputsOf(img));
    expect(Number(vid.cost)).toBeGreaterThan(0);
  });

  it('échec partiel : le lot garde les éléments réussis, la suite ne reçoit qu’eux', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    await me.post(`/workflows/${w.id}/runs`, { graph: listChain('robe rouge\nraté FAIL_TEST') });
    const state = await waitRun(me, w.id);
    const img = latest(state, 'img');
    expect(img).toMatchObject({ status: 'succeeded', errorMessage: expect.stringMatching(/^1 sur 2 en échec/) });
    expect(img.items!.map(i => i.status)).toEqual(['succeeded', 'failed']);
    expect(latest(state, 'vid').items!.map(i => i.label)).toEqual(['robe rouge']);
  });

  it('lots successifs : le lot actif choisi dans le nœud est celui qui part dans la suite', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    await me.post(`/workflows/${w.id}/runs`, { graph: listChain('a\nb'), nodeIds: ['img'] });
    const first = latest(await waitRun(me, w.id), 'img');
    await me.post(`/workflows/${w.id}/runs`, { graph: listChain('c\nd\ne'), nodeIds: ['img'] });
    expect(latest(await waitRun(me, w.id), 'img').items).toHaveLength(3);

    const graph = listChain('c\nd\ne');
    graph.nodes[2].data.activeResultId = first.id;
    const quote = await me.post(`/workflows/${w.id}/quote`, { graph, nodeIds: ['vid'] });
    expect(quote.body.nodes[0].count).toBe(2);
    await me.post(`/workflows/${w.id}/runs`, { graph, nodeIds: ['vid'] });
    const vid = latest(await waitRun(me, w.id), 'vid');
    expect(vid.items!.map(i => i.label)).toEqual(['a', 'b']);
    expect(vid.items!.map(i => i.generation!.references.map(a => a.id))).toEqual(outputsOf(first));
  });

  it('liste écrite par un Texte IA : sa réponse découpée, au plus son maximum (devis compris)', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: 'des tenues d’été' } },
        { id: 'llm', type: 'llm', position: { x: 0, y: 0 }, data: { instruction: 'donne 10 tenues, une par ligne' } },
        { id: 'l', type: 'list', position: { x: 0, y: 0 }, data: { max: 2 } },
        { id: 'img', type: 'image-gen', position: { x: 0, y: 0 }, data: { family: SEEDREAM, params: {} } },
      ],
      edges: [
        { id: 'a', source: 't', sourceHandle: 'text', target: 'llm', targetHandle: 'text' },
        { id: 'b', source: 'llm', sourceHandle: 'text', target: 'l', targetHandle: 'text' },
        { id: 'c', source: 'l', sourceHandle: 'items', target: 'img', targetHandle: 'lists' },
      ],
    };
    const quote = await me.post(`/workflows/${w.id}/quote`, { graph });
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    expect(quote.body.nodes.map((n: { nodeId: string; count: number }) => [n.nodeId, n.count])).toEqual([
      ['llm', 1],
      ['img', 2],
    ]);
    await me.post(`/workflows/${w.id}/runs`, { graph, expectedCost: quote.body.estimatedCost });
    const state = await waitRun(me, w.id);
    expect(state.run!.status).toBe('succeeded');
    // Réponse simulée sur plusieurs lignes : ses deux premières deviennent les éléments.
    const lines = latest(state, 'llm').text!.split('\n').filter(l => l.trim());
    expect(latest(state, 'img').items!.map(i => i.generation!.prompt)).toEqual(lines.slice(0, 2).map(l => l.trim()));
  });

  it('deux listes et un prompt qui les cite : elles avancent ensemble, la plus courte reprend au début', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'fonds', type: 'list', position: { x: 0, y: 0 }, data: { items: [{ text: 'café', active: true }, { text: 'plage', active: true }, { text: 'forêt', active: true }] } },
        { id: 'objets', type: 'list', position: { x: 0, y: 0 }, data: { items: 'chapeau\nparapluie' } },
        { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: 'Elle devant @liste1 avec @liste2' } },
        { id: 'img', type: 'image-gen', position: { x: 0, y: 0 }, data: { family: SEEDREAM, params: {} } },
      ],
      edges: [
        { id: 'a', source: 'fonds', sourceHandle: 'items', target: 'img', targetHandle: 'lists' },
        { id: 'b', source: 'objets', sourceHandle: 'items', target: 'img', targetHandle: 'lists' },
        { id: 'c', source: 't', sourceHandle: 'text', target: 'img', targetHandle: 'prompt' },
      ],
    };
    const quote = await me.post(`/workflows/${w.id}/quote`, { graph });
    expect(quote.body.nodes[0].count).toBe(3);
    await me.post(`/workflows/${w.id}/runs`, { graph, expectedCost: quote.body.estimatedCost });
    const img = latest(await waitRun(me, w.id), 'img');
    expect(img.items!.map(i => [i.label, i.generation!.prompt])).toEqual([
      ['café · chapeau', 'Elle devant café avec chapeau'],
      ['plage · parapluie', 'Elle devant plage avec parapluie'],
      ['forêt · chapeau', 'Elle devant forêt avec chapeau'],
    ]);
  });

  it('refus : une liste vide, trop d’éléments actifs ; ancien graphe (liste sur le prompt) converti', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    const old = listChain();
    old.edges[0] = { ...old.edges[0], targetHandle: 'prompt' };
    await db.update(workflows).set({ graph: old }).where(eq(workflows.id, w.id));
    const loaded = (await me.get(`/workflows/${w.id}`)).body.workflow.graph as WorkflowGraph;
    expect(loaded.edges.find(e => e.id === 'e1')!.targetHandle).toBe('lists');

    const empty = await me.post(`/workflows/${w.id}/quote`, { graph: listChain('  \n') });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/la liste est vide/);

    // Liste longue : seuls les actifs comptent, 50 au plus.
    const entries = Array.from({ length: 60 }, (_, i) => ({ text: `décor ${i}`, active: i < 3 }));
    const long = listChain();
    long.nodes[0].data = { items: entries };
    const ok = await me.post(`/workflows/${w.id}/quote`, { graph: long });
    expect(ok.body.nodes[0].count).toBe(3);
    long.nodes[0].data = { items: entries.map(e => ({ ...e, active: true })) };
    const tooMany = await me.post(`/workflows/${w.id}/quote`, { graph: long });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toMatch(/60 éléments actifs, 50 au plus/);
  });
});
