/**
 * Corbeille : un persona ou un fil supprimé est d'abord masqué (`deleted_at`).
 * Supprimer un persona met aussi ses fils à la corbeille, avec la même date :
 * c'est ce qui permet de les restaurer ensemble.
 * Après 7 jours (ou en vidant la corbeille), les lignes sont supprimées et les
 * fichiers locaux partent dans la Corbeille du système, jamais effacés d'office.
 */
import { and, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { unlink } from 'node:fs/promises';
import trash from 'trash';
import { env } from '../env.js';
import type { TrashResponse } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, personas, threads } from '../db/schema.js';
import { toAsset } from './serialize.js';

export const TRASH_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const purgeAt = (deletedAt: Date) => new Date(deletedAt.getTime() + TRASH_DAYS * DAY_MS).toISOString();

// ── Mise à la corbeille / restauration ────────────────────────

export async function trashPersona(userId: string, personaId: string): Promise<boolean> {
  const now = new Date();
  return db.transaction(async tx => {
    const [row] = await tx
      .update(personas)
      .set({ deletedAt: now })
      .where(and(eq(personas.id, personaId), eq(personas.userId, userId), isNull(personas.deletedAt)))
      .returning({ id: personas.id });
    if (!row) return false;
    await tx
      .update(threads)
      .set({ deletedAt: now })
      // Filtre par utilisateur : jamais les fils d'un autre compte, même rattachés à ce persona.
      .where(and(eq(threads.userId, userId), eq(threads.personaId, personaId), isNull(threads.deletedAt)));
    return true;
  });
}

export async function restorePersona(userId: string, personaId: string): Promise<boolean> {
  return db.transaction(async tx => {
    const [p] = await tx
      .select({ deletedAt: personas.deletedAt })
      .from(personas)
      .where(and(eq(personas.id, personaId), eq(personas.userId, userId), isNotNull(personas.deletedAt)))
      .limit(1);
    if (!p?.deletedAt) return false;
    // Seuls les fils supprimés avec le persona reviennent avec lui.
    await tx
      .update(threads)
      .set({ deletedAt: null })
      .where(and(eq(threads.userId, userId), eq(threads.personaId, personaId), eq(threads.deletedAt, p.deletedAt)));
    await tx.update(personas).set({ deletedAt: null }).where(eq(personas.id, personaId));
    return true;
  });
}

export async function trashThread(userId: string, threadId: string): Promise<boolean> {
  const [row] = await db
    .update(threads)
    .set({ deletedAt: new Date() })
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId), isNull(threads.deletedAt)))
    .returning({ id: threads.id });
  return Boolean(row);
}

export async function restoreThread(userId: string, threadId: string): Promise<boolean> {
  const [t] = await db
    .select({ personaId: threads.personaId, personaDeleted: personas.deletedAt })
    .from(threads)
    .leftJoin(personas, eq(personas.id, threads.personaId))
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId), isNotNull(threads.deletedAt)))
    .limit(1);
  if (!t) return false;
  // Son persona est encore à la corbeille : le fil revient dans « Tous les fils ».
  await db
    .update(threads)
    .set({ deletedAt: null, ...(t.personaDeleted ? { personaId: null } : {}) })
    .where(eq(threads.id, threadId));
  return true;
}

// ── Contenu de la corbeille ───────────────────────────────────

export async function listTrash(userId: string): Promise<TrashResponse> {
  const ps = await db
    .select({
      p: personas,
      threadCount: sql<number>`(select count(*)::int from threads t where t.persona_id = "personas"."id" and t.deleted_at = "personas"."deleted_at")`,
    })
    .from(personas)
    .where(and(eq(personas.userId, userId), isNotNull(personas.deletedAt)))
    .orderBy(sql`${personas.deletedAt} desc`);

  const avatarIds = ps.map(r => r.p.avatarAssetId).filter((id): id is string => Boolean(id));
  const avatars = avatarIds.length ? await db.select().from(assets).where(inArray(assets.id, avatarIds)) : [];
  const avatarUrl = new Map(avatars.map(a => [a.id, toAsset(a).url]));

  // Fils supprimés un par un (pas ceux partis avec leur persona, rangés sous le persona).
  const ts = await db
    .select({
      t: threads,
      personaName: personas.name,
      coverAssetId: sql<string | null>`(select a.id from assets a inner join generations g on g.id = a.generation_id where g.thread_id = "threads"."id" and a.media_type = 'image' order by a.created_at desc limit 1)`,
    })
    .from(threads)
    .leftJoin(personas, eq(personas.id, threads.personaId))
    .where(
      and(
        eq(threads.userId, userId),
        isNotNull(threads.deletedAt),
        or(isNull(personas.deletedAt), sql`${personas.deletedAt} <> ${threads.deletedAt}`),
      ),
    )
    .orderBy(sql`${threads.deletedAt} desc`);

  return {
    days: TRASH_DAYS,
    personas: ps.map(({ p, threadCount }) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      avatarUrl: p.avatarAssetId ? (avatarUrl.get(p.avatarAssetId) ?? null) : null,
      threadCount,
      deletedAt: p.deletedAt!.toISOString(),
      purgeAt: purgeAt(p.deletedAt!),
    })),
    threads: ts.map(({ t, personaName, coverAssetId }) => ({
      id: t.id,
      title: t.title,
      personaName: personaName ?? null,
      coverUrl: coverAssetId ? `/api/media/${coverAssetId}` : null,
      deletedAt: t.deletedAt!.toISOString(),
      purgeAt: purgeAt(t.deletedAt!),
    })),
  };
}

