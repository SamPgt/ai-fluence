import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../db/index.js';
import { assets, personas, promptPresets, threads } from '../db/schema.js';
import { SESSION_COOKIE } from '../lib/session.js';
import { FIXTURE_PNG, SEEDREAM_FLASH, call, signup, type Agent, type Res } from './helpers.js';

const ID = randomUUID();

/** Formulaire d'upload valide, recréé à chaque appel (un FormData ne se relit pas). */
function uploadForm() {
  const form = new FormData();
  form.set('file', new File([FIXTURE_PNG], 'test.png', { type: 'image/png' }));
  return form;
}

/** Chaque endpoint de l'app, avec un corps valide pour que seule la session fasse la différence. */
const PROTECTED: [method: string, path: string, body?: () => unknown][] = [
  ['PATCH', '/auth/me', () => ({ name: 'Pirate' })],
  // Paramètres
  ['GET', '/settings'],
  ['PATCH', '/settings', () => ({ enhanceModel: 'abc/def' })],
  ['PUT', '/settings/api-key', () => ({ apiKey: 'sk-spicy-test-0000000000' })],
  ['DELETE', '/settings/api-key'],
  ['POST', '/settings/open-media-dir', () => ({})],
  ['GET', '/settings/balance'],
  ['GET', '/settings/credits'],
  // Catalogue
  ['GET', '/catalog'],
  ['GET', '/catalog?refresh=1'],
  // Médias
  ['POST', '/assets', uploadForm],
  ['GET', `/assets/references?personaId=${ID}`],
  ['PUT', '/assets/references/order', () => ({ personaId: ID, ids: [ID] })],
  ['PATCH', `/assets/${ID}/reference`, () => ({ personaId: ID, isReference: true })],
  ['GET', '/assets/gallery'],
  ['GET', `/media/${ID}`],
  ['GET', `/media/${ID}?download=1`],
  // Personas
  ['GET', '/personas'],
  ['POST', '/personas', () => ({ name: 'Pirate' })],
  ['PATCH', `/personas/${ID}`, () => ({ name: 'Pirate' })],
  ['PUT', '/personas/order', () => ({ ids: [ID] })],
  ['DELETE', `/personas/${ID}`],
  // Fils
  ['GET', '/threads'],
  ['GET', '/threads?personaId=none'],
  ['GET', '/threads/search?q=pomme'],
  ['GET', `/threads/${ID}`],
  ['PATCH', `/threads/${ID}`, () => ({ title: 'Pirate' })],
  ['DELETE', `/threads/${ID}`],
  // Générations
  ['POST', '/generations/upscale/quote', () => ({ assetId: ID })],
  ['POST', '/generations/upscale', () => ({ assetId: ID })],
  ['POST', '/generations/quote', () => ({ family: SEEDREAM_FLASH, prompt: 'x' })],
  ['POST', '/generations', () => ({ family: SEEDREAM_FLASH, prompt: 'x' })],
  ['GET', `/generations/${ID}`],
  // Raccourcis
  ['GET', '/presets'],
  ['POST', '/presets', () => ({ label: 'x', text: 'y' })],
  ['PATCH', `/presets/${ID}`, () => ({ label: 'x' })],
  ['DELETE', `/presets/${ID}`],
  // Reformulation
  ['POST', '/prompts/enhance', () => ({ prompt: 'x', media: 'image' })],
  // Civitai (aucun appel réseau : la session est vérifiée avant)
  ['GET', '/civitai/status'],
  ['GET', '/civitai/search?query=test'],
  // Corbeille
  ['GET', '/trash'],
  ['POST', `/trash/personas/${ID}/restore`, () => ({})],
  ['POST', `/trash/threads/${ID}/restore`, () => ({})],
  ['DELETE', `/trash/personas/${ID}`],
  ['DELETE', `/trash/threads/${ID}`],
  ['DELETE', '/trash'],
];

