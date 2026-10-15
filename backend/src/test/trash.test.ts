import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Thread, TrashResponse } from '@sublime/shared';
import { db } from '../db/index.js';
import { assets, generations, personas, promptPresets, threads } from '../db/schema.js';
import { purge, TRASH_DAYS } from '../services/trash.service.js';
import { call, signup, type Agent } from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Chemin du fichier d'un média, lu en base. */
async function filePath(assetId: string): Promise<string> {
  const [row] = await db.select({ filePath: assets.filePath }).from(assets).where(eq(assets.id, assetId));
  expect(row, `média ${assetId}`).toBeTruthy();
  return row.filePath;
}

async function assetExists(assetId: string) {
  return (await db.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId))).length > 0;
}

async function personaExists(id: string) {
  return (await db.select({ id: personas.id }).from(personas).where(eq(personas.id, id))).length > 0;
}

async function threadExists(id: string) {
  return (await db.select({ id: threads.id }).from(threads).where(eq(threads.id, id))).length > 0;
}

async function generationCount(threadId: string) {
  return db.$count(generations, eq(generations.threadId, threadId));
}

async function getTrash(me: Agent): Promise<TrashResponse> {
  const res = await me.get('/trash');
  expect(res.status).toBe(200);
  return res.body;
}

/** Génération avec son unique résultat (id et chemin du fichier). */
async function generateOne(me: Agent, body: Record<string, unknown> = {}) {
  const { generation, thread } = await me.generate(body);
  expect(generation.status).toBe('succeeded');
  const output = generation.outputs[0];
  const path = await filePath(output.id);
  expect(existsSync(path)).toBe(true);
  return { generation, thread, output, path };
}

async function ids(me: Agent, path: string, key: string): Promise<string[]> {
  return ((await me.get(path)).body[key] as { id: string }[]).map(x => x.id);
}

describe('corbeille : accès sans session', () => {
  it('chaque route répond 401 sans session', async () => {
    const id = randomUUID();
    expect((await call('GET', '/trash')).status).toBe(401);
    expect((await call('POST', `/trash/personas/${id}/restore`)).status).toBe(401);
    expect((await call('POST', `/trash/threads/${id}/restore`)).status).toBe(401);
    expect((await call('DELETE', `/trash/personas/${id}`)).status).toBe(401);
    expect((await call('DELETE', `/trash/threads/${id}`)).status).toBe(401);
    expect((await call('DELETE', '/trash')).status).toBe(401);
  });
});

