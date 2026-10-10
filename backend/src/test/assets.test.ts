/**
 * Médias : upload, bibliothèque de références, galerie et service des fichiers (/media).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import app from '../app.js';
import { db } from '../db/index.js';
import { assets } from '../db/schema.js';
import { env } from '../env.js';
import { FIXTURE_PNG, call, signup, type Agent } from './helpers.js';

const BASE = 'http://api.test';

async function assetRow(id: string) {
  const [row] = await db.select().from(assets).where(eq(assets.id, id));
  return row;
}

/** Résultat généré inséré directement en base (pour la pagination de la galerie). */
async function insertOutput(owner: Agent, data: Partial<typeof assets.$inferInsert> = {}) {
  const [row] = await db
    .insert(assets)
    .values({
      userId: owner.user.id,
      kind: 'output',
      mediaType: 'image',
      mime: 'image/png',
      filePath: '/nulle-part/fichier.png',
      ...data,
    })
    .returning();
  return row;
}

/** GET /media brut, pour lire les octets et envoyer des en-têtes (Range). */
async function fetchMedia(owner: Agent | null, path: string, headers: Record<string, string> = {}) {
  const res = await app.fetch(
    new Request(`${BASE}${path}`, { headers: { ...(owner ? { Cookie: owner.cookie } : {}), ...headers } }),
  );
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** Octets reconnaissables : l'octet n vaut n % 256. */
const pattern = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 256);

const assetIds = (list: { id: string }[]) => list.map(a => a.id);

describe('authentification', () => {
  it('toutes les routes des médias exigent une session', async () => {
    const id = randomUUID();
    const form = new FormData();
    form.set('file', new File([FIXTURE_PNG], 'a.png', { type: 'image/png' }));
    expect((await call('POST', '/assets', form)).status).toBe(401);
    expect((await call('GET', `/assets/references?personaId=${id}`)).status).toBe(401);
    expect((await call('PUT', '/assets/references/order', { personaId: id, ids: [] })).status).toBe(401);
    expect((await call('PATCH', `/assets/${id}/reference`, { personaId: id, isReference: true })).status).toBe(401);
    expect((await call('GET', '/assets/gallery')).status).toBe(401);
    expect((await call('GET', `/media/${id}`)).status).toBe(401);
  });
});