const PUBLIC: [method: string, path: string, body?: unknown, status?: number][] = [
  ['GET', '/health', undefined, 200],
  ['GET', '/auth/me', undefined, 200],
  ['POST', '/auth/logout', {}, 200],
  // Corps invalide : la route répond (400) au lieu de demander une session.
  ['POST', '/auth/signup', {}, 400],
  ['POST', '/auth/login', {}, 400],
];

describe('accès sans session', () => {
  it('chaque endpoint protégé répond 401 sans session', async () => {
    const holes: string[] = [];
    for (const [method, path, body] of PROTECTED) {
      const res = await call(method, path, body?.());
      if (res.status !== 401) holes.push(`${method} ${path} : ${res.status}`);
    }
    expect(holes).toEqual([]);
  });

  it('chaque endpoint protégé répond 401 avec un cookie inventé', async () => {
    const holes: string[] = [];
    for (const [method, path, body] of PROTECTED) {
      const res = await call(method, path, body?.(), `${SESSION_COOKIE}=${'f'.repeat(64)}`);
      if (res.status !== 401) holes.push(`${method} ${path} : ${res.status}`);
    }
    expect(holes).toEqual([]);
  });

  it('chaque endpoint protégé répond 401 après une déconnexion', async () => {
    const me = await signup();
    await me.post('/auth/logout');
    const holes: string[] = [];
    for (const [method, path, body] of PROTECTED) {
      const res = await me.req(method, path, body?.());
      if (res.status !== 401) holes.push(`${method} ${path} : ${res.status}`);
    }
    expect(holes).toEqual([]);
  });

  it('le message 401 est clair', async () => {
    const res = await call('GET', '/personas');
    expect(res.body).toEqual({ error: 'Authentification requise' });
  });

  it('les endpoints publics répondent sans session', async () => {
    const holes: string[] = [];
    for (const [method, path, body, status] of PUBLIC) {
      const res = await call(method, path, body);
      if (res.status !== status) holes.push(`${method} ${path} : ${res.status} au lieu de ${status}`);
    }
    expect(holes).toEqual([]);
  });

  it('une session valide ouvre chaque endpoint protégé (aucun 401)', async () => {
    const me = await signup();
    const holes: string[] = [];
    // Les suppressions de clé et la déconnexion sont faites en dernier pour ne pas gêner les autres.
    const ordered = [...PROTECTED].sort(([m1, p1], [m2, p2]) =>
      Number(m1 === 'DELETE' && p1 === '/settings/api-key') - Number(m2 === 'DELETE' && p2 === '/settings/api-key'),
    );
    for (const [method, path, body] of ordered) {
      if (path.startsWith('/civitai/search')) continue; // appellerait Civitai pour de vrai
      const res = await me.req(method, path, body?.());
      if (res.status === 401) holes.push(`${method} ${path} : 401 avec une session valide`);
    }
    expect(holes).toEqual([]);
  });
});

// ── Isolation entre utilisateurs ──────────────────────────────

interface Seed {
  a: Agent;
  personaId: string;
  refAssetId: string;
  outputAssetId: string;
  threadId: string;
  generationId: string;
  presetId: string;
  trashedThreadId: string;
  trashedPersonaId: string;
}

/** Contenu complet de l'utilisateur A : persona, référence, génération, raccourci, corbeille. */
async function seedA(): Promise<Seed> {
  const a = await signup({ name: 'Alice' });
  const persona = await a.createPersona({ name: 'Lina' });
  const ref = await a.uploadAsset({ personaId: persona.id, isReference: true });
  const { generation, thread } = await a.generate({ personaId: persona.id, prompt: 'une pomme rouge secrète' });
  expect(generation.status).toBe('succeeded');
  const preset = (await a.post('/presets', { label: 'Secret', text: 'texte secret', personaId: persona.id })).body.preset;

  const { thread: trashed } = await a.generate({ prompt: 'fil à la corbeille' });
  expect((await a.del(`/threads/${trashed.id}`)).status).toBe(200);
  const gone = await a.createPersona({ name: 'Ancienne' });
  expect((await a.del(`/personas/${gone.id}`)).status).toBe(200);

  return {
    a,
    personaId: persona.id,
    refAssetId: ref.id,
    outputAssetId: generation.outputs[0].id,
    threadId: thread.id,
    generationId: generation.id,
    presetId: preset.id,
    trashedThreadId: trashed.id,
    trashedPersonaId: gone.id,
  };
}

