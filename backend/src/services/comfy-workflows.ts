/**
 * Workflows ComfyUI exposés comme modèles locaux.
 *
 * Un endpoint = un workflow exporté au format API (`backend/comfy-workflows/…json`, menu
 * « Export (API) » de ComfyUI) + un schéma de paramètres au format des schémas SpicyAPI
 * (le composer construit le formulaire avec, sans code en plus) + les nœuds à remplir.
 *
 * AJOUTER UN WORKFLOW = déposer son JSON, déclarer ici ses paramètres et ses nœuds,
 * et ajouter la famille dans `LOCAL_FAMILIES` (shared/src/models.ts).
 * Un workflow dont la forme varie (nombre d'images de référence) est construit en code (`build`, cf. comfy-builders.ts).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LOCAL_FAMILIES,
  type CatalogFamily,
  type InputSchema,
  type LocalModelsConfig,
  type LocalModelsResponse,
  type TaskKind,
} from '@ai-fluence/shared';
import { env } from '../env.js';
import { getNodeOptions, hasNodes, isComfyRunning, modelFileSize } from './comfy.service.js';
import { getSettingsRow } from './settings.service.js';
import { autofixRegions, buildKlein, buildKrea, buildLtx, buildQwenEdit, buildQwenImage, buildWanI2V, type BuildContext, type Graph, type RetouchBox } from './comfy-builders.js';

/** Entrée d'un nœud du workflow : [id du nœud, nom de l'entrée]. */
type Slot = [node: string, input: string];

export interface LocalEndpoint {
  modelId: string;
  task: TaskKind;
  schema: InputSchema;
  /** Fichier du workflow, relatif à `backend/comfy-workflows/` (sinon `build`). */
  file?: string;
  /** Workflow construit en code, avec les images envoyées et les fichiers de modèles résolus. */
  build?: (values: Record<string, unknown>, ctx: BuildContext) => Graph;
  /**
   * Fichiers de modèles nécessaires, par rôle : le premier installé parmi `files` (ordre de préférence),
   * ou parmi ceux qui correspondent à `match`. Sans eux, le modèle est indisponible.
   */
  requires?: Record<string, { loader: string; input: string; files?: string[]; match?: RegExp; optional?: boolean }>;
  /** Nœud `SaveImage` dont on récupère les images. */
  outputNode: string;
  /** Où écrire chaque valeur de l'`input`. `width`/`height` viennent de `aspect_ratio`. */
  slots: Partial<
    Record<'prompt' | 'negative_prompt' | 'seed' | 'steps' | 'strength' | 'width' | 'height' | 'image' | 'model' | 'precision', Slot>
  >;
  /** Workflow construit en code qui a besoin d'une largeur et d'une hauteur (déduites des proportions). */
  sized?: boolean;
  /** Nombre de pixels visé (taille native du modèle) ; défaut : celui de Z-Image (1,33 Mpx). */
  pixels?: number;
  /** Paramètres `lora` / `lora_strength` : un `LoraLoaderModelOnly` est inséré entre `from` et `to`. */
  lora?: { from: [node: string, output: number]; to: Slot };
  /**
   * Visage : avec une image « visage », un `ReActorFaceSwap` est inséré entre l'image décodée (`from`)
   * et l'enregistrement (`to`). Paramètre `face_restore` : restauration du visage après le swap.
   */
  faceSwap?: { from: [node: string, output: number]; to: Slot };
}

/** Nœud custom ReActor (https://github.com/Gourieff/ComfyUI-ReActor). */
const REACTOR = 'ReActorFaceSwap';

/** Réglages ReActor du workflow d'origine (`reActor.png`). */
const REACTOR_DEFAULTS = {
  enabled: true,
  swap_model: 'inswapper_128.onnx',
  facedetection: 'retinaface_resnet50',
  face_restore_model: 'none',
  face_restore_visibility: 1,
  codeformer_weight: 0.5,
  detect_gender_input: 'no',
  detect_gender_source: 'no',
  input_faces_index: '0',
  source_faces_index: '0',
  console_log_level: 1,
};

/** Valeur du paramètre `lora` quand aucune LoRA n'est appliquée. */
export const NO_LORA = 'Aucune';

/** Ids des nœuds ajoutés au workflow (hors de la plage des ids exportés par ComfyUI). */
const LORA_NODE = '900';
const FACE_IMAGE_NODE = '910';
const FACE_SWAP_NODE = '911';

const WORKFLOWS_DIR = fileURLToPath(new URL('../../comfy-workflows/', import.meta.url));

/** Nombre de pixels visé : le 864×1536 des workflows d'origine. */
const TARGET_PIXELS = 864 * 1536;

const ASPECT_RATIOS = ['9:16', '2:3', '3:4', '4:5', '1:1', '5:4', '4:3', '3:2', '16:9'];

/** Seed max : la colonne `generations.seed` est un integer Postgres. */
export const MAX_SEED = 2_147_483_647;

