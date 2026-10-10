/**
 * Miniatures de la bibliothèque : une image type par option (et par version femme / homme pour les
 * catégories genrées), avec le modèle choisi pour la catégorie (Z-Image en local par défaut).
 *
 * - Modèle local : la miniature va directement dans la file de ComfyUI (basse résolution), est suivie ici,
 *   puis enregistrée comme asset `thumbnail` (hors galerie).
 * - Modèle API (SpicyAPI, payant) : elle passe par une génération ordinaire dans un fil masqué
 *   (« Miniatures de la bibliothèque »), et l'image produite devient la miniature.
 */
import { randomInt } from 'node:crypto';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { getZone, type Gender, type LibraryThumbnail, type ThumbnailGender, type ThumbnailQuote } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { assets, generations, libraryCategories, libraryOptions, libraryThumbnails, threads, users } from '../db/schema.js';
import type { SessionUser } from '../types.js';
import { getCatalog } from './spicy.service.js';
import { MAX_SEED, buildGraph, localEndpoint } from './comfy-workflows.js';
import { createGeneration, quoteGeneration } from './generation.service.js';
import { cancelPrompt, deleteOutputFile, downloadFile, getPromptState, queuePrompt } from './comfy.service.js';
import { mediaUrl } from './serialize.js';
import { getSettingsRow, mediaDirOf, slug } from './settings.service.js';
import { extFor, saveFile } from './storage.service.js';

type CategoryRow = typeof libraryCategories.$inferSelect;
type OptionRow = typeof libraryOptions.$inferSelect;
type ThumbnailRow = typeof libraryThumbnails.$inferSelect;

/** Modèle des miniatures par défaut : Z-Image en local. */
export const DEFAULT_THUMBNAIL_FAMILY = 'local/z-image-turbo';

/** Fil masqué qui reçoit les miniatures faites avec un modèle API. */
const THUMBNAILS_THREAD = 'Miniatures de la bibliothèque';

/** Basse résolution : une miniature n'a pas besoin de plus, et la génération est ~4× plus rapide. */
const PORTRAIT = { width: 512, height: 640 };
const LANDSCAPE = { width: 640, height: 512 };

const POLL_MS = 1500;

// ── Prompt ────────────────────────────────────────────────────

/** Personnes variées : la miniature montre l'option, pas une personne en particulier. */
const ORIGINS = ['East Asian', 'Black', 'South Asian', 'Southeast Asian', 'Middle Eastern', 'white European', 'mixed-race'];

/** `{subject}` : une personne d'origine tirée au hasard. */
function subjectFor(g: Gender, decade: string): string {
  const origin =
    randomInt(ORIGINS.length + 1) === ORIGINS.length ? (g === 'female' ? 'Latina' : 'Latino') : ORIGINS[randomInt(ORIGINS.length)];
  return g === 'female' ? `a young ${origin} woman in her ${decade}` : `a young ${origin} man in his ${decade}`;
}

/** `{person}` : le genre seul, sans origine (couleur de peau, des yeux… : pas de contradiction avec l'option). */
function personFor(g: Gender, decade: string): string {
  return g === 'female' ? `a young woman in her ${decade}` : `a young man in his ${decade}`;
}

/** `{femme: … | homme: …}` : la branche du genre de la miniature (ex. crop top pour elle, torse nu pour lui). */
const GENDER_ALTERNATIVE = /\{\s*femme\s*:([^|{}]*)\|\s*homme\s*:([^{}]*)\}/gi;

export function templateOf(category: Pick<CategoryRow, 'thumbnailTemplate' | 'zone'>): string {
  return category.thumbnailTemplate.trim() || getZone(category.zone).thumbnailTemplate;
}

