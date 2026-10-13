/**
 * Exécution des workflows (faux SpicyAPI) : devis, lancement, ordre des étapes,
 * échec qui bloque la suite, lancement d'un seul nœud, plafond de coût.
 */
import { describe, expect, it } from 'vitest';
import type { WorkflowGraph, WorkflowStateResponse } from '@ai-fluence/shared';
import { settle, signup, type Agent } from './helpers.js';

const SEEDREAM = 'bytedance/seedream-5.0-flash';
const SEEDANCE = 'bytedance/seedance-2.0-mini';

/** Texte → image → vidéo (image de début). */
const chain = (prompt = 'une pomme rouge'): WorkflowGraph => ({
  nodes: [
    { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: prompt } },
    { id: 'img', type: 'image-gen', position: { x: 300, y: 0 }, data: { family: SEEDREAM, params: {} } },
    { id: 'vid', type: 'video-gen', position: { x: 600, y: 0 }, data: { family: SEEDANCE, params: {} } },
  ],
  edges: [
    { id: 'e1', source: 't', sourceHandle: 'text', target: 'img', targetHandle: 'prompt' },
    { id: 'e2', source: 't', sourceHandle: 'text', target: 'vid', targetHandle: 'prompt' },
    { id: 'e3', source: 'img', sourceHandle: 'image', target: 'vid', targetHandle: 'start' },
  ],
});

async function createWorkflow(me: Agent) {
  return (await me.post('/workflows', { name: 'Exécution' })).body.workflow as { id: string };
}

/** Attend la fin de l'exécution en cours. */
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