const Z_IMAGE_COMMON: InputSchema['properties'] = {
  prompt: { type: 'string', description: 'Description de l’image.' },
  negative_prompt: {
    type: 'string',
    default: 'low quality, bad anatomy, extra digits, missing digits, extra limbs, missing limbs',
  },
  steps: { type: 'integer', default: 8, minimum: 4, maximum: 20 },
  /**
   * Précision des poids au chargement. fp8 par défaut : comparatif sur RTX 3060 (2026-10-09), même graine,
   * images identiques à l'œil, même vitesse (~3,55 s/étape), pic de VRAM 7,5–9,2 Go au lieu de 11,8 Go.
   * Sans cette marge, ComfyUI s'est figé en pleine série. `default` = pleine précision, au choix.
   * Sans effet sur un modèle déjà enregistré en fp8 (CyberRealistic…).
   */
  precision: { type: 'string', enum: ['fp8_e4m3fn', 'default'], default: 'fp8_e4m3fn' },
  seed: { type: 'integer', minimum: 0, maximum: MAX_SEED },
};

const Z_IMAGE_SLOTS = {
  prompt: ['67', 'text'],
  negative_prompt: ['71', 'text'],
  seed: ['70', 'seed'],
  steps: ['70', 'steps'],
  model: ['66', 'unet_name'],
  precision: ['66', 'weight_dtype'],
} satisfies LocalEndpoint['slots'];

/** La LoRA s'applique au modèle chargé (66), avant le réglage d'échantillonnage (69). */
const Z_IMAGE_LORA: LocalEndpoint['lora'] = { from: ['66', 0], to: ['69', 'model'] };

/** Le visage s'applique à l'image décodée (65), avant l'enregistrement (9). */
const Z_IMAGE_FACE: LocalEndpoint['faceSwap'] = { from: ['65', 0], to: ['9', 'images'] };

// ── FLUX.2 klein 4B, Qwen-Image-Edit-2511, Wan 2.2 (cf. comfy-builders.ts) ──

const SEED = { type: 'integer', minimum: 0, maximum: MAX_SEED } as const;

const KLEIN_FILES: LocalEndpoint['requires'] = {
  unet: { loader: 'UNETLoader', input: 'unet_name', files: ['flux-2-klein-4b-fp8.safetensors', 'flux-2-klein-4b.safetensors'] },
  // Le même encodeur Qwen3-4B que Z-Image.
  encoder: { loader: 'CLIPLoader', input: 'clip_name', files: ['qwen_3_4b_fp8_mixed.safetensors', 'qwen_3_4b.safetensors', 'qwen_3_4b_fp4_flux2.safetensors'] },
  vae: { loader: 'VAELoader', input: 'vae_name', files: ['flux2-vae.safetensors'] },
};

const KLEIN_COMMON: InputSchema['properties'] = {
  prompt: { type: 'string', description: 'Description de l’image. Avec des références : « la femme de l’image 1… ».' },
  aspect_ratio: { type: 'string', enum: ASPECT_RATIOS, default: '9:16' },
  steps: { type: 'integer', default: 4, minimum: 1, maximum: 12 },
  seed: SEED,
};

/** FLUX.2 klein 9B : même pipeline que le 4B, modèle en GGUF et encodeur Qwen3-8B. */
const KLEIN_9B_FILES: LocalEndpoint['requires'] = {
  unet: { loader: 'UnetLoaderGGUF', input: 'unet_name', match: /flux-2-klein-9b.*\.gguf$/i },
  encoder: { loader: 'CLIPLoader', input: 'clip_name', match: /qwen_3_8b/i },
  vae: { loader: 'VAELoader', input: 'vae_name', files: ['flux2-vae.safetensors'] },
};

/** Texte → image et image → image (références, ou « filtre » avec une force < 1) d'un modèle klein. */
function kleinEndpoints(family: string, requires: LocalEndpoint['requires']): Partial<Record<TaskKind, LocalEndpoint>> {
  const build: LocalEndpoint['build'] = (values, ctx) =>
    buildKlein(values, ctx, { width: Number(values.width), height: Number(values.height) });
  // klein est entraîné autour de 1 Mpx.
  const common = { outputNode: '9', slots: {}, sized: true, pixels: 1024 * 1024, requires, build };
  return {
    'text-to-image': {
      ...common,
      modelId: `${family}/text-to-image`,
      task: 'text-to-image',
      schema: { type: 'object', required: ['prompt'], properties: KLEIN_COMMON },
    },
    'image-to-image': {
      ...common,
      modelId: `${family}/image-to-image`,
      task: 'image-to-image',
      schema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          ...KLEIN_COMMON,
          image_urls: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          strength: {
            type: 'number',
            default: 1,
            minimum: 0.05,
            maximum: 1,
            description:
              '1 : nouvelle image d’après les références. 0,2–0,4 : « filtre », retravaille l’image 1 (composition et anatomie gardées).',
          },
          // Retouche locale (pinceau de la visionneuse) : { mask: 'asset:<id>', box: { x, y, width, height } }.
          // Objet : jamais affiché dans les réglages du composer.
          retouch: { type: 'object', description: 'Zone peinte à refaire dans l’image 1.' },
          // Correction automatique : { parts: [{ kind: 'face' | 'hand' | 'foot', x, y, width, height }] }.
          autofix: { type: 'object', description: 'Visages, mains et pieds détectés, refaits l’un après l’autre.' },
        },
      },
    },
  };
}