function promptFor(category: CategoryRow, option: OptionRow, gender: ThumbnailGender): string {
  // Catégorie sans genre : une personne au hasard, la même pour tout le gabarit.
  const g: Gender = gender === 'any' ? (randomInt(2) ? 'female' : 'male') : gender;
  const decade = randomInt(2) ? 'twenties' : 'thirties';
  // L'option avec la tournure de la catégorie (« black » → « black skin »), comme dans le prompt des générations.
  const text = category.phrase.includes('{option}') ? category.phrase.replaceAll('{option}', option.fragment) : option.fragment;
  // Les mots-clés d'abord : ils peuvent apparaître dans une branche femme / homme.
  return templateOf(category)
    .replaceAll('{option}', text)
    .replaceAll('{subject}', subjectFor(g, decade))
    .replaceAll('{person}', personFor(g, decade))
    .replace(GENDER_ALTERNATIVE, (_, female: string, male: string) => (g === 'female' ? female : male).trim())
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ');
}

/** Versions à générer : femme et/ou homme dans une catégorie genrée, une seule sinon. */
function gendersFor(category: CategoryRow, option: OptionRow): ThumbnailGender[] {
  if (!category.gendered) return ['any'];
  return option.gender ? [option.gender] : ['female', 'male'];
}

// ── Lecture ───────────────────────────────────────────────────

function toThumbnail(row: ThumbnailRow): LibraryThumbnail {
  return {
    optionId: row.optionId,
    gender: row.gender,
    status: row.status,
    url: row.assetId ? mediaUrl(row.assetId) : null,
    error: row.error,
    durationMs: row.durationMs,
    family: row.family,
  };
}

async function ownedCategory(userId: string, categoryId: string): Promise<CategoryRow> {
  const [row] = await db
    .select()
    .from(libraryCategories)
    .where(and(eq(libraryCategories.id, categoryId), eq(libraryCategories.userId, userId)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: 'Catégorie introuvable.' });
  return row;
}

async function thumbnailsOfCategory(categoryId: string): Promise<ThumbnailRow[]> {
  const rows = await db
    .select({ t: libraryThumbnails })
    .from(libraryThumbnails)
    .innerJoin(libraryOptions, eq(libraryOptions.id, libraryThumbnails.optionId))
    .where(eq(libraryOptions.categoryId, categoryId));
  return rows.map(r => r.t);
}

export async function listThumbnails(userId: string, categoryId: string): Promise<LibraryThumbnail[]> {
  await ownedCategory(userId, categoryId);
  return (await thumbnailsOfCategory(categoryId)).map(toThumbnail);
}

// ── Génération ────────────────────────────────────────────────

type CatalogFamily = Awaited<ReturnType<typeof getCatalog>>['families'][number];

/** Modèle des miniatures d'une catégorie, s'il est disponible (texte → image). */
async function thumbnailFamily(userId: string, category: CategoryRow): Promise<CatalogFamily> {
  const id = category.thumbnailFamily ?? DEFAULT_THUMBNAIL_FAMILY;
  const family = (await getCatalog(userId)).families.find(f => f.id === id);
  if (!family?.tasks['text-to-image']) throw new HTTPException(400, { message: 'Ce modèle ne génère pas d’image à partir d’un texte.' });
  if (!family.available) {
    throw new HTTPException(409, {
      message:
        family.provider === 'comfy'
          ? 'ComfyUI ne tourne pas : démarre-le depuis la barre latérale pour générer les miniatures.'
          : `${family.label} : ${family.unavailableReason ?? 'indisponible'}.`,
    });
  }
  return family;
}

/**
 * Paramètres d'une miniature avec un modèle API : proportions proches du 4:5 (portrait) ou du 5:4 (lieu),
 * et la plus petite résolution proposée (une miniature n'a pas besoin de plus, et coûte moins).
 */
function apiThumbnailParams(family: CatalogFamily, landscape: boolean): Record<string, unknown> {
  const props = family.tasks['text-to-image']!.schema.properties ?? {};
  const params: Record<string, unknown> = {};
  const ratios = (props.aspect_ratio?.enum ?? []).map(String);
  const wanted = landscape ? ['5:4', '4:3', '3:2', '16:9'] : ['4:5', '3:4', '2:3', '9:16'];
  const ratio = wanted.find(r => ratios.includes(r));
  if (ratio) params.aspect_ratio = ratio;
  const resolutions = props.resolution?.enum;
  if (resolutions?.length) params.resolution = resolutions[0];
  return params;
}