describe('POST /assets', () => {
  it('enregistre une image PNG sur le disque et renvoie le média', async () => {
    const me = await signup();
    const res = await me.upload();
    expect(res.status).toBe(201);
    const a = res.body.asset;
    expect(a).toMatchObject({
      kind: 'upload',
      mediaType: 'image',
      mime: 'image/png',
      personaId: null,
      isReference: false,
      generationId: null,
    });
    expect(a.url).toBe(`/api/media/${a.id}`);
    const row = await assetRow(a.id);
    expect(row.userId).toBe(me.user.id);
    expect(row.bytes).toBe(FIXTURE_PNG.byteLength);
    expect(row.filePath).toMatch(/\/references\/divers\/[0-9a-f-]{12}\.png$/);
    expect(new Uint8Array(readFileSync(row.filePath))).toEqual(new Uint8Array(FIXTURE_PNG));
  });

  it.each([
    ['image/jpeg', 'image', 'jpg'],
    ['image/png', 'image', 'png'],
    ['image/webp', 'image', 'webp'],
    ['image/gif', 'image', 'gif'],
    ['video/mp4', 'video', 'mp4'],
    ['video/webm', 'video', 'webm'],
  ])('accepte le format %s', async (mime, mediaType, ext) => {
    const me = await signup();
    const res = await me.upload({ mime, bytes: pattern(64) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.asset.mime).toBe(mime);
    expect(res.body.asset.mediaType).toBe(mediaType);
    expect((await assetRow(res.body.asset.id)).filePath.endsWith(`.${ext}`)).toBe(true);
  });

  it.each(['image/svg+xml', 'video/quicktime', 'application/pdf', 'text/plain'])(
    'refuse le format %s par une erreur 400',
    async mime => {
      const me = await signup();
      const res = await me.upload({ mime, bytes: pattern(64) });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Formats acceptés : JPEG, PNG, WebP, GIF, MP4, WebM.');
    },
  );

  it('refuse une requête sans fichier par une erreur 400', async () => {
    const me = await signup();
    const form = new FormData();
    form.set('personaId', randomUUID());
    const res = await me.req('POST', '/assets', form);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Fichier manquant.');
  });

  it('refuse un champ file qui est un simple texte par une erreur 400', async () => {
    const me = await signup();
    const form = new FormData();
    form.set('file', 'pas un fichier');
    const res = await me.req('POST', '/assets', form);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Fichier manquant.');
  });

  it('accepte une image de 10 Mo tout juste et refuse une image plus lourde par une erreur 400', async () => {
    const me = await signup();
    const ok = await me.upload({ mime: 'image/jpeg', bytes: new Uint8Array(10 * 1024 * 1024) });
    expect(ok.status).toBe(201);
    const tooBig = await me.upload({ mime: 'image/jpeg', bytes: new Uint8Array(10 * 1024 * 1024 + 1) });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error).toBe('Image trop lourde (10 Mo max).');
  });

  it('accepte une vidéo de plus de 10 Mo et refuse une vidéo de plus de 90 Mo par une erreur 400', async () => {
    const me = await signup();
    const ok = await me.upload({ mime: 'video/mp4', bytes: new Uint8Array(11 * 1024 * 1024) });
    expect(ok.status).toBe(201);
    const tooBig = await me.upload({ mime: 'video/mp4', bytes: new Uint8Array(90 * 1024 * 1024 + 1) });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error).toBe('Vidéo trop lourde (90 Mo max).');
  });

  it('range le média sous un persona possédé, dans le dossier de ce persona', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Léa Martin' });
    const res = await me.upload({ personaId: p.id });
    expect(res.status).toBe(201);
    expect(res.body.asset.personaId).toBe(p.id);
    expect(res.body.asset.isReference).toBe(false);
    expect((await assetRow(res.body.asset.id)).filePath).not.toContain('/references/divers/');
  });

  it('ajoute le média aux références du persona avec isReference', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Mia' });
    const res = await me.upload({ personaId: p.id, isReference: true });
    expect(res.status).toBe(201);
    expect(res.body.asset).toMatchObject({ personaId: p.id, isReference: true });
  });

  it('ignore isReference sans persona', async () => {
    const me = await signup();
    const res = await me.upload({ isReference: true });
    expect(res.status).toBe(201);
    expect(res.body.asset).toMatchObject({ personaId: null, isReference: false });
  });

  it('ignore le persona d’un autre utilisateur', async () => {
    const me = await signup();
    const other = await signup();
    const theirs = await other.createPersona({ name: 'Pas à moi' });
    const res = await me.upload({ personaId: theirs.id, isReference: true });
    expect(res.status).toBe(201);
    expect(res.body.asset).toMatchObject({ personaId: null, isReference: false });
    expect((await assetRow(res.body.asset.id)).filePath).toContain('/references/divers/');
    expect((await other.get(`/assets/references?personaId=${theirs.id}`)).body.assets).toEqual([]);
  });

  it('ignore un persona inconnu', async () => {
    const me = await signup();
    const res = await me.upload({ personaId: randomUUID(), isReference: true });
    expect(res.status).toBe(201);
    expect(res.body.asset).toMatchObject({ personaId: null, isReference: false });
  });

  // Ancien bug (corrigé) : un personaId qui n'est pas un UUID est passé tel quel à Postgres, qui
  // échoue : la réponse est une erreur 500. Il faudrait une erreur 400.
  it('refuse un personaId qui n’est pas un UUID par une erreur 400', async () => {
    const me = await signup();
    const form = new FormData();
    form.set('file', new File([FIXTURE_PNG], 'a.png', { type: 'image/png' }));
    form.set('personaId', 'pas-un-uuid');
    const res = await me.req('POST', '/assets', form);
    expect(res.status).toBe(400);
  });
});