const QWEN_EDIT_FILES: LocalEndpoint['requires'] = {
  unet: { loader: 'UnetLoaderGGUF', input: 'unet_name', match: /qwen[-_]image[-_]edit[-_]2511.*\.gguf$/i },
  encoder: { loader: 'CLIPLoader', input: 'clip_name', match: /qwen_2\.5_vl_7b/i },
  vae: { loader: 'VAELoader', input: 'vae_name', files: ['qwen_image_vae.safetensors'] },
  lightning: { loader: 'LoraLoaderModelOnly', input: 'lora_name', match: /qwen-image-edit-2511-lightning-4steps/i },
};

const WAN_I2V_FILES: LocalEndpoint['requires'] = {
  high: { loader: 'UnetLoaderGGUF', input: 'unet_name', match: /wan2\.2-i2v-a14b-highnoise.*\.gguf$/i },
  low: { loader: 'UnetLoaderGGUF', input: 'unet_name', match: /wan2\.2-i2v-a14b-lownoise.*\.gguf$/i },
  loraHigh: { loader: 'LoraLoaderModelOnly', input: 'lora_name', match: /wan2\.2_i2v_lightx2v_4steps_lora.*high_noise/i },
  loraLow: { loader: 'LoraLoaderModelOnly', input: 'lora_name', match: /wan2\.2_i2v_lightx2v_4steps_lora.*low_noise/i },
  encoder: { loader: 'CLIPLoader', input: 'clip_name', match: /umt5_xxl/i },
  vae: { loader: 'VAELoader', input: 'vae_name', files: ['wan_2.1_vae.safetensors'] },
};

const KREA_FILES: LocalEndpoint['requires'] = {
  unet: { loader: 'UnetLoaderGGUF', input: 'unet_name', match: /krea2.*\.gguf$/i },
  encoder: { loader: 'CLIPLoader', input: 'clip_name', match: /qwen3vl_4b/i },
  vae: { loader: 'VAELoader', input: 'vae_name', files: ['qwen_image_vae.safetensors'] },
};

const KREA_COMMON: InputSchema['properties'] = {
  prompt: { type: 'string', description: 'Description de l’image, en langage naturel.' },
  steps: { type: 'integer', default: 8, minimum: 4, maximum: 12 },
  seed: SEED,
};

/** Qwen-Image 2512 : même encodeur et même VAE que Qwen Edit 2511. */
const QWEN_IMAGE_FILES: LocalEndpoint['requires'] = {
  unet: { loader: 'UnetLoaderGGUF', input: 'unet_name', match: /qwen[-_]image[-_]2512.*\.gguf$/i },
  encoder: { loader: 'CLIPLoader', input: 'clip_name', match: /qwen_2\.5_vl_7b/i },
  vae: { loader: 'VAELoader', input: 'vae_name', files: ['qwen_image_vae.safetensors'] },
  // Vitesse « rapide » : LoRA Lightning de lightx2v (facultatives).
  lightning8: { loader: 'LoraLoaderModelOnly', input: 'lora_name', match: /qwen-image-2512-lightning-8steps/i, optional: true },
  lightning4: { loader: 'LoraLoaderModelOnly', input: 'lora_name', match: /qwen-image-2512-lightning-4steps/i, optional: true },
};

/** Réglages communs de Qwen-Image 2512 (texte → image et image → image). */
const QWEN_IMAGE_COMMON: InputSchema['properties'] = {
  prompt: { type: 'string', description: 'Description de l’image, en langage naturel : il la suit à la lettre.' },
  negative_prompt: { type: 'string', description: 'Ce qu’on ne veut pas voir (vitesse normale seulement : CFG > 1).' },
  vitesse: {
    type: 'string',
    enum: ['rapide (8 étapes)', 'très rapide (4 étapes)', 'normale'],
    // Rapide par défaut : en normale (25 étapes), ~8 min par image pour un rendu pas meilleur (testé le 2026-10-14).
    default: 'rapide (8 étapes)',
    description: 'Rapide : LoRA Lightning (8 ou 4 étapes, CFG 1), ~1 min 30–2 min, sans prompt négatif. Normale : 25 étapes, ~8 min.',
  },
  steps: { type: 'integer', default: 25, minimum: 10, maximum: 50, description: 'Vitesse normale. 50 : réglage officiel, 2 fois plus long.' },
  cfg: { type: 'number', default: 4, minimum: 1, maximum: 8, description: 'Vitesse normale seulement.' },
  seed: SEED,
};

export const LTX_FILES: LocalEndpoint['requires'] = {
  unet: { loader: 'UnetLoaderGGUF', input: 'unet_name', match: /ltx-2\.3.*distilled.*\.gguf$/i },
  // Gemma 3 12B (GGUF), sans le fichier `mmproj` (vision) qui n'a pas d'utilité ici.
  encoder: { loader: 'DualCLIPLoaderGGUF', input: 'clip_name1', match: /gemma-3-12b-it.*\.gguf$/i },
  connectors: { loader: 'DualCLIPLoaderGGUF', input: 'clip_name2', match: /ltx-2\.3.*embeddings_connectors/i },
  vae: { loader: 'VAELoader', input: 'vae_name', match: /ltx-2\.3.*video_vae/i },
  audioVae: { loader: 'VAELoader', input: 'vae_name', match: /ltx-2\.3.*audio_vae/i },
  // Mouvement repris d'une vidéo (facultatif) : LoRA in-context de Lightricks (pose, profondeur, contours).
  icLora: { loader: 'LoraLoaderModelOnly', input: 'lora_name', match: /ltx-2\.3.*ic-lora-union-control/i, optional: true },
  // Deux passes (facultatif) : agrandisseur ×2 du latent, de Lightricks.
  upscaler: { loader: 'LatentUpscaleModelLoader', input: 'model_name', match: /ltx-2\.3.*spatial-upscaler-x2/i, optional: true },
};

