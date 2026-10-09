/**
 * Découpage automatique d'une grosse catégorie en sous-catégories, par mots-clés anglais.
 * En anglais, le nom principal vient en dernier (« sweater dress » est une robe, « dress shirt » une chemise) :
 * l'option va dans le groupe dont un mot-clé apparaît le plus tard dans le fragment.
 */
import type { LibraryZone } from './library';

export interface SplitRule {
  label: string;
  keywords: string[];
}

export const SPLIT_RULES: Partial<Record<LibraryZone, SplitRule[]>> = {
  outfit: [
    {
      label: 'Lingerie & nuit',
      keywords: [
        'lingerie', 'bra', 'bralette', 'panties', 'panty', 'thong', 'briefs', 'boxers', 'underwear', 'corset', 'bustier',
        'garter', 'garters', 'stockings', 'chemise', 'negligee', 'babydoll', 'teddy', 'slip', 'petticoat', 'camisole set',
        'nightgown', 'nightdress', 'nightie', 'pajamas', 'pyjamas', 'pajama', 'robe', 'bathrobe', 'kimono robe', 'bodystocking',
      ],
    },
    { label: 'Maillots de bain', keywords: ['bikini', 'swimsuit', 'swimwear', 'monokini', 'one-piece', 'swim trunks', 'tankini'] },
    { label: 'Robes', keywords: ['dress', 'gown', 'sundress', 'frock', 'minidress', 'maxi dress'] },
    {
      label: 'Hauts',
      keywords: [
        'top', 'shirt', 't-shirt', 'tee', 'blouse', 'tank top', 'tank', 'camisole', 'cami', 'crop top', 'sweater', 'jumper',
        'pullover', 'hoodie', 'sweatshirt', 'cardigan', 'tunic', 'polo', 'turtleneck', 'bodysuit', 'halter', 'tube top',
      ],
    },
    {
      label: 'Bas',
      keywords: ['jeans', 'pants', 'trousers', 'shorts', 'leggings', 'joggers', 'sweatpants', 'skirt', 'miniskirt', 'culottes', 'chinos'],
    },
    {
      label: 'Vestes & manteaux',
      keywords: ['jacket', 'coat', 'blazer', 'parka', 'trench', 'puffer', 'windbreaker', 'overcoat', 'poncho', 'cape', 'gilet'],
    },
    { label: 'Ensembles', keywords: ['jumpsuit', 'romper', 'playsuit', 'overalls', 'dungarees', 'suit', 'tracksuit', 'set', 'uniform', 'costume', 'outfit'] },
    {
      label: 'Chaussures',
      keywords: ['shoes', 'boots', 'heels', 'high heels', 'sneakers', 'trainers', 'sandals', 'pumps', 'loafers', 'flats', 'stilettos', 'slippers', 'mules', 'wedges'],
    },
    {
      label: 'Accessoires',
      keywords: [
        'hat', 'cap', 'beanie', 'scarf', 'gloves', 'belt', 'bag', 'handbag', 'purse', 'necklace', 'earrings', 'bracelet', 'ring',
        'glasses', 'sunglasses', 'jewelry', 'jewellery', 'watch', 'choker', 'headband', 'tie', 'bow tie', 'socks',
      ],
    },
  ],
};

export interface SplitGroup {
  label: string;
  optionIds: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Groupes proposés (dans l'ordre des règles, vides exclus) et options sans groupe. */
export function suggestSplit(
  zone: LibraryZone,
  options: { id: string; fragment: string }[],
): { groups: SplitGroup[]; unmatched: string[] } {
  const rules = SPLIT_RULES[zone] ?? [];
  const patterns = rules.map(r => new RegExp(`\\b(?:${r.keywords.map(escape).join('|')})\\b`, 'gi'));
  const groups = rules.map(r => ({ label: r.label, optionIds: [] as string[] }));
  const unmatched: string[] = [];
  for (const o of options) {
    let best = -1;
    let bestEnd = -1;
    patterns.forEach((re, i) => {
      for (const m of o.fragment.matchAll(re)) {
        const end = (m.index ?? 0) + m[0].length;
        if (end > bestEnd) {
          bestEnd = end;
          best = i;
        }
      }
    });
    if (best >= 0) groups[best].optionIds.push(o.id);
    else unmatched.push(o.id);
  }
  return { groups: groups.filter(g => g.optionIds.length), unmatched };
}
