/**
 * Reformulation du prompt : en mode SPICY_FAKE, la réponse est simulée
 * (`<prompt> (reformulé)`) et aucun appel réseau n'est fait.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, signup } from './helpers.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /prompts/enhance', () => {
  it('refuse sans session (401)', async () => {
    const res = await call('POST', '/prompts/enhance', { prompt: 'une idée', media: 'image' });
    expect(res.status).toBe(401);
  });

  it('renvoie le texte reformulé, sans appel réseau', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const me = await signup();
    const res = await me.post('/prompts/enhance', { prompt: 'une fille sur la plage', media: 'image' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prompt: 'une fille sur la plage (reformulé)' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepte le média vidéo', async () => {
    const me = await signup();
    const res = await me.post('/prompts/enhance', { prompt: 'un travelling', media: 'video' });
    expect(res.status).toBe(200);
    expect(res.body.prompt).toBe('un travelling (reformulé)');
  });

  it('retire les espaces aux extrémités du prompt', async () => {
    const me = await signup();
    const res = await me.post('/prompts/enhance', { prompt: '  une idée \n', media: 'image' });
    expect(res.body.prompt).toBe('une idée (reformulé)');
  });

  it('accepte un persona (null ou uuid)', async () => {
    const me = await signup();
    const persona = await me.createPersona({ name: 'Léa' });
    expect((await me.post('/prompts/enhance', { prompt: 'idée', media: 'image', personaId: null })).status).toBe(200);
    expect((await me.post('/prompts/enhance', { prompt: 'idée', media: 'image', personaId: persona.id })).status).toBe(200);
  });

  it.each([
    ['prompt vide', { prompt: '', media: 'image' }],
    ['prompt fait seulement d’espaces', { prompt: '   ', media: 'image' }],
    ['prompt absent', { media: 'image' }],
    ['prompt trop long', { prompt: 'a'.repeat(3001), media: 'image' }],
    ['média absent', { prompt: 'idée' }],
    ['média inconnu', { prompt: 'idée', media: 'audio' }],
    ['persona qui n’est pas un uuid', { prompt: 'idée', media: 'image', personaId: 'abc' }],
  ])('400 de validation : %s', async (_label, payload) => {
    const me = await signup();
    const res = await me.post('/prompts/enhance', payload);
    expect(res.status).toBe(400);
  });

  it('accepte un prompt de 3000 caractères', async () => {
    const me = await signup();
    const res = await me.post('/prompts/enhance', { prompt: 'a'.repeat(3000), media: 'image' });
    expect(res.status).toBe(200);
  });

  it('erreur 412 sans clé API SpicyAPI', async () => {
    const me = await signup({ apiKey: false });
    const res = await me.post('/prompts/enhance', { prompt: 'une idée', media: 'image' });
    expect(res.status).toBe(412);
    expect(res.body.error).toContain('Aucune clé API SpicyAPI');
  });
});