export const LOCAL_ENDPOINTS: Record<string, Partial<Record<TaskKind, LocalEndpoint>>> = {
  'local/flux2-klein-4b': kleinEndpoints('local/flux2-klein-4b', KLEIN_FILES),
  'local/flux2-klein-9b': kleinEndpoints('local/flux2-klein-9b', KLEIN_9B_FILES),
  'local/qwen-image-2512': {
    'text-to-image': {
      modelId: 'local/qwen-image-2512/text-to-image',
      task: 'text-to-image',
      outputNode: '9',
      schema: {
        type: 'object',
        required: ['prompt'],
        properties: { ...QWEN_IMAGE_COMMON, aspect_ratio: { type: 'string', enum: ASPECT_RATIOS, default: '4:5' } },
      },
      slots: {},
      sized: true,
      // Taille native du modèle : 1328 × 1328 (~1,76 Mpx).
      pixels: 1328 * 1328,
      requires: QWEN_IMAGE_FILES,
      build: (values, ctx) => buildQwenImage(values, ctx, { width: Number(values.width), height: Number(values.height) }),
    },
    'image-to-image': {
      modelId: 'local/qwen-image-2512/image-to-image',
      task: 'image-to-image',
      outputNode: '9',
      schema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          ...QWEN_IMAGE_COMMON,
          image_url: { type: 'string' },
          strength: {
            type: 'number',
            default: 0.35,
            minimum: 0.05,
            maximum: 1,
            description: 'Faible (0,2–0,4) : « filtre », retravaille l’image en gardant la composition. Élevée : plus libre.',
          },
        },
      },
      slots: {},
      requires: QWEN_IMAGE_FILES,
      build: (values, ctx) => buildQwenImage(values, ctx, { width: 1024, height: 1024 }),
    },
  },
  'local/krea-2': {
    'text-to-image': {
      modelId: 'local/krea-2/text-to-image',
      task: 'text-to-image',
      outputNode: '9',
      schema: {
        type: 'object',
        required: ['prompt'],
        properties: { ...KREA_COMMON, aspect_ratio: { type: 'string', enum: ASPECT_RATIOS, default: '4:5' } },
      },
      slots: {},
      sized: true,
      requires: KREA_FILES,
      build: (values, ctx) => buildKrea(values, ctx, { width: Number(values.width), height: Number(values.height) }),
    },
    'image-to-image': {
      modelId: 'local/krea-2/image-to-image',
      task: 'image-to-image',
      outputNode: '9',
      schema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          ...KREA_COMMON,
          image_url: { type: 'string' },
          strength: {
            type: 'number',
            default: 0.3,
            minimum: 0.05,
            maximum: 1,
            description: 'Faible (0,2–0,3) : « filtre » réalisme, garde visage et scène. Élevée : plus libre.',
          },
        },
      },
      slots: { image: ['20', 'image'] },
      requires: KREA_FILES,
      build: buildKrea,
    },
  },
  'local/qwen-image-edit-2511': {
    'image-to-image': {
      modelId: 'local/qwen-image-edit-2511/image-to-image',
      task: 'image-to-image',
      outputNode: '9',
      schema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', description: 'La retouche : « la femme de l’image 1 dans la cuisine de l’image 2, en t-shirt gris ».' },
          image_urls: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          // « Auto » : le format de l'image 1 ; sinon une image neuve aux proportions choisies.
          aspect_ratio: { type: 'string', enum: ['adaptive', ...ASPECT_RATIOS], default: 'adaptive' },
          steps: { type: 'integer', default: 4, minimum: 4, maximum: 8 },
          seed: SEED,
        },
      },
      slots: {},
      requires: QWEN_EDIT_FILES,
      build: buildQwenEdit,
    },
  },
  'local/wan-2.2-i2v': {
    'image-to-video': {
      modelId: 'local/wan-2.2-i2v/image-to-video',
      task: 'image-to-video',
      outputNode: '9',
      schema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', description: 'Le mouvement : « elle sourit à la caméra puis prend une tomate ».' },
          image_url: { type: 'string' },
          duration_seconds: { type: 'integer', enum: [3, 5], default: 3 },
          resolution: { type: 'string', enum: ['480p', '720p'], default: '480p', description: '720p : plus net, 2 à 3 fois plus long.' },
          seed: SEED,
        },
      },
      slots: {},
      requires: WAN_I2V_FILES,
      build: buildWanI2V,
    },
  },
  'local/ltx-2.3': {
    'image-to-video': {
      modelId: 'local/ltx-2.3/image-to-video',
      task: 'image-to-video',
      outputNode: '9000',
      schema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: {
            type: 'string',
            description:
              'La scène, le mouvement et le son : « elle rit et dit "Salut !" d’une voix enjouée, bruit de cuisine ». ' +
              'Vidéo longue : une ligne « --- » sépare les passages, pour raconter une suite.',
          },
          image_url: { type: 'string' },
          // Image de fin (2e image jointe) : la vidéo arrive sur elle (dernier clip d'une vidéo longue).
          last_image_url: { type: 'string' },
          speech: {
            type: 'string',
            description:
              'Texte dit par le personnage, avec sa voix (fiche du personnage) : les lèvres suivent la phrase. ' +
              'Pauses exactes : [2s] (début, entre deux phrases, fin).',
          },
          /** Piste du « Texte dit » écoutée dans le composer (média `voice`), reprise telle quelle si elle correspond. */
          speech_audio: { type: 'string' },
          // Mouvement repris d'une vidéo : { video: 'asset:<id>' }. Objet : jamais affiché dans les réglages.
          mouvement: { type: 'object', description: 'Vidéo dont LTX reprend les mouvements (squelettes).' },
          /** Expressivité du « Texte dit » pour cette vidéo (0,2 calme → 1,2 très expressive) ; sinon celle de la voix. */
          speech_exaggeration: { type: 'number', minimum: 0.2, maximum: 1.2 },
          // Par défaut depuis le test du 2026-10-15 (720p, 15 s) : 9 min 45 au lieu de 18 min 28, scénario suivi dans
          // l'ordre (plus d'enchaînement de plans), image plus nette. Retiré du schéma sans l'agrandisseur.
          deux_passes: {
            type: 'boolean',
            default: true,
            description:
              'Méthode officielle de Lightricks : mouvement calculé en demi-définition, puis agrandi et fini en pleine ' +
              'définition (3 étapes). Plus stable, souvent pas plus long. Jusqu’à 15 s en un seul plan, même en 720p (sans enchaînement de clips).',
          },
          duration_seconds: {
            type: 'integer',
            enum: [5, 10, 15, 20, 30, 45, 60],
            default: 5,
            description:
              'Au-delà de 15 s, des clips de ~9 s enchaînés. Compte ~40 s de calcul par seconde de vidéo en 512p, le double en 720p. ' +
              'Avec un « Texte dit » : durée minimale (la voix plus courte est complétée par du silence, plus longue elle l’emporte).',
          },
          resolution: { type: 'string', enum: ['512p', '720p'], default: '512p', description: '720p : plus net, ~2 fois plus long.' },
          seed: SEED,
        },
      },
      slots: {},
      requires: LTX_FILES,
      build: buildLtx,
    },
  },
  'local/z-image-turbo': {
    'text-to-image': {
      modelId: 'local/z-image-turbo/text-to-image',
      task: 'text-to-image',
      file: 'z-image-turbo/text-to-image.json',
      outputNode: '9',
      schema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          ...Z_IMAGE_COMMON,
          aspect_ratio: { type: 'string', enum: ASPECT_RATIOS, default: '9:16' },
        },
      },
      slots: { ...Z_IMAGE_SLOTS, width: ['68', 'width'], height: ['68', 'height'] },
      lora: Z_IMAGE_LORA,
      faceSwap: Z_IMAGE_FACE,
    },
    'image-to-image': {
      modelId: 'local/z-image-turbo/image-to-image',
      task: 'image-to-image',
      file: 'z-image-turbo/image-to-image.json',
      outputNode: '9',
      schema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          ...Z_IMAGE_COMMON,
          image_url: { type: 'string' },
          strength: {
            type: 'number',
            default: 0.45,
            minimum: 0.05,
            maximum: 1,
            description: 'Faible : proche de l’image de départ. Élevée : plus libre.',
          },
        },
      },
      slots: { ...Z_IMAGE_SLOTS, strength: ['70', 'denoise'], image: ['73', 'image'] },
      lora: Z_IMAGE_LORA,
      faceSwap: Z_IMAGE_FACE,
    },
  },
};

