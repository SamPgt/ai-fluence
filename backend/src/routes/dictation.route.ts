/** Dictée dans le composer : jeton temporaire du fournisseur choisi (ElevenLabs ou Deepgram). */
import { Hono } from 'hono';
import { auth } from '../middleware/auth.js';
import { createDictationToken } from '../services/dictation.service.js';
import type { AppEnv } from '../types.js';

const dictationRoutes = new Hono<AppEnv>()
  .use(auth)
  .post('/token', async c => c.json(await createDictationToken(c.get('user').id)));

export default dictationRoutes;
