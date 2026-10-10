import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { assets, generations, personas } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { toAsset } from '../services/serialize.js';
import { getSettingsRow, mediaDirOf, slug } from '../services/settings.service.js';
import {
  ACCEPTED_UPLOAD_MIMES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  extFor,
  fileSize,
  join,
  mediaTypeOf,
  saveFile,
} from '../services/storage.service.js';
import type { AppEnv } from '../types.js';

const PG_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/;

/** Curseur de la galerie : date exacte (à la microseconde, en texte Postgres) et id. */
function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id])).toString('base64url');
}
function decodeCursor(raw: string): { at: string; id: string } | null {
  try {
    const [at, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof at !== 'string' || !PG_TIMESTAMP_RE.test(at) || !UUID_RE.test(String(id))) return null;
    return { at, id };
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ownedPersona(userId: string, personaId: string | null | undefined) {
  if (!personaId) return null;
  const [p] = await db
    .select()
    .from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)))
    .limit(1);
  return p ?? null;
}

export const assetsRoutes = new Hono<AppEnv>()
  .use(auth)
  /** Upload d'une image ou vidéo (référence, avatar…). Multipart : `file`, `personaId?`, `isReference?`. */
  .post('/', async c => {
    const user = c.get('user');
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'Fichier manquant.' }, 400);
    if (!ACCEPTED_UPLOAD_MIMES.has(file.type)) {
      return c.json({ error: 'Formats acceptés : JPEG, PNG, WebP, GIF, MP4, WebM.' }, 400);
    }
    const mediaType = mediaTypeOf(file.type);
    if (file.size > (mediaType === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
      return c.json({ error: mediaType === 'video' ? 'Vidéo trop lourde (90 Mo max).' : 'Image trop lourde (10 Mo max).' }, 400);
    }
    const personaId = typeof body.personaId === 'string' && body.personaId ? body.personaId : null;
    // Un id mal formé ferait planter Postgres : refusé avant.
    if (personaId && !UUID_RE.test(personaId)) return c.json({ error: 'Persona invalide.' }, 400);
    const persona = await ownedPersona(user.id, personaId);
    const dir = join(
      mediaDirOf(user, await getSettingsRow(user.id)),
      'references',
      persona ? slug(persona.name) : 'divers',
    );
    const saved = await saveFile(
      join(dir, `${randomUUID().slice(0, 12)}.${extFor(file.type)}`),
      new Uint8Array(await file.arrayBuffer()),
    );
    const [row] = await db
      .insert(assets)
      .values({
        userId: user.id,
        personaId: persona?.id ?? null,
        kind: 'upload',
        mediaType,
        mime: file.type,
        filePath: saved.path,
        bytes: saved.bytes,
        isReference: body.isReference === 'true' && Boolean(persona),
      })
      .returning();
    return c.json({ asset: toAsset(row) }, 201);
  })
  /** Bibliothèque de références d'un persona. */
  .get('/references', zValidator('query', z.object({ personaId: z.uuid() })), async c => {
    const rows = await db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.userId, c.get('user').id),
          eq(assets.personaId, c.req.valid('query').personaId),
          eq(assets.isReference, true),
        ),
      )
      // Ordre choisi par glisser-déposer ; les nouvelles (sans position) en premier.
      .orderBy(sql`${assets.referencePosition} asc nulls first`, desc(assets.createdAt));
    return c.json({ assets: rows.map(toAsset) });
  })
  /** Nouvel ordre de la bibliothèque de références d'un persona. */
  .put(
    '/references/order',
    zValidator('json', z.object({ personaId: z.uuid(), ids: z.array(z.uuid()).max(500) })),
    async c => {
      const user = c.get('user');
      const { personaId, ids } = c.req.valid('json');
      if (!(await ownedPersona(user.id, personaId))) return c.json({ error: 'Persona introuvable.' }, 404);
      await db.transaction(async tx => {
        for (const [position, id] of ids.entries()) {
          await tx
            .update(assets)
            .set({ referencePosition: position })
            .where(and(eq(assets.id, id), eq(assets.userId, user.id), eq(assets.personaId, personaId)));
        }
      });
      return c.json({ ok: true });
    },
  )
  /** Ajoute ou retire un média de la bibliothèque de références d'un persona. */
  .patch(
    '/:id/reference',
    zValidator('json', z.object({ personaId: z.uuid(), isReference: z.boolean() })),
    async c => {
      const user = c.get('user');
      const { personaId, isReference } = c.req.valid('json');
      if (!(await ownedPersona(user.id, personaId))) return c.json({ error: 'Persona introuvable.' }, 404);
      const [row] = await db
        .update(assets)
        .set({ isReference, personaId })
        .where(and(eq(assets.id, c.req.param('id')), eq(assets.userId, user.id)))
        .returning();
      if (!row) return c.json({ error: 'Média introuvable.' }, 404);
      return c.json({ asset: toAsset(row) });
    },
  )
  /** Galerie : tous les résultats générés, du plus récent au plus ancien. */
  .get(
    '/gallery',
    zValidator(
      'query',
      z.object({
        personaId: z.uuid().optional(),
        media: z.enum(['image', 'video']).optional(),
        /** Curseur opaque renvoyé par la page précédente (`nextBefore`). */
        before: z.string().max(200).optional(),
      }),
    ),
    async c => {
      const user = c.get('user');
      const q = c.req.valid('query');
      const where = [
        eq(assets.userId, user.id),
        eq(assets.kind, 'output'),
        // Pas les résultats des fils à la corbeille.
        sql`not exists (select 1 from generations g inner join threads t on t.id = g.thread_id where g.id = ${assets.generationId} and t.deleted_at is not null)`,
      ];
      if (q.personaId) where.push(eq(assets.personaId, q.personaId));
      if (q.media) where.push(eq(assets.mediaType, q.media));
      if (q.before) {
        const cursor = decodeCursor(q.before);
        if (!cursor) return c.json({ error: 'Curseur invalide.' }, 400);
        // (date, id) strictement avant le dernier élément de la page précédente :
        // aucun saut, même pour des résultats créés dans la même milliseconde.
        where.push(sql`(${assets.createdAt}, ${assets.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`);
      }
      const rows = await db
        .select({ asset: assets, at: sql<string>`${assets.createdAt}::text` })
        .from(assets)
        .where(and(...where))
        .orderBy(desc(assets.createdAt), desc(assets.id))
        .limit(60)
        .then(list => list.map(({ asset, at }) => Object.assign(asset, { cursorAt: at })));
      const genIds = [...new Set(rows.map(r => r.generationId).filter((id): id is string => Boolean(id)))];
      const gens = genIds.length
        ? await db
            .select({ id: generations.id, threadId: generations.threadId, prompt: generations.prompt, family: generations.family })
            .from(generations)
            .where(inArray(generations.id, genIds))
        : [];
      const byGen = new Map(gens.map(g => [g.id, g]));
      return c.json({
        items: rows.map(r => ({ asset: toAsset(r), generation: r.generationId ? (byGen.get(r.generationId) ?? null) : null })),
        nextBefore: rows.length === 60 ? encodeCursor(rows[rows.length - 1].cursorAt, rows[rows.length - 1].id) : null,
      });
    },
  );

/** Sert un fichier local (avec Range pour la lecture vidéo). */
export const mediaRoutes = new Hono<AppEnv>().use(auth).get('/:id', async c => {
  const [row] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, c.req.param('id')), eq(assets.userId, c.get('user').id)))
    .limit(1);
  if (!row) return c.json({ error: 'Média introuvable.' }, 404);
  const size = await fileSize(row.filePath);
  if (size === null) return c.json({ error: 'Fichier absent du disque.' }, 410);

  const headers: Record<string, string> = {
    'Content-Type': row.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
  if (c.req.query('download')) {
    headers['Content-Disposition'] = `attachment; filename="${row.filePath.split('/').pop()}"`;
  }

  const range = c.req.header('range');
  const match = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (match) {
    // `bytes=-N` : les N derniers octets ; `bytes=N-` : de N à la fin.
    const suffix = !match[1] && match[2] ? Math.min(Number(match[2]), size) : null;
    const start = suffix !== null ? size - suffix : match[1] ? Number(match[1]) : 0;
    const end = suffix !== null ? size - 1 : match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const stream = Readable.toWeb(createReadStream(row.filePath, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(createReadStream(row.filePath)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, 'Content-Length': String(size) } });
});