/** Dimensions multiples de 16 pour un ratio `L:H`, autour de `pixels` (1,33 Mpx par défaut). */
export function sizeFor(aspectRatio: string, pixels = TARGET_PIXELS): { width: number; height: number } {
  const [w, h] = aspectRatio.split(':').map(Number);
  const ratio = w && h ? w / h : 9 / 16;
  const round16 = (n: number) => Math.max(256, Math.round(n / 16) * 16);
  return { width: round16(Math.sqrt(pixels * ratio)), height: round16(Math.sqrt(pixels / ratio)) };
}

/**
 * Fichiers de modèles retenus pour un endpoint (le premier installé par rôle) et ceux qui manquent.
 * Lu en direct dans ComfyUI : un fichier ajouté est pris en compte sans redémarrer l'app.
 */
export async function resolveRequirements(
  endpoint: LocalEndpoint,
  /** Fichiers imposés par rôle (le modèle de diffusion choisi : `unet`). */
  overrides: Record<string, string> = {},
): Promise<{ files: Record<string, string>; missing: string[] }> {
  const files: Record<string, string> = { ...overrides };
  const missing: string[] = [];
  for (const [role, req] of Object.entries(endpoint.requires ?? {})) {
    if (overrides[role]) continue;
    const installed = await getNodeOptions(req.loader, req.input).catch(() => [] as string[]);
    const pick = req.files?.find(f => installed.includes(f)) ?? (req.match ? installed.find(f => req.match!.test(f)) : undefined);
    if (pick) files[role] = pick;
    else if (!req.optional) missing.push(req.files?.[0] ?? `${role} (${req.match})`);
  }
  return { files, missing };
}