describe('GET /trash', () => {
  it('renvoie une corbeille vide avec la durée de conservation', async () => {
    const me = await signup();
    expect(await getTrash(me)).toEqual({ days: TRASH_DAYS, personas: [], threads: [], workflows: [] });
  });

  it('liste un persona supprimé avec son nombre de références, sans emporter ses fils', async () => {
    const me = await signup();
    const avatar = await me.uploadAsset();
    const lea = await me.createPersona({ name: 'Léa', color: '#123456', avatarAssetId: avatar.id });
    const ref = await me.uploadAsset({ personaId: lea.id, isReference: true });
    await me.uploadAsset({ personaId: lea.id, isReference: true });
    // Import du persona hors références : pas compté.
    await me.uploadAsset({ personaId: lea.id });
    const { thread } = await generateOne(me, { referenceAssetIds: [ref.id] });
    await me.del(`/personas/${lea.id}`);

    const trash = await getTrash(me);
    expect(trash.threads).toEqual([]);
    expect(trash.personas).toHaveLength(1);
    const p = trash.personas[0];
    expect(p).toMatchObject({ id: lea.id, name: 'Léa', color: '#123456', avatarUrl: `/api/media/${avatar.id}`, referenceCount: 2 });
    expect(p).not.toHaveProperty('threadCount');
    expect(new Date(p.purgeAt).getTime() - new Date(p.deletedAt).getTime()).toBe(TRASH_DAYS * DAY_MS);
    // Le fil reste dans la liste, sans ce persona.
    const threadsNow = (await me.get('/threads')).body.threads as Thread[];
    expect(threadsNow.map(t => t.id)).toEqual([thread.id]);
    expect(threadsNow[0].personaIds).toEqual([]);
  });

  it('liste un fil supprimé avec sa vignette, sans nom de persona @smoke', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const ref = await me.uploadAsset({ personaId: lea.id, isReference: true });
    const { thread, output } = await generateOne(me, { referenceAssetIds: [ref.id], prompt: 'un chat' });
    expect((await me.del(`/threads/${thread.id}`)).status).toBe(200);

    const trash = await getTrash(me);
    expect(trash.personas).toEqual([]);
    expect(trash.threads).toHaveLength(1);
    const t = trash.threads[0];
    expect(t).toMatchObject({ id: thread.id, title: 'un chat', coverUrl: `/api/media/${output.id}` });
    expect(Object.keys(t).sort()).toEqual(['coverUrl', 'deletedAt', 'id', 'purgeAt', 'title']);
    expect(new Date(t.purgeAt).getTime() - new Date(t.deletedAt).getTime()).toBe(TRASH_DAYS * DAY_MS);
  });

  it('liste chaque fil supprimé, que le persona de ses références soit à la corbeille ou non', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const ref = await me.uploadAsset({ personaId: lea.id, isReference: true });
    const { thread: early } = await generateOne(me, { referenceAssetIds: [ref.id] });
    const { thread: late } = await generateOne(me, { referenceAssetIds: [ref.id] });
    await me.del(`/threads/${early.id}`);
    await new Promise(r => setTimeout(r, 10));
    await me.del(`/personas/${lea.id}`);
    await new Promise(r => setTimeout(r, 10));
    await me.del(`/threads/${late.id}`);

    const trash = await getTrash(me);
    expect(trash.personas.map(p => p.id)).toEqual([lea.id]);
    expect(trash.personas[0].referenceCount).toBe(1);
    expect(trash.threads.map(t => t.id)).toEqual([late.id, early.id]);
  });

  it('trie personas et fils du plus récent au plus ancien', async () => {
    const me = await signup();
    const a = await me.createPersona({ name: 'A' });
    const b = await me.createPersona({ name: 'B' });
    const { thread: t1 } = await generateOne(me);
    const { thread: t2 } = await generateOne(me);
    await me.del(`/personas/${a.id}`);
    await me.del(`/threads/${t1.id}`);
    await new Promise(r => setTimeout(r, 10));
    await me.del(`/personas/${b.id}`);
    await me.del(`/threads/${t2.id}`);
    const trash = await getTrash(me);
    expect(trash.personas.map(p => p.id)).toEqual([b.id, a.id]);
    expect(trash.threads.map(t => t.id)).toEqual([t2.id, t1.id]);
  });

  it('ne montre pas la corbeille d’un autre utilisateur', async () => {
    const me = await signup();
    const other = await signup();
    const p = await other.createPersona({ name: 'Autre' });
    const { thread } = await generateOne(other);
    await other.del(`/personas/${p.id}`);
    await other.del(`/threads/${thread.id}`);
    expect(await getTrash(me)).toEqual({ days: TRASH_DAYS, personas: [], threads: [], workflows: [] });
  });
});

