import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { EnhancePromptResponse } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { personas } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { getSettingsRow, requireApiKey } from '../services/settings.service.js';
import type { AppEnv } from '../types.js';

const CHAT_URL = 'https://api.spicyapi.ai/v1/chat/completions';

function systemPrompt(media: 'image' | 'video', persona?: typeof personas.$inferSelect) {
  const lines = [
    `You rewrite short ideas into strong prompts for an AI ${media === 'video' ? 'video' : 'image'} generation model.`,
    'Write in English, one paragraph, concrete and visual: subject, action, setting, lighting, camera, style.',
    media === 'video'
      ? 'Describe the motion and the camera movement over the shot. Keep it under 90 words.'
      : 'Keep it under 80 words.',
    'Keep every explicit detail from the user. Do not add a trigger word, quotes, labels or explanations.',
    'Answer with the prompt only.',
  ];
  if (persona) {
    lines.push('', `The content is for the character or art page "${persona.name}".`);
    if (persona.description) lines.push(`Who/what it is: ${persona.description}`);
    if (persona.personality) lines.push(`Personality, behavior and tone: ${persona.personality}`);
    lines.push('Make the result consistent with this identity.');
  }
  return lines.join('\n');
}

const promptsRoutes = new Hono<AppEnv>().use(auth).post(
  '/enhance',
  zValidator(
    'json',
    z.object({
      prompt: z.string().trim().min(1).max(3000),
      personaId: z.uuid().nullable().optional(),
      media: z.enum(['image', 'video']),
    }),
  ),
  async c => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const apiKey = await requireApiKey(user.id);
    const settings = await getSettingsRow(user.id);
    let persona: typeof personas.$inferSelect | undefined;
    if (body.personaId) {
      [persona] = await db
        .select()
        .from(personas)
        .where(and(eq(personas.id, body.personaId), eq(personas.userId, user.id)))
        .limit(1);
    }

    const messages = [
      { role: 'system', content: systemPrompt(body.media, persona) },
      { role: 'user', content: body.prompt },
    ];
    // Réflexion limitée : une reformulation n'en a pas besoin, et un modèle qui réfléchit trop
    // peut épuiser son budget sans écrire de réponse. On ne paie que les tokens réellement utilisés.
    const call = (withReasoning: boolean) =>
      fetch(CHAT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.enhanceModel,
          max_tokens: 2000,
          ...(withReasoning ? { reasoning_effort: 'low' } : {}),
          messages,
        }),
        signal: AbortSignal.timeout(90_000),
      }).catch(() => null);

    type ChatResponse = {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string; code?: string };
      msg?: string;
    } | null;

    let res = await call(true);
    let data = res ? ((await res.json().catch(() => null)) as ChatResponse) : null;
    // Modèle choisi dans les paramètres qui n'accepte pas `reasoning_effort` : on relance sans.
    if (res?.status === 400 && data?.error?.code === 'unsupported_parameter') {
      res = await call(false);
      data = res ? ((await res.json().catch(() => null)) as ChatResponse) : null;
    }

    if (!res) throw new HTTPException(502, { message: 'SpicyAPI ne répond pas.' });
    if (!res.ok) {
      throw new HTTPException(502, { message: data?.error?.message ?? data?.msg ?? 'Reformulation du prompt impossible.' });
    }
    const text = data?.choices?.[0]?.message?.content?.trim().replace(/^["“]|["”]$/g, '');
    if (!text) throw new HTTPException(502, { message: 'Le modèle n’a rien renvoyé.' });
    return c.json({ prompt: text } satisfies EnhancePromptResponse);
  },
);

export default promptsRoutes;