/**
 * Remplit le workflow avec l'`input` construit par `buildInput` (prompt, paramètres, seed).
 * `files` : noms des fichiers déjà envoyés dans le dossier `input` de ComfyUI
 * (`image` : image de départ, `face` : visage à appliquer, `images` : références, dans l'ordre).
 */
/** Rendu « photo de téléphone » (nœud AI Fluence) : force appliquée. */
const PHONE_LOOK_STRENGTH = 0.6;

/**
 * Workflow d'un endpoint local, avec le post-traitement demandé : « Rendu téléphone » (grain, vignetage, compression
 * JPEG) inséré juste avant l'enregistrement de l'image.
 */
export async function buildGraph(
  endpoint: LocalEndpoint,
  input: Record<string, unknown>,
  files: Parameters<typeof buildBaseGraph>[2] = {},
): Promise<Graph> {
  const graph = await buildBaseGraph(endpoint, input, files);
  const save = graph[endpoint.outputNode];
  if (input.rendu_telephone === true && save?.class_type === 'SaveImage') {
    graph.phone = { class_type: 'AIFluencePhoneLook', inputs: { image: save.inputs.images, strength: PHONE_LOOK_STRENGTH } };
    save.inputs.images = ['phone', 0];
  }
  return graph;
}

async function buildBaseGraph(
  endpoint: LocalEndpoint,
  input: Record<string, unknown>,
  files: {
    image?: string;
    face?: string;
    images?: string[];
    imageSizes?: ({ width: number; height: number } | null)[];
    /** Voix imposée (vidéo parlée) : fichier dans `input` de ComfyUI et durée. */
    audio?: { file: string; seconds: number };
    /** Retouche : masque peint (fichier dans `input`) et son cadre. */
    mask?: { file: string; box: RetouchBox };
    /** Vidéo de mouvement (fichier dans `input`). */
    motion?: { file: string };
  } = {},
): Promise<Graph> {
  const values: Record<string, unknown> = { ...input, image: files.image };
  const props = endpoint.schema.properties ?? {};
  for (const [key, prop] of Object.entries(props)) {
    if (values[key] === undefined && prop.default !== undefined) values[key] = prop.default;
  }
  // Taille imposée (miniatures), sinon déduite des proportions.
  const fixedSize = typeof input.width === 'number' && typeof input.height === 'number';
  const sized = endpoint.sized || (endpoint.slots.width && endpoint.slots.height);
  if (sized && !fixedSize) Object.assign(values, sizeFor(String(values.aspect_ratio ?? '9:16'), endpoint.pixels));

  if (endpoint.build) {
    // Modèle de diffusion choisi (menu « Modèle », cf. Paramètres → Modèles locaux).
    const chosen: Record<string, string> = endpoint.requires?.unet && typeof values.model === 'string' ? { unet: values.model } : {};
    const { files: models, missing } = await resolveRequirements(endpoint, chosen);
    if (missing.length) throw new Error(`Fichiers manquants dans ComfyUI : ${missing.join(', ')}.`);
    const images = files.images ?? (files.image ? [files.image] : []);
    return endpoint.build(values, {
      images,
      imageSizes: files.imageSizes ?? images.map(() => null),
      files: models,
      audio: files.audio,
      mask: files.mask,
      // Correction automatique (visages, mains, pieds détectés).
      regions: autofixRegions(values.autofix),
      motion: files.motion,
    });
  }

  const graph = JSON.parse(readFileSync(WORKFLOWS_DIR + endpoint.file!, 'utf8')) as Graph;

  for (const [key, slot] of Object.entries(endpoint.slots)) {
    const value = values[key];
    if (value === undefined) continue;
    const node = graph[slot[0]];
    if (!node) throw new Error(`Workflow ${endpoint.file} : nœud ${slot[0]} introuvable.`);
    node.inputs[slot[1]] = value;
  }

  if (endpoint.lora && typeof values.lora === 'string' && values.lora !== NO_LORA) {
    const [node, input] = endpoint.lora.to;
    if (!graph[node]) throw new Error(`Workflow ${endpoint.file} : nœud ${node} introuvable.`);
    graph[LORA_NODE] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: { lora_name: values.lora, strength_model: values.lora_strength ?? 1, model: endpoint.lora.from },
    };
    graph[node].inputs[input] = [LORA_NODE, 0];
  }

  if (files.face) {
    if (!endpoint.faceSwap) throw new Error(`Workflow ${endpoint.file} : le visage n'est pas pris en charge.`);
    const [node, input] = endpoint.faceSwap.to;
    if (!graph[node]) throw new Error(`Workflow ${endpoint.file} : nœud ${node} introuvable.`);
    graph[FACE_IMAGE_NODE] = { class_type: 'LoadImage', inputs: { image: files.face } };
    graph[FACE_SWAP_NODE] = {
      class_type: REACTOR,
      inputs: {
        ...REACTOR_DEFAULTS,
        face_restore_model: values.face_restore ?? REACTOR_DEFAULTS.face_restore_model,
        input_image: endpoint.faceSwap.from,
        source_image: [FACE_IMAGE_NODE, 0],
      },
    };
    graph[node].inputs[input] = [FACE_SWAP_NODE, 0];
  }
  return graph;
}