describe('POST /trash/personas/:id/restore', () => {
  it('restaure seulement le persona, avec ses références, sans toucher aux fils', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const ref = await me.uploadAsset({ personaId: lea.id, isReference: true });
    const { thread: early } = await generateOne(me, { referenceAssetIds: [ref.id] });
    const { thread: kept } = await generateOne(me, { referenceAssetIds: [ref.id] });
    await me.del(`/threads/${early.id}`);
    await me.del(`/personas/${lea.id}`);
    // Le fil non supprimé n'est jamais parti à la corbeille.
    expect(await ids(me, '/threads', 'threads')).toEqual([kept.id]);

    const res = await me.post(`/trash/personas/${lea.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await ids(me, '/personas', 'personas')).toEqual([lea.id]);
    expect(await ids(me, `/assets/references?personaId=${lea.id}`, 'assets')).toEqual([ref.id]);
    expect(await ids(me, '/threads', 'threads')).toEqual([kept.id]);
    expect((await me.get(`/threads/${kept.id}`)).body.thread.personaIds).toEqual([lea.id]);

    // Le fil supprimé à part reste à la corbeille.
    const trash = await getTrash(me);
    expect(trash.personas).toEqual([]);
    expect(trash.threads.map(t => t.id)).toEqual([early.id]);
  });

  it('répond 404 pour un persona qui n’est pas à la corbeille', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Vivant' });
    const res = await me.post(`/trash/personas/${p.id}/restore`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Introuvable dans la corbeille.');
  });

  it('répond 404 la deuxième fois', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'A' });
    await me.del(`/personas/${p.id}`);
    expect((await me.post(`/trash/personas/${p.id}/restore`)).status).toBe(200);
    expect((await me.post(`/trash/personas/${p.id}/restore`)).status).toBe(404);
  });

  it('répond 404 pour un persona inconnu ou un id invalide', async () => {
    const me = await signup();
    expect((await me.post(`/trash/personas/${randomUUID()}/restore`)).status).toBe(404);
    expect((await me.post('/trash/personas/pas-un-uuid/restore')).status).toBe(404);
  });

  it('répond 404 pour le persona d’un autre utilisateur et le laisse à la corbeille', async () => {
    const me = await signup();
    const other = await signup();
    const p = await other.createPersona({ name: 'Autre' });
    await other.del(`/personas/${p.id}`);
    expect((await me.post(`/trash/personas/${p.id}/restore`)).status).toBe(404);
    expect((await getTrash(other)).personas).toHaveLength(1);
  });
});

describe('POST /trash/threads/:id/restore', () => {
  it('restaure un fil supprimé, qui cite toujours le persona de ses références', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const ref = await me.uploadAsset({ personaId: lea.id, isReference: true });
    const { thread } = await generateOne(me, { referenceAssetIds: [ref.id] });
    await me.del(`/threads/${thread.id}`);

    const res = await me.post(`/trash/threads/${thread.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const detail = await me.get(`/threads/${thread.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.thread.personaIds).toEqual([lea.id]);
    expect(detail.body.generations).toHaveLength(1);
    expect((await getTrash(me)).threads).toEqual([]);
  });

  it('restaure un fil dont le persona est encore à la corbeille, sans toucher au persona', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const ref = await me.uploadAsset({ personaId: lea.id, isReference: true });
    const { thread } = await generateOne(me, { referenceAssetIds: [ref.id] });
    await me.del(`/personas/${lea.id}`);
    await me.del(`/threads/${thread.id}`);

    expect((await me.post(`/trash/threads/${thread.id}/restore`)).status).toBe(200);
    const detail = await me.get(`/threads/${thread.id}`);
    expect(detail.status).toBe(200);
    // Un persona à la corbeille n'est pas cité.
    expect(detail.body.thread.personaIds).toEqual([]);
    expect(await ids(me, '/threads', 'threads')).toEqual([thread.id]);

    // Le persona reste à la corbeille, avec sa référence.
    const trash = await getTrash(me);
    expect(trash.threads).toEqual([]);
    expect(trash.personas.map(p => p.id)).toEqual([lea.id]);
    expect(trash.personas[0].referenceCount).toBe(1);

    // Une fois le persona restauré, le fil le cite de nouveau.
    expect((await me.post(`/trash/personas/${lea.id}/restore`)).status).toBe(200);
    expect((await me.get(`/threads/${thread.id}`)).body.thread.personaIds).toEqual([lea.id]);
  });

  it('répond 404 pour un fil qui n’est pas à la corbeille', async () => {
    const me = await signup();
    const { thread } = await generateOne(me);
    expect((await me.post(`/trash/threads/${thread.id}/restore`)).status).toBe(404);
  });

  it('répond 404 pour un fil inconnu ou un id invalide', async () => {
    const me = await signup();
    expect((await me.post(`/trash/threads/${randomUUID()}/restore`)).status).toBe(404);
    expect((await me.post('/trash/threads/pas-un-uuid/restore')).status).toBe(404);
  });

  it('répond 404 pour le fil d’un autre utilisateur et le laisse à la corbeille', async () => {
    const me = await signup();
    const other = await signup();
    const { thread } = await generateOne(other);
    await other.del(`/threads/${thread.id}`);
    expect((await me.post(`/trash/threads/${thread.id}/restore`)).status).toBe(404);
    expect((await getTrash(other)).threads).toHaveLength(1);
  });
});

describe('DELETE /trash/personas/:id', () => {
  it('supprime pour de bon le persona et ses médias propres, jamais les fils', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const ref = await me.uploadAsset({ personaId: lea.id, isReference: true });
    const avatar = await me.uploadAsset({ personaId: lea.id });
    const imported = await me.uploadAsset({ personaId: lea.id });
    await me.patch(`/personas/${lea.id}`, { name: 'Léa', avatarAssetId: avatar.id });
    const { thread, output, path } = await generateOne(me);
    // Ancien raccourci rattaché au persona (plus possible par l'API) : il part avec lui.
    const [preset] = await db
      .insert(promptPresets)
      .values({ userId: me.user.id, personaId: lea.id, label: 'L', text: 'x', position: 99 })
      .returning();
    const paths = await Promise.all([ref.id, avatar.id, imported.id].map(filePath));
    await me.del(`/personas/${lea.id}`);

    const res = await me.del(`/trash/personas/${lea.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ personas: 1, threads: 0, workflows: 0, files: 3 });

    expect(await personaExists(lea.id)).toBe(false);
    for (const id of [ref.id, avatar.id, imported.id]) expect(await assetExists(id)).toBe(false);
    for (const p of paths) expect(existsSync(p)).toBe(false);
    expect(await db.$count(promptPresets, eq(promptPresets.id, preset.id))).toBe(0);
    // Le fil et ses résultats restent.
    expect(await threadExists(thread.id)).toBe(true);
    expect(await generationCount(thread.id)).toBe(1);
    expect(await assetExists(output.id)).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(await getTrash(me)).toEqual({ days: TRASH_DAYS, personas: [], threads: [], workflows: [] });
  });

  it('ne supprime pas un fil mis à la corbeille qui utilisait ses références', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const ref = await me.uploadAsset({ personaId: lea.id, isReference: true });
    const { thread, path } = await generateOne(me, { referenceAssetIds: [ref.id] });
    const refPath = await filePath(ref.id);
    await me.del(`/threads/${thread.id}`);
    await me.del(`/personas/${lea.id}`);

    const res = await me.del(`/trash/personas/${lea.id}`);
    expect(res.body).toEqual({ personas: 1, threads: 0, workflows: 0, files: 0 });
    expect(await threadExists(thread.id)).toBe(true);
    expect(existsSync(path)).toBe(true);
    // La référence sert encore au fil (restaurable) : elle reste.
    expect(await assetExists(ref.id)).toBe(true);
    expect(existsSync(refPath)).toBe(true);
    expect((await getTrash(me)).threads.map(t => t.id)).toEqual([thread.id]);
  });

  it('garde une référence du persona utilisée par une génération d’un fil conservé', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const ref = await me.uploadAsset({ personaId: lea.id, isReference: true });
    // Fil sans persona qui utilise la référence de Léa : il reste en place.
    const { thread: kept } = await generateOne(me, { referenceAssetIds: [ref.id] });
    const refPath = await filePath(ref.id);
    await me.del(`/personas/${lea.id}`);

    const res = await me.del(`/trash/personas/${lea.id}`);
    expect(res.body).toMatchObject({ personas: 1, files: 0 });
    expect(await assetExists(ref.id)).toBe(true);
    expect(existsSync(refPath)).toBe(true);
    const detail = await me.get(`/threads/${kept.id}`);
    expect(detail.body.generations[0].references.map((r: { id: string }) => r.id)).toEqual([ref.id]);
    // Gardée pour le fil, mais plus une référence : elle n'apparaît pas dans Général.
    expect((await me.get('/assets/references?personaId=general')).body.assets).toEqual([]);
  });

  it('garde un média du persona utilisé comme avatar d’un autre persona', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const shared = await me.uploadAsset({ personaId: lea.id, isReference: true });
    const zoe = await me.createPersona({ name: 'Zoé', avatarAssetId: shared.id });
    const sharedPath = await filePath(shared.id);
    await me.del(`/personas/${lea.id}`);

    await me.del(`/trash/personas/${lea.id}`);
    expect(await assetExists(shared.id)).toBe(true);
    expect(existsSync(sharedPath)).toBe(true);
    const zoeNow = ((await me.get('/personas')).body.personas as { id: string; avatarAssetId: string }[]).find(p => p.id === zoe.id);
    expect(zoeNow!.avatarAssetId).toBe(shared.id);
  });

  it('garde un média du persona utilisé comme photo de profil', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const photo = await me.uploadAsset({ personaId: lea.id });
    expect((await me.patch('/auth/me', { avatarAssetId: photo.id })).status).toBe(200);
    const photoPath = await filePath(photo.id);
    await me.del(`/personas/${lea.id}`);

    await me.del(`/trash/personas/${lea.id}`);
    expect(await assetExists(photo.id)).toBe(true);
    expect(existsSync(photoPath)).toBe(true);
  });

  it('ne touche pas aux références d’un autre persona', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const zoe = await me.createPersona({ name: 'Zoé' });
    const zoeRef = await me.uploadAsset({ personaId: zoe.id, isReference: true });
    const { path: zoeOutput } = await generateOne(me, { referenceAssetIds: [zoeRef.id] });
    const zoeRefPath = await filePath(zoeRef.id);
    await me.del(`/personas/${lea.id}`);

    await me.del(`/trash/personas/${lea.id}`);
    expect(await assetExists(zoeRef.id)).toBe(true);
    expect(existsSync(zoeRefPath)).toBe(true);
    expect(existsSync(zoeOutput)).toBe(true);
    expect((await me.get('/personas')).body.personas[0].referenceCount).toBe(1);
  });

  it('garde un résultat de génération ajouté à ses références : il suit son fil', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const { thread, output, path } = await generateOne(me);
    expect((await me.patch(`/assets/${output.id}/reference`, { personaId: lea.id, isReference: true })).status).toBe(200);
    await me.del(`/personas/${lea.id}`);

    const res = await me.del(`/trash/personas/${lea.id}`);
    expect(res.body).toEqual({ personas: 1, threads: 0, workflows: 0, files: 0 });
    expect(await assetExists(output.id)).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect((await me.get(`/threads/${thread.id}`)).body.generations[0].outputs[0].id).toBe(output.id);
  });

  it('ne fait rien pour un persona qui n’est pas à la corbeille', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Vivant' });
    const ref = await me.uploadAsset({ personaId: p.id, isReference: true });
    const res = await me.del(`/trash/personas/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ personas: 0, threads: 0, workflows: 0, files: 0 });
    expect(await personaExists(p.id)).toBe(true);
    expect(existsSync(await filePath(ref.id))).toBe(true);
  });

  it('ne fait rien pour le persona d’un autre utilisateur', async () => {
    const me = await signup();
    const other = await signup();
    const p = await other.createPersona({ name: 'Autre' });
    const ref = await other.uploadAsset({ personaId: p.id, isReference: true });
    const path = await filePath(ref.id);
    await other.del(`/personas/${p.id}`);
    const res = await me.del(`/trash/personas/${p.id}`);
    expect(res.body).toEqual({ personas: 0, threads: 0, workflows: 0, files: 0 });
    expect(await personaExists(p.id)).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect((await getTrash(other)).personas).toHaveLength(1);
  });

  it('répond 404 pour un id qui n’est pas un uuid', async () => {
    const me = await signup();
    expect((await me.del('/trash/personas/pas-un-uuid')).status).toBe(404);
  });

  it('répond 200 sans rien supprimer pour un persona inconnu', async () => {
    const me = await signup();
    const res = await me.del(`/trash/personas/${randomUUID()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ personas: 0, threads: 0, workflows: 0, files: 0 });
  });
});

