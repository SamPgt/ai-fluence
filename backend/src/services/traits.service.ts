/**
 * Traits : options de la bibliothèque choisies dans le composer (bulles). Assemblés en une phrase en
 * langage naturel, zone par zone, plutôt qu'en liste de mots-clés : c'est ce qu'attendent Z-Image, Flux, Qwen.
 *
 *   « A woman with long beach waves and light freckles, wearing a red summer dress, a soft smile,
 *     a cozy bedroom, golden hour light »
 *
 * Sans point final : le texte libre de l'utilisateur la prolonge (« …, reading a book »).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { LIBRARY_ZONES, type Gender, type GenerationTrait, type LibraryZone } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { libraryCategories, libraryOptions, libraryThumbnails } from '../db/schema.js';
import { mediaUrl } from './serialize.js';

/** « a, b and c » */
function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** Mots qui désignent le lieu lui-même (une pièce, un endroit), placés en tête de la phrase du lieu. */
const PLACE_HEAD =
  /\b(room|bedroom|kitchen|bathroom|living room|office|studio|loft|apartment|house|caf[eé]|coffee shop|restaurant|bar|pub|club|street|alley|avenue|square|beach|park|garden|terrace|balcony|rooftop|pool|gym|shop|store|boutique|library|hotel|forest|mountain|lake|city|subway|station|airport|car|market)\b/i;

/**
 * Phrase du lieu : la pièce ou l'endroit d'abord, le reste en « with » (« a sunny kitchen with a wooden desk »), au
 * lieu de « a wooden desk and a sunny kitchen ».
 */
export function placePhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  const head = items.findIndex(t => PLACE_HEAD.test(t));
  if (head < 0) return list(items);
  const rest = items.filter((_, i) => i !== head);
  return `${items[head]} with ${list(rest)}`;
}

/**
 * Bloc « Photo » : nommer l'appareil (« smartphone photo », « shot on an iPhone ») fait apparaître un téléphone dans
 * l'image (2 images sur 3 avec Z-Image, vu en test). On décrit l'effet à la place.
 */
export function withoutDevice(text: string): string {
  return text
    .replace(/\bshot on an? (?:iphone|smartphone|phone)\b/gi, 'casual handheld shot')
    .replace(/\b(?:iphone|smartphone|phone)(?: front)?(?: camera)? (photo|picture|snapshot|selfie|video)\b/gi, 'handheld $1')
    .replace(/\b(?:iphone|smartphone|phone)[- ]camera look\b/gi, 'casual handheld look');
}

/** Phrase des traits : personnage (avec ses traits), tenue, pose, lieu, photo. */
export function assembleTraits(items: { zone: LibraryZone; text: string }[], gender: Gender | null): string {
  const by = (zone: LibraryZone) => items.filter(i => i.zone === zone).map(i => i.text);
  const [character, outfit, action, place, photo] = (['character', 'outfit', 'action', 'place', 'photo'] as const).map(by);
  const pieces: string[] = [];
  // Le sujet n'est nommé que si un trait porte sur une personne.
  if (character.length || outfit.length || action.length) {
    const subject = gender === 'female' ? 'a woman' : gender === 'male' ? 'a man' : 'a person';
    pieces.push(character.length ? `${subject} with ${list(character)}` : subject);
  }
  if (outfit.length) pieces.push(`wearing ${list(outfit)}`);
  if (action.length) pieces.push(list(action));
  if (place.length) pieces.push(placePhrase(place));
  if (photo.length) pieces.push(list(photo.map(withoutDevice)));
  const sentence = pieces.join(', ');
  return sentence ? `${sentence[0].toUpperCase()}${sentence.slice(1)}` : '';
}

/**
 * Charge les traits demandés (options du compte uniquement), dans l'ordre des zones puis de la demande,
 * avec la miniature du genre du personnage, et renvoie la phrase assemblée.
 */
export async function resolveTraits(
  userId: string,
  optionIds: string[],
  gender: Gender | null,
): Promise<{ traits: GenerationTrait[]; sentence: string }> {
  if (!optionIds.length) return { traits: [], sentence: '' };
  const rows = await db
    .select({ option: libraryOptions, category: libraryCategories })
    .from(libraryOptions)
    .innerJoin(libraryCategories, eq(libraryCategories.id, libraryOptions.categoryId))
    .where(and(inArray(libraryOptions.id, optionIds), eq(libraryCategories.userId, userId)));
  const byId = new Map(rows.map(r => [r.option.id, r]));
  const zoneOrder = (z: LibraryZone) => LIBRARY_ZONES.findIndex(d => d.id === z);
  const ordered = optionIds
    .map(id => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .sort((a, b) => zoneOrder(a.category.zone) - zoneOrder(b.category.zone));

  // Miniature : version du genre du personnage (femme par défaut), ou version unique d'une catégorie sans genre.
  const wanted = gender ?? 'female';
  const thumbs = await db
    .select({ optionId: libraryThumbnails.optionId, gender: libraryThumbnails.gender, assetId: libraryThumbnails.assetId })
    .from(libraryThumbnails)
    .where(inArray(libraryThumbnails.optionId, ordered.map(r => r.option.id)));
  const thumbOf = (optionId: string, optionGender: Gender | null) => {
    const own = thumbs.filter(t => t.optionId === optionId && t.assetId);
    const pick =
      own.find(t => t.gender === (optionGender ?? wanted)) ?? own.find(t => t.gender === 'any') ?? own[0];
    return pick?.assetId ? mediaUrl(pick.assetId) : null;
  };

  const traits: GenerationTrait[] = ordered.map(({ option, category }) => ({
    optionId: option.id,
    categoryId: category.id,
    categoryLabel: category.label,
    zone: category.zone,
    label: option.label,
    fragment: option.fragment,
    thumbnailUrl: thumbOf(option.id, option.gender),
  }));
  const sentence = assembleTraits(
    ordered.map(({ option, category }) => ({
      zone: category.zone,
      text: category.phrase.includes('{option}') ? category.phrase.replaceAll('{option}', option.fragment) : option.fragment,
    })),
    gender,
  );
  return { traits, sentence };
}
