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
}

export const LIBRARY_ZONES: LibraryZoneDef[] = [
  { id: 'character', label: 'Personnage', hint: 'Coiffures, couleurs de cheveux, yeux, peau, morphologie…', gender: 'ask' },
  { id: 'outfit', label: 'Tenue', hint: 'Hauts, robes, chaussures, accessoires…', gender: 'ask' },
  { id: 'action', label: 'Pose & action', hint: 'Poses, expressions, activités…', gender: 'optional' },
  { id: 'place', label: 'Lieu & décor', hint: 'Pièces, mobilier, objets, moments de la journée…', gender: 'none' },
  { id: 'photo', label: 'Photo & ambiance', hint: 'Cadrages, lumières, rendus…', gender: 'none' },
];

export function getZone(id: LibraryZone): LibraryZoneDef {
  return LIBRARY_ZONES.find(z => z.id === id) ?? LIBRARY_ZONES[0];
}