/** Fil masqué des miniatures API du compte (créé à la première). */
async function thumbnailsThread(userId: string): Promise<string> {
  const [thread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.userId, userId), eq(threads.hidden, true), eq(threads.title, THUMBNAILS_THREAD)))
    .limit(1);
  if (thread) return thread.id;
  const [created] = await db.insert(threads).values({ userId, title: THUMBNAILS_THREAD, hidden: true }).returning({ id: threads.id });
  return created.id;
}

/** Lance une miniature (ComfyUI en local, génération ordinaire pour un modèle API) et enregistre son suivi. */
async function queueThumbnail(user: SessionUser, family: CatalogFamily, category: CategoryRow, option: OptionRow, gender: ThumbnailGender) {
  const prompt = promptFor(category, option, gender);
  const landscape = category.zone === 'place';
  let comfyPromptId: string | null = null;
  let generationId: string | null = null;
  if (family.provider === 'comfy') {
    const endpoint = localEndpoint(family.tasks['text-to-image']!.modelId);
    if (!endpoint) throw new Error('Workflow des miniatures introuvable.');
    const size = landscape ? LANDSCAPE : PORTRAIT;
    comfyPromptId = await queuePrompt(await buildGraph(endpoint, { prompt, seed: randomInt(MAX_SEED), ...size }));
  } else {
    const { generation } = await createGeneration(user, {
      family: family.id,
      threadId: await thumbnailsThread(user.id),
      prompt,
      params: apiThumbnailParams(family, landscape),
      referenceAssetIds: [],
      contextIds: [],
      traitIds: [],
      count: 1,
    });
    generationId = generation.id;
  }
  await db
    .insert(libraryThumbnails)
    .values({ optionId: option.id, gender, status: 'queued', comfyPromptId, generationId, family: family.id, prompt })
    .onConflictDoUpdate({
      target: [libraryThumbnails.optionId, libraryThumbnails.gender],
      set: { status: 'queued', comfyPromptId, generationId, family: family.id, prompt, error: null, updatedAt: new Date() },
    });
}

/** Miniatures à générer : options visibles, versions femme / homme, sans celles déjà prêtes (`missing`) ni en cours. */
async function thumbnailsToGenerate(category: CategoryRow, mode: 'missing' | 'all') {
  const options = await db
    .select()
    .from(libraryOptions)
    .where(and(eq(libraryOptions.categoryId, category.id), eq(libraryOptions.hidden, false)))
    .orderBy(libraryOptions.position);
  const existing = new Map((await thumbnailsOfCategory(category.id)).map(t => [`${t.optionId}:${t.gender}`, t]));
  const todo: { option: OptionRow; gender: ThumbnailGender }[] = [];
  for (const option of options) {
    for (const gender of gendersFor(category, option)) {
      const current = existing.get(`${option.id}:${gender}`);
      if (current && (current.status === 'queued' || current.status === 'running')) continue;
      if (mode === 'missing' && current?.status === 'ready') continue;
      todo.push({ option, gender });
    }
  }
  return todo;
}

/** Devis : combien de miniatures, et leur coût avec le modèle de la catégorie (0 en local). */
export async function quoteCategoryThumbnails(user: SessionUser, categoryId: string, mode: 'missing' | 'all'): Promise<ThumbnailQuote> {
  const category = await ownedCategory(user.id, categoryId);
  const family = await thumbnailFamily(user.id, category);
  const todo = await thumbnailsToGenerate(category, mode);
  let unitCost = '0';
  if (family.provider !== 'comfy' && todo.length) {
    const quote = await quoteGeneration(user, {
      family: family.id,
      prompt: promptFor(category, todo[0].option, todo[0].gender),
      params: apiThumbnailParams(family, category.zone === 'place'),
      referenceAssetIds: [],
      contextIds: [],
      traitIds: [],
    });
    unitCost = quote.estimatedCost;
  }
  return {
    family: family.id,
    provider: family.provider,
    count: todo.length,
    unitCost,
    totalCost: String(Number((Number(unitCost) * todo.length).toFixed(6))),
  };
}