describe('GET /assets/references', () => {
  it('liste les références du persona, les plus récentes en premier', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Nina' });
    const a = await me.uploadAsset({ personaId: p.id, isReference: true });
    const b = await me.uploadAsset({ personaId: p.id, isReference: true });
    await db.update(assets).set({ createdAt: new Date('2026-01-01T00:00:00Z') }).where(eq(assets.id, a.id));
    const res = await me.get(`/assets/references?personaId=${p.id}`);
    expect(res.status).toBe(200);
    expect(assetIds(res.body.assets)).toEqual([b.id, a.id]);
    expect(res.body.assets[0]).toMatchObject({ personaId: p.id, isReference: true, kind: 'upload' });
  });

  it('exclut les médias du persona qui ne sont pas des références, et ceux des autres personas', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Oscar' });
    const q = await me.createPersona({ name: 'Paul' });
    const ref = await me.uploadAsset({ personaId: p.id, isReference: true });
    await me.uploadAsset({ personaId: p.id });
    await me.uploadAsset({ personaId: q.id, isReference: true });
    await me.uploadAsset();
    expect(assetIds((await me.get(`/assets/references?personaId=${p.id}`)).body.assets)).toEqual([ref.id]);
  });

  it('renvoie une liste vide pour le persona d’un autre utilisateur', async () => {
    const me = await signup();
    const other = await signup();
    const theirs = await other.createPersona({ name: 'Quentin' });
    await other.uploadAsset({ personaId: theirs.id, isReference: true });
    const res = await me.get(`/assets/references?personaId=${theirs.id}`);
    expect(res.status).toBe(200);
    expect(res.body.assets).toEqual([]);
  });

  it('refuse un personaId absent ou qui n’est pas un UUID par une erreur 400', async () => {
    const me = await signup();
    expect((await me.get('/assets/references')).status).toBe(400);
    expect((await me.get('/assets/references?personaId=abc')).status).toBe(400);
  });
});

describe('PUT /assets/references/order', () => {
  it('enregistre l’ordre choisi, et les nouvelles références sans position passent devant', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Rose' });
    const a = await me.uploadAsset({ personaId: p.id, isReference: true });
    const b = await me.uploadAsset({ personaId: p.id, isReference: true });
    const c = await me.uploadAsset({ personaId: p.id, isReference: true });
    const res = await me.put('/assets/references/order', { personaId: p.id, ids: [b.id, c.id, a.id] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(assetIds((await me.get(`/assets/references?personaId=${p.id}`)).body.assets)).toEqual([b.id, c.id, a.id]);
    expect((await assetRow(b.id)).referencePosition).toBe(0);
    expect((await assetRow(a.id)).referencePosition).toBe(2);

    const d = await me.uploadAsset({ personaId: p.id, isReference: true });
    expect(assetIds((await me.get(`/assets/references?personaId=${p.id}`)).body.assets)).toEqual([d.id, b.id, c.id, a.id]);
  });

  it('accepte une liste vide', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Sam' });
    const res = await me.put('/assets/references/order', { personaId: p.id, ids: [] });
    expect(res.status).toBe(200);
  });

  it('ignore les médias d’un autre utilisateur ou d’un autre persona', async () => {
    const me = await signup();
    const other = await signup();
    const p = await me.createPersona({ name: 'Tom' });
    const q = await me.createPersona({ name: 'Ugo' });
    const theirP = await other.createPersona({ name: 'Vera' });
    const theirs = await other.uploadAsset({ personaId: theirP.id, isReference: true });
    const elsewhere = await me.uploadAsset({ personaId: q.id, isReference: true });
    const res = await me.put('/assets/references/order', { personaId: p.id, ids: [theirs.id, elsewhere.id, randomUUID()] });
    expect(res.status).toBe(200);
    expect((await assetRow(theirs.id)).referencePosition).toBeNull();
    expect((await assetRow(elsewhere.id)).referencePosition).toBeNull();
  });

  it('répond 404 pour un persona inconnu ou d’un autre utilisateur', async () => {
    const me = await signup();
    const other = await signup();
    const theirs = await other.createPersona({ name: 'Willy' });
    for (const personaId of [randomUUID(), theirs.id]) {
      const res = await me.put('/assets/references/order', { personaId, ids: [] });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Persona introuvable.');
    }
  });

  it('refuse un corps invalide par une erreur 400', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Xena' });
    expect((await me.put('/assets/references/order', { ids: [] })).status).toBe(400);
    expect((await me.put('/assets/references/order', { personaId: 'abc', ids: [] })).status).toBe(400);
    expect((await me.put('/assets/references/order', { personaId: p.id })).status).toBe(400);
    expect((await me.put('/assets/references/order', { personaId: p.id, ids: ['abc'] })).status).toBe(400);
    const tooMany = Array.from({ length: 501 }, () => randomUUID());
    expect((await me.put('/assets/references/order', { personaId: p.id, ids: tooMany })).status).toBe(400);
  });
});

