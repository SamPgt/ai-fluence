import { describe, expect, it } from 'vitest';
import { call, signup } from './helpers.js';

describe('supprimer un résultat du fil', () => {
  it('masque les images, garde la demande, et se restaure @smoke', async () => {
    const me = await signup();
    const { generation, thread } = await me.generate({ prompt: 'une pomme' });
    const removed = await me.del(`/generations/${generation.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.ids).toEqual([generation.id]);
    const g = (await me.get(`/generations/${generation.id}`)).body.generation;
    expect(g.removedAt).not.toBeNull();
    expect(g.outputs).toEqual([]);
    expect(g.prompt).toBe('une pomme');
    // Plus dans la galerie ni en vignette du fil.
    expect((await me.get('/assets/gallery')).body.items).toHaveLength(0);
    expect((await me.get('/threads')).body.threads[0].coverUrl ?? null).toBeNull();
    // Restauration.
    expect((await me.post(`/generations/${generation.id}/restore`)).status).toBe(200);
    const back = (await me.get(`/threads/${thread.id}`)).body.generations[0];
    expect(back.removedAt).toBeNull();
    expect(back.outputs).toHaveLength(1);
  });

  it('avec batch=true, supprime tout le lot d’une série', async () => {
    const me = await signup();
    const { generation, thread } = await me.generate({ prompt: 'série', count: 3 });
    const res = await me.del(`/generations/${generation.id}?batch=true`);
    expect(res.body.ids).toHaveLength(3);
    const gens = (await me.get(`/threads/${thread.id}`)).body.generations;
    expect(gens.every((x: { removedAt: string | null }) => x.removedAt)).toBe(true);
  });

  it('sans batch, ne supprime qu’une image de la série', async () => {
    const me = await signup();
    const { generation, thread } = await me.generate({ prompt: 'série', count: 2 });
    expect((await me.del(`/generations/${generation.id}`)).body.ids).toHaveLength(1);
    const gens = (await me.get(`/threads/${thread.id}`)).body.generations;
    expect(gens.filter((x: { removedAt: string | null }) => x.removedAt)).toHaveLength(1);
  });

  it('404 pour un autre utilisateur ou un id inconnu, 401 sans session', async () => {
    const a = await signup();
    const b = await signup();
    const { generation } = await a.generate();
    expect((await b.del(`/generations/${generation.id}`)).status).toBe(404);
    expect((await b.post(`/generations/${generation.id}/restore`)).status).toBe(404);
    expect((await a.del('/generations/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await call('DELETE', `/generations/${generation.id}`)).status).toBe(401);
    expect((await a.get(`/generations/${generation.id}`)).body.generation.removedAt).toBeNull();
  });
});
