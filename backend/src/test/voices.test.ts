import { describe, expect, it } from 'vitest';
import { call, signup } from './helpers.js';

const VOICE = { voiceId: 'fake-sarah', name: 'Sarah', previewUrl: null, labels: { gender: 'female' } };

describe('clé ElevenLabs', () => {
  it('s’enregistre masquée, puis se supprime', async () => {
    const me = await signup();
    expect((await me.get('/settings')).body.settings).toMatchObject({ hasElevenLabsKey: false, elevenLabsKeyHint: null });
    const saved = await me.put('/settings/elevenlabs-key', { apiKey: 'sk_test_0000000000abcd' });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.hasElevenLabsKey).toBe(true);
    expect(saved.body.settings.elevenLabsKeyHint).toBe('sk_t••••abcd');
    expect(JSON.stringify(saved.body)).not.toContain('sk_test_0000000000abcd');
    const removed = await me.del('/settings/elevenlabs-key');
    expect(removed.body.settings).toMatchObject({ hasElevenLabsKey: false, elevenLabsKeyHint: null });
  });

  it('refuse une clé trop courte', async () => {
    const me = await signup();
    expect((await me.put('/settings/elevenlabs-key', { apiKey: 'court' })).status).toBe(400);
  });
});

describe('GET /voices/library', () => {
  it('demande une clé ElevenLabs (412), et une session (401)', async () => {
    const me = await signup();
    expect((await me.get('/voices/library')).status).toBe(412);
    expect((await call('GET', '/voices/library')).status).toBe(401);
  });

  it('renvoie le catalogue (simulé en test), filtré par recherche et genre', async () => {
    const me = await signup();
    await me.put('/settings/elevenlabs-key', { apiKey: 'sk_test_0000000000abcd' });
    const all = await me.get('/voices/library');
    expect(all.status).toBe(200);
    expect(all.body.voices.map((v: { name: string }) => v.name)).toEqual(['Sarah', 'George', 'River']);
    expect((await me.get('/voices/library?search=geo')).body.voices).toHaveLength(1);
    expect((await me.get('/voices/library?gender=female&source=default')).body.voices[0].name).toBe('Sarah');
    expect((await me.get('/voices/library?source=library')).body.voices.map((v: { name: string }) => v.name)).toEqual(['River']);
  });

  it('refuse des paramètres invalides', async () => {
    const me = await signup();
    await me.put('/settings/elevenlabs-key', { apiKey: 'sk_test_0000000000abcd' });
    expect((await me.get('/voices/library?source=autre')).status).toBe(400);
    expect((await me.get('/voices/library?page=-1')).status).toBe(400);
  });
});

describe('voix d’un persona', () => {
  it('se créent, se modifient seules et gardent le reste du persona @smoke', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Léa', color: '#112233' });
    expect(p.voices).toEqual([]);
    const res = await me.patch(`/personas/${p.id}`, { voices: [VOICE] });
    expect(res.status).toBe(200);
    expect(res.body.persona.voices).toEqual([expect.objectContaining({ ...VOICE, id: expect.any(String) })]);
    expect(res.body.persona.color).toBe('#112233');
  });

  it('refuse un extrait qui n’est pas en https', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Léa' });
    const res = await me.patch(`/personas/${p.id}`, { voices: [{ ...VOICE, previewUrl: 'http://exemple.test/a.mp3' }] });
    expect(res.status).toBe(400);
  });
});

describe('type de persona', () => {
  it('influenceur par défaut, modifiable en artistique, sans toucher au reste', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Royaume', color: '#112233' });
    expect(p.kind).toBe('influencer');
    const res = await me.patch(`/personas/${p.id}`, { kind: 'artistic' });
    expect(res.status).toBe(200);
    expect(res.body.persona).toMatchObject({ kind: 'artistic', color: '#112233', name: 'Royaume' });
  });

  it('refuse un type inconnu', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Royaume' });
    expect((await me.patch(`/personas/${p.id}`, { kind: 'autre' })).status).toBe(400);
    expect((await me.post('/personas', { name: 'X', kind: 'autre' })).status).toBe(400);
  });
});