describe('PATCH /assets/:id/reference', () => {
  it('ajoute un média aux références d’un persona puis l’en retire', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Yann' });
    const a = await me.uploadAsset();
    const add = await me.patch(`/assets/${a.id}/reference`, { personaId: p.id, isReference: true });
    expect(add.status).toBe(200);
    expect(add.body.asset).toMatchObject({ id: a.id, personaId: p.id, isReference: true });
    expect(assetIds((await me.get(`/assets/references?personaId=${p.id}`)).body.assets)).toEqual([a.id]);

    const remove = await me.patch(`/assets/${a.id}/reference`, { personaId: p.id, isReference: false });
    expect(remove.status).toBe(200);
    expect(remove.body.asset).toMatchObject({ personaId: p.id, isReference: false });
    expect((await me.get(`/assets/references?personaId=${p.id}`)).body.assets).toEqual([]);
  });

  it('peut ajouter un résultat généré aux références', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Zoé' });
    const { generation } = await me.generate();
    const out = generation.outputs[0];
    const res = await me.patch(`/assets/${out.id}/reference`, { personaId: p.id, isReference: true });
    expect(res.status).toBe(200);
    expect(res.body.asset).toMatchObject({ kind: 'output', generationId: generation.id, isReference: true });
    expect(assetIds((await me.get(`/assets/references?personaId=${p.id}`)).body.assets)).toEqual([out.id]);
  });

  it('déplace une référence d’un persona vers un autre', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Anna' });
    const q = await me.createPersona({ name: 'Bea' });
    const a = await me.uploadAsset({ personaId: p.id, isReference: true });
    const res = await me.patch(`/assets/${a.id}/reference`, { personaId: q.id, isReference: true });
    expect(res.status).toBe(200);
    expect((await me.get(`/assets/references?personaId=${p.id}`)).body.assets).toEqual([]);
    expect(assetIds((await me.get(`/assets/references?personaId=${q.id}`)).body.assets)).toEqual([a.id]);
  });

  it('répond 404 pour un persona inconnu ou d’un autre utilisateur, sans toucher au média', async () => {
    const me = await signup();
    const other = await signup();
    const theirs = await other.createPersona({ name: 'Cléo' });
    const a = await me.uploadAsset();
    for (const personaId of [randomUUID(), theirs.id]) {
      const res = await me.patch(`/assets/${a.id}/reference`, { personaId, isReference: true });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Persona introuvable.');
    }
    expect(await assetRow(a.id)).toMatchObject({ personaId: null, isReference: false });
  });

  it('répond 404 pour un média inconnu ou d’un autre utilisateur, sans y toucher', async () => {
    const me = await signup();
    const other = await signup();
    const p = await me.createPersona({ name: 'Dan' });
    const theirs = await other.uploadAsset();
    for (const id of [randomUUID(), theirs.id]) {
      const res = await me.patch(`/assets/${id}/reference`, { personaId: p.id, isReference: true });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Média introuvable.');
    }
    expect(await assetRow(theirs.id)).toMatchObject({ personaId: null, isReference: false });
  });

  it('répond 404 pour un identifiant de média qui n’est pas un UUID', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Eve' });
    expect((await me.patch('/assets/abc/reference', { personaId: p.id, isReference: true })).status).toBe(404);
  });

  it('refuse un corps invalide par une erreur 400', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Fred' });
    const a = await me.uploadAsset();
    expect((await me.patch(`/assets/${a.id}/reference`, { personaId: p.id })).status).toBe(400);
    expect((await me.patch(`/assets/${a.id}/reference`, { isReference: true })).status).toBe(400);
    expect((await me.patch(`/assets/${a.id}/reference`, { personaId: 'abc', isReference: true })).status).toBe(400);
    expect((await me.patch(`/assets/${a.id}/reference`, { personaId: p.id, isReference: 'oui' })).status).toBe(400);
  });
});