/** ReActor installé dans ComfyUI : le visage peut être proposé. */
async function canSwapFaces(): Promise<boolean> {
  return hasNodes([REACTOR]).catch(() => false);
}

/**
 * Schéma complété avec ce qui est installé dans ComfyUI : modèles compatibles et LoRA.
 * Un fichier ajouté dans ComfyUI apparaît donc dans l'app sans toucher au code.
 */
async function liveSchema(endpoint: LocalEndpoint, faces: boolean, models: string[] | null): Promise<InputSchema> {
  const properties = { ...endpoint.schema.properties };
  if (endpoint.faceSwap && faces) {
    const models = await getNodeOptions(REACTOR, 'face_restore_model');
    if (models.length) {
      properties.face_restore = {
        type: 'string',
        enum: models,
        default: models.includes('none') ? 'none' : models[0],
        description: 'Avec une image « Visage » : affine le visage après le swap.',
      };
    }
  }
  // Options AI Fluence des images (nœuds `comfyui-nodes/ai_fluence`) : rendu téléphone, correction automatique.
  if (endpoint.task === 'text-to-image' || endpoint.task === 'image-to-image') {
    if (await hasNodes(['AIFluencePhoneLook']).catch(() => false)) {
      properties.rendu_telephone = {
        type: 'boolean',
        default: false,
        description: 'Grain de capteur, léger vignetage et compression JPEG : une image moins « parfaite », comme prise au téléphone.',
      };
    }
    if (await hasNodes(['AIFluenceDetectParts', 'AIFluenceColorMatch']).catch(() => false)) {
      properties.correction_auto = {
        type: 'boolean',
        default: false,
        description:
          'Après chaque image : visages et pieds repérés puis refaits par klein (mains seulement si la détection est sûre). ' +
          'Le résultat corrigé arrive en plus dans le fil (~1 min par zone).',
      };
    }
  }
  // Deux passes de LTX : seulement avec l'agrandisseur de Lightricks installé.
  if (properties.deux_passes) {
    const upscalers = await getNodeOptions('LatentUpscaleModelLoader', 'model_name').catch(() => []);
    if (!upscalers.some(f => /ltx-2\.3.*spatial-upscaler-x2/i.test(f))) delete properties.deux_passes;
  }
  // Modèle de diffusion au choix : les fichiers visibles de la famille, le préféré en premier.
  if (models?.length) properties.model = { type: 'string', enum: models, default: models[0] };
  if (endpoint.lora) {
    const loras = await getNodeOptions('LoraLoaderModelOnly', 'lora_name');
    if (loras.length) {
      properties.lora = { type: 'string', enum: [NO_LORA, ...loras], default: NO_LORA };
      properties.lora_strength = { type: 'number', default: 1, minimum: 0, maximum: 2 };
    }
  }
  return { ...endpoint.schema, properties };
}

// ── Modèles de diffusion : reconnus par leur nom, ou rattachés à une famille dans Paramètres ──

/** Familles dont on choisit le modèle de diffusion (plusieurs variantes possibles) : nom reconnu, fichier préféré. */
const MAIN_MODEL: Record<string, { match: RegExp; preferred?: string }> = {
  'local/z-image-turbo': { match: /z[-_ ]?image/i, preferred: 'zImageTurbo_turbo.safetensors' },
  'local/flux2-klein-4b': { match: /flux-2-klein-4b/i, preferred: 'flux-2-klein-4b-fp8.safetensors' },
  'local/flux2-klein-9b': { match: /flux-2-klein-9b/i },
  'local/krea-2': { match: /krea2/i },
  'local/qwen-image-edit-2511': { match: /qwen[-_]image[-_]edit[-_]2511/i },
  'local/qwen-image-2512': { match: /qwen[-_]image[-_]2512/i },
  // « ltx-2.3-22b-distilled… » (Unsloth) comme « ltx23DISTILLED… » (Civitai).
  // Q5_K_M par défaut (choix de Kevin, 2026-10-14) ; les autres versions restent dans le menu « Modèle ».
  'local/ltx-2.3': { match: /ltx[-_ ]?2[._]?3.*distilled/i, preferred: 'ltx-2.3-22b-distilled-1.1-Q5_K_M.gguf' },
};
/** Wan : une paire de fichiers (bruit fort, bruit faible), reconnue par son nom ; on peut seulement la cacher. */
const FIXED_MODEL: Record<string, RegExp> = { 'local/wan-2.2-i2v': /wan2\.2-i2v/i };

/** Rattachables à la main (Paramètres) : les familles à modèle de diffusion unique. */
export const ASSIGNABLE_FAMILIES = Object.keys(MAIN_MODEL);

