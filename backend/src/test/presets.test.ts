import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PromptPreset } from '@ai-fluence/shared';
import { call, signup } from './helpers.js';

const PRESET = { label: 'Plage', text: 'on a sunny beach' };

describe('raccourcis : accès sans session', () => {
  it('chaque route répond 401 sans session', async () => {
    const id = randomUUID();
    expect((await call('GET', '/presets')).status).toBe(401);
    expect((await call('POST', '/presets', PRESET)).status).toBe(401);
    expect((await call('PATCH', `/presets/${id}`, { label: 'x' })).status).toBe(401);
    expect((await call('DELETE', `/presets/${id}`)).status).toBe(401);
  });
});

describe('GET /presets', () => {
  it('renvoie les 8 raccourcis par défaut après l’inscription, dans l’ordre', async () => {
    const me = await signup();
    const res = await me.get('/presets');
    expect(res.status).toBe(200);
    const presets = res.body.presets as PromptPreset[];
    expect(presets.map(p => p.label)).toEqual([
      'Photo iPhone',
      'Lumière dorée',
      'Studio',
      'Ciné 35mm',
      'Selfie miroir',
      'Travelling',
      'Plan drone',
      'Anime',
    ]);
    expect(presets.map(p => p.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(presets.map(p => p.media)).toEqual(['image', 'all', 'image', 'all', 'image', 'video', 'video', 'all']);
    for (const p of presets) {
      expect(p.enabled).toBe(true);
      expect(p.personaId).toBeNull();
      expect(p.text.length).toBeGreaterThan(0);
      expect(Object.keys(p).sort()).toEqual(['enabled', 'id', 'label', 'media', 'personaId', 'position', 'text']);
    }
  });

  it('ne renvoie que les raccourcis de l’utilisateur connecté', async () => {
    const me = await signup();
    const other = await signup();
    await other.post('/presets', { label: 'Secret', text: 'secret' });
    const mine = (await me.get('/presets')).body.presets as PromptPreset[];
    expect(mine).toHaveLength(8);
    expect(mine.some(p => p.label === 'Secret')).toBe(false);
  });
});

describe('POST /presets', () => {
  it('crée un raccourci avec les valeurs par défaut, placé à la fin', async () => {
    const me = await signup();
    const res = await me.post('/presets', { label: '  Plage ', text: ' on a sunny beach ' });
    expect(res.status).toBe(201);
    expect(res.body.preset).toMatchObject({
      label: 'Plage',
      text: 'on a sunny beach',
      media: 'all',
      enabled: true,
      personaId: null,
      position: 8,
    });
    const list = (await me.get('/presets')).body.presets as PromptPreset[];
    expect(list.at(-1)!.id).toBe(res.body.preset.id);
  });

  it.each(['all', 'image', 'video'] as const)('accepte le média « %s »', async media => {
    const me = await signup();
    const res = await me.post('/presets', { ...PRESET, media });
    expect(res.status).toBe(201);
    expect(res.body.preset.media).toBe(media);
  });

  it('crée un raccourci désactivé', async () => {
    const me = await signup();
    const res = await me.post('/presets', { ...PRESET, enabled: false });
    expect(res.status).toBe(201);
    expect(res.body.preset.enabled).toBe(false);
  });

  it('rattache un raccourci à un persona de l’utilisateur', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Léa' });
    const res = await me.post('/presets', { ...PRESET, personaId: p.id });
    expect(res.status).toBe(201);
    expect(res.body.preset.personaId).toBe(p.id);
    const list = (await me.get('/presets')).body.presets as PromptPreset[];
    expect(list.find(x => x.id === res.body.preset.id)!.personaId).toBe(p.id);
  });

  it('accepte personaId à null', async () => {
    const me = await signup();
    const res = await me.post('/presets', { ...PRESET, personaId: null });
    expect(res.status).toBe(201);
    expect(res.body.preset.personaId).toBeNull();
  });

  it('accepte 40 caractères de libellé et 1000 de texte', async () => {
    const me = await signup();
    const res = await me.post('/presets', { label: 'x'.repeat(40), text: 'y'.repeat(1000) });
    expect(res.status).toBe(201);
  });

  it('répond 404 pour un persona inconnu', async () => {
    const me = await signup();
    const res = await me.post('/presets', { ...PRESET, personaId: randomUUID() });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Persona introuvable.');
    expect((await me.get('/presets')).body.presets).toHaveLength(8);
  });

  it('répond 404 pour le persona d’un autre utilisateur', async () => {
    const me = await signup();
    const other = await signup();
    const p = await other.createPersona({ name: 'Autre' });
    const res = await me.post('/presets', { ...PRESET, personaId: p.id });
    expect(res.status).toBe(404);
    expect((await me.get('/presets')).body.presets).toHaveLength(8);
  });

  it.each([
    ['libellé absent', { text: 'x' }],
    ['libellé vide', { label: '  ', text: 'x' }],
    ['libellé trop long', { label: 'x'.repeat(41), text: 'x' }],
    ['texte absent', { label: 'x' }],
    ['texte vide', { label: 'x', text: '   ' }],
    ['texte trop long', { label: 'x', text: 'y'.repeat(1001) }],
    ['média inconnu', { ...PRESET, media: 'audio' }],
    ['enabled qui n’est pas un booléen', { ...PRESET, enabled: 'oui' }],
    ['personaId qui n’est pas un uuid', { ...PRESET, personaId: 'abc' }],
  ])('refuse la création (400) : %s', async (_label, body) => {
    const me = await signup();
    expect((await me.post('/presets', body)).status).toBe(400);
    expect((await me.get('/presets')).body.presets).toHaveLength(8);
  });
});

describe('PATCH /presets/:id', () => {
  async function setup() {
    const me = await signup();
    const preset = (await me.post('/presets', { ...PRESET, media: 'image' })).body.preset as PromptPreset;
    return { me, preset };
  }

  it('modifie chaque champ séparément', async () => {
    const { me, preset } = await setup();
    let res = await me.patch(`/presets/${preset.id}`, { label: ' Mer ' });
    expect(res.status).toBe(200);
    expect(res.body.preset).toMatchObject({ label: 'Mer', text: PRESET.text, media: 'image', enabled: true });
    res = await me.patch(`/presets/${preset.id}`, { text: 'at the sea' });
    expect(res.body.preset).toMatchObject({ label: 'Mer', text: 'at the sea' });
    res = await me.patch(`/presets/${preset.id}`, { media: 'video' });
    expect(res.body.preset.media).toBe('video');
    res = await me.patch(`/presets/${preset.id}`, { enabled: false });
    expect(res.body.preset).toMatchObject({ label: 'Mer', text: 'at the sea', media: 'video', enabled: false });
    const stored = ((await me.get('/presets')).body.presets as PromptPreset[]).find(p => p.id === preset.id);
    expect(stored).toEqual(res.body.preset);
  });

  it('ne modifie pas le persona rattaché', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Léa' });
    const preset = (await me.post('/presets', { ...PRESET, personaId: p.id })).body.preset as PromptPreset;
    const res = await me.patch(`/presets/${preset.id}`, { label: 'Autre', personaId: null });
    expect(res.status).toBe(200);
    expect(res.body.preset.personaId).toBe(p.id);
  });

  it('modifie aussi un raccourci par défaut', async () => {
    const me = await signup();
    const first = ((await me.get('/presets')).body.presets as PromptPreset[])[0];
    const res = await me.patch(`/presets/${first.id}`, { enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.preset.enabled).toBe(false);
  });

  it.each([
    ['libellé vide', { label: '' }],
    ['libellé trop long', { label: 'x'.repeat(41) }],
    ['texte vide', { text: ' ' }],
    ['texte trop long', { text: 'y'.repeat(1001) }],
    ['média inconnu', { media: 'audio' }],
    ['enabled qui n’est pas un booléen', { enabled: 1 }],
  ])('refuse la modification (400) : %s', async (_label, body) => {
    const { me, preset } = await setup();
    expect((await me.patch(`/presets/${preset.id}`, body)).status).toBe(400);
    const stored = ((await me.get('/presets')).body.presets as PromptPreset[]).find(p => p.id === preset.id);
    expect(stored).toEqual(preset);
  });

  it('répond 404 pour un raccourci inconnu ou un id invalide', async () => {
    const me = await signup();
    expect((await me.patch(`/presets/${randomUUID()}`, { label: 'x' })).status).toBe(404);
    expect((await me.patch('/presets/pas-un-uuid', { label: 'x' })).status).toBe(404);
  });

  it('répond 404 pour le raccourci d’un autre utilisateur et ne le modifie pas', async () => {
    const { me, preset } = await setup();
    const other = await signup();
    const res = await other.patch(`/presets/${preset.id}`, { label: 'Volé' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Raccourci introuvable.');
    const stored = ((await me.get('/presets')).body.presets as PromptPreset[]).find(p => p.id === preset.id);
    expect(stored!.label).toBe('Plage');
  });
});

describe('DELETE /presets/:id', () => {
  it('supprime le raccourci', async () => {
    const me = await signup();
    const preset = (await me.post('/presets', PRESET)).body.preset as PromptPreset;
    const res = await me.del(`/presets/${preset.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const list = (await me.get('/presets')).body.presets as PromptPreset[];
    expect(list).toHaveLength(8);
    expect(list.some(p => p.id === preset.id)).toBe(false);
  });

  it('supprime un raccourci par défaut', async () => {
    const me = await signup();
    const first = ((await me.get('/presets')).body.presets as PromptPreset[])[0];
    expect((await me.del(`/presets/${first.id}`)).status).toBe(200);
    expect((await me.get('/presets')).body.presets).toHaveLength(7);
  });

  it('répond 404 pour un id qui n’est pas un uuid', async () => {
    const me = await signup();
    expect((await me.del('/presets/pas-un-uuid')).status).toBe(404);
  });

  it('ne supprime pas le raccourci d’un autre utilisateur', async () => {
    const me = await signup();
    const other = await signup();
    const preset = (await me.post('/presets', PRESET)).body.preset as PromptPreset;
    // La route est idempotente : elle répond 200 même si rien n'a été supprimé.
    expect((await other.del(`/presets/${preset.id}`)).status).toBe(200);
    expect(((await me.get('/presets')).body.presets as PromptPreset[]).some(p => p.id === preset.id)).toBe(true);
  });

  it('répond 200 pour un raccourci inconnu (suppression idempotente)', async () => {
    const me = await signup();
    expect((await me.del(`/presets/${randomUUID()}`)).status).toBe(200);
    expect((await me.get('/presets')).body.presets).toHaveLength(8);
  });
});
