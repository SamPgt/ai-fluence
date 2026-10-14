/**
 * Workflow utilisé depuis un fil : entrées « À fournir », valeurs saisies, exécution
 * rattachée au fil (créé au besoin), résultat final affiché dans le fil.
 */
import { describe, expect, it } from 'vitest';
import type { ThreadDetailResponse, WorkflowGraph } from '@ai-fluence/shared';
import { settle, signup, type Agent } from './helpers.js';

const SEEDREAM = 'bytedance/seedream-5.0-flash';

const graph = (overrides: { label?: string } = {}): WorkflowGraph => ({
  nodes: [
    { id: 't', type: 'text', position: { x: 0, y: 200 }, data: { text: 'défaut', exposed: true, label: overrides.label ?? 'Sujet' } },
    { id: 's', type: 'image-source', position: { x: 0, y: 0 }, data: { assetIds: [], exposed: true, label: 'Photo' } },
    { id: 'g', type: 'image-gen', position: { x: 400, y: 0 }, data: { family: SEEDREAM, params: {} } },
  ],
  edges: [
    { id: 'a', source: 't', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' },
    { id: 'b', source: 's', sourceHandle: 'image', target: 'g', targetHandle: 'references' },
  ],
});

async function setup(g = graph()) {
  const me = await signup();
  const w = (await me.post('/workflows', { name: 'Sticker' })).body.workflow as { id: string };
  expect((await me.patch(`/workflows/${w.id}`, { graph: g })).status).toBe(200);
  return { me, w };
}

async function waitThread(me: Agent, threadId: string): Promise<ThreadDetailResponse> {
  for (let i = 0; i < 150; i++) {
    const body = (await me.get(`/threads/${threadId}`)).body as ThreadDetailResponse;
    if (body.workflowRuns[0] && body.workflowRuns[0].status !== 'running') {
      await settle();
      return (await me.get(`/threads/${threadId}`)).body;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Exécution toujours en cours');
}

describe('workflow dans un fil', () => {
  it('lancé depuis un nouveau fil : valeurs saisies, résultat dans le fil, workflow inchangé @smoke', async () => {
    const { me, w } = await setup();
    expect((await me.get('/workflows')).body.workflows[0]).toMatchObject({ inputCount: 2, usableInThread: true });
    const image = await me.uploadAsset();
    const inputs = { t: { text: 'un chat roux' }, s: { assetIds: [image.id] } };

    // Devis du formulaire avant saisie (valeurs types) : le même prix qu'une fois rempli.
    const template = await me.post(`/workflows/${w.id}/quote`, { template: true });
    expect(template.status, JSON.stringify(template.body)).toBe(200);
    const quote = await me.post(`/workflows/${w.id}/quote`, { inputs });
    expect(quote.body.estimatedCost).toBe(template.body.estimatedCost);
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    expect(quote.body.nodes.map((n: { task: string }) => n.task)).toEqual(['image-to-image']);

    const res = await me.post(`/workflows/${w.id}/runs`, { inputs, thread: { id: null, personaId: null } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.threadId).toBeTruthy();

    const thread = await waitThread(me, res.body.threadId);
    expect(thread.thread.title).toBe('Sticker');
    const run = thread.workflowRuns[0];
    expect(run).toMatchObject({ workflowName: 'Sticker', status: 'succeeded' });
    expect(run.inputs).toEqual([
      { nodeId: 's', label: 'Photo', assetIds: [image.id], assets: [expect.objectContaining({ id: image.id })] },
      { nodeId: 't', label: 'Sujet', text: 'un chat roux', assets: [] },
    ]);
    expect(run.outputs).toHaveLength(1);
    expect(Number(thread.thread.totalCost)).toBeGreaterThan(0);

    // Le workflow enregistré garde ses valeurs par défaut.
    const saved = (await me.get(`/workflows/${w.id}`)).body.workflow.graph as WorkflowGraph;
    expect(saved.nodes.find(n => n.id === 't')!.data.text).toBe('défaut');
  });

  it('dans un fil existant : l’exécution s’y affiche, à la suite', async () => {
    const { me, w } = await setup();
    const { thread } = await me.generate({ prompt: 'avant' });
    const image = await me.uploadAsset();
    const res = await me.post(`/workflows/${w.id}/runs`, {
      inputs: { s: { assetIds: [image.id] } },
      thread: { id: thread.id, personaId: null },
    });
    expect(res.body.threadId).toBe(thread.id);
    const detail = await waitThread(me, thread.id);
    expect(detail.generations).toHaveLength(1);
    expect(detail.workflowRuns).toHaveLength(1);
  });

  it('résultat supprimé du fil : masqué (fil et Galerie), puis remis', async () => {
    const { me, w } = await setup();
    const image = await me.uploadAsset();
    const res = await me.post(`/workflows/${w.id}/runs`, { inputs: { s: { assetIds: [image.id] } }, thread: { id: null, personaId: null } });
    const run = (await waitThread(me, res.body.threadId)).workflowRuns[0];
    const outputId = run.outputs[0].id;
    const inGallery = async () => ((await me.get('/assets/gallery')).body.items as { asset: { id: string } }[]).some(i => i.asset.id === outputId);
    expect(await inGallery()).toBe(true);

    expect((await me.del(`/workflows/runs/${run.id}/result`)).status).toBe(200);
    const removed = (await me.get(`/threads/${res.body.threadId}`)).body.workflowRuns[0];
    expect(removed).toMatchObject({ removed: true, outputs: [] });
    expect(await inGallery()).toBe(false);

    expect((await me.post(`/workflows/runs/${run.id}/result/restore`, {})).status).toBe(200);
    expect((await me.get(`/threads/${res.body.threadId}`)).body.workflowRuns[0]).toMatchObject({ removed: false, outputs: [{ id: outputId }] });

    // Une exécution d'un autre compte : introuvable.
    const other = await signup();
    expect((await other.del(`/workflows/runs/${run.id}/result`)).status).toBe(404);
  });

  it('refus clairs : libellé manquant, entrée inconnue ou vide, image ou fil d’un autre compte, graphe manquant', async () => {
    const noLabel = await setup(graph({ label: '' }));
    expect((await noLabel.me.post(`/workflows/${noLabel.w.id}/quote`, { inputs: {} })).body.error).toMatch(/libellé/);

    const { me, w } = await setup();
    const other = await signup();
    const image = await me.uploadAsset();
    const theirs = await other.uploadAsset();
    const send = (body: Record<string, unknown>) => me.post(`/workflows/${w.id}/runs`, { thread: { id: null, personaId: null }, ...body });
    expect((await send({ inputs: { g: { text: 'x' }, s: { assetIds: [image.id] } } })).body.error).toMatch(/n’existe pas/);
    expect((await send({ inputs: { s: { assetIds: [] } } })).body.error).toBe('« Photo » est vide.');
    expect((await send({ inputs: { s: { assetIds: [theirs.id] } } })).body.error).toBe('Image introuvable.');
    const { thread } = await other.generate({ prompt: 'à lui' });
    const res = await me.post(`/workflows/${w.id}/runs`, { inputs: { s: { assetIds: [image.id] } }, thread: { id: thread.id, personaId: null } });
    expect(res.status).toBe(404);
    // Depuis l'éditeur, le graphe est obligatoire.
    expect((await me.post(`/workflows/${w.id}/runs`, {})).body.error).toBe('Graphe manquant.');
  });
});
