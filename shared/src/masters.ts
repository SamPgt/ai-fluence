/**
 * Images master d'un personnage : variations proches de son image de référence, rangées par axe.
 * Chaque axe couvre une dimension utile au futur jeu d'entraînement d'une LoRA (angles, expressions…).
 * Les fragments anglais prolongent la phrase d'identité du personnage (« a woman with afro hair, … »).
 */

export type MasterAxis = 'angles' | 'expressions' | 'lighting' | 'outfits' | 'framing';

export interface MasterVariant {
  id: string;
  label: string;
  fragment: string;
}

export interface MasterAxisDef {
  id: MasterAxis;
  label: string;
  hint: string;
  variants: MasterVariant[];
}

/** Variation enregistrée avec la génération : l'axe et la variante tirés pour cette image. */
export interface GenerationVariation {
  axis: MasterAxis;
  variantId: string;
  label: string;
}

/** Repère pour un jeu d'entraînement de LoRA (15 à 30 images variées). */
export const MASTER_TARGET = 20;
/** Repère par axe, pour voir ce qui manque. */
export const MASTER_TARGET_PER_AXIS = 4;

const STUDIO = 'wearing a plain grey t-shirt, plain light grey background, soft even lighting, realistic photo';

export const MASTER_AXES: MasterAxisDef[] = [
  {
    id: 'angles',
    label: 'Angles',
    hint: 'Face, profils, trois-quarts, plongée…',
    variants: [
      { id: 'front', label: 'Face', fragment: `head and shoulders portrait facing the camera, ${STUDIO}` },
      { id: 'profile-left', label: 'Profil gauche', fragment: `head and shoulders portrait in side profile view, facing left, ${STUDIO}` },
      { id: 'profile-right', label: 'Profil droit', fragment: `head and shoulders portrait in side profile view, facing right, ${STUDIO}` },
      { id: 'three-quarter-left', label: 'Trois-quarts gauche', fragment: `head and shoulders portrait in three-quarter view, face turned slightly to the left, ${STUDIO}` },
      { id: 'three-quarter-right', label: 'Trois-quarts droit', fragment: `head and shoulders portrait in three-quarter view, face turned slightly to the right, ${STUDIO}` },
      { id: 'high', label: 'Plongée', fragment: `portrait seen from slightly above, looking up at the camera, ${STUDIO}` },
      { id: 'low', label: 'Contre-plongée', fragment: `portrait seen from a low angle, ${STUDIO}` },
      { id: 'over-shoulder', label: 'Par-dessus l’épaule', fragment: `portrait from behind, looking back over the shoulder at the camera, ${STUDIO}` },
    ],
  },
  {
    id: 'expressions',
    label: 'Expressions',
    hint: 'Sourire, rire, sérieux, surprise…',
    variants: [
      { id: 'smile', label: 'Sourire', fragment: `close-up portrait, smiling warmly, ${STUDIO}` },
      { id: 'laugh', label: 'Rire', fragment: `close-up portrait, laughing out loud, ${STUDIO}` },
      { id: 'neutral', label: 'Neutre', fragment: `close-up portrait, serious neutral expression, ${STUDIO}` },
      { id: 'surprised', label: 'Surprise', fragment: `close-up portrait, surprised expression, ${STUDIO}` },
      { id: 'pensive', label: 'Pensif', fragment: `close-up portrait, pensive, looking away from the camera, ${STUDIO}` },
      { id: 'wink', label: 'Clin d’œil', fragment: `close-up portrait, playful wink, ${STUDIO}` },
      { id: 'pout', label: 'Moue', fragment: `close-up portrait, pouting, ${STUDIO}` },
      { id: 'smirk', label: 'Sourire en coin', fragment: `close-up portrait, confident smirk, ${STUDIO}` },
    ],
  },
  {
    id: 'lighting',
    label: 'Lumières',
    hint: 'Heure dorée, fenêtre, néons, flash…',
    variants: [
      { id: 'golden-hour', label: 'Heure dorée', fragment: 'head and shoulders portrait outdoors at golden hour, warm sunlight, realistic photo' },
      { id: 'window', label: 'Fenêtre', fragment: 'head and shoulders portrait indoors, soft natural window light from the side, realistic photo' },
      { id: 'neon', label: 'Néons de nuit', fragment: 'head and shoulders portrait at night in a city street lit by neon lights, realistic photo' },
      { id: 'overcast', label: 'Temps couvert', fragment: 'head and shoulders portrait outdoors on an overcast day, diffuse light, realistic photo' },
      { id: 'chiaroscuro', label: 'Clair-obscur', fragment: 'head and shoulders portrait, dramatic side lighting, dark background, realistic photo' },
      { id: 'lamp', label: 'Lampe chaude', fragment: 'head and shoulders portrait indoors in the evening under warm lamp light, realistic photo' },
      { id: 'sun', label: 'Plein soleil', fragment: 'head and shoulders portrait outdoors in bright midday sun, hard shadows, realistic photo' },
      { id: 'flash', label: 'Flash', fragment: 'head and shoulders portrait, direct on-camera flash, dark background, realistic photo' },
    ],
  },
  {
    id: 'outfits',
    label: 'Tenues',
    hint: 'Décontracté, élégant, sport, hiver…',
    variants: [
      { id: 'casual', label: 'Décontracté', fragment: 'waist-up photo wearing a casual t-shirt and jeans, plain light grey background, soft lighting, realistic photo' },
      { id: 'elegant', label: 'Élégant', fragment: 'waist-up photo wearing an elegant evening outfit, plain light grey background, soft lighting, realistic photo' },
      { id: 'sweater', label: 'Pull douillet', fragment: 'waist-up photo wearing a cozy knit sweater, plain light grey background, soft lighting, realistic photo' },
      { id: 'sport', label: 'Sport', fragment: 'waist-up photo wearing sportswear, plain light grey background, soft lighting, realistic photo' },
      { id: 'business', label: 'Business', fragment: 'waist-up photo wearing a smart business outfit with a blazer, plain light grey background, soft lighting, realistic photo' },
      { id: 'summer', label: 'Été', fragment: 'waist-up photo wearing light summer clothes, plain light grey background, soft lighting, realistic photo' },
      { id: 'winter', label: 'Hiver', fragment: 'waist-up photo wearing a warm winter coat and a scarf, plain light grey background, soft lighting, realistic photo' },
      { id: 'streetwear', label: 'Streetwear', fragment: 'waist-up photo wearing streetwear with a hoodie, plain light grey background, soft lighting, realistic photo' },
    ],
  },
  {
    id: 'framing',
    label: 'Cadrages',
    hint: 'Gros plan, buste, en pied, assis…',
    variants: [
      { id: 'face', label: 'Gros plan', fragment: `extreme close-up of the face, ${STUDIO}` },
      { id: 'waist', label: 'Buste', fragment: `waist-up shot, ${STUDIO}` },
      { id: 'knees', label: 'Plan américain', fragment: 'medium shot from the knees up, standing, wearing a casual outfit, plain light grey background, soft lighting, realistic photo' },
      { id: 'full', label: 'En pied', fragment: 'full body shot, standing, wearing a casual outfit, plain light grey studio background, soft lighting, realistic photo' },
      { id: 'sitting', label: 'Assis', fragment: 'full body shot sitting on a chair, wearing a casual outfit, plain light grey background, soft lighting, realistic photo' },
      { id: 'walking', label: 'En marchant', fragment: 'full body shot walking in a city street, wearing a casual outfit, natural daylight, realistic photo' },
    ],
  },
];

export function masterAxis(id: MasterAxis): MasterAxisDef {
  return MASTER_AXES.find(a => a.id === id)!;
}