describe('GET /assets/gallery', () => {
  it('liste les résultats générés avec leur génération, sans les uploads', async () => {
    const me = await signup();
    await me.uploadAsset();
    const { generation, thread } = await me.generate({ prompt: 'un phare' });
    const res = await me.get('/assets/gallery');
    expect(res.status).toBe(200);
    expect(res.body.nextBefore).toBeNull();
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.asset).toMatchObject({ id: generation.outputs[0].id, kind: 'output', generationId: generation.id });
    expect(item.generation).toEqual({
      id: generation.id,
      threadId: thread.id,
      prompt: 'un phare',
      family: 'bytedance/seedream-5.0-flash',
    });
  });

  it('donne une génération nulle pour un résultat sans génération', async () => {
    const me = await signup();
    const row = await insertOutput(me);
    const res = await me.get('/assets/gallery');
    expect(res.body.items).toEqual([{ asset: expect.objectContaining({ id: row.id }), generation: null }]);
  });

  it('trie du plus récent au plus ancien et n’affiche pas les résultats des autres utilisateurs', async () => {
    const me = await signup();
    const other = await signup();
    const old = await insertOutput(me, { createdAt: new Date('2026-01-01T00:00:00Z') });
    const recent = await insertOutput(me, { createdAt: new Date('2026-02-01T00:00:00Z') });
    await insertOutput(other);
    expect((await me.get('/assets/gallery')).body.items.map((i: { asset: { id: string } }) => i.asset.id)).toEqual([
      recent.id,
      old.id,
    ]);
  });

  it('filtre par type de média', async () => {
    const me = await signup();
    const img = await insertOutput(me);
    const vid = await insertOutput(me, { mediaType: 'video', mime: 'video/mp4' });
    const ids = async (q: string) =>
      (await me.get(`/assets/gallery${q}`)).body.items.map((i: { asset: { id: string } }) => i.asset.id);
    expect(await ids('?media=image')).toEqual([img.id]);
    expect(await ids('?media=video')).toEqual([vid.id]);
  });

  it('filtre par persona', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Gina' });
    const withP = await me.generate({ personaId: p.id });
    await me.generate();
    const res = await me.get(`/assets/gallery?personaId=${p.id}`);
    expect(res.body.items.map((i: { asset: { id: string } }) => i.asset.id)).toEqual([withP.generation.outputs[0].id]);
  });

  it('exclut les résultats des fils à la corbeille', async () => {
    const me = await signup();
    const kept = await me.generate();
    const trashed = await me.generate();
    await me.del(`/threads/${trashed.thread.id}`);
    expect((await me.get('/assets/gallery')).body.items.map((i: { asset: { id: string } }) => i.asset.id)).toEqual([
      kept.generation.outputs[0].id,
    ]);
  });

  it('pagine par 60 avec nextBefore, puis donne la page suivante', async () => {
    const me = await signup();
    const start = Date.UTC(2026, 0, 1);
    const rows = await db
      .insert(assets)
      .values(
        Array.from({ length: 61 }, (_, i) => ({
          userId: me.user.id,
          kind: 'output' as const,
          mediaType: 'image' as const,
          mime: 'image/png',
          filePath: `/nulle-part/${i}.png`,
          createdAt: new Date(start + i * 60_000),
        })),
      )
      .returning();
    const newestFirst = [...rows].reverse().map(r => r.id);

    const page1 = await me.get('/assets/gallery');
    expect(page1.status).toBe(200);
    expect(page1.body.items.map((i: { asset: { id: string } }) => i.asset.id)).toEqual(newestFirst.slice(0, 60));
    // Curseur opaque (date exacte et id du dernier élément).
    expect(typeof page1.body.nextBefore).toBe('string');

    const page2 = await me.get(`/assets/gallery?before=${encodeURIComponent(page1.body.nextBefore)}`);
    expect(page2.status).toBe(200);
    expect(page2.body.items.map((i: { asset: { id: string } }) => i.asset.id)).toEqual([rows[0].id]);
    expect(page2.body.nextBefore).toBeNull();
  });

  it('ne saute aucun résultat quand plusieurs sont créés au même instant', async () => {
    const me = await signup();
    const same = new Date(Date.UTC(2026, 0, 1, 12, 0, 0, 123));
    const rows = await db
      .insert(assets)
      .values(
        Array.from({ length: 75 }, (_, i) => ({
          userId: me.user.id,
          kind: 'output' as const,
          mediaType: 'image' as const,
          mime: 'image/png',
          filePath: `/nulle-part/meme-instant-${i}.png`,
          createdAt: same,
        })),
      )
      .returning();
    const page1 = await me.get('/assets/gallery');
    const page2 = await me.get(`/assets/gallery?before=${encodeURIComponent(page1.body.nextBefore)}`);
    const seen = [...page1.body.items, ...page2.body.items].map((i: { asset: { id: string } }) => i.asset.id);
    expect(page1.body.items).toHaveLength(60);
    expect(new Set(seen).size).toBe(75);
    expect(seen.sort()).toEqual(rows.map(r => r.id).sort());
    expect(page2.body.nextBefore).toBeNull();
  });

  it('refuse des filtres invalides par une erreur 400', async () => {
    const me = await signup();
    expect((await me.get('/assets/gallery?media=audio')).status).toBe(400);
    expect((await me.get('/assets/gallery?personaId=abc')).status).toBe(400);
    expect((await me.get('/assets/gallery?before=hier')).status).toBe(400);
  });
});