const ids = (items: { id: string }[]) => items.map(i => i.id);

describe('isolation entre utilisateurs', () => {
  it("B ne peut ni lire, ni modifier, ni supprimer les éléments de A", async () => {
    const s = await seedA();
    const b = await signup({ name: 'Bob' });
    const bPersona = await b.createPersona({ name: 'Bob perso' });
    const holes: string[] = [];
    const expectStatus = (label: string, res: Res, ...allowed: number[]) => {
      if (!allowed.includes(res.status)) holes.push(`${label} : ${res.status} (attendu ${allowed.join(' ou ')})`);
    };

    // Lecture directe
    expectStatus('GET fil de A', await b.get(`/threads/${s.threadId}`), 404);
    expectStatus('GET génération de A', await b.get(`/generations/${s.generationId}`), 404);
    expectStatus('GET média de référence de A', await b.get(`/media/${s.refAssetId}`), 404);
    expectStatus('GET résultat de A', await b.get(`/media/${s.outputAssetId}`), 404);
    expectStatus('GET résultat de A en téléchargement', await b.get(`/media/${s.outputAssetId}?download=1`), 404);

    // Modification
    expectStatus('PATCH fil de A', await b.patch(`/threads/${s.threadId}`, { title: 'Pirate' }), 404);
    expectStatus('PATCH persona de A', await b.patch(`/personas/${s.personaId}`, { name: 'Pirate' }), 404);
    expectStatus('PATCH raccourci de A', await b.patch(`/presets/${s.presetId}`, { label: 'Pirate' }), 404);
    expectStatus(
      'PATCH référence de A vers un persona de B',
      await b.patch(`/assets/${s.refAssetId}/reference`, { personaId: bPersona.id, isReference: true }),
      404,
    );
    expectStatus(
      'PATCH référence de A sur le persona de A',
      await b.patch(`/assets/${s.refAssetId}/reference`, { personaId: s.personaId, isReference: false }),
      404,
    );
    expectStatus(
      'PUT ordre des références du persona de A',
      await b.put('/assets/references/order', { personaId: s.personaId, ids: [s.refAssetId] }),
      404,
    );
    expectStatus(
      'PUT ordre des références de B avec un média de A',
      await b.put('/assets/references/order', { personaId: bPersona.id, ids: [s.refAssetId] }),
      200,
    );
    expectStatus('PUT ordre des personas avec ceux de A', await b.put('/personas/order', { ids: [bPersona.id, s.personaId] }), 200);

    // Suppression
    expectStatus('DELETE fil de A', await b.del(`/threads/${s.threadId}`), 404);
    expectStatus('DELETE persona de A', await b.del(`/personas/${s.personaId}`), 404);
    // La route répond toujours ok : on vérifie l'effet plus bas.
    expectStatus('DELETE raccourci de A', await b.del(`/presets/${s.presetId}`), 200, 404);

    // Corbeille de A
    expectStatus('restaurer le fil de A', await b.post(`/trash/threads/${s.trashedThreadId}/restore`), 404);
    expectStatus('restaurer le persona de A', await b.post(`/trash/personas/${s.trashedPersonaId}/restore`), 404);
    const purgeThread = await b.del(`/trash/threads/${s.trashedThreadId}`);
    if (purgeThread.body?.threads !== 0) holes.push(`purge du fil de A : ${JSON.stringify(purgeThread.body)}`);
    const purgePersona = await b.del(`/trash/personas/${s.trashedPersonaId}`);
    if (purgePersona.body?.personas !== 0) holes.push(`purge du persona de A : ${JSON.stringify(purgePersona.body)}`);
    const purgeAll = await b.del('/trash');
    if (purgeAll.body?.personas !== 0 || purgeAll.body?.threads !== 0) {
      holes.push(`vider la corbeille de B : ${JSON.stringify(purgeAll.body)}`);
    }

    // Générations qui s'appuient sur les éléments de A
    const gen = (extra: Record<string, unknown>) => b.post('/generations', { family: SEEDREAM_FLASH, prompt: 'x', ...extra });
    expectStatus('générer dans le fil de A', await gen({ threadId: s.threadId }), 404);
    expectStatus('générer avec le persona de A', await gen({ personaId: s.personaId }), 404);
    expectStatus(
      'devis avec le persona de A',
      await b.post('/generations/quote', { family: SEEDREAM_FLASH, prompt: 'x', personaId: s.personaId }),
      404,
    );
    expectStatus('devis d’upscale du résultat de A', await b.post('/generations/upscale/quote', { assetId: s.outputAssetId }), 404);
    expectStatus('upscale du résultat de A', await b.post('/generations/upscale', { assetId: s.outputAssetId }), 404);
    const withRefs = await gen({ referenceAssetIds: [s.refAssetId, s.outputAssetId], contextIds: [s.presetId] });
    expectStatus('générer avec les médias de A', withRefs, 201);
    if (withRefs.status === 201) {
      const g = await b.waitGeneration(withRefs.body.generation.id);
      if (g.references.length) holes.push(`références de A utilisées par B : ${ids(g.references)}`);
      if (g.contexts.length) holes.push(`raccourcis de A utilisés par B : ${JSON.stringify(g.contexts)}`);
      if (g.finalPrompt.includes('texte secret')) holes.push('texte du raccourci de A dans le prompt de B');
    }

    // Rattachements aux éléments de A
    expectStatus('persona de B avec l’avatar de A', await b.post('/personas', { name: 'X', avatarAssetId: s.refAssetId }), 400);
    expectStatus(
      'PATCH persona de B avec l’avatar de A',
      await b.patch(`/personas/${bPersona.id}`, { avatarAssetId: s.refAssetId }),
      400,
    );
    expectStatus('raccourci de B sur le persona de A', await b.post('/presets', { label: 'x', text: 'y', personaId: s.personaId }), 404);
    expectStatus('photo de profil de B avec l’image de A', await b.patch('/auth/me', { avatarAssetId: s.refAssetId }), 400);
    const form = new FormData();
    form.set('file', new File([FIXTURE_PNG], 'test.png', { type: 'image/png' }));
    form.set('personaId', s.personaId);
    form.set('isReference', 'true');
    const upload = await b.req('POST', '/assets', form);
    expectStatus('upload de B sur le persona de A', upload, 201);
    if (upload.status === 201) {
      const [row] = await db.select().from(assets).where(eq(assets.id, upload.body.asset.id));
      if (row.personaId !== null || row.isReference) holes.push('le média de B est rangé dans le persona de A');
    }

    // Listes de B : rien de A
    const aIds = new Set([
      s.personaId,
      s.refAssetId,
      s.outputAssetId,
      s.threadId,
      s.generationId,
      s.presetId,
      s.trashedThreadId,
      s.trashedPersonaId,
    ]);
    const leaks = (label: string, res: Res) => {
      const text = JSON.stringify(res.body);
      for (const id of aIds) if (text.includes(id)) holes.push(`${label} contient ${id}`);
      if (text.includes('secrète') || text.includes('texte secret')) holes.push(`${label} contient un texte de A`);
    };
    leaks('GET /personas', await b.get('/personas'));
    leaks('GET /threads', await b.get('/threads'));
    leaks('GET /threads?personaId', await b.get(`/threads?personaId=${s.personaId}`));
    leaks('GET /threads/search', await b.get('/threads/search?q=pomme'));
    leaks('GET /presets', await b.get('/presets'));
    leaks('GET /assets/gallery', await b.get('/assets/gallery'));
    leaks('GET /assets/gallery?personaId', await b.get(`/assets/gallery?personaId=${s.personaId}`));
    leaks('GET /assets/references', await b.get(`/assets/references?personaId=${s.personaId}`));
    leaks('GET /trash', await b.get('/trash'));
    leaks('GET /settings/credits', await b.get('/settings/credits'));

    // Côté A : tout est intact
    const thread = await s.a.get(`/threads/${s.threadId}`);
    if (thread.status !== 200 || thread.body.thread.title === 'Pirate') holes.push('le fil de A a changé');
    const aPersonas = (await s.a.get('/personas')).body.personas;
    const lina = aPersonas.find((p: { id: string }) => p.id === s.personaId);
    if (!lina || lina.name !== 'Lina') holes.push('le persona de A a changé');
    const [linaRow] = await db.select().from(personas).where(eq(personas.id, s.personaId));
    if (linaRow.position !== 0) holes.push(`position du persona de A changée : ${linaRow.position}`);
    const [preset] = await db.select().from(promptPresets).where(eq(promptPresets.id, s.presetId));
    if (!preset) holes.push('le raccourci de A a été supprimé par B');
    else if (preset.label !== 'Secret') holes.push('le raccourci de A a changé');
    const [refRow] = await db.select().from(assets).where(eq(assets.id, s.refAssetId));
    if (refRow.personaId !== s.personaId || !refRow.isReference || refRow.referencePosition !== null) {
      holes.push(`la référence de A a changé : ${JSON.stringify(refRow)}`);
    }
    if ((await s.a.get(`/media/${s.outputAssetId}`)).status !== 200) holes.push('le résultat de A n’est plus servi');
    const trash = (await s.a.get('/trash')).body;
    if (!ids(trash.threads).includes(s.trashedThreadId)) holes.push('le fil à la corbeille de A a disparu');
    if (!ids(trash.personas).includes(s.trashedPersonaId)) holes.push('le persona à la corbeille de A a disparu');

    expect(holes).toEqual([]);
  });

  // Ancien bug (corrigé) : PATCH /threads/:id accepte n'importe quel `personaId` sans vérifier qu'il
  // appartient à l'utilisateur. B peut donc rattacher son fil au persona de A, et quand
  // A met ce persona à la corbeille, `trashPersona` (qui ne filtre pas sur l'utilisateur)
  // envoie aussi le fil de B à la corbeille. Attendu : 404 « Persona introuvable ».
  it("B ne peut pas rattacher son fil au persona de A", async () => {
    const s = await seedA();
    const b = await signup();
    const { thread } = await b.generate();
    const res = await b.patch(`/threads/${thread.id}`, { personaId: s.personaId });
    expect([400, 404]).toContain(res.status);
    const [row] = await db.select().from(threads).where(eq(threads.id, thread.id));
    expect(row.personaId).toBeNull();
  });

  it('un identifiant qui n’est pas un UUID répond 404 sans faire planter la base', async () => {
    const me = await signup();
    const holes: string[] = [];
    for (const path of ['/threads/abc', '/generations/abc', '/media/abc', '/personas/abc', '/presets/abc', '/assets/abc/reference']) {
      const res = await me.req(path === '/assets/abc/reference' ? 'PATCH' : 'GET', path, path === '/assets/abc/reference' ? { personaId: ID, isReference: true } : undefined);
      if (res.status !== 404) holes.push(`${path} : ${res.status}`);
    }
    for (const path of ['/trash/threads/abc/restore', '/trash/personas/abc/restore']) {
      const res = await me.post(path);
      if (res.status !== 404) holes.push(`${path} : ${res.status}`);
    }
    expect(holes).toEqual([]);
  });
});
