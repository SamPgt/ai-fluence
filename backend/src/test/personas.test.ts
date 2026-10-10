import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CONTEXT_BLOCK_MAX, type Persona } from '@ai-fluence/shared';
import { call, signup, SEEDANCE_MINI, SEEDREAM_FLASH } from './helpers.js';

const LORA = {
  label: 'Visage',
  path: 'https://exemple.test/lora.safetensors',
  scale: 0.8,
  family: SEEDREAM_FLASH,
};

describe('personas : accès sans session', () => {
  it('chaque route répond 401 sans session', async () => {
    const id = randomUUID();
    expect((await call('GET', '/personas')).status).toBe(401);
    expect((await call('POST', '/personas', { name: 'A' })).status).toBe(401);
    expect((await call('PATCH', `/personas/${id}`, { name: 'A' })).status).toBe(401);
    expect((await call('PUT', '/personas/order', { ids: [] })).status).toBe(401);
    expect((await call('DELETE', `/personas/${id}`)).status).toBe(401);
  });
});

describe('GET /personas', () => {
  it('renvoie une liste vide pour un nouvel utilisateur', async () => {
    const me = await signup();
    const res = await me.get('/personas');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ personas: [] });
  });

  it('ne renvoie que les personas de l’utilisateur connecté', async () => {
    const me = await signup();
    const other = await signup();
    await me.createPersona({ name: 'Moi' });
    await other.createPersona({ name: 'Autre' });
    const res = await me.get('/personas');
    expect(res.body.personas.map((p: Persona) => p.name)).toEqual(['Moi']);
  });

  it('trie les personas par ordre de création', async () => {
    const me = await signup();
    for (const name of ['A', 'B', 'C']) await me.createPersona({ name });
    const res = await me.get('/personas');
    expect(res.body.personas.map((p: Persona) => p.name)).toEqual(['A', 'B', 'C']);
  });

  it('compte uniquement les références du persona', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Réf' });
    const q = await me.createPersona({ name: 'Autre' });
    await me.uploadAsset({ personaId: p.id, isReference: true });
    await me.uploadAsset({ personaId: p.id, isReference: true });
    // Média du persona qui n'est pas une référence : non compté.
    await me.uploadAsset({ personaId: p.id });
    await me.uploadAsset({ personaId: q.id, isReference: true });
    const list = (await me.get('/personas')).body.personas as Persona[];
    expect(list.find(x => x.id === p.id)!.referenceCount).toBe(2);
    expect(list.find(x => x.id === q.id)!.referenceCount).toBe(1);
  });
});