describe('GET /assets/:id', () => {
  // Il n'existe pas de route de métadonnées pour un média seul : la réponse est 404,
  // même pour un média de l'utilisateur. Les métadonnées passent par les autres listes.
  it('répond 404, car aucune route ne sert les métadonnées d’un seul média', async () => {
    const me = await signup();
    const a = await me.uploadAsset();
    expect((await me.get(`/assets/${a.id}`)).status).toBe(404);
    expect((await me.get('/assets/abc')).status).toBe(404);
  });
});

describe('GET /media/:id', () => {
  it('renvoie les octets du fichier avec le bon type et les en-têtes de cache', async () => {
    const me = await signup();
    const a = await me.uploadAsset();
    const { res, bytes } = await fetchMedia(me, `/media/${a.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-length')).toBe(String(FIXTURE_PNG.byteLength));
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(res.headers.get('content-disposition')).toBeNull();
    expect(bytes).toEqual(new Uint8Array(FIXTURE_PNG));
  });

  it('sert aussi un résultat généré', async () => {
    const me = await signup();
    const { generation } = await me.generate();
    const { res, bytes } = await fetchMedia(me, generation.outputs[0].url.replace('/api', ''));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(bytes).toEqual(new Uint8Array(FIXTURE_PNG));
  });

  it('propose le téléchargement avec ?download', async () => {
    const me = await signup();
    const a = await me.uploadAsset({ mime: 'image/webp', bytes: pattern(32) });
    const { res } = await fetchMedia(me, `/media/${a.id}?download=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[0-9a-f-]{12}\.webp"$/);
  });

  it('répond 404 pour un média inconnu ou d’un autre utilisateur', async () => {
    const me = await signup();
    const other = await signup();
    const theirs = await other.uploadAsset();
    for (const id of [randomUUID(), theirs.id]) {
      const res = await me.get(`/media/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Média introuvable.');
    }
  });

  it('répond 404 pour un identifiant qui n’est pas un UUID', async () => {
    const me = await signup();
    expect((await me.get('/media/abc')).status).toBe(404);
  });

  it('répond 410 quand le fichier n’est plus sur le disque', async () => {
    const me = await signup();
    const a = await me.uploadAsset();
    await db
      .update(assets)
      .set({ filePath: `${env.DATA_DIR}/absent-${randomUUID()}.png` })
      .where(eq(assets.id, a.id));
    const res = await me.get(`/media/${a.id}`);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('Fichier absent du disque.');
  });

  describe('requêtes partielles (Range)', () => {
    async function video(me: Agent) {
      return me.uploadAsset({ mime: 'video/mp4', bytes: pattern(1000) });
    }

    it('renvoie une plage précise en 206', async () => {
      const me = await signup();
      const v = await video(me);
      const { res, bytes } = await fetchMedia(me, `/media/${v.id}`, { Range: 'bytes=100-199' });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-type')).toBe('video/mp4');
      expect(res.headers.get('content-range')).toBe('bytes 100-199/1000');
      expect(res.headers.get('content-length')).toBe('100');
      expect(bytes).toEqual(pattern(1000).slice(100, 200));
    });

    it('renvoie la fin du fichier pour une plage ouverte', async () => {
      const me = await signup();
      const v = await video(me);
      const { res, bytes } = await fetchMedia(me, `/media/${v.id}`, { Range: 'bytes=900-' });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe('bytes 900-999/1000');
      expect(bytes).toEqual(pattern(1000).slice(900));
    });

    it('ramène une fin de plage trop grande à la taille du fichier', async () => {
      const me = await signup();
      const v = await video(me);
      const { res, bytes } = await fetchMedia(me, `/media/${v.id}`, { Range: 'bytes=990-5000' });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe('bytes 990-999/1000');
      expect(bytes).toHaveLength(10);
    });

    it('répond 416 pour une plage hors du fichier ou inversée', async () => {
      const me = await signup();
      const v = await video(me);
      for (const range of ['bytes=1000-', 'bytes=5000-6000', 'bytes=500-100']) {
        const { res } = await fetchMedia(me, `/media/${v.id}`, { Range: range });
        expect(res.status, range).toBe(416);
        expect(res.headers.get('content-range')).toBe('bytes */1000');
      }
    });

    it('ignore un en-tête Range illisible et renvoie tout le fichier', async () => {
      const me = await signup();
      const v = await video(me);
      const { res, bytes } = await fetchMedia(me, `/media/${v.id}`, { Range: 'lignes=1-2' });
      expect(res.status).toBe(200);
      expect(bytes).toHaveLength(1000);
    });

    // Ancien bug (corrigé) : une plage « suffixe » (bytes=-100, les 100 derniers octets) est lue
    // comme « du début jusqu'à l'octet 100 ». Le serveur renvoie les 101 premiers
    // octets au lieu des 100 derniers.
    it('renvoie les derniers octets pour une plage suffixe', async () => {
      const me = await signup();
      const v = await video(me);
      const { res, bytes } = await fetchMedia(me, `/media/${v.id}`, { Range: 'bytes=-100' });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe('bytes 900-999/1000');
      expect(bytes).toEqual(pattern(1000).slice(900));
    });
  });
});
