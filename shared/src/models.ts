/**
 * Registre des familles de modèles proposées dans l'app.
 *
 * Une famille = un modèle tel que l'utilisateur le voit dans le dropdown
 * (ex. « Seedream 5.0 Pro »). SpicyAPI expose une famille sous plusieurs
 * endpoints, un par tâche : `bytedance/seedream-5.0-pro/text-to-image`,
 * `.../edit`, etc. Le backend découvre ces endpoints dans le catalogue live,
 * la tâche est ensuite choisie automatiquement selon les pièces jointes.
 *
 * AJOUTER UN MODÈLE = ajouter une ligne ici (l'id est le préfixe des model IDs
 * du catalogue SpicyAPI). Les champs du formulaire viennent du schéma live.
 */

export type MediaKind = 'image' | 'video';

/** Pourquoi on propose ce modèle (badge coloré dans le dropdown). */
export type ModelBadge = 'EDIT' | 'LORA' | 'REF' | 'PERF';

export type TaskKind =
  | 'text-to-image'
  | 'image-to-image'
  | 'text-to-video'
  | 'image-to-video'
  | 'reference-to-video'
  | 'upscale';

/** Fournisseur affiché dans le menu des modèles (logo dans public/providers). */
export type ProviderId =
  | 'openai'
  | 'google'
  | 'bytedance'
  | 'alibaba'
  | 'black-forest-labs'
  | 'kling'
  | 'minimax'
  | 'lightricks'
  | 'spicyapi';

/** L'ordre des clés est celui du menu des modèles (section Fournisseurs). */
export const PROVIDERS: Record<ProviderId, { label: string; logo: string | null }> = {
  openai: { label: 'OpenAI', logo: '/providers/openai.svg' },
  bytedance: { label: 'ByteDance', logo: '/providers/bytedance.svg' },
  alibaba: { label: 'Alibaba', logo: '/providers/alibaba.svg' },
  google: { label: 'Google', logo: '/providers/google.svg' },
  'black-forest-labs': { label: 'Black Forest Labs', logo: '/providers/black-forest-labs.svg' },
  kling: { label: 'Kling', logo: '/providers/kling.svg' },
  minimax: { label: 'MiniMax', logo: '/providers/minimax.svg' },
  lightricks: { label: 'Lightricks', logo: '/providers/lightricks.svg' },
  spicyapi: { label: 'SpicyAPI', logo: null },
};

export interface ModelFamilyDef {
  /** Préfixe des model IDs SpicyAPI, ex. `bytedance/seedream-5.0-pro`. */
  id: string;
  label: string;
  media: MediaKind;
  badges: ModelBadge[];
  /** Une phrase courte affichée sous le nom dans le dropdown. */
  hint: string;
  provider: ProviderId;
  /** Rang dans la section « Modèles recommandés » du menu (1 = en haut). Absent : pas recommandé. */
  recommended?: number;
  /** Groupe « Low cost » du menu. */
  lowCost?: boolean;
  /**
   * Elo du classement Artificial Analysis (text-to-image pour la photo,
   * text-to-video pour la vidéo). Sert uniquement à trier, jamais affiché.
   * Les deux échelles sont distinctes : on ne compare que dans un même média.
   */
  score: number;
}