describe('POST /personas', () => {
  it('crée un persona avec les valeurs par défaut', async () => {
    const me = await signup();
    const res = await me.post('/personas', { name: '  Léa  ' });
    expect(res.status).toBe(201);
    const p = res.body.persona as Persona;
    expect(p).toMatchObject({
      name: 'Léa',
      color: '#8b5cf6',
      avatarAssetId: null,
      avatarUrl: null,
      contextBlocks: [],
      loras: [],
      defaultImageFamily: null,
      defaultVideoFamily: null,
      referenceCount: 0,
    });
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof p.createdAt).toBe('string');
  });

  it('enregistre tous les champs fournis et attribue des id aux LoRA et aux blocs', async () => {
    const me = await signup();
    const avatar = await me.uploadAsset();
    const p = await me.createPersona({
      name: 'Complet',
      color: '#ABCDEF',
      avatarAssetId: avatar.id,
      contextBlocks: [{ title: 'Physique', text: 'cheveux bruns' } as never],
      loras: [{ ...LORA, triggerWords: ['lea_face'] } as never],
      defaultImageFamily: SEEDREAM_FLASH,
      defaultVideoFamily: SEEDANCE_MINI,
    });
    expect(p.color).toBe('#ABCDEF');
    expect(p.avatarAssetId).toBe(avatar.id);
    expect(p.avatarUrl).toBe(`/api/media/${avatar.id}`);
    expect(p.defaultImageFamily).toBe(SEEDREAM_FLASH);
    expect(p.defaultVideoFamily).toBe(SEEDANCE_MINI);
    expect(p.contextBlocks).toHaveLength(1);
    expect(p.contextBlocks[0]).toMatchObject({ title: 'Physique', text: 'cheveux bruns' });
    expect(p.contextBlocks[0].id).toBeTruthy();
    expect(p.loras).toHaveLength(1);
    expect(p.loras[0]).toMatchObject({ ...LORA, triggerWords: ['lea_face'] });
    expect(p.loras[0].id).toBeTruthy();
  });

  it('conserve l’id fourni pour une LoRA et un bloc', async () => {
    const me = await signup();
    const p = await me.createPersona({
      name: 'Ids',
      contextBlocks: [{ id: 'bloc-1', title: 'T', text: 'x' }],
      loras: [{ ...LORA, id: 'lora-1', triggerWords: [] }],
    });
    expect(p.contextBlocks[0].id).toBe('bloc-1');
    expect(p.loras[0].id).toBe('lora-1');
  });

  it('applique les valeurs par défaut d’une LoRA (libellé, échelle, mots)', async () => {
    const me = await signup();
    const p = await me.createPersona({
      name: 'Défauts',
      loras: [{ path: LORA.path, family: SEEDREAM_FLASH } as never],
    });
    expect(p.loras[0]).toMatchObject({ label: '', scale: 1, triggerWords: [] });
  });

  it('accepte les champs optionnels d’une LoRA (bruit, mots masqués, aperçu, groupe)', async () => {
    const me = await signup();
    const lora = {
      ...LORA,
      noise: 'high',
      triggerWords: ['a', 'b'],
      hiddenWords: ['b'],
      previewUrl: 'https://exemple.test/apercu.jpg',
      sourceUrl: 'https://civitai.test/models/1',
      group: {
        key: 'civitai-1',
        available: [{ family: SEEDREAM_FLASH, files: [{ url: 'https://exemple.test/a.safetensors', noise: 'low' }], triggerWords: ['a'] }],
      },
    };
    const p = await me.createPersona({ name: 'LoRA', loras: [lora as never] });
    expect(p.loras[0]).toMatchObject(lora);
  });

  it('place les nouveaux personas à la fin', async () => {
    const me = await signup();
    await me.createPersona({ name: 'Premier' });
    const res = await me.post('/personas', { name: 'Second' });
    const list = (await me.get('/personas')).body.personas as Persona[];
    expect(list.at(-1)!.id).toBe(res.body.persona.id);
  });

  it.each([
    ['nom absent', {}],
    ['nom vide', { name: '' }],
    ['nom fait d’espaces', { name: '   ' }],
    ['nom trop long', { name: 'x'.repeat(41) }],
    ['couleur sans dièse', { name: 'A', color: '8b5cf6' }],
    ['couleur trop courte', { name: 'A', color: '#fff' }],
    ['couleur non hexadécimale', { name: 'A', color: '#zzzzzz' }],
    ['avatar qui n’est pas un uuid', { name: 'A', avatarAssetId: 'abc' }],
    ['trop de blocs de contexte', { name: 'A', contextBlocks: Array.from({ length: 11 }, () => ({ title: 't', text: 'x' })) }],
    ['bloc de contexte trop long', { name: 'A', contextBlocks: [{ title: 't', text: 'x'.repeat(CONTEXT_BLOCK_MAX + 1) }] }],
    ['titre de bloc trop long', { name: 'A', contextBlocks: [{ title: 'x'.repeat(61), text: 'x' }] }],
    ['trop de LoRA', { name: 'A', loras: Array.from({ length: 13 }, () => LORA) }],
    ['LoRA sans lien', { name: 'A', loras: [{ ...LORA, path: undefined }] }],
    ['LoRA en http', { name: 'A', loras: [{ ...LORA, path: 'http://exemple.test/lora.safetensors' }] }],
    ['LoRA avec un lien invalide', { name: 'A', loras: [{ ...LORA, path: 'pas un lien' }] }],
    ['LoRA sans famille', { name: 'A', loras: [{ ...LORA, family: undefined }] }],
    ['LoRA avec une famille trop courte', { name: 'A', loras: [{ ...LORA, family: 'ab' }] }],
    ['LoRA avec une échelle négative', { name: 'A', loras: [{ ...LORA, scale: -0.1 }] }],
    ['LoRA avec une échelle trop grande', { name: 'A', loras: [{ ...LORA, scale: 4.1 }] }],
    ['LoRA avec un libellé trop long', { name: 'A', loras: [{ ...LORA, label: 'x'.repeat(61) }] }],
    ['LoRA avec un bruit inconnu', { name: 'A', loras: [{ ...LORA, noise: 'medium' }] }],
    ['LoRA avec trop de mots déclencheurs', { name: 'A', loras: [{ ...LORA, triggerWords: Array.from({ length: 21 }, (_, i) => `m${i}`) }] }],
    ['LoRA avec un mot déclencheur vide', { name: 'A', loras: [{ ...LORA, triggerWords: ['  '] }] }],
    ['LoRA avec un mot déclencheur trop long', { name: 'A', loras: [{ ...LORA, triggerWords: ['x'.repeat(61)] }] }],
    ['LoRA avec trop de mots masqués', { name: 'A', loras: [{ ...LORA, hiddenWords: Array.from({ length: 21 }, (_, i) => `m${i}`) }] }],
    ['LoRA avec un aperçu en http', { name: 'A', loras: [{ ...LORA, previewUrl: 'http://exemple.test/a.jpg' }] }],
    ['LoRA avec une source en http', { name: 'A', loras: [{ ...LORA, sourceUrl: 'http://civitai.test/1' }] }],
    [
      'LoRA avec un fichier de groupe en http',
      { name: 'A', loras: [{ ...LORA, group: { key: 'k', available: [{ family: SEEDREAM_FLASH, files: [{ url: 'http://x.test/a' }], triggerWords: [] }] } }] },
    ],
    [
      'LoRA avec trop de fichiers dans un groupe',
      {
        name: 'A',
        loras: [
          {
            ...LORA,
            group: {
              key: 'k',
              available: [{ family: SEEDREAM_FLASH, files: Array.from({ length: 5 }, () => ({ url: 'https://x.test/a' })), triggerWords: [] }],
            },
          },
        ],
      },
    ],
    ['modèle image par défaut qui n’est pas une chaîne', { name: 'A', defaultImageFamily: 42 }],
    ['modèle vidéo par défaut qui n’est pas une chaîne', { name: 'A', defaultVideoFamily: true }],
  ])('refuse la création (400) : %s', async (_label, body) => {
    const me = await signup();
    const res = await me.post('/personas', body);
    expect(res.status).toBe(400);
    expect((await me.get('/personas')).body.personas).toEqual([]);
  });

  it('accepte exactement 10 blocs, 12 LoRA, 40 caractères et une échelle de 4', async () => {
    const me = await signup();
    const res = await me.post('/personas', {
      name: 'x'.repeat(40),
      contextBlocks: Array.from({ length: 10 }, () => ({ title: 't', text: 'x'.repeat(CONTEXT_BLOCK_MAX) })),
      loras: Array.from({ length: 12 }, () => ({ ...LORA, scale: 4 })),
    });
    expect(res.status).toBe(201);
    expect(res.body.persona.contextBlocks).toHaveLength(10);
    expect(res.body.persona.loras).toHaveLength(12);
  });

  it('refuse un avatar inconnu (400)', async () => {
    const me = await signup();
    const res = await me.post('/personas', { name: 'A', avatarAssetId: randomUUID() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Avatar introuvable.');
  });

  it('refuse l’avatar d’un autre utilisateur (400)', async () => {
    const me = await signup();
    const other = await signup();
    const avatar = await other.uploadAsset();
    const res = await me.post('/personas', { name: 'A', avatarAssetId: avatar.id });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /personas/:id', () => {
  async function setup() {
    const me = await signup();
    const avatar = await me.uploadAsset();
    const persona = await me.createPersona({
      name: 'Léa',
      color: '#112233',
      avatarAssetId: avatar.id,
      contextBlocks: [{ id: 'b1', title: 'Physique', text: 'brune' }],
      loras: [{ ...LORA, id: 'l1', triggerWords: ['lea'] }],
      defaultImageFamily: SEEDREAM_FLASH,
      defaultVideoFamily: SEEDANCE_MINI,
    });
    return { me, avatar, persona };
  }

  // Ancien bug (corrigé) : le schéma partiel garde les `.default()` de zod. Un champ absent du corps
  // reçoit donc sa valeur par défaut (couleur violette, LoRA, blocs et modèles vidés,
  // avatar retiré) au lieu d'être conservé. Le front envoie la fiche entière, ce qui masque le bug.
  it('modifie le nom sans toucher aux autres champs', async () => {
    const { me, persona } = await setup();
    const res = await me.patch(`/personas/${persona.id}`, { name: 'Léa 2' });
    expect(res.status).toBe(200);
    const { name, updatedAt, ...rest } = res.body.persona as Persona;
    const { name: _n, updatedAt: _u, ...before } = persona;
    expect(name).toBe('Léa 2');
    expect(rest).toEqual(before);
    expect(new Date(updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(persona.updatedAt).getTime());
  });

  // Ancien bug (corrigé) : le schéma partiel garde les `.default()` de zod. Un champ absent du corps
  // reçoit donc sa valeur par défaut (couleur violette, LoRA, blocs et modèles vidés,
  // avatar retiré) au lieu d'être conservé. Le front envoie la fiche entière, ce qui masque le bug.
  it('modifie la couleur seule', async () => {
    const { me, persona } = await setup();
    const res = await me.patch(`/personas/${persona.id}`, { color: '#ffffff' });
    expect(res.body.persona.color).toBe('#ffffff');
    expect(res.body.persona.name).toBe('Léa');
    expect(res.body.persona.loras).toHaveLength(1);
  });

  // Ancien bug (corrigé) : le schéma partiel garde les `.default()` de zod. Un champ absent du corps
  // reçoit donc sa valeur par défaut (couleur violette, LoRA, blocs et modèles vidés,
  // avatar retiré) au lieu d'être conservé. Le front envoie la fiche entière, ce qui masque le bug.
  it('accepte un corps vide et ne change rien', async () => {
    const { me, persona } = await setup();
    const res = await me.patch(`/personas/${persona.id}`, {});
    expect(res.status).toBe(200);
    expect(res.body.persona).toMatchObject({ name: 'Léa', color: '#112233', loras: persona.loras, contextBlocks: persona.contextBlocks });
  });

  it('remplace les LoRA avec mots déclencheurs et mots masqués', async () => {
    const { me, persona } = await setup();
    const res = await me.patch(`/personas/${persona.id}`, {
      loras: [
        { ...LORA, id: 'l1', triggerWords: ['lea', 'lea_smile'], hiddenWords: ['lea_smile'] },
        { ...LORA, label: 'Tenue', path: 'https://exemple.test/tenue.safetensors' },
      ],
    });
    expect(res.status).toBe(200);
    const loras = res.body.persona.loras as Persona['loras'];
    expect(loras).toHaveLength(2);
    expect(loras[0]).toMatchObject({ id: 'l1', triggerWords: ['lea', 'lea_smile'], hiddenWords: ['lea_smile'] });
    expect(loras[1]).toMatchObject({ label: 'Tenue', triggerWords: [] });
    expect(loras[1].id).toBeTruthy();
    expect(loras[1].id).not.toBe('l1');
    // Persisté.
    const list = (await me.get('/personas')).body.personas as Persona[];
    expect(list[0].loras).toEqual(loras);
  });

  it('vide les LoRA avec une liste vide', async () => {
    const { me, persona } = await setup();
    const res = await me.patch(`/personas/${persona.id}`, { loras: [] });
    expect(res.body.persona.loras).toEqual([]);
  });

  it('remplace les blocs de contexte et garde leurs id', async () => {
    const { me, persona } = await setup();
    const res = await me.patch(`/personas/${persona.id}`, {
      contextBlocks: [
        { id: 'b1', title: 'Physique', text: 'blonde' },
        { title: 'Style', text: 'streetwear' },
      ],
    });
    const blocks = res.body.persona.contextBlocks as Persona['contextBlocks'];
    expect(blocks[0]).toEqual({ id: 'b1', title: 'Physique', text: 'blonde' });
    expect(blocks[1]).toMatchObject({ title: 'Style', text: 'streetwear' });
    expect(blocks[1].id).toBeTruthy();
  });

  // Ancien bug (corrigé) : le schéma partiel garde les `.default()` de zod. Un champ absent du corps
  // reçoit donc sa valeur par défaut (couleur violette, LoRA, blocs et modèles vidés,
  // avatar retiré) au lieu d'être conservé. Le front envoie la fiche entière, ce qui masque le bug.
  it('change le modèle image par défaut sans effacer le modèle vidéo', async () => {
    const { me, persona } = await setup();
    const changed = await me.patch(`/personas/${persona.id}`, { defaultImageFamily: 'openai/gpt-image-2.5-sunburst' });
    expect(changed.body.persona.defaultImageFamily).toBe('openai/gpt-image-2.5-sunburst');
    expect(changed.body.persona.defaultVideoFamily).toBe(SEEDANCE_MINI);
  });

  it('change puis efface les modèles par défaut', async () => {
    const { me, persona } = await setup();
    const changed = await me.patch(`/personas/${persona.id}`, {
      defaultImageFamily: 'openai/gpt-image-2.5-sunburst',
      defaultVideoFamily: SEEDANCE_MINI,
    });
    expect(changed.body.persona.defaultImageFamily).toBe('openai/gpt-image-2.5-sunburst');
    expect(changed.body.persona.defaultVideoFamily).toBe(SEEDANCE_MINI);
    const cleared = await me.patch(`/personas/${persona.id}`, { defaultImageFamily: null, defaultVideoFamily: null });
    expect(cleared.body.persona.defaultImageFamily).toBeNull();
    expect(cleared.body.persona.defaultVideoFamily).toBeNull();
  });

  it('change puis retire l’avatar', async () => {
    const { me, persona } = await setup();
    const next = await me.uploadAsset({ personaId: persona.id });
    const changed = await me.patch(`/personas/${persona.id}`, { avatarAssetId: next.id });
    expect(changed.body.persona.avatarAssetId).toBe(next.id);
    expect(changed.body.persona.avatarUrl).toBe(`/api/media/${next.id}`);
    const removed = await me.patch(`/personas/${persona.id}`, { avatarAssetId: null });
    expect(removed.body.persona.avatarAssetId).toBeNull();
    expect(removed.body.persona.avatarUrl).toBeNull();
  });

  it('renvoie le nombre de références à jour', async () => {
    const { me, persona } = await setup();
    await me.uploadAsset({ personaId: persona.id, isReference: true });
    const res = await me.patch(`/personas/${persona.id}`, { name: 'X' });
    expect(res.body.persona.referenceCount).toBe(1);
  });

  it('refuse un avatar inconnu ou d’un autre utilisateur (400)', async () => {
    const { me, persona } = await setup();
    const other = await signup();
    const foreign = await other.uploadAsset();
    expect((await me.patch(`/personas/${persona.id}`, { avatarAssetId: randomUUID() })).status).toBe(400);
    expect((await me.patch(`/personas/${persona.id}`, { avatarAssetId: foreign.id })).status).toBe(400);
  });

  it.each([
    ['nom vide', { name: '' }],
    ['nom trop long', { name: 'x'.repeat(41) }],
    ['couleur invalide', { color: 'rouge' }],
    ['LoRA en http', { loras: [{ ...LORA, path: 'http://exemple.test/a.safetensors' }] }],
    ['mot masqué vide', { loras: [{ ...LORA, hiddenWords: [''] }] }],
    ['trop de blocs', { contextBlocks: Array.from({ length: 11 }, () => ({ text: 'x' })) }],
    ['bloc trop long', { contextBlocks: [{ text: 'x'.repeat(CONTEXT_BLOCK_MAX + 1) }] }],
  ])('refuse la modification (400) : %s', async (_label, body) => {
    const { me, persona } = await setup();
    const res = await me.patch(`/personas/${persona.id}`, body);
    expect(res.status).toBe(400);
    const after = (await me.get('/personas')).body.personas[0] as Persona;
    expect(after).toEqual(persona);
  });

  it('répond 404 pour un persona inconnu', async () => {
    const me = await signup();
    const res = await me.patch(`/personas/${randomUUID()}`, { name: 'X' });
    expect(res.status).toBe(404);
  });

  it('répond 404 pour un id qui n’est pas un uuid', async () => {
    const me = await signup();
    expect((await me.patch('/personas/pas-un-uuid', { name: 'X' })).status).toBe(404);
  });

  it('répond 404 pour le persona d’un autre utilisateur et ne le modifie pas', async () => {
    const { me, persona } = await setup();
    const other = await signup();
    expect((await other.patch(`/personas/${persona.id}`, { name: 'Volé' })).status).toBe(404);
    expect((await me.get('/personas')).body.personas[0].name).toBe('Léa');
  });

  it('répond 404 pour un persona à la corbeille', async () => {
    const { me, persona } = await setup();
    await me.del(`/personas/${persona.id}`);
    expect((await me.patch(`/personas/${persona.id}`, { name: 'X' })).status).toBe(404);
  });
});

describe('PUT /personas/order', () => {
  it('range les personas dans l’ordre des ids', async () => {
    const me = await signup();
    const a = await me.createPersona({ name: 'A' });
    const b = await me.createPersona({ name: 'B' });
    const c = await me.createPersona({ name: 'C' });
    const res = await me.put('/personas/order', { ids: [c.id, a.id, b.id] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const list = (await me.get('/personas')).body.personas as Persona[];
    expect(list.map(p => p.name)).toEqual(['C', 'A', 'B']);
  });

  it('accepte une liste vide', async () => {
    const me = await signup();
    expect((await me.put('/personas/order', { ids: [] })).status).toBe(200);
  });

  it('ignore les personas d’un autre utilisateur', async () => {
    const me = await signup();
    const other = await signup();
    const x = await other.createPersona({ name: 'X' });
    const y = await other.createPersona({ name: 'Y' });
    const mine = await me.createPersona({ name: 'M' });
    const res = await me.put('/personas/order', { ids: [y.id, mine.id, x.id] });
    expect(res.status).toBe(200);
    const list = (await other.get('/personas')).body.personas as Persona[];
    expect(list.map(p => p.name)).toEqual(['X', 'Y']);
  });

  it.each([
    ['ids absent', {}],
    ['id qui n’est pas un uuid', { ids: ['abc'] }],
    ['ids qui n’est pas une liste', { ids: 'abc' }],
    ['plus de 200 ids', { ids: Array.from({ length: 201 }, () => randomUUID()) }],
  ])('refuse un ordre invalide (400) : %s', async (_label, body) => {
    const me = await signup();
    expect((await me.put('/personas/order', body)).status).toBe(400);
  });
});

describe('DELETE /personas/:id', () => {
  it('met le persona et ses fils à la corbeille, sans toucher aux autres fils', async () => {
    const me = await signup();
    const lea = await me.createPersona({ name: 'Léa' });
    const zoe = await me.createPersona({ name: 'Zoé' });
    const { thread: leaThread } = await me.generate({ personaId: lea.id });
    const { thread: zoeThread } = await me.generate({ personaId: zoe.id });
    const { thread: freeThread } = await me.generate();

    const res = await me.del(`/personas/${lea.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const personas = (await me.get('/personas')).body.personas as Persona[];
    expect(personas.map(p => p.id)).toEqual([zoe.id]);

    const threads = (await me.get('/threads')).body.threads as { id: string }[];
    expect(threads.map(t => t.id).sort()).toEqual([zoeThread.id, freeThread.id].sort());
    expect((await me.get(`/threads/${leaThread.id}`)).status).toBe(404);
    expect((await me.get(`/threads?personaId=${lea.id}`)).body.threads).toEqual([]);

    const trash = (await me.get('/trash')).body;
    expect(trash.personas.map((p: { id: string }) => p.id)).toEqual([lea.id]);
    expect(trash.personas[0].threadCount).toBe(1);
    // Le fil est rangé sous son persona, pas listé à part.
    expect(trash.threads).toEqual([]);
  });

  it('répond 404 la deuxième fois', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'A' });
    expect((await me.del(`/personas/${p.id}`)).status).toBe(200);
    expect((await me.del(`/personas/${p.id}`)).status).toBe(404);
  });

  it('répond 404 pour un persona inconnu ou un id invalide', async () => {
    const me = await signup();
    expect((await me.del(`/personas/${randomUUID()}`)).status).toBe(404);
    expect((await me.del('/personas/pas-un-uuid')).status).toBe(404);
  });

  it('répond 404 pour le persona d’un autre utilisateur et ne le supprime pas', async () => {
    const me = await signup();
    const other = await signup();
    const p = await other.createPersona({ name: 'A' });
    expect((await me.del(`/personas/${p.id}`)).status).toBe(404);
    expect((await other.get('/personas')).body.personas).toHaveLength(1);
  });
});
