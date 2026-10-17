/**
 * Corbeille : un persona, un fil ou un workflow supprimé est d'abord masqué (`deleted_at`).
 * Un fil n'appartient plus à un persona : supprimer un persona ne touche pas aux fils
 * (seules ses références et ses LoRA partent avec lui).
 * Après 7 jours (ou en vidant la corbeille), les lignes sont supprimées et les
 * fichiers locaux partent dans la Corbeille du système, jamais effacés d'office.
 */
import { and, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { unlink } from 'node:fs/promises';
import trash from 'trash';
import { env } from '../env.js';
import type { TrashResponse } from '@sublime/shared';
import { db } from '../db/index.js';
import { assets, personas, threads, workflows } from '../db/schema.js';
import { toAsset } from './serialize.js';

export const TRASH_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const purgeAt = (deletedAt: Date) => new Date(deletedAt.getTime() + TRASH_DAYS * DAY_MS).toISOString();

// ── Mise à la corbeille / restauration ────────────────────────

export async function trashPersona(userId: string, personaId: string): Promise<boolean> {
  const [row] = await db
    .update(personas)
    .set({ deletedAt: new Date() })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId), isNull(personas.deletedAt)))
    .returning({ id: personas.id });
  return Boolean(row);
}

export async function restorePersona(userId: string, personaId: string): Promise<boolean> {
  const [row] = await db
    .update(personas)
    .set({ deletedAt: null })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId), isNotNull(personas.deletedAt)))
    .returning({ id: personas.id });
  return Boolean(row);
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
  const [row] = await db
    .update(threads)
    .set({ deletedAt: null })
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId), isNotNull(threads.deletedAt)))
    .returning({ id: threads.id });
  return Boolean(row);
}

export async function trashWorkflow(userId: string, workflowId: string): Promise<boolean> {
  const [row] = await db
    .update(workflows)
    .set({ deletedAt: new Date() })
    .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId), isNull(workflows.deletedAt)))
    .returning({ id: workflows.id });
  return Boolean(row);
}

export async function restoreWorkflow(userId: string, workflowId: string): Promise<boolean> {
  const [row] = await db
    .update(workflows)
    .set({ deletedAt: null })
    .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId), isNotNull(workflows.deletedAt)))
    .returning({ id: workflows.id });
  return Boolean(row);
}

// ── Contenu de la corbeille ───────────────────────────────────

export async function listTrash(userId: string): Promise<TrashResponse> {
  const ps = await db
    .select({
      p: personas,
      referenceCount: sql<number>`(select count(*)::int from assets a where a.persona_id = "personas"."id" and a.is_reference)`,
    })
    .from(personas)
    .where(and(eq(personas.userId, userId), isNotNull(personas.deletedAt)))
    .orderBy(sql`${personas.deletedAt} desc`);

  const avatarIds = ps.map(r => r.p.avatarAssetId).filter((id): id is string => Boolean(id));
  const avatars = avatarIds.length ? await db.select().from(assets).where(inArray(assets.id, avatarIds)) : [];
  const avatarUrl = new Map(avatars.map(a => [a.id, toAsset(a).url]));

  const ts = await db
    .select({
      t: threads,
      coverAssetId: sql<string | null>`(select a.id from assets a inner join generations g on g.id = a.generation_id where g.thread_id = "threads"."id" and a.media_type = 'image' order by a.created_at desc limit 1)`,
    })
    .from(threads)
    .where(and(eq(threads.userId, userId), isNotNull(threads.deletedAt)))
    .orderBy(sql`${threads.deletedAt} desc`);

  const ws = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.userId, userId), isNotNull(workflows.deletedAt)))
    .orderBy(sql`${workflows.deletedAt} desc`);

  return {
    days: TRASH_DAYS,
    personas: ps.map(({ p, referenceCount }) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      avatarUrl: p.avatarAssetId ? (avatarUrl.get(p.avatarAssetId) ?? null) : null,
      referenceCount,
      deletedAt: p.deletedAt!.toISOString(),
      purgeAt: purgeAt(p.deletedAt!),
    })),
    threads: ts.map(({ t, coverAssetId }) => ({
      id: t.id,
      title: t.title,
      coverUrl: coverAssetId ? `/api/media/${coverAssetId}` : null,
      deletedAt: t.deletedAt!.toISOString(),
      purgeAt: purgeAt(t.deletedAt!),
    })),
    workflows: ws.map(w => ({
      id: w.id,
      name: w.name,
      nodeCount: w.graph.nodes.length,
      deletedAt: w.deletedAt!.toISOString(),
      purgeAt: purgeAt(w.deletedAt!),
    })),
  };
}