// ── Suppression définitive ────────────────────────────────────

export interface PurgeTarget {
  userId?: string;
  personaIds?: string[];
  threadIds?: string[];
  /** Tout ce qui est à la corbeille depuis plus de 7 jours. */
  expired?: boolean;
}

/** Supprime pour de bon ; les fichiers locaux partent dans la Corbeille du système. */
export async function purge(target: PurgeTarget): Promise<{ personas: number; threads: number; files: number }> {
  const cutoff = new Date(Date.now() - TRASH_DAYS * DAY_MS);
  const scope = (col: typeof personas.userId | typeof threads.userId) => (target.userId ? eq(col, target.userId) : undefined);

  const personaFilter = target.expired
    ? lt(personas.deletedAt, cutoff)
    : target.personaIds?.length
      ? inArray(personas.id, target.personaIds)
      : null;
  const personaIds = personaFilter
    ? (
        await db
          .select({ id: personas.id })
          .from(personas)
          .where(and(isNotNull(personas.deletedAt), scope(personas.userId), personaFilter))
      ).map(r => r.id)
    : [];

  // Fils visés + fils partis avec ces personas.
  const threadRows = await db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        isNotNull(threads.deletedAt),
        scope(threads.userId),
        or(
          target.expired ? lt(threads.deletedAt, cutoff) : undefined,
          target.threadIds?.length ? inArray(threads.id, target.threadIds) : undefined,
          personaIds.length ? inArray(threads.personaId, personaIds) : undefined,
        ) ?? sql`false`,
      ),
    );
  const threadIds = threadRows.map(r => r.id);
  if (!personaIds.length && !threadIds.length) return { personas: 0, threads: 0, files: 0 };

  // `x in ()` est invalide et `x not in (null)` vaut NULL : on traite les listes vides à part.
  const list = (ids: string[]) => sql.join(ids.map(id => sql`${id}::uuid`), sql`, `);
  const isIn = (col: SQL, ids: string[]) => (ids.length ? sql`${col} in (${list(ids)})` : sql`false`);
  const notIn = (col: SQL, ids: string[]) => (ids.length ? sql`${col} not in (${list(ids)})` : sql`true`);

  // Médias concernés : résultats des fils supprimés + médias des personas supprimés…
  // …sauf ceux encore utilisés ailleurs (référence d'un autre persona, pièce jointe
  // d'une génération conservée, avatar).
  const doomed = await db
    .select({ id: assets.id, filePath: assets.filePath })
    .from(assets)
    .where(
      and(
        or(
          sql`${assets.generationId} in (select g.id from generations g where ${isIn(sql`g.thread_id`, threadIds)})`,
          // Médias propres au persona (imports, références, avatar) : pas les résultats
          // de génération, qui suivent leur fil (un fil déplacé vers un autre persona
          // garde ses images).
          and(isIn(sql`${assets.personaId}`, personaIds), isNull(assets.generationId)),
        ),
        sql`not (${assets.isReference} and ${assets.personaId} is not null and ${notIn(sql`${assets.personaId}`, personaIds)})`,
        sql`not exists (select 1 from generations g where g.reference_asset_ids ? ${assets.id}::text and ${notIn(sql`g.thread_id`, threadIds)})`,
        sql`not exists (select 1 from personas p where p.avatar_asset_id = ${assets.id} and ${notIn(sql`p.id`, personaIds)})`,
        sql`not exists (select 1 from users u where u.avatar_asset_id = ${assets.id})`,
      ),
    );

  let files = 0;
  const paths = [...new Set(doomed.map(a => a.filePath))];
  if (paths.length) {
    try {
      // Tests : fichiers de test supprimés directement (pas dans la corbeille du Mac).
      if (env.NODE_ENV === 'test') await Promise.all(paths.map(p => unlink(p).catch(() => {})));
      else await trash(paths, { glob: false });
      files = paths.length;
    } catch (err) {
      // Fichier déjà absent ou corbeille indisponible : on garde les fichiers, on supprime quand même les entrées.
      console.error('[corbeille] fichiers non déplacés :', (err as Error).message);
    }
  }

  await db.transaction(async tx => {
    if (doomed.length) await tx.delete(assets).where(inArray(assets.id, doomed.map(a => a.id)));
    if (threadIds.length) await tx.delete(threads).where(inArray(threads.id, threadIds)); // générations en cascade
    if (personaIds.length) await tx.delete(personas).where(inArray(personas.id, personaIds));
  });

  return { personas: personaIds.length, threads: threadIds.length, files };
}

/** Nettoyage automatique : au démarrage puis toutes les heures. */
export function schedulePurge(): void {
  const run = () =>
    purge({ expired: true })
      .then(r => {
        if (r.personas || r.threads) {
          console.log(`🗑️  Corbeille : ${r.personas} persona(s), ${r.threads} fil(s), ${r.files} fichier(s) déplacé(s).`);
        }
      })
      .catch(err => console.error('[corbeille]', err));
  void run();
  setInterval(run, 60 * 60 * 1000).unref();
}
