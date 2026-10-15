/** Dictée : jeton à usage unique pour ElevenLabs Scribe (faux jeton en test, aucun appel réseau). */
import { describe, expect, it } from 'vitest';
import { call, signup } from './helpers.js';

describe('POST /dictation/token', () => {
  it('donne un jeton de dictée (faux en test, sans appel à ElevenLabs) @smoke', async () => {
    const me = await signup();
    const res = await me.post('/dictation/token', {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ provider: 'elevenlabs', token: 'fake-dictation-token', fake: true });
  });

  it('suit le fournisseur choisi dans Paramétrage (Deepgram, Cartesia)', async () => {
    const me = await signup();
    expect((await me.patch('/settings', { dictationProvider: 'deepgram' })).status).toBe(200);
    expect((await me.post('/dictation/token', {})).body).toMatchObject({ provider: 'deepgram', fake: true });
    expect((await me.patch('/settings', { dictationProvider: 'cartesia' })).status).toBe(200);
    expect((await me.post('/dictation/token', {})).body).toMatchObject({ provider: 'cartesia', fake: true });
    expect((await me.patch('/settings', { dictationProvider: 'whisper' })).status).toBe(400);
  });

  it('répond 401 sans session', async () => {
    expect((await call('POST', '/dictation/token')).status).toBe(401);
  });
});
