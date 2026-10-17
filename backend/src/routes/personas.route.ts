import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CONTEXT_BLOCK_STORED_MAX } from '@sublime/shared';
import { db } from '../db/index.js';
import { assets, personas } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { toPersona } from '../services/serialize.js';
import { trashPersona } from '../services/trash.service.js';
import { cancelCreation, convertSpeech, copyVoice, createVoice, decideCandidate, importVoice, listVoices, getVoice, listenSpeech, previewVoice, updateVoice } from '../services/voice.service.js';
import type { AppEnv } from '../types.js';

/** LoRA d'un persona, ou de Général (settings.route). */
export const loraSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().max(60).default(''),
  path: z.url({ protocol: /^https$/, message: 'Lien https direct vers le .safetensors' }),
  scale: z.number().min(0).max(4).default(1),
  family: z.string().min(3),
  noise: z.enum(['high', 'low', 'both']).optional(),
  triggerWords: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  hiddenWords: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  previewUrl: z.url({ protocol: /^https$/ }).optional(),
  sourceUrl: z.url({ protocol: /^https$/ }).optional(),
  group: z
    .object({
      key: z.string().max(80),
      available: z
        .array(
          z.object({
            family: z.string().min(3),
            files: z
              .array(z.object({ url: z.url({ protocol: /^https$/ }), noise: z.enum(['high', 'low']).optional() }))
              .max(4),
            triggerWords: z.array(z.string().trim().min(1).max(60)).max(20),
          }),
        )
        .max(10),
    })
    .optional(),
});

const contextBlockSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().max(60).default(''),
  text: z.string().max(CONTEXT_BLOCK_STORED_MAX).default(''),
});

const voiceSchema = z.object({
  id: z.string().optional(),
  voiceId: z.string().trim().min(1).max(100),
  publicOwnerId: z.string().trim().max(200).optional(),
  name: z.string().trim().min(1).max(100),
  previewUrl: z.url({ protocol: /^https$/ }).nullable().default(null),
  labels: z.record(z.string().max(40), z.string().max(80)).default({}),
  description: z.string().max(500).optional(),
});

const personaFields = {
  name: z.string().trim().min(1).max(40),
  kind: z.enum(['influencer', 'artistic']),
  /** Genre du personnage (créateur de personnage) : accorde le prompt et choisit les miniatures des traits. */
  gender: z.enum(['female', 'male']).nullable(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  avatarAssetId: z.uuid().nullable(),
  contextBlocks: z.array(contextBlockSchema).max(10),
  loras: z.array(loraSchema).max(12),
  /** Pas de limite métier : borne technique seulement. */
  voices: z.array(voiceSchema).max(100),
  defaultImageFamily: z.string().nullable(),
  defaultVideoFamily: z.string().nullable(),
};

/** Création : valeurs par défaut pour les champs absents. */
const personaSchema = z.object({
  ...personaFields,
  kind: personaFields.kind.default('influencer'),
  // Sans valeur par défaut : absent, il reste non précisé.
  gender: personaFields.gender.optional(),
  color: personaFields.color.default('#8b5cf6'),
  avatarAssetId: personaFields.avatarAssetId.default(null),
  contextBlocks: personaFields.contextBlocks.default([]),
  loras: personaFields.loras.default([]),
  voices: personaFields.voices.default([]),
  defaultImageFamily: personaFields.defaultImageFamily.default(null),
  defaultVideoFamily: personaFields.defaultVideoFamily.default(null),
});

/** Modification : seuls les champs envoyés changent (aucune valeur par défaut). */
const personaUpdateSchema = z.object(personaFields).partial();

/** Garantit un id stable à chaque LoRA et à chaque bloc de contexte. */
export const withIds = <T extends { id?: string }>(items: T[]) => items.map(i => ({ ...i, id: i.id || randomUUID() }));

const refCount = sql<number>`(select count(*)::int from assets a where a.persona_id = "personas"."id" and a.is_reference)`;

async function assertAvatar(userId: string, avatarAssetId: string | null | undefined) {
  if (!avatarAssetId) return true;
  const [a] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.id, avatarAssetId), eq(assets.userId, userId)))
    .limit(1);
  return Boolean(a);
}

const personasRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/', async c => {
    const rows = await db
      .select({ p: personas, refs: refCount })
      .from(personas)
      .where(and(eq(personas.userId, c.get('user').id), isNull(personas.deletedAt)))
      .orderBy(asc(personas.position), asc(personas.createdAt));
    return c.json({ personas: rows.map(r => toPersona(r.p, r.refs)) });
  })
  .post('/', zValidator('json', personaSchema), async c => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (!(await assertAvatar(user.id, body.avatarAssetId))) return c.json({ error: 'Avatar introuvable.' }, 400);
    const position = await db.$count(personas, eq(personas.userId, user.id));
    const [row] = await db
      .insert(personas)
      .values({
        ...body,
        loras: withIds(body.loras),
        contextBlocks: withIds(body.contextBlocks),
        voices: withIds(body.voices),
        userId: user.id,
        position,
      })
      .returning();
    return c.json({ persona: toPersona(row) }, 201);
  })
  .patch('/:id', zValidator('json', personaUpdateSchema), async c => {
    const user = c.get('user');
    // Avec Zod 4, `.partial()` applique les valeurs par défaut aux champs absents : sans ce filtre,
    // renommer un persona remettrait à zéro son type, sa couleur, sa description… On ne garde que les champs envoyés.
    const sent = new Set(Object.keys((await c.req.json()) as object));
    const body = Object.fromEntries(Object.entries(c.req.valid('json')).filter(([key]) => sent.has(key))) as ReturnType<
      typeof c.req.valid<'json'>
    >;
    if (!(await assertAvatar(user.id, body.avatarAssetId))) return c.json({ error: 'Avatar introuvable.' }, 400);
    const { loras, contextBlocks, voices, ...rest } = body;
    const [row] = await db
      .update(personas)
      .set({
        ...rest,
        ...(loras ? { loras: withIds(loras) } : {}),
        ...(contextBlocks ? { contextBlocks: withIds(contextBlocks) } : {}),
        ...(voices ? { voices: withIds(voices) } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(personas.id, c.req.param('id')), eq(personas.userId, user.id), isNull(personas.deletedAt)))
      .returning();
    if (!row) return c.json({ error: 'Persona introuvable.' }, 404);
    const [{ refs }] = await db.select({ refs: refCount }).from(personas).where(eq(personas.id, row.id));
    return c.json({ persona: toPersona(row, refs) });
  })
  /** Nouvel ordre des bulles (glisser-déposer) : la position suit l'ordre des ids. */
  .put('/order', zValidator('json', z.object({ ids: z.array(z.uuid()).max(200) })), async c => {
    const userId = c.get('user').id;
    const { ids } = c.req.valid('json');
    await db.transaction(async tx => {
      for (const [position, id] of ids.entries()) {
        await tx
          .update(personas)
          .set({ position })
          .where(and(eq(personas.id, id), eq(personas.userId, userId)));
      }
    });
    return c.json({ ok: true });
  })
  // ── Voix (vidéos parlées, local) ──
  /** Voix existantes (personnages qui en ont une), pour en reprendre une. */
  .get('/voices', async c => c.json({ voices: await listVoices(c.get('user')) }))
  .get('/:id/voice', async c => c.json({ voice: await getVoice(c.get('user'), c.req.param('id')) }))
  /** Importe un fichier audio comme voix proposée (wav, mp3, flac, ogg ; 25 Mo au plus). */
  .post('/:id/voice/import', async c => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'Fichier manquant.' }, 400);
    if (file.size > 25 * 1024 * 1024) return c.json({ error: 'Fichier trop lourd (25 Mo max).' }, 400);
    return c.json({
      voice: await importVoice(c.get('user'), c.req.param('id'), { name: file.name, data: new Uint8Array(await file.arrayBuffer()) }),
    });
  })
  /** Conversion de voix : la phrase enregistrée (WAV) redite avec la voix du personnage, pour un « Texte dit ». */
  .post('/:id/voice/convert', async c => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'Enregistrement manquant.' }, 400);
    if (file.size > 25 * 1024 * 1024) return c.json({ error: 'Enregistrement trop long (25 Mo max).' }, 400);
    return c.json(await convertSpeech(c.get('user'), c.req.param('id'), new Uint8Array(await file.arrayBuffer())));
  })
  .post('/:id/voice/copy', zValidator('json', z.object({ fromPersonaId: z.uuid() })), async c =>
    c.json({ voice: await copyVoice(c.get('user'), c.req.param('id'), c.req.valid('json').fromPersonaId) }),
  )
  .post(
    '/:id/voice/create',
    zValidator(
      'json',
      z.object({
        description: z.string().trim().max(300).default(''),
        resolution: z.enum(['512p', '720p']).default('512p'),
        language: z.enum(['fr', 'en']).default('fr'),
      }),
    ),
    async c => {
      const { description, resolution, language } = c.req.valid('json');
      return c.json({ voice: await createVoice(c.get('user'), c.req.param('id'), description, resolution, language) });
    },
  )
  .post('/:id/voice/cancel', async c => c.json({ voice: await cancelCreation(c.get('user'), c.req.param('id')) }))
  .post('/:id/voice/candidate', zValidator('json', z.object({ keep: z.boolean() })), async c =>
    c.json({ voice: await decideCandidate(c.get('user'), c.req.param('id'), c.req.valid('json').keep) }),
  )
  .patch(
    '/:id/voice',
    zValidator('json', z.object({ exaggeration: z.number().min(0.2).max(1.2).optional(), clearJob: z.boolean().optional() })),
    async c => c.json({ voice: await updateVoice(c.get('user'), c.req.param('id'), c.req.valid('json')) }),
  )
  /** Texte dit écouté dans le composer avant la vidéo : la piste est gardée pour la génération. */
  .post(
    '/:id/voice/speech',
    zValidator('json', z.object({ text: z.string().trim().min(1).max(2000), exaggeration: z.number().min(0.2).max(1.2).optional() })),
    async c => {
      const { text, exaggeration } = c.req.valid('json');
      return c.json(await listenSpeech(c.get('user'), c.req.param('id'), text, exaggeration));
    },
  )
  /** Essai de la voix : renvoie le WAV directement, rien n'est enregistré. */
  .post(
    '/:id/voice/preview',
    zValidator(
      'json',
      z.object({
        text: z.string().trim().min(1).max(400),
        exaggeration: z.number().min(0.2).max(1.2).optional(),
        candidate: z.boolean().optional(),
      }),
    ),
    async c => {
      const wav = await previewVoice(c.get('user'), c.req.param('id'), c.req.valid('json'));
      return new Response(new Uint8Array(wav), { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } });
    },
  )
  .delete('/:id', async c => {
    // Corbeille : le persona et ses fils sont masqués 7 jours avant suppression définitive.
    if (!(await trashPersona(c.get('user').id, c.req.param('id')))) return c.json({ error: 'Persona introuvable.' }, 404);
    return c.json({ ok: true });
  });

export default personasRoutes;
