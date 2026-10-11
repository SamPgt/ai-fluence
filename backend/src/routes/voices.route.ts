import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { listVoiceLibrary, requireElevenLabsKey } from '../services/elevenlabs.service.js';
import type { AppEnv } from '../types.js';

const filter = z.string().trim().max(60).optional();

const voicesRoutes = new Hono<AppEnv>()
  .use(auth)
  /** Catalogue ElevenLabs : voix par défaut ou bibliothèque communautaire, avec extraits. */
  .get(
    '/library',
    zValidator(
      'query',
      z.object({
        source: z.enum(['all', 'default', 'library']).default('all'),
        search: z.string().trim().max(100).optional(),
        gender: filter,
        age: filter,
        language: filter,
        useCase: filter,
        page: z.coerce.number().int().min(0).max(100).default(0),
      }),
    ),
    async c => {
      const apiKey = await requireElevenLabsKey(c.get('user').id);
      return c.json(await listVoiceLibrary(apiKey, c.req.valid('query')));
    },
  );

export default voicesRoutes;
