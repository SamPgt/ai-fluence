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
export type ModelBadge = 'LORA' | 'REF' | 'PERF' | 'LOCAL';

/** Où tourne la génération : SpicyAPI (cloud) ou le ComfyUI local. */
export type ModelProvider = 'spicy' | 'comfy';

export type TaskKind =
  | 'text-to-image'
  | 'image-to-image'
  | 'text-to-video'
  | 'image-to-video'
  | 'reference-to-video'
  | 'upscale';

export interface ModelFamilyDef {
  /** Préfixe des model IDs SpicyAPI, ex. `bytedance/seedream-5.0-pro`. */
  id: string;
  label: string;
  media: MediaKind;
  badges: ModelBadge[];
  /** Une phrase courte affichée sous le nom dans le dropdown. */
  hint: string;
  /** Par défaut `spicy`. */
  provider?: ModelProvider;
}

export const MODEL_FAMILIES: ModelFamilyDef[] = [
  // ── PHOTO ────────────────────────────────────────────────
  {
    id: 'alibaba/qwen-image-2512-lora',
    label: 'Qwen Image 2512 LoRA',
    media: 'image',
    badges: ['LORA'],
    hint: 'Ta LoRA de personnage, base Qwen-Image-2512',
  },
  {
    id: 'alibaba/z-image-turbo-lora',
    label: 'Z-Image Turbo LoRA',
    media: 'image',
    badges: ['LORA'],
    hint: 'LoRA réaliste et pas chère',
  },
  {
    id: 'black-forest-labs/flux-1-dev-lora',
    label: 'FLUX.1 Dev LoRA',
    media: 'image',
    badges: ['LORA'],
    hint: 'LoRA FLUX.1 [dev], base la plus connue',
  },
  {
    id: 'bytedance/seedream-5.0-pro',
    label: 'Seedream 5.0 Pro',
    media: 'image',
    badges: ['REF', 'PERF'],
    hint: "Jusqu'à 10 images de référence",
  },
  {
    id: 'bytedance/seedream-5.0-flash',
    label: 'Seedream 5.0 Flash',
    media: 'image',
    badges: ['PERF'],
    hint: 'Rapide, 2K',
  },
  {
    id: 'alibaba/qwen-image-3.0-pro',
    label: 'Qwen Image 3.0 Pro',
    media: 'image',
    badges: ['PERF'],
    hint: 'Très bon suivi du prompt',
  },
  {
    id: 'openai/gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5',
    media: 'image',
    badges: ['PERF'],
    hint: "Texte dans l'image, jusqu'à 16 références (filtré)",
  },

  // ── VIDÉO ────────────────────────────────────────────────
  {
    id: 'minimax/h3-lora',
    label: 'MiniMax H3 LoRA',
    media: 'video',
    badges: ['LORA', 'REF'],
    hint: 'LoRA vidéo + références, avec audio',
  },
  {
    id: 'alibaba/wan-2.2-lora',
    label: 'Wan 2.2 LoRA',
    media: 'video',
    badges: ['LORA'],
    hint: 'LoRA HIGH/LOW noise',
  },
  {
    id: 'lightricks/ltx-2.3-spicy-lora',
    label: 'LTX 2.3 Spicy LoRA',
    media: 'video',
    badges: ['LORA'],
    hint: 'Image de départ obligatoire',
  },
  {
    id: 'bytedance/seedance-2.5',
    label: 'Seedance 2.5',
    media: 'video',
    badges: ['REF', 'PERF'],
    hint: "Jusqu'à 30 images de référence",
  },
  {
    id: 'alibaba/wan-3.0',
    label: 'Wan 3.0',
    media: 'video',
    badges: ['REF', 'PERF'],
    hint: "Jusqu'à 10 références, avec audio",
  },
  {
    id: 'alibaba/wan-3.0-prime',
    label: 'Wan 3.0 Prime',
    media: 'video',
    badges: ['REF', 'PERF'],
    hint: 'Version haut de gamme de Wan 3.0',
  },
  {
    id: 'alibaba/happyhorse-1.1',
    label: 'HappyHorse 1.1',
    media: 'video',
    badges: ['REF'],
    hint: "Jusqu'à 9 images de référence",
  },
  {
    id: 'alibaba/wan-2.6',
    label: 'Wan 2.6',
    media: 'video',
    badges: ['REF'],
    hint: 'Référence = vidéos (pas images)',
  },
  {
    id: 'kling/3.0',
    label: 'Kling 3.0',
    media: 'video',
    badges: ['PERF'],
    hint: "Mouvements réalistes, jusqu'en 4K",
  },
];

/**
 * Outils lancés depuis un résultat (pas dans le dropdown des modèles).
 * Upscale : agrandit et affine une image ou une vidéo, sans prompt.
 */
export const UPSCALERS: Record<MediaKind, { family: string; modelId: string; label: string; defaultResolution: string }> = {
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
  { id: UPSCALERS.image.family, label: UPSCALERS.image.label, media: 'image', badges: [], hint: 'Agrandit et affine une image' },
  { id: UPSCALERS.video.family, label: UPSCALERS.video.label, media: 'video', badges: [], hint: 'Passe une vidéo en haute résolution' },
];

/**
 * Modèles locaux, exécutés par ComfyUI sur le GPU de l'utilisateur (visibles seulement si
 * le backend a un `COMFYUI_URL`). Les workflows et leurs paramètres sont décrits côté backend.
 */
export const LOCAL_FAMILIES: ModelFamilyDef[] = [
  {
    id: 'local/z-image-turbo',
    label: 'Z-Image Turbo (local)',
    media: 'image',
    badges: ['LOCAL'],
    hint: 'Sur ton GPU via ComfyUI, gratuit',
    provider: 'comfy',
  },
];

export const BADGE_INFO: Record<ModelBadge, { label: string; description: string }> = {
  LORA: { label: 'LORA', description: 'Accepte une LoRA (personnage entraîné)' },
  REF: { label: 'REF', description: 'Cohérence par images de référence' },
  PERF: { label: 'PERF', description: 'Qualité de rendu' },
  LOCAL: { label: 'LOCAL', description: 'Généré sur ton GPU par ComfyUI, sans API ni coût' },
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

export function getFamily(id: string): ModelFamilyDef | undefined {
  return MODEL_FAMILIES.find(f => f.id === id) ?? LOCAL_FAMILIES.find(f => f.id === id) ?? TOOL_FAMILIES.find(f => f.id === id);
}

/** Famille d'un model ID SpicyAPI (`publisher/model/task` → `publisher/model`). */
export function familyIdOf(modelId: string): string {
  return modelId.split('/').slice(0, 2).join('/');
}
