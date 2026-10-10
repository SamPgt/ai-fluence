import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { personaPlaces, personas, places } from '../db/schema.js';
import { auth } from '../middleware/auth.js';
import { toPlace } from '../services/serialize.js';
import type { AppEnv } from '../types.js';

/** Lieux récurrents : liste, rattachement aux personnages, renommage, suppression (images conservées). */

const masterCount = sql<number>`(select count(*)::int from assets a where a.place_id = "places"."id" and a.is_master)`;

async function personaIdsOf(placeIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!placeIds.length) return map;
  const rows = await db.select().from(personaPlaces).where(inArray(personaPlaces.placeId, placeIds));
  for (const r of rows) map.set(r.placeId, [...(map.get(r.placeId) ?? []), r.personaId]);
  return map;
}

const placesRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/', async c => {
    const rows = await db
      .select({ place: places, masters: masterCount })
      .from(places)
      .where(eq(places.userId, c.get('user').id))
      .orderBy(desc(places.createdAt));
    const links = await personaIdsOf(rows.map(r => r.place.id));
    return c.json({ places: rows.map(r => toPlace(r.place, links.get(r.place.id) ?? [], r.masters)) });
  })
  .patch(
    '/:id',
    zValidator(
      'json',
      z
        .object({
          name: z.string().trim().min(1).max(40),
          defaultImageFamily: z.string().nullable(),
          /** Personnages rattachés (remplace la liste). */
          personaIds: z.array(z.uuid()).max(100),
        })
        .partial(),
    ),
    async c => {
      const user = c.get('user');
      const id = c.req.param('id');
      const { personaIds, ...fields } = c.req.valid('json');
      const [current] = await db
        .select()
        .from(places)
        .where(and(eq(places.id, id), eq(places.userId, user.id)))
        .limit(1);
      if (!current) return c.json({ error: 'Lieu introuvable.' }, 404);
      const [row] = Object.keys(fields).length
        ? await db
            .update(places)
            .set({ ...fields, updatedAt: new Date() })
            .where(eq(places.id, id))
            .returning()
        : [current];
      if (personaIds) {
        const owned = personaIds.length
          ? await db
              .select({ id: personas.id })
              .from(personas)
              .where(and(inArray(personas.id, personaIds), eq(personas.userId, user.id)))
          : [];
        await db.delete(personaPlaces).where(eq(personaPlaces.placeId, id));
        if (owned.length) await db.insert(personaPlaces).values(owned.map(p => ({ personaId: p.id, placeId: id })));
      }
      const [{ masters }] = await db.select({ masters: masterCount }).from(places).where(eq(places.id, id));
      return c.json({ place: toPlace(row, (await personaIdsOf([id])).get(id) ?? [], masters) });
    },
  )
  /** Retire le lieu de l'app ; ses images restent dans les fichiers (et les fils où elles apparaissent). */
  .delete('/:id', async c => {
    await db.delete(places).where(and(eq(places.id, c.req.param('id')), eq(places.userId, c.get('user').id)));
    return c.json({ ok: true });
  });

export default placesRoutes;