describe('DELETE /trash/threads/:id', () => {
  it('supprime pour de bon le fil, ses générations, ses résultats et leurs fichiers', async () => {
    const me = await signup();
    const { thread, generation, output, path } = await generateOne(me);
    await me.del(`/threads/${thread.id}`);

    const res = await me.del(`/trash/threads/${thread.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ personas: 0, threads: 1, workflows: 0, files: 1 });
    expect(await threadExists(thread.id)).toBe(false);
    expect(await db.$count(generations, eq(generations.id, generation.id))).toBe(0);
    expect(await assetExists(output.id)).toBe(false);
    expect(existsSync(path)).toBe(false);
    expect((await getTrash(me)).threads).toEqual([]);
  });

  it('ne supprime pas les références envoyées par le fil', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const ref = await me.uploadAsset({ personaId: lea.id, isReference: true });
    const upload = await me.uploadAsset();
    const { thread, path } = await generateOne(me, { referenceAssetIds: [ref.id, upload.id] });
    await me.del(`/threads/${thread.id}`);
    await me.del(`/trash/threads/${thread.id}`);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(await filePath(ref.id))).toBe(true);
    expect(existsSync(await filePath(upload.id))).toBe(true);
  });

  it('garde un résultat ajouté aux références d’un persona vivant', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const { thread, output, path } = await generateOne(me);
    const mark = await me.patch(`/assets/${output.id}/reference`, { personaId: lea.id, isReference: true });
    expect(mark.status).toBe(200);
    await me.del(`/threads/${thread.id}`);

    const res = await me.del(`/trash/threads/${thread.id}`);
    expect(res.body).toEqual({ personas: 0, threads: 1, workflows: 0, files: 0 });
    expect(await threadExists(thread.id)).toBe(false);
    expect(await assetExists(output.id)).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect((await me.get('/personas')).body.personas[0].referenceCount).toBe(1);
  });

  it('garde un résultat utilisé comme référence par une génération d’un autre fil', async () => {
    const me = await signup();
    const { thread, output, path } = await generateOne(me);
    const { thread: other } = await generateOne(me, { referenceAssetIds: [output.id] });
    await me.del(`/threads/${thread.id}`);

    const res = await me.del(`/trash/threads/${thread.id}`);
    expect(res.body).toMatchObject({ threads: 1, files: 0 });
    expect(await assetExists(output.id)).toBe(true);
    expect(existsSync(path)).toBe(true);
    const detail = await me.get(`/threads/${other.id}`);
    expect(detail.body.generations[0].references.map((r: { id: string }) => r.id)).toEqual([output.id]);
  });

  it('supprime un résultat réutilisé uniquement dans le même fil', async () => {
    const me = await signup();
    const { thread, output, path } = await generateOne(me);
    const { output: second, path: secondPath } = await generateOne(me, { threadId: thread.id, referenceAssetIds: [output.id] });
    await me.del(`/threads/${thread.id}`);

    const res = await me.del(`/trash/threads/${thread.id}`);
    expect(res.body).toEqual({ personas: 0, threads: 1, workflows: 0, files: 2 });
    expect(await assetExists(output.id)).toBe(false);
    expect(await assetExists(second.id)).toBe(false);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(secondPath)).toBe(false);
  });

  it('garde un résultat utilisé comme avatar d’un persona', async () => {
    const me = await signup();
    const { thread, output, path } = await generateOne(me);
    await me.createPersona({ name: 'Léa', avatarAssetId: output.id });
    await me.del(`/threads/${thread.id}`);

    await me.del(`/trash/threads/${thread.id}`);
    expect(await assetExists(output.id)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('garde un résultat utilisé comme photo de profil', async () => {
    const me = await signup();
    const { thread, output, path } = await generateOne(me);
    expect((await me.patch('/auth/me', { avatarAssetId: output.id })).status).toBe(200);
    await me.del(`/threads/${thread.id}`);

    await me.del(`/trash/threads/${thread.id}`);
    expect(await assetExists(output.id)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('supprime un fil sans toucher au persona à la corbeille dont il utilisait une référence', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const ref = await me.uploadAsset({ personaId: lea.id, isReference: true });
    const { thread, path } = await generateOne(me, { referenceAssetIds: [ref.id] });
    await me.del(`/personas/${lea.id}`);
    await me.del(`/threads/${thread.id}`);

    const res = await me.del(`/trash/threads/${thread.id}`);
    expect(res.body).toEqual({ personas: 0, threads: 1, workflows: 0, files: 1 });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(await filePath(ref.id))).toBe(true);
    const trash = await getTrash(me);
    expect(trash.personas.map(p => p.id)).toEqual([lea.id]);
    expect(trash.personas[0].referenceCount).toBe(1);
  });

  it('ne fait rien pour un fil qui n’est pas à la corbeille', async () => {
    const me = await signup();
    const { thread, path } = await generateOne(me);
    const res = await me.del(`/trash/threads/${thread.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ personas: 0, threads: 0, workflows: 0, files: 0 });
    expect((await me.get(`/threads/${thread.id}`)).status).toBe(200);
    expect(existsSync(path)).toBe(true);
  });

  it('ne fait rien pour le fil d’un autre utilisateur', async () => {
    const me = await signup();
    const other = await signup();
    const { thread, path } = await generateOne(other);
    await other.del(`/threads/${thread.id}`);
    const res = await me.del(`/trash/threads/${thread.id}`);
    expect(res.body).toEqual({ personas: 0, threads: 0, workflows: 0, files: 0 });
    expect(await threadExists(thread.id)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('répond 404 pour un id qui n’est pas un uuid', async () => {
    const me = await signup();
    expect((await me.del('/trash/threads/pas-un-uuid')).status).toBe(404);
  });
});

describe('DELETE /trash', () => {
  it('vide toute la corbeille de l’utilisateur, sans toucher au reste', async () => {
    const me = await signup();
    const other = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const zoe = await me.createPersona({ name: 'Zoé' });
    const leaRef = await me.uploadAsset({ personaId: lea.id, isReference: true });
    const leaUsedRef = await me.uploadAsset({ personaId: lea.id, isReference: true });
    const zoeRef = await me.uploadAsset({ personaId: zoe.id, isReference: true });
    const leaRefPath = await filePath(leaRef.id);
    // Fil vivant qui utilise une référence de Léa : il reste, et la référence avec lui.
    const { thread: kept, path: keptPath } = await generateOne(me, { referenceAssetIds: [leaUsedRef.id] });
    const { thread: lone, path: lonePath } = await generateOne(me);
    const { thread: alive, path: alivePath } = await generateOne(me, { referenceAssetIds: [zoeRef.id] });
    await me.del(`/personas/${lea.id}`);
    await me.del(`/threads/${lone.id}`);

    const otherPersona = await other.createPersona({ name: 'Autre' });
    const otherRef = await other.uploadAsset({ personaId: otherPersona.id, isReference: true });
    const { thread: otherThread, path: otherPath } = await generateOne(other, { referenceAssetIds: [otherRef.id] });
    await other.del(`/personas/${otherPersona.id}`);
    await other.del(`/threads/${otherThread.id}`);

    const res = await me.del('/trash');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ personas: 1, threads: 1, workflows: 0, files: 2 });
    expect(await getTrash(me)).toEqual({ days: TRASH_DAYS, personas: [], threads: [], workflows: [] });
    expect(existsSync(leaRefPath)).toBe(false);
    expect(existsSync(lonePath)).toBe(false);

    // Ce qui n'est pas à la corbeille reste.
    expect(await ids(me, '/personas', 'personas')).toEqual([zoe.id]);
    expect((await ids(me, '/threads', 'threads')).sort()).toEqual([kept.id, alive.id].sort());
    expect(existsSync(alivePath)).toBe(true);
    expect(existsSync(keptPath)).toBe(true);
    expect(existsSync(await filePath(leaUsedRef.id))).toBe(true);

    // La corbeille de l'autre utilisateur reste intacte.
    const otherTrash = await getTrash(other);
    expect(otherTrash.personas).toHaveLength(1);
    expect(otherTrash.threads.map(t => t.id)).toEqual([otherThread.id]);
    expect(existsSync(otherPath)).toBe(true);
    expect(existsSync(await filePath(otherRef.id))).toBe(true);
  });

  it('répond avec des compteurs à zéro pour une corbeille vide', async () => {
    const me = await signup();
    const res = await me.del('/trash');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ personas: 0, threads: 0, workflows: 0, files: 0 });
  });
});