const FAMILY_DEFS: ModelFamilyDef[] = [
  // ── PHOTO ────────────────────────────────────────────────
  {
    id: 'alibaba/qwen-image-2512-lora',
    label: 'Qwen Image 2512 LoRA',
    media: 'image',
    badges: ['REF', 'LORA'],
    hint: "Pour tes LoRA sur la base Qwen Image.",
    provider: 'alibaba',
    score: 999, // Elo AA de Qwen Image Max 2512 (modèle le plus proche)
  },
  {
    id: 'alibaba/z-image-turbo-lora',
    label: 'Z-Image Turbo LoRA',
    media: 'image',
    badges: ['EDIT', 'LORA'],
    hint: "Pour tes LoRA réalistes, très peu cher.",
    provider: 'alibaba',
    score: 941,
  },
  {
    id: 'black-forest-labs/flux-1-dev-lora',
    label: 'FLUX.1 Dev LoRA',
    media: 'image',
    badges: ['EDIT', 'LORA'],
    hint: "Pour tes LoRA FLUX.1, la base la plus répandue.",
    provider: 'black-forest-labs',
    score: 840,
  },
  {
    id: 'bytedance/seedream-5.0-pro',
    label: 'Seedream 5.0 Pro',
    media: 'image',
    badges: ['REF', 'PERF'],
    hint: "Le meilleur de ByteDance : photos réalistes, fidèles à tes références.",
    provider: 'bytedance',
    recommended: 3,
    score: 1081,
  },
  {
    id: 'bytedance/seedream-5.0-flash',
    label: 'Seedream 5.0 Flash',
    media: 'image',
    badges: ['REF', 'PERF'],
    hint: "Rapide et économe, très bon rapport qualité-prix.",
    provider: 'bytedance',
    lowCost: true,
    score: 1040, // guess score
  },
  {
    id: 'alibaba/qwen-image-3.0-pro',
    label: 'Qwen Image 3.0 Pro',
    media: 'image',
    badges: ['REF', 'PERF'],
    hint: "Le modèle d'Alibaba qui suit le plus fidèlement ta demande.",
    provider: 'alibaba',
    recommended: 2,
    score: 1088,
  },
  {
    id: 'openai/gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5',
    media: 'image',
    badges: ['REF', 'PERF'],
    hint: "Le modèle phare d'OpenAI : très haute qualité, texte lisible dans l'image.",
    provider: 'openai',
    recommended: 1,
    score: 1198,
  },

  {
    id: 'google/nano-banana-pro',
    label: 'Nano Banana Pro',
    media: 'image',
    badges: ['REF', 'PERF'],
    hint: "Le modèle le plus abouti de Google, pour des photos de très haute qualité.",
    provider: 'google',
    recommended: 4,
    score: 1190, // guess score (sous GPT Image 2.5, n°1 d'Artificial Analysis)
  },

  {
    id: 'google/nano-banana-2.1',
    label: 'Nano Banana 2.1',
    media: 'image',
    badges: ['REF'],
    hint: "Le modèle économe de Google : très bon rapport qualité-prix.",
    provider: 'google',
    lowCost: true,
    score: 1100, // guess score (sur la ligne de Pareto qualité / prix d'Artificial Analysis)
  },

  // ── VIDÉO ────────────────────────────────────────────────
  {
    id: 'bytedance/seedance-2.0-mini',
    label: 'Seedance 2.0 Mini',
    media: 'video',
    badges: ['REF'],
    hint: "Le modèle vidéo le plus économe de ByteDance, avec références.",
    provider: 'bytedance',
    lowCost: true,
    score: 1050, // guess score
  },
  {
    id: 'minimax/h3-lora',
    label: 'MiniMax H3 LoRA',
    media: 'video',
    badges: ['REF', 'LORA'],
    hint: "Pour tes LoRA vidéo MiniMax, avec le son.",
    provider: 'minimax',
    score: 1137, // Elo AA de MiniMax H3 (768p)
  },
  {
    id: 'alibaba/wan-2.2-lora',
    label: 'Wan 2.2 LoRA',
    media: 'video',
    badges: ['LORA'],
    hint: "Pour tes LoRA Wan 2.2 (passes HIGH et LOW).",
    provider: 'alibaba',
    score: 940, // guess score
  },
  {
    id: 'lightricks/ltx-2.3-spicy-lora',
    label: 'LTX 2.3 Spicy LoRA',
    media: 'video',
    badges: ['LORA'],
    hint: "Pour tes LoRA LTX, image de départ obligatoire.",
    provider: 'lightricks',
    score: 892, // Elo AA de LTX-2.3 Pro
  },
  {
    id: 'bytedance/seedance-2.5',
    label: 'Seedance 2.5',
    media: 'video',
    badges: ['REF', 'PERF'],
    hint: "Le meilleur modèle vidéo de ByteDance, jusqu'à 30 références.",
    provider: 'bytedance',
    recommended: 1,
    score: 1143,
  },
  {
    id: 'alibaba/wan-3.0',
    label: 'Wan 3.0',
    media: 'video',
    badges: ['REF', 'PERF'],
    hint: "Vidéo avec le son, bon rapport qualité-prix.",
    provider: 'alibaba',
    recommended: 4,
    score: 1156,
  },
  {
    id: 'alibaba/wan-3.0-prime',
    label: 'Wan 3.0 Prime',
    media: 'video',
    badges: ['REF', 'PERF'],
    hint: "La version haut de gamme de Wan, avec le son.",
    provider: 'alibaba',
    recommended: 2,
    score: 1165, // guess score
  },
  {
    id: 'alibaba/happyhorse-1.1',
    label: 'HappyHorse 1.1',
    media: 'video',
    badges: ['REF'],
    hint: "Vidéo d'Alibaba, jusqu'à 9 images de référence.",
    provider: 'alibaba',
    score: 1042,
  },
  {
    id: 'alibaba/wan-2.6',
    label: 'Wan 2.6',
    media: 'video',
    badges: ['REF'],
    hint: "Vidéo d'Alibaba, références en vidéo.",
    provider: 'alibaba',
    score: 1005, // guess score
  },
  {
    id: 'kling/3.0',
    label: 'Kling 3.0',
    media: 'video',
    badges: ['PERF'],
    hint: "Des mouvements très naturels, jusqu'en 4K.",
    provider: 'kling',
    recommended: 3,
    score: 1000, // Kling 3.0 1080p (Pro)
  },
];