// ── Suppression définitive ────────────────────────────────────

export interface PurgeTarget {
  userId?: string;
  personaIds?: string[];
  threadIds?: string[];
  workflowIds?: string[];
  /** Tout ce qui est à la corbeille depuis plus de 7 jours. */
  expired?: boolean;
}

/** Supprime pour de bon ; les fichiers locaux partent dans la Corbeille du système. */
export async function purge(
  target: PurgeTarget,
): Promise<{ personas: number; threads: number; workflows: number; files: number }> {
  const cutoff = new Date(Date.now() - TRASH_DAYS * DAY_MS);
  const workflowFilter = target.expired
    ? lt(workflows.deletedAt, cutoff)
    : target.workflowIds?.length
      ? inArray(workflows.id, target.workflowIds)
      : null;
  const workflowIds = workflowFilter
    ? (
        await db
          .select({ id: workflows.id })
          .from(workflows)
          .where(and(isNotNull(workflows.deletedAt), target.userId ? eq(workflows.userId, target.userId) : undefined, workflowFilter))
      ).map(r => r.id)
    : [];
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

  // Fils visés (un persona n'emporte plus ses fils).
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
        ) ?? sql`false`,
      ),
    );
  const threadIds = threadRows.map(r => r.id);
  if (!personaIds.length && !threadIds.length && !workflowIds.length) {
    return { personas: 0, threads: 0, workflows: 0, files: 0 };
  }

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
          sql`${assets.generationId} in (select g.id from generations g where ${isIn(sql`g.thread_id`, threadIds)} or ${isIn(sql`g.workflow_id`, workflowIds)})`,
          // Couverture importée d'un workflow supprimé (un résultat choisi comme couverture suit sa génération).
          and(
            sql`${assets.id} in (select w.cover_asset_id from workflows w where ${isIn(sql`w.id`, workflowIds)})`,
            eq(assets.kind, 'upload'),
          ),
          // Médias propres au persona (imports, références, avatar) : pas les résultats
          // de génération, qui suivent leur fil (un fil déplacé vers un autre persona
          // garde ses images).
          and(isIn(sql`${assets.personaId}`, personaIds), isNull(assets.generationId)),
        ),
        sql`not (${assets.isReference} and ${assets.personaId} is not null and ${notIn(sql`${assets.personaId}`, personaIds)})`,
        // Encore utilisé comme référence par une génération conservée (d'un fil ou d'un workflow).
        sql`not exists (select 1 from generations g where g.reference_asset_ids ? ${assets.id}::text and (g.thread_id is null or ${notIn(sql`g.thread_id`, threadIds)}) and (g.workflow_id is null or ${notIn(sql`g.workflow_id`, workflowIds)}))`,
        sql`not exists (select 1 from personas p where p.avatar_asset_id = ${assets.id} and ${notIn(sql`p.id`, personaIds)})`,
        sql`not exists (select 1 from users u where u.avatar_asset_id = ${assets.id})`,
        sql`not exists (select 1 from workflows w where w.cover_asset_id = ${assets.id} and ${notIn(sql`w.id`, workflowIds)})`,
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
    if (workflowIds.length) await tx.delete(workflows).where(inArray(workflows.id, workflowIds)); // idem
    if (personaIds.length) {
      // Médias gardés (encore utilisés ailleurs) : ils quittent les références, sinon ils
      // réapparaîtraient dans Général une fois le persona supprimé.
      await tx.update(assets).set({ isReference: false }).where(inArray(assets.personaId, personaIds));
      await tx.delete(personas).where(inArray(personas.id, personaIds));
    }
  });

  return { personas: personaIds.length, threads: threadIds.length, workflows: workflowIds.length, files };
}

/** Nettoyage automatique : au démarrage puis toutes les heures. */
export function schedulePurge(): void {
  const run = () =>
    purge({ expired: true })
      .then(r => {
        if (r.personas || r.threads || r.workflows) {
          console.log(
            `🗑️  Corbeille : ${r.personas} persona(s), ${r.threads} fil(s), ${r.workflows} workflow(s), ${r.files} fichier(s) déplacé(s).`,
          );
        }
      })
      .catch(err => console.error('[corbeille]', err));
  void run();
  setInterval(run, 60 * 60 * 1000).unref();
}