describe('purge automatique des éléments expirés', () => {
  it('supprime seulement ce qui est à la corbeille depuis plus de 7 jours', async () => {
    const me = await signup();
    const old = await me.createPersona({ name: 'Ancien' });
    const recent = await me.createPersona({ name: 'Récent' });
    const oldRef = await me.uploadAsset({ personaId: old.id, isReference: true });
    const oldRefPath = await filePath(oldRef.id);
    const { thread: oldThread, path: oldThreadPath } = await generateOne(me);
    const { thread: recentThread, path: recentThreadPath } = await generateOne(me);
    const { thread: alive } = await generateOne(me);
    await me.del(`/personas/${old.id}`);
    await me.del(`/personas/${recent.id}`);
    await me.del(`/threads/${oldThread.id}`);
    await me.del(`/threads/${recentThread.id}`);

    // Mises à la corbeille il y a 8 jours.
    const longAgo = new Date(Date.now() - (TRASH_DAYS + 1) * DAY_MS);
    await db.update(personas).set({ deletedAt: longAgo }).where(eq(personas.id, old.id));
    await db.update(threads).set({ deletedAt: longAgo }).where(inArray(threads.id, [oldThread.id]));

    const res = await purge({ expired: true });
    expect(res).toEqual({ personas: 1, threads: 1, workflows: 0, files: 2 });
    expect(await personaExists(old.id)).toBe(false);
    expect(await threadExists(oldThread.id)).toBe(false);
    expect(existsSync(oldRefPath)).toBe(false);
    expect(existsSync(oldThreadPath)).toBe(false);

    expect(await personaExists(recent.id)).toBe(true);
    expect(await threadExists(recentThread.id)).toBe(true);
    expect(existsSync(recentThreadPath)).toBe(true);
    expect(await ids(me, '/threads', 'threads')).toEqual([alive.id]);
    const trash = await getTrash(me);
    expect(trash.personas.map(p => p.id)).toEqual([recent.id]);
    expect(trash.threads.map(t => t.id)).toEqual([recentThread.id]);
  });
});