describe('exécution', () => {
  it('devis puis lancement : image puis vidéo à partir de l’image, résultats sans fil @smoke', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    const quote = await me.post(`/workflows/${w.id}/quote`, { graph: chain() });
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    expect(quote.body.nodes.map((n: { nodeId: string; task: string }) => [n.nodeId, n.task])).toEqual([
      ['img', 'text-to-image'],
      ['vid', 'image-to-video'],
    ]);
    expect(Number(quote.body.estimatedCost)).toBeGreaterThan(0);

    const run = await me.post(`/workflows/${w.id}/runs`, { graph: chain(), expectedCost: quote.body.estimatedCost });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    expect(run.body.run.status).toBe('running');

    const state = await waitRun(me, w.id);
    expect(state.run!.status).toBe('succeeded');
    const img = latest(state, 'img');
    const vid = latest(state, 'vid');
    expect(img.status).toBe('succeeded');
    expect(vid.status).toBe('succeeded');
    expect(img.generation).toMatchObject({ threadId: null, workflowId: w.id, workflowNodeId: 'img', prompt: 'une pomme rouge' });
    // La vidéo part de l'image générée juste avant.
    expect(vid.generation!.references.map(a => a.id)).toEqual(img.generation!.outputs.map(a => a.id));
    // Aucun fil créé.
    expect((await me.get('/threads')).body.threads).toEqual([]);
    // Le graphe lancé est enregistré.
    expect((await me.get(`/workflows/${w.id}`)).body.workflow.graph.nodes).toHaveLength(3);
  });

  it('une étape en échec : celles qui en dépendent ne partent pas', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    await me.post(`/workflows/${w.id}/runs`, { graph: chain('raté FAIL_TEST') });
    const state = await waitRun(me, w.id);
    expect(state.run!.status).toBe('failed');
    expect(latest(state, 'img').status).toBe('failed');
    expect(latest(state, 'vid')).toMatchObject({ status: 'skipped', errorMessage: 'Une étape précédente a échoué.' });
  });

  it('un seul nœud : il reprend le résultat actif de l’étape précédente ; sans résultat, refus', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    const refused = await me.post(`/workflows/${w.id}/runs`, { graph: chain(), nodeIds: ['vid'] });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/Lance d’abord « Générer une image »/);

    await me.post(`/workflows/${w.id}/runs`, { graph: chain(), nodeIds: ['img'] });
    const first = await waitRun(me, w.id);
    const image = latest(first, 'img').generation!.outputs[0].id;
    expect(first.results.filter(r => r.nodeId === 'vid')).toEqual([]);

    await me.post(`/workflows/${w.id}/runs`, { graph: chain(), nodeIds: ['vid'] });
    const second = await waitRun(me, w.id);
    expect(second.run!.nodeIds).toEqual(['vid']);
    expect(latest(second, 'vid').generation!.references.map(a => a.id)).toEqual([image]);
  });

  it('résultat actif choisi dans le nœud : c’est lui qui sert d’entrée', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    await me.post(`/workflows/${w.id}/runs`, { graph: chain(), nodeIds: ['img'] });
    const a = latest(await waitRun(me, w.id), 'img');
    await me.post(`/workflows/${w.id}/runs`, { graph: chain(), nodeIds: ['img'] });
    expect(latest(await waitRun(me, w.id), 'img').id).not.toBe(a.id);

    const graph = chain();
    graph.nodes[1].data.activeResultId = a.id;
    await me.post(`/workflows/${w.id}/runs`, { graph, nodeIds: ['vid'] });
    const state = await waitRun(me, w.id);
    expect(latest(state, 'vid').generation!.references.map(x => x.id)).toEqual(a.generation!.outputs.map(x => x.id));
  });

  it('refus clairs : rien à lancer, modèle manquant, image à décrire manquante', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    const textOnly: WorkflowGraph = { nodes: [chain().nodes[0]], edges: [] };
    expect((await me.post(`/workflows/${w.id}/quote`, { graph: textOnly })).body.error).toMatch(/Aucune étape à lancer/);

    const noModel = chain();
    noModel.nodes[1].data = {};
    expect((await me.post(`/workflows/${w.id}/quote`, { graph: noModel })).body.error).toBe('« Générer une image » : Choisis un modèle.');

    const withDescribe: WorkflowGraph = {
      nodes: [...chain().nodes, { id: 'd', type: 'describe', position: { x: 0, y: 0 }, data: {} }],
      edges: [...chain().edges, { id: 'e4', source: 'img', sourceHandle: 'image', target: 'd', targetHandle: 'images' }],
    };
    const lonely: WorkflowGraph = { nodes: [{ id: 'd', type: 'describe', position: { x: 0, y: 0 }, data: {} }], edges: [] };
    expect((await me.post(`/workflows/${w.id}/quote`, { graph: lonely })).body.error).toBe(
      '« Décrire une image » : Relie au moins une image à décrire.',
    );
    // Avec son image (générée en amont), le devis passe.
    expect((await me.post(`/workflows/${w.id}/quote`, { graph: withDescribe })).status).toBe(200);
  });

  it('plafond : un devis confirmé trop bas arrête l’exécution avant de dépenser plus', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    await me.post(`/workflows/${w.id}/runs`, { graph: chain(), expectedCost: '0.0001' });
    const state = await waitRun(me, w.id);
    expect(state.run!.status).toBe('failed');
    expect(latest(state, 'img')).toMatchObject({ status: 'failed', errorMessage: expect.stringMatching(/dépasse le devis/) });
    expect(latest(state, 'img').generation).toBeNull();
  });

  it('accès : le workflow d’un autre compte est introuvable ; une seule exécution à la fois', async () => {
    const owner = await signup();
    const other = await signup();
    const w = await createWorkflow(owner);
    expect((await other.post(`/workflows/${w.id}/quote`, { graph: chain() })).status).toBe(404);
    expect((await other.post(`/workflows/${w.id}/runs`, { graph: chain() })).status).toBe(404);
    expect((await other.get(`/workflows/${w.id}/state`)).status).toBe(404);

    await owner.post(`/workflows/${w.id}/runs`, { graph: chain() });
    const again = await owner.post(`/workflows/${w.id}/runs`, { graph: chain() });
    expect(again.status).toBe(409);
    await waitRun(owner, w.id);
  });

  it('galerie : les résultats d’un workflow y apparaissent ; purgé, ses fichiers partent', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    await me.post(`/workflows/${w.id}/runs`, { graph: chain(), nodeIds: ['img'] });
    const state = await waitRun(me, w.id);
    const output = latest(state, 'img').generation!.outputs[0];
    const gallery = (await me.get('/assets/gallery')).body.items;
    expect(gallery.map((i: { asset: { id: string } }) => i.asset.id)).toContain(output.id);

    await me.del(`/workflows/${w.id}`);
    // À la corbeille : masqué de la galerie.
    expect((await me.get('/assets/gallery')).body.items).toEqual([]);
    const purged = await me.del(`/trash/workflows/${w.id}`);
    expect(purged.body).toMatchObject({ workflows: 1, files: 1 });
    expect((await me.get(`/media/${output.id}`)).status).toBe(404);
  });

  it('texte IA : décrire l’image générée, reformuler, puis générer à partir de ce texte @smoke', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    const graph: WorkflowGraph = {
      nodes: [
        ...chain().nodes.filter(n => n.id !== 'vid'),
        { id: 'd', type: 'describe', position: { x: 0, y: 0 }, data: {} },
        { id: 'l', type: 'llm', position: { x: 0, y: 0 }, data: { instruction: 'rends-le plus cinématographique' } },
        { id: 'img2', type: 'image-gen', position: { x: 0, y: 0 }, data: { family: SEEDREAM, params: {} } },
      ],
      edges: [
        chain().edges[0],
        { id: 'a', source: 'img', sourceHandle: 'image', target: 'd', targetHandle: 'images' },
        { id: 'b', source: 'd', sourceHandle: 'text', target: 'l', targetHandle: 'text' },
        { id: 'c', source: 'l', sourceHandle: 'text', target: 'img2', targetHandle: 'prompt' },
      ],
    };
    const quote = await me.post(`/workflows/${w.id}/quote`, { graph });
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    expect(quote.body.nodes.map((n: { nodeId: string; task: string }) => `${n.nodeId}:${n.task}`)).toEqual([
      'img:text-to-image',
      'd:text',
      'l:text',
      'img2:text-to-image',
    ]);
    await me.post(`/workflows/${w.id}/runs`, { graph, expectedCost: quote.body.estimatedCost });
    const state = await waitRun(me, w.id);
    expect(state.run!.status).toBe('succeeded');
    expect(latest(state, 'd')).toMatchObject({ status: 'succeeded', text: 'Description simulée de 1 image.' });
    const reformulated = latest(state, 'l').text!;
    expect(reformulated).toMatch(/^Texte reformulé : Consigne : rends-le plus cinématographique/);
    // Le texte produit sert de prompt à la génération suivante.
    expect(latest(state, 'img2').generation!.prompt).toBe(reformulated);
  });

  it('texte IA en échec : la génération qui en dépend ne part pas', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: 'FAIL_TEST' } },
        { id: 'l', type: 'llm', position: { x: 0, y: 0 }, data: { instruction: 'traduis' } },
        { id: 'img', type: 'image-gen', position: { x: 0, y: 0 }, data: { family: SEEDREAM, params: {} } },
      ],
      edges: [
        { id: 'a', source: 't', sourceHandle: 'text', target: 'l', targetHandle: 'text' },
        { id: 'b', source: 'l', sourceHandle: 'text', target: 'img', targetHandle: 'prompt' },
      ],
    };
    await me.post(`/workflows/${w.id}/runs`, { graph });
    const state = await waitRun(me, w.id);
    expect(latest(state, 'l')).toMatchObject({ status: 'failed', errorMessage: expect.stringMatching(/échoué/) });
    expect(latest(state, 'img').status).toBe('skipped');
  });

  it('Stop : l’étape en cours va au bout, celles en attente ne partent pas', async () => {
    const me = await signup();
    const w = await createWorkflow(me);
    await me.post(`/workflows/${w.id}/runs`, { graph: chain('lente SLOW_TEST') });
    const stopped = await me.post(`/workflows/${w.id}/stop`);
    expect(stopped.status, JSON.stringify(stopped.body)).toBe(200);
    expect(stopped.body.run.status).toBe('stopped');
    expect(latest(stopped.body, 'vid')).toMatchObject({ status: 'skipped', errorMessage: 'Exécution arrêtée.' });

    // L'image déjà lancée va au bout ; la vidéo n'est jamais partie.
    for (let i = 0; i < 100 && latest((await me.get(`/workflows/${w.id}/state`)).body, 'img').status !== 'succeeded'; i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    await settle();
    const state = (await me.get(`/workflows/${w.id}/state`)).body as WorkflowStateResponse;
    expect(state.run!.status).toBe('stopped');
    expect(latest(state, 'img').status).toBe('succeeded');
    expect(latest(state, 'vid').generation).toBeNull();
    // Plus rien à arrêter.
    expect((await me.post(`/workflows/${w.id}/stop`)).status).toBe(409);
  });
});