/**
 * Lance les miniatures d'une catégorie. `missing` : seulement celles qui n'existent pas encore (ou ont échoué) ;
 * `all` : tout régénérer. Renvoie le nombre de miniatures mises en file.
 */
export async function generateCategoryThumbnails(user: SessionUser, categoryId: string, mode: 'missing' | 'all'): Promise<number> {
  const category = await ownedCategory(user.id, categoryId);
  const family = await thumbnailFamily(user.id, category);
  const todo = await thumbnailsToGenerate(category, mode);
  for (const { option, gender } of todo) await queueThumbnail(user, family, category, option, gender);
  if (todo.length) void pollThumbnails();
  return todo.length;
}

/** Régénère la ou les miniatures d'une option (une version précise, ou toutes). */
export async function regenerateOptionThumbnail(user: SessionUser, optionId: string, gender?: ThumbnailGender): Promise<number> {
  const [row] = await db
    .select({ option: libraryOptions, category: libraryCategories })
    .from(libraryOptions)
    .innerJoin(libraryCategories, eq(libraryCategories.id, libraryOptions.categoryId))
    .where(and(eq(libraryOptions.id, optionId), eq(libraryCategories.userId, user.id)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: 'Option introuvable.' });
  const family = await thumbnailFamily(user.id, row.category);
  const genders = gendersFor(row.category, row.option).filter(g => !gender || g === gender);
  for (const g of genders) await queueThumbnail(user, family, row.category, row.option, g);
  if (genders.length) void pollThumbnails();
  return genders.length;
}

/**
 * Annule les miniatures en attente : retirées de la file de ComfyUI ; une ancienne image reste affichée.
 * Une miniature API déjà envoyée n'est plus suivie (la tâche continue chez SpicyAPI).
 */
async function cancelRows(rows: ThumbnailRow[]) {
  const pending = rows.filter(t => t.status === 'queued' || t.status === 'running');
  for (const t of pending) if (t.comfyPromptId) await cancelPrompt(t.comfyPromptId).catch(() => undefined);
  const withImage = pending.filter(t => t.assetId).map(t => t.id);
  const without = pending.filter(t => !t.assetId).map(t => t.id);
  if (withImage.length) {
    await db
      .update(libraryThumbnails)
      .set({ status: 'ready', comfyPromptId: null, generationId: null })
      .where(inArray(libraryThumbnails.id, withImage));
  }
  if (without.length) await db.delete(libraryThumbnails).where(inArray(libraryThumbnails.id, without));
  return pending.length;
}

export async function cancelCategoryThumbnails(userId: string, categoryId: string): Promise<number> {
  await ownedCategory(userId, categoryId);
  return cancelRows(await thumbnailsOfCategory(categoryId));
}

/** Avant de supprimer une option : annule ses miniatures encore en file. */
export async function cancelOptionThumbnails(optionId: string) {
  await cancelRows(await db.select().from(libraryThumbnails).where(eq(libraryThumbnails.optionId, optionId)));
}

/** Avant une suppression en masse : annule les miniatures en file de ces options. */
export async function cancelOptionsThumbnails(optionIds: string[]) {
  if (optionIds.length) await cancelRows(await db.select().from(libraryThumbnails).where(inArray(libraryThumbnails.optionId, optionIds)));
}

/** Avant de supprimer une catégorie : annule ses miniatures encore en file. */
export async function cancelCategoryThumbnailsUnchecked(categoryId: string) {
  await cancelRows(await thumbnailsOfCategory(categoryId));
}

// ── Suivi ─────────────────────────────────────────────────────