/** Photo puis vidéo, et dans chaque média du meilleur score au moins bon. */
export function byScore(a: ModelFamilyDef, b: ModelFamilyDef): number {
  if (a.media !== b.media) return a.media === 'image' ? -1 : 1;
  return b.score - a.score;
}

/** Toujours triée par score : toutes les listes de l'app suivent cet ordre. */
export const MODEL_FAMILIES: ModelFamilyDef[] = [...FAMILY_DEFS].sort(byScore);

/**
 * Outils lancés depuis un résultat (pas dans le dropdown des modèles).
 * Upscale : agrandit et affine une image ou une vidéo, sans prompt.
 */
export const UPSCALERS: Record<
  MediaKind,
  { family: string; modelId: string; label: string; defaultResolution: string }
> = {
  image: {
    family: 'spicyapi/image-upscaler-v1',
    modelId: 'spicyapi/image-upscaler-v1/upscale',
    label: 'Upscaler image',
    defaultResolution: '4k',
  },
  video: {
    family: 'spicyapi/video-upscaler-v1',
    modelId: 'spicyapi/video-upscaler-v1/upscale',
    label: 'Upscaler vidéo',
    defaultResolution: '1080p',
  },
};

export const TOOL_FAMILIES: ModelFamilyDef[] = [
  {
    id: UPSCALERS.image.family,
    label: UPSCALERS.image.label,
    media: 'image',
    badges: [],
    hint: 'Agrandit et affine une image',
    provider: 'spicyapi',
    score: 0, // outil hors classement
  },
  {
    id: UPSCALERS.video.family,
    label: UPSCALERS.video.label,
    media: 'video',
    badges: [],
    hint: 'Passe une vidéo en haute résolution',
    provider: 'spicyapi',
    score: 0, // outil hors classement
  },
];

