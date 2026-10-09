/**
 * Zones de la bibliothèque : chaque catégorie de wildcards appartient à une partie du prompt.
 * La zone dit si la question du genre a un sens : une coiffure est souvent réservée aux femmes
 * ou aux hommes, une expression rarement, un objet ou un lieu jamais.
 */

export type LibraryZone = 'character' | 'outfit' | 'action' | 'place' | 'photo';

export interface LibraryZoneDef {
  id: LibraryZone;
  label: string;
  /** Exemples affichés pour guider le rangement. */
  hint: string;
  /**
   * Genre des options : `ask` = demandé à l'import (coiffures, tenues) ; `optional` = pas demandé,
   * mais possible pour quelques exceptions (poses) ; `none` = jamais (lieux, objets, lumières).
   */
  gender: 'ask' | 'optional' | 'none';
  /**
   * Prompt anglais des miniatures : `{option}` = le fragment de l'option, `{subject}` = une personne tirée
   * au hasard (« a young East Asian woman in her twenties »). Remplaçable par catégorie.
   */
  thumbnailTemplate: string;
}

export const LIBRARY_ZONES: LibraryZoneDef[] = [
  {
    id: 'character',
    label: 'Personnage',
    hint: 'Coiffures, couleurs de cheveux, yeux, peau, morphologie…',
    gender: 'ask',
    thumbnailTemplate:
      'Head and shoulders studio portrait photo of {subject} with {option}, wearing a plain grey t-shirt, plain light grey background, soft even lighting, sharp focus, realistic photo.',
  },
  {
    id: 'outfit',
    label: 'Tenue',
    hint: 'Hauts, robes, chaussures, accessoires…',
    gender: 'ask',
    thumbnailTemplate:
      'Full body studio photo of {subject} wearing {option}, standing, plain light grey background, soft even lighting, realistic photo.',
  },
  {
    id: 'action',
    label: 'Pose & action',
    hint: 'Poses, expressions, activités…',
    gender: 'optional',
    thumbnailTemplate: 'Photo of {subject}, {option}, simple neutral background, natural light, realistic photo.',
  },
  {
    id: 'place',
    label: 'Lieu & décor',
    hint: 'Pièces, mobilier, objets, moments de la journée…',
    gender: 'none',
    thumbnailTemplate: 'Wide photo of {option}, no people, natural light, realistic interior photography.',
  },
  {
    id: 'photo',
    label: 'Photo & ambiance',
    hint: 'Cadrages, lumières, rendus…',
    gender: 'none',
    thumbnailTemplate: 'Photo of {subject} sitting at a café table, {option}, realistic photo.',
  },
];

export function getZone(id: LibraryZone): LibraryZoneDef {
  return LIBRARY_ZONES.find(z => z.id === id) ?? LIBRARY_ZONES[0];
}

/**
 * Catégories dans l'ordre d'affichage : chaque catégorie de premier niveau suivie de ses sous-catégories.
 * `depth` : 0 pour une catégorie, 1 pour une sous-catégorie.
 */
export function orderCategories<T extends { id: string; parentId: string | null }>(categories: T[]): (T & { depth: 0 | 1 })[] {
  const ids = new Set(categories.map(c => c.id));
  const roots = categories.filter(c => !c.parentId || !ids.has(c.parentId));
  return roots.flatMap(root => [
    { ...root, depth: 0 as const },
    ...categories.filter(c => c.parentId === root.id).map(c => ({ ...c, depth: 1 as const })),
  ]);
}