let polling = false;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Suit les miniatures en cours jusqu'à ce qu'il n'y en ait plus. Un seul suivi à la fois. */
export async function pollThumbnails(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      const rows = await db
        .select({ t: libraryThumbnails, categoryKey: libraryCategories.key, userId: libraryCategories.userId })
        .from(libraryThumbnails)
        .innerJoin(libraryOptions, eq(libraryOptions.id, libraryThumbnails.optionId))
        .innerJoin(libraryCategories, eq(libraryCategories.id, libraryOptions.categoryId))
        .where(inArray(libraryThumbnails.status, ['queued', 'running']));
      if (!rows.length) return;

      for (const { t, categoryKey, userId } of rows) {
        if (t.generationId) {
          await followGeneration(t);
          continue;
        }
        if (!t.comfyPromptId) continue;
        const family = (t.family ?? DEFAULT_THUMBNAIL_FAMILY) + '/text-to-image';
        const endpoint = localEndpoint(family);
        if (!endpoint) continue;
        let state: Awaited<ReturnType<typeof getPromptState>>;
        try {
          state = await getPromptState(t.comfyPromptId, endpoint.outputNode);
        } catch {
          continue; // ComfyUI injoignable un instant : on réessaie au tour suivant.
        }
        if (state.state === 'queued' || state.state === 'running') {
          if (state.state !== t.status) await db.update(libraryThumbnails).set({ status: state.state }).where(eq(libraryThumbnails.id, t.id));
        } else if (state.state === 'succeeded') {
          await storeThumbnail(t, userId, categoryKey, state.files[0], state.durationMs).catch(async err => {
            await db
              .update(libraryThumbnails)
              .set({ status: 'failed', error: (err as Error).message })
              .where(eq(libraryThumbnails.id, t.id));
          });
        } else {
          await db
            .update(libraryThumbnails)
            .set({
              status: 'failed',
              error: 'message' in state ? state.message : 'ComfyUI a redémarré avant la fin de la miniature.',
            })
            .where(eq(libraryThumbnails.id, t.id));
        }
      }
      await sleep(POLL_MS);
    }
  } catch (err) {
    console.error('[miniatures]', (err as Error).message);
  } finally {
    polling = false;
  }
}

/** Miniature API : suit sa génération ; l'image produite devient la miniature. */
async function followGeneration(t: ThumbnailRow) {
  const [generation] = await db
    .select({ status: generations.status, error: generations.errorMessage, durationMs: generations.durationMs })
    .from(generations)
    .where(eq(generations.id, t.generationId!))
    .limit(1);
  if (!generation) {
    await db.update(libraryThumbnails).set({ status: 'failed', error: 'Génération introuvable.' }).where(eq(libraryThumbnails.id, t.id));
  } else if (generation.status === 'succeeded') {
    const [output] = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.generationId, t.generationId!), eq(assets.kind, 'output')))
      .limit(1);
    await db
      .update(libraryThumbnails)
      .set(
        output
          ? { status: 'ready', assetId: output.id, generationId: null, error: null, durationMs: generation.durationMs, updatedAt: new Date() }
          : { status: 'failed', error: 'La génération n’a pas produit d’image.' },
      )
      .where(eq(libraryThumbnails.id, t.id));
  } else if (generation.status === 'failed') {
    await db
      .update(libraryThumbnails)
      .set({ status: 'failed', error: generation.error ?? 'La génération a échoué.', generationId: null })
      .where(eq(libraryThumbnails.id, t.id));
  } else if (generation.status !== t.status) {
    await db.update(libraryThumbnails).set({ status: generation.status }).where(eq(libraryThumbnails.id, t.id));
  }
}

async function storeThumbnail(
  t: ThumbnailRow,
  userId: string,
  categoryKey: string,
  file: Parameters<typeof downloadFile>[0],
  durationMs: number | null,
) {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  const dir = join(mediaDirOf(user, await getSettingsRow(userId)), 'miniatures', slug(categoryKey));
  const { data, mime } = await downloadFile(file);
  // Nom unique : une régénération ne réécrit pas l'ancienne image, encore affichée jusque-là.
  const saved = await saveFile(join(dir, `${t.optionId.slice(0, 8)}-${t.gender}-${Date.now()}.${extFor(mime)}`), data);
  const [asset] = await db
    .insert(assets)
    .values({ userId, kind: 'thumbnail', mediaType: 'image', mime, filePath: saved.path, bytes: saved.bytes })
    .returning({ id: assets.id });
  await db
    .update(libraryThumbnails)
    .set({ status: 'ready', assetId: asset.id, comfyPromptId: null, error: null, durationMs, updatedAt: new Date() })
    .where(eq(libraryThumbnails.id, t.id));
  await deleteOutputFile(file);
}
