/**
 * Tirages au hasard dans la bibliothèque : bulles 🎲 du composer (une catégorie, dans toute la liste, les favoris
 * ou une sélection) et syntaxe du texte libre (`__catégorie__`, `{café|parc}`, `{2::café|parc}`).
 * Un tirage par image : appelé à chaque préparation d'une génération.
 */
import { randomInt } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Gender, TraitSlot } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { libraryCategories, libraryOptions } from '../db/schema.js';

type OptionRow = typeof libraryOptions.$inferSelect;

/** Tirage pondéré (`weight`). */
function weighted<T>(items: T[], weightOf: (item: T) => number): T | null {
  if (!items.length) return null;
  const total = items.reduce((n, i) => n + Math.max(weightOf(i), 0), 0);
  if (total <= 0) return items[randomInt(items.length)];
  let r = Math.random() * total;
  for (const item of items) {
    r -= Math.max(weightOf(item), 0);
    if (r <= 0) return item;
  }
  return items.at(-1)!;
}

/** Options tirables : visibles et du genre du personnage (ou pour les deux). */
const usable = (options: OptionRow[], gender: Gender | null) =>
  options.filter(o => !o.hidden && (!gender || !o.gender || o.gender === gender));

/** Une option par bulle 🎲. La sélection ou les favoris vides retombent sur toute la liste. */
export async function drawSlots(
  userId: string,
  slots: Pick<TraitSlot, 'categoryId' | 'drawFrom' | 'pool'>[],
  gender: Gender | null,
): Promise<string[]> {
  if (!slots.length) return [];
  const rows = await db
    .select({ o: libraryOptions })
    .from(libraryOptions)
    .innerJoin(libraryCategories, eq(libraryCategories.id, libraryOptions.categoryId))
    .where(and(inArray(libraryOptions.categoryId, slots.map(s => s.categoryId)), eq(libraryCategories.userId, userId)));
  const drawn: string[] = [];
  for (const slot of slots) {
    const all = usable(
      rows.map(r => r.o).filter(o => o.categoryId === slot.categoryId),
      gender,
    );
    const pool =
      slot.drawFrom === 'pool' ? all.filter(o => slot.pool.includes(o.id)) : slot.drawFrom === 'favorites' ? all.filter(o => o.favorite) : all;
    const pick = weighted(pool.length ? pool : all, o => o.weight);
    if (pick) drawn.push(pick.id);
  }
  return drawn;
}

const WILDCARD = /__([a-z0-9_/-]+)__/gi;
/** `{…}` sans accolade imbriquée : on résout de l'intérieur vers l'extérieur. */
const VARIANTS = /\{([^{}]*\|[^{}]*)\}/g;
const MAX_DEPTH = 5;

/**
 * Résout la syntaxe du texte libre. `__clé__` : une option de la catégorie (avec sa tournure) ; `{a|b}` : une variante ;
 * `{2::a|b}` : variantes pondérées. Une option peut elle-même contenir de la syntaxe (5 niveaux au plus).
 * Une wildcard inconnue reste telle quelle et est signalée.
 */
export async function resolveWildcards(
  userId: string,
  text: string,
  gender: Gender | null,
): Promise<{ text: string; unknown: string[]; randomized: boolean }> {
  if (!text.includes('__') && !/\{[^{}]*\|/.test(text)) return { text, unknown: [], randomized: false };
  const categories = await db
    .select({ id: libraryCategories.id, key: libraryCategories.key, phrase: libraryCategories.phrase })
    .from(libraryCategories)
    .where(eq(libraryCategories.userId, userId));
  const byKey = new Map(categories.map(c => [c.key.toLowerCase(), c]));
  const optionCache = new Map<string, OptionRow[]>();
  const unknown = new Set<string>();
  let randomized = false;

  let out = text;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const before = out;
    // Variantes `{…|…}`.
    out = out.replace(VARIANTS, (_, body: string) => {
      randomized = true;
      const parts = body.split('|').map(p => {
        const m = /^\s*(\d+(?:\.\d+)?)::(.*)$/s.exec(p);
        return m ? { weight: Number(m[1]), text: m[2] } : { weight: 1, text: p };
      });
      return weighted(parts, p => p.weight)?.text.trim() ?? '';
    });
    // Wildcards `__clé__` (asynchrone : on collecte puis on remplace).
    const keys = [...new Set([...out.matchAll(WILDCARD)].map(m => m[1].toLowerCase()))];
    const picks = new Map<string, string>();
    for (const key of keys) {
      const category = byKey.get(key);
      if (!category) {
        unknown.add(key);
        continue;
      }
      if (!optionCache.has(category.id)) {
        optionCache.set(category.id, await db.select().from(libraryOptions).where(eq(libraryOptions.categoryId, category.id)));
      }
      randomized = true;
      // Une option par occurrence : deux `__tenue__` peuvent tirer deux tenues différentes.
      picks.set(key, category.id);
    }
    out = out.replace(WILDCARD, (whole, raw: string) => {
      const categoryId = picks.get(raw.toLowerCase());
      if (!categoryId) return whole;
      const category = categories.find(c => c.id === categoryId)!;
      const pick = weighted(usable(optionCache.get(categoryId) ?? [], gender), o => o.weight);
      if (!pick) return '';
      return category.phrase.includes('{option}') ? category.phrase.replaceAll('{option}', pick.fragment) : pick.fragment;
    });
    if (out === before) break;
  }
  return { text: out.replace(/\s{2,}/g, ' ').trim(), unknown: [...unknown], randomized };
}
