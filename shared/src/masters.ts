/**
 * Images master d'un personnage : variations proches de son image de référence, rangées par axe.
 * Chaque axe couvre une dimension utile au futur jeu d'entraînement d'une LoRA (angles, expressions…).
 * Les fragments anglais prolongent la phrase d'identité du personnage (« a woman with afro hair, … »).
 */

/** Axes d'un personnage. */
export type CharacterAxis = 'angles' | 'expressions' | 'lighting' | 'outfits' | 'framing';
/** Axes d'un lieu. */
export type PlaceAxis = 'room-angles' | 'times' | 'details' | 'presence';
export type MasterAxis = CharacterAxis | PlaceAxis;
/** Ce qu'on crée : un personnage ou un lieu récurrent. */
export type CreatorKind = 'character' | 'place';

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
  /**
   * Lieu, image → image : force conseillée. Un autre angle ou un détail demande de s'éloigner de la référence ;
   * un autre moment de la journée, de la garder.
   */
  strength?: number;
}

/** Variation enregistrée avec la génération : l'axe et la variante tirés pour cette image. */
export interface GenerationVariation {
  axis: MasterAxis;
  variantId: string;
  label: string;
}

/** Repères : total recommandé et par axe (personnage : jeu d'entraînement d'une LoRA, 15 à 30 images variées). */
export const MASTER_TARGETS: Record<CreatorKind, { total: number; perAxis: number }> = {
  character: { total: 20, perAxis: 4 },
  place: { total: 12, perAxis: 3 },
};

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

/**
 * Axes d'un lieu. Le moment de la journée n'appartient pas au lieu (sa chambre de jour comme de nuit) :
 * les masters couvrent plusieurs moments pour que le lieu reste reconnaissable dans chaque scène.
 */
export const PLACE_AXES: MasterAxisDef[] = [
  {
    id: 'room-angles',
    label: 'Angles',
    strength: 0.85,
    hint: 'Depuis la porte, le coin opposé, en plongée…',
    variants: [
      { id: 'doorway', label: 'Depuis l’entrée', fragment: 'wide-angle photo of the whole place seen from the entrance, no people, natural daylight, realistic photo' },
      { id: 'opposite', label: 'Coin opposé', fragment: 'wide-angle photo of the place seen from the opposite corner, no people, natural daylight, realistic photo' },
      { id: 'eye-level', label: 'Face au mur principal', fragment: 'eye-level photo facing the main wall of the place, no people, natural daylight, realistic photo' },
      { id: 'window', label: 'Vers la fenêtre', fragment: 'photo of the place looking towards the window, no people, natural daylight, realistic photo' },
      { id: 'high', label: 'Plongée', fragment: 'high-angle photo of the place seen from above, no people, natural daylight, realistic photo' },
      { id: 'low', label: 'Ras du sol', fragment: 'low-angle photo of the place taken close to the floor, no people, natural daylight, realistic photo' },
    ],
  },
  {
    id: 'times',
    label: 'Moments',
    strength: 0.6,
    hint: 'Matin, midi, heure dorée, nuit…',
    variants: [
      { id: 'morning', label: 'Matin', fragment: 'wide photo of the place in the early morning, soft cool light, no people, realistic photo' },
      { id: 'noon', label: 'Midi', fragment: 'wide photo of the place at midday, bright natural light, no people, realistic photo' },
      { id: 'golden', label: 'Heure dorée', fragment: 'wide photo of the place at golden hour, warm sunlight, long shadows, no people, realistic photo' },
      { id: 'dusk', label: 'Crépuscule', fragment: 'wide photo of the place at dusk, blue hour light, no people, realistic photo' },
      { id: 'night-lamps', label: 'Nuit, lampes', fragment: 'wide photo of the place at night, lit by warm lamps, no people, realistic photo' },
      { id: 'night-dark', label: 'Nuit, pénombre', fragment: 'wide photo of the place at night in dim light, a few glowing light sources, no people, realistic photo' },
    ],
  },
  {
    id: 'details',
    label: 'Détails',
    strength: 0.85,
    hint: 'Objets, matières, recoins…',
    variants: [
      { id: 'object', label: 'Objet', fragment: 'close-up detail photo of a decorative object in the place, shallow depth of field, realistic photo' },
      { id: 'materials', label: 'Matières', fragment: 'close-up detail photo of the textures and materials of the place, realistic photo' },
      { id: 'corner', label: 'Recoin', fragment: 'photo of a corner of the place, no people, natural light, realistic photo' },
      { id: 'surface', label: 'Plan de travail', fragment: 'detail photo of the main table or desk surface of the place with its objects, realistic photo' },
    ],
  },
  {
    id: 'presence',
    label: 'Avec quelqu’un',
    strength: 0.75,
    hint: 'Une silhouette pour l’échelle, de dos, assise…',
    variants: [
      { id: 'back', label: 'De dos', fragment: 'wide photo of the place with a person seen from behind, small in the frame, natural light, realistic photo' },
      { id: 'sitting', label: 'Assise', fragment: 'wide photo of the place with a person sitting, seen from afar, natural light, realistic photo' },
      { id: 'walking', label: 'En passant', fragment: 'wide photo of the place with a person walking through, slightly blurred, natural light, realistic photo' },
    ],
  },
];

export function axesFor(kind: CreatorKind): MasterAxisDef[] {
  return kind === 'place' ? PLACE_AXES : MASTER_AXES;
}

export function masterAxis(id: MasterAxis): MasterAxisDef {
  return [...MASTER_AXES, ...PLACE_AXES].find(a => a.id === id)!;
}