/** Fichiers des dossiers `diffusion_models` et `unet` de ComfyUI (safetensors et GGUF). */
export async function diffusionFiles(): Promise<string[]> {
  const lists = await Promise.all(
    [getNodeOptions('UNETLoader', 'unet_name'), getNodeOptions('UnetLoaderGGUF', 'unet_name')].map(p => p.catch(() => [] as string[])),
  );
  return [...new Set(lists.flat())].sort((a, b) => a.localeCompare(b));
}

/** Fichier préféré d'une famille s'il est installé (la création de voix prend ainsi la même version de LTX). */
export async function preferredModel(familyId: string): Promise<string | undefined> {
  const preferred = MAIN_MODEL[familyId]?.preferred;
  return preferred && (await diffusionFiles()).includes(preferred) ? preferred : undefined;
}

/** Famille déduite du nom du fichier (null : non reconnu). */
export function detectFamily(file: string): string | null {
  for (const [id, { match }] of Object.entries(MAIN_MODEL)) if (match.test(file)) return id;
  for (const [id, match] of Object.entries(FIXED_MODEL)) if (match.test(file)) return id;
  return null;
}

/** Fichiers d'une famille : tous (cachés compris) et visibles, le préféré en premier. */
function familyModels(familyId: string, files: string[], config: LocalModelsConfig) {
  const preferred = MAIN_MODEL[familyId]?.preferred;
  const all = files
    .filter(f => (config[f]?.family ?? detectFamily(f)) === familyId)
    .sort((a, b) => Number(b === preferred) - Number(a === preferred));
  return { all, visible: all.filter(f => !config[f]?.hidden) };
}

/**
 * Familles locales du catalogue : présentes seulement si ComfyUI est configuré. Réglages de l'utilisateur
 * (Paramètres → Modèles locaux) : une famille dont tous les fichiers sont cachés n'est pas proposée.
 */
export async function getLocalFamilies(userId: string): Promise<CatalogFamily[]> {
  if (!env.COMFYUI_URL) return [];
  const running = await isComfyRunning();
  const faces = running && (await canSwapFaces());
  const config = (await getSettingsRow(userId)).localModels;
  const files = running ? await diffusionFiles() : [];
  const families = await Promise.all(
    LOCAL_FAMILIES.map(async (def): Promise<CatalogFamily | null> => {
      const { all, visible } = familyModels(def.id, files, config);
      if (all.length && !visible.length) return null;
      if (FIXED_MODEL[def.id] && visible.length < all.length) return null;
      const main = MAIN_MODEL[def.id] ? visible : null;
      const tasks: CatalogFamily['tasks'] = {};
      const endpoints = Object.values(LOCAL_ENDPOINTS[def.id] ?? {});
      for (const endpoint of endpoints) {
        // ComfyUI arrêté : schéma de base, la famille est de toute façon indisponible.
        const schema = running ? await liveSchema(endpoint, faces, main).catch(() => endpoint.schema) : endpoint.schema;
        tasks[endpoint.task] = { modelId: endpoint.modelId, schema, startingPrice: null, policyTier: null };
      }
      // Fichiers de modèles requis : sans eux, le modèle est grisé (ex. Qwen Edit pas encore téléchargé).
      const chosen: Record<string, string> = main?.[0] ? { unet: main[0] } : {};
      const missing = running
        ? [
            ...new Set([
              ...(main && !main.length ? [`modèle de diffusion (${def.label})`] : []),
              ...(await Promise.all(endpoints.map(e => resolveRequirements(e, chosen)))).flatMap(r => r.missing),
            ]),
          ]
        : [];
      const ready = running && Object.keys(tasks).length > 0 && missing.length === 0;
      return {
        ...def,
        runtime: 'comfy',
        typicalSeconds: null,
        supportsFace: faces && endpoints.some(e => e.faceSwap),
        tasks,
        available: ready,
        unavailableReason: ready
          ? null
          : !running
            ? 'Démarre ComfyUI pour l’utiliser'
            : `Fichiers manquants dans ComfyUI : ${missing.join(', ')}`,
      };
    }),
  );
  return families.filter((f): f is CatalogFamily => f !== null);
}

/** Paramètres → Modèles locaux : chaque fichier de diffusion, sa famille et sa visibilité. */
export async function listLocalModels(userId: string): Promise<LocalModelsResponse> {
  const config = (await getSettingsRow(userId)).localModels;
  const files = await diffusionFiles();
  return {
    files: await Promise.all(
      files.map(async file => {
        const detected = detectFamily(file);
        return {
          file,
          bytes: await modelFileSize(file),
          detected,
          family: config[file]?.family ?? detected,
          assigned: Boolean(config[file]?.family),
          hidden: Boolean(config[file]?.hidden),
        };
      }),
    ),
    families: LOCAL_FAMILIES.map(f => ({ id: f.id, label: f.label, assignable: ASSIGNABLE_FAMILIES.includes(f.id) })),
  };
}

/** Endpoint local d'un model ID (`local/z-image-turbo/text-to-image`). */
export function localEndpoint(modelId: string): LocalEndpoint | undefined {
  for (const tasks of Object.values(LOCAL_ENDPOINTS)) {
    for (const endpoint of Object.values(tasks)) if (endpoint.modelId === modelId) return endpoint;
  }
  return undefined;
}