export const BADGE_INFO: Record<ModelBadge, { label: string; description: string }> = {
  EDIT: {
    label: 'EDIT',
    description: 'Retouche une image (une seule image en entrée, avec une force)',
  },
  LORA: { label: 'LORA', description: 'Accepte une LoRA (personnage entraîné)' },
  REF: { label: 'REF', description: 'Cohérence par images de référence' },
  PERF: { label: 'PERF', description: 'Qualité de rendu' },
};

/** Suffixe d'endpoint SpicyAPI → tâche. */
export const ENDPOINT_SUFFIX_TO_TASK: Record<string, TaskKind> = {
  'text-to-image': 'text-to-image',
  edit: 'image-to-image',
  'text-to-video': 'text-to-video',
  'image-to-video': 'image-to-video',
  'reference-to-video': 'reference-to-video',
  upscale: 'upscale',
};

export const TASK_LABEL: Record<TaskKind, string> = {
  'text-to-image': 'Texte → image',
  'image-to-image': 'Image → image',
  'text-to-video': 'Texte → vidéo',
  'image-to-video': 'Image → vidéo',
  'reference-to-video': 'Références → vidéo',
  upscale: 'Upscale',
};

const BADGE_ORDER: ModelBadge[] = ['EDIT', 'LORA', 'REF', 'PERF'];

/**
 * Badges déduits du schéma live : EDIT (une seule image à retoucher), LORA (accepte des LoRA),
 * REF (au moins 2 images de référence, ou des références vidéo). PERF reste un choix éditorial.
 */
export function deriveBadges(
  tasks: Partial<
    Record<TaskKind, { schema: { properties?: Record<string, { maxItems?: number }> } }>
  >,
  editorial: ModelBadge[]
): ModelBadge[] {
  const props = (t: TaskKind) => tasks[t]?.schema.properties ?? {};
  const all = Object.values(tasks).flatMap(t => Object.keys(t?.schema.properties ?? {}));
  const edit = props('image-to-image');
  const r2v = props('reference-to-video');
  const badges = new Set<ModelBadge>(editorial.filter(b => b === 'PERF'));
  if (edit.image_url && !edit.image_urls) badges.add('EDIT');
  if (all.some(k => k === 'loras' || k.endsWith('_noise_loras'))) badges.add('LORA');
  if (
    (edit.image_urls?.maxItems ?? 0) > 1 ||
    Object.keys(r2v).some(k => k.startsWith('reference_') && k.endsWith('_urls'))
  ) {
    badges.add('REF');
  }
  return BADGE_ORDER.filter(b => badges.has(b));
}

/**
 * Modèle choisi quand rien d'autre ne s'applique (ni persona, ni dernier choix) :
 * économique exprès, les modèles haut de gamme restent un choix volontaire.
 */
export const APP_DEFAULT_FAMILY: Record<MediaKind, string> = {
  image: 'bytedance/seedream-5.0-flash',
  video: 'bytedance/seedance-2.0-mini',
};

export function getFamily(id: string): ModelFamilyDef | undefined {
  return MODEL_FAMILIES.find(f => f.id === id) ?? TOOL_FAMILIES.find(f => f.id === id);
}

/** Famille d'un model ID SpicyAPI (`publisher/model/task` → `publisher/model`). */
export function familyIdOf(modelId: string): string {
  return modelId.split('/').slice(0, 2).join('/');
}

/**
 * Modèles de base Civitai compatibles avec chaque famille LoRA.
 * Les familles absentes (ex. MiniMax H3) n'ont pas de LoRA sur Civitai.
 */
export const CIVITAI_BASE_MODELS: Record<string, string[]> = {
  'alibaba/qwen-image-2512-lora': ['Qwen'],
  'alibaba/z-image-turbo-lora': ['ZImageTurbo'],
  'black-forest-labs/flux-1-dev-lora': ['Flux.1 D'],
  'alibaba/wan-2.2-lora': ['Wan Video 2.2 T2V-A14B', 'Wan Video 2.2 I2V-A14B'],
  'lightricks/ltx-2.3-spicy-lora': ['LTXV 2.3', 'LTXV2'],
};
