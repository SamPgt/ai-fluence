import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { assistStatus, rewritePrompt } from '../services/assist.service.js';
import { transcribe } from '../services/voice.service.js';
import type { AppEnv } from '../types.js';

/** Aide à l'écriture des prompts, en local : dictée (Whisper) et reformulation (Ollama). */
const assistRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/status', async c => c.json({ status: await assistStatus() }))
  /** Dictée : corps WAV (audio/wav), rien n'est enregistré. Appelée en boucle pendant qu'on parle (texte en direct). */
  .post('/transcribe', async c => {
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.byteLength > 20 * 1024 * 1024) return c.json({ error: 'Dictée trop longue.' }, 400);
    const language = c.req.query('language');
    // Amorce : vocabulaire à bien transcrire (noms des personas, modèles…).
    const prompt = c.req.query('prompt')?.slice(0, 500);
    return c.json({ text: await transcribe(data, language && /^[a-z]{2}$/.test(language) ? language : undefined, prompt) });
  })
  .post(
    '/rewrite',
    zValidator(
      'json',
      z.object({
        text: z.string().trim().min(1).max(4000),
        media: z.enum(['image', 'video']),
        familyId: z.string().max(100).nullish(),
        modelLabel: z.string().max(100).nullish(),
        attachments: z.number().int().min(0).max(20),
        gender: z.string().max(20).nullish(),
      }),
    ),
    async c => c.json(await rewritePrompt(c.req.valid('json'))),
  );

export default assistRoutes;
