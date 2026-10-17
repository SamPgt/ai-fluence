/**
 * Voix envoyée aux modèles vidéo : extrait de référence généré une fois par voix
 * ElevenLabs (simulé en test), envoyé en `reference_audio_urls` en mode références.
 */
import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../db/index.js';
import { generations, voiceSamples } from '../db/schema.js';
import { signup, type Agent } from './helpers.js';

const MINI = 'bytedance/seedance-2.0-mini';

async function setup(opts: { elevenKey?: boolean } = {}) {
  const me = await signup();
  if (opts.elevenKey !== false) {
    expect((await me.put('/settings/elevenlabs-key', { apiKey: 'sk_test_0000000000abcd' })).status).toBe(200);
  }
  const persona = await me.createPersona({ name: 'Léa' });
  const res = await me.patch(`/personas/${persona.id}`, { voices: [{ voiceId: 'el-voice-1', name: 'Mimi' }] });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const voice = res.body.persona.voices[0] as { id: string };
  const image = await me.uploadAsset();
  return { me, persona, voice, image };
}

const send = (me: Agent, body: Record<string, unknown>) =>
  me.post('/generations', { family: MINI, prompt: 'elle dit bonjour', params: {}, ...body });

async function inputOf(id: string) {
  const [row] = await db.select().from(generations).where(eq(generations.id, id));
  return row;
}

describe('voix de référence', () => {
  it('mode références : l’extrait part en reference_audio_urls ; généré une seule fois par voix @smoke', async () => {
    const { me, persona, voice, image } = await setup();
    const body = { personaId: persona.id, refMode: 'reference', referenceAssetIds: [image.id], voiceId: voice.id };
    const first = await send(me, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.generation.voiceId).toBe(voice.id);
    const row = await inputOf(first.body.generation.id);
    expect(row.task).toBe('reference-to-video');
    expect(row.input.reference_audio_urls).toHaveLength(1);

    const samples = await db.select().from(voiceSamples);
    expect(samples.map(s => s.voiceId)).toEqual(['el-voice-1']);
    expect(samples[0].filePath).toMatch(/application\/voix\/el-voice-1\.wav$/);
    expect(existsSync(samples[0].filePath)).toBe(true);

    // Même voix, une autre fois (ou un autre compte) : l'extrait est réutilisé.
    expect((await send(me, body)).status).toBe(201);
    const other = await setup();
    expect((await send(other.me, { personaId: other.persona.id, refMode: 'reference', referenceAssetIds: [other.image.id], voiceId: other.voice.id })).status).toBe(201);
    expect(await db.$count(voiceSamples)).toBe(1);
  });

  it('image de départ (pas en mode références) : la voix n’est pas envoyée', async () => {
    const { me, persona, voice, image } = await setup();
    const res = await send(me, { personaId: persona.id, referenceAssetIds: [image.id], voiceId: voice.id });
    expect(res.status).toBe(201);
    const row = await inputOf(res.body.generation.id);
    expect(row.task).toBe('image-to-video');
    expect(row.input.reference_audio_urls).toBeUndefined();
    expect(res.body.generation.voiceId).toBeNull();
  });

  it('sans clé ElevenLabs : refus clair, rien n’est lancé', async () => {
    const { me, persona, voice, image } = await setup({ elevenKey: false });
    const res = await send(me, { personaId: persona.id, refMode: 'reference', referenceAssetIds: [image.id], voiceId: voice.id });
    expect(res.status).toBe(412);
    expect(res.body.error).toMatch(/clé ElevenLabs/);
  });
});
