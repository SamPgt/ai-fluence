/**
 * Workflows ComfyUI construits en code (le nombre d'images de référence varie d'une demande à l'autre).
 * Repris des modèles officiels de ComfyUI (`comfyui_workflow_templates`) et validés sur RTX 3060 12 Go
 * le 2026-10-10 (avec `--reserve-vram 1.5`) :
 *
 * - FLUX.2 klein 4B (fp8) : ~8 s en texte seul, 14–26 s avec 1 ou 2 références, sans débordement en RAM ;
 * - Qwen-Image-Edit-2511 (GGUF Q3_K_M + Lightning 4 étapes) : ~1 min, 1 à 1,7 Go en RAM (déchargement géré) ;
 * - Wan 2.2 image → vidéo 14B (GGUF Q3_K_M, LoRA lightx2v 4 étapes) : ~4 min 30 pour 3 s en 480p.
 *
 * Décodage par tuiles partout : d'un seul bloc, le décodage d'une image de 1,3 Mpx a pris 6 min au lieu de
 * quelques secondes (le pilote Windows déborde alors en silence sur la RAM).
 */
import { randomInt } from 'node:crypto';

export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

/** Fichiers envoyés à ComfyUI et fichiers de modèles résolus (ceux réellement installés). */
export interface BuildContext {
  /** Images d'entrée (dossier `input` de ComfyUI), dans l'ordre de la demande. */
  images: string[];
  /** Taille de chaque image d'entrée (même ordre), si connue. */
  imageSizes: ({ width: number; height: number } | null)[];
  /** Fichiers de modèles retenus, par rôle (`encoder`, `vae`…). */
  files: Record<string, string>;
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const seedOf = (v: unknown) => (typeof v === 'number' ? v : randomInt(2 ** 31 - 1));

/** FLUX.2 klein 4B : texte → image, ou avec 1 à 3 images de référence (cohérence personnage / lieu). */
export function buildKlein(values: Record<string, unknown>, ctx: BuildContext, size: { width: number; height: number }): Graph {
  const g: Graph = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: ctx.files.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: ctx.files.encoder, type: 'flux2', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: ctx.files.vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: String(values.prompt ?? ''), clip: ['2', 0] } },
    '5': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
  };
  let pos: [string, number] = ['4', 0];
  let neg: [string, number] = ['5', 0];
  // Chaque référence est encodée puis attachée au conditionnement positif et négatif.
  ctx.images.forEach((image, i) => {
    const b = 10 + i * 10;
    g[b] = { class_type: 'LoadImage', inputs: { image } };
    g[b + 1] = { class_type: 'ImageScaleToTotalPixels', inputs: { image: [`${b}`, 0], upscale_method: 'lanczos', megapixels: 1, resolution_steps: 1 } };
    g[b + 2] = { class_type: 'VAEEncode', inputs: { pixels: [`${b + 1}`, 0], vae: ['3', 0] } };
    g[b + 3] = { class_type: 'ReferenceLatent', inputs: { conditioning: pos, latent: [`${b + 2}`, 0] } };
    g[b + 4] = { class_type: 'ReferenceLatent', inputs: { conditioning: neg, latent: [`${b + 2}`, 0] } };
    pos = [`${b + 3}`, 0];
    neg = [`${b + 4}`, 0];
  });
  const steps = num(values.steps, 4);
  Object.assign(g, {
    '90': { class_type: 'EmptyFlux2LatentImage', inputs: { ...size, batch_size: 1 } },
    '91': { class_type: 'Flux2Scheduler', inputs: { steps, ...size } },
    '92': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '93': { class_type: 'RandomNoise', inputs: { noise_seed: seedOf(values.seed) } },
    '94': { class_type: 'CFGGuider', inputs: { model: ['1', 0], positive: pos, negative: neg, cfg: 1 } },
    '95': {
      class_type: 'SamplerCustomAdvanced',
      inputs: { noise: ['93', 0], guider: ['94', 0], sampler: ['92', 0], sigmas: ['91', 0], latent_image: ['90', 0] },
    },
    '96': { class_type: 'VAEDecodeTiled', inputs: { samples: ['95', 0], vae: ['3', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } },
    '9': { class_type: 'SaveImage', inputs: { images: ['96', 0], filename_prefix: 'ai-fluence/flux2-klein' } },
  });
  return g;
}

/** Qwen-Image-Edit-2511 : retouche guidée par 1 à 3 images ; l'image produite reprend le cadre de la première. */
export function buildQwenEdit(values: Record<string, unknown>, ctx: BuildContext): Graph {
  const g: Graph = {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: ctx.files.unet } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: ctx.files.encoder, type: 'qwen_image', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: ctx.files.vae } },
    '4': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3.1 } },
    '5': { class_type: 'CFGNorm', inputs: { model: ['4', 0], strength: 1 } },
    '6': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['5', 0], lora_name: ctx.files.lightning, strength_model: 1 } },
  };
  const images: Record<string, [string, number]> = {};
  ctx.images.slice(0, 3).forEach((image, i) => {
    const b = 10 + i * 10;
    g[b] = { class_type: 'LoadImage', inputs: { image } };
    g[b + 1] = { class_type: 'FluxKontextImageScale', inputs: { image: [`${b}`, 0] } };
    images[`image${i + 1}`] = [`${b + 1}`, 0];
  });
  for (const [key, text] of [['40', String(values.prompt ?? '')], ['41', '']] as const) {
    g[key] = { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['2', 0], vae: ['3', 0], prompt: text, ...images } };
    g[`${Number(key) + 2}`] = {
      class_type: 'FluxKontextMultiReferenceLatentMethod',
      inputs: { conditioning: [key, 0], reference_latents_method: 'index_timestep_zero' },
    };
  }
  Object.assign(g, {
    '50': { class_type: 'VAEEncode', inputs: { pixels: images.image1, vae: ['3', 0] } },
    '51': {
      class_type: 'KSampler',
      inputs: {
        model: ['6', 0], positive: ['42', 0], negative: ['43', 0], latent_image: ['50', 0],
        seed: seedOf(values.seed), steps: num(values.steps, 4), cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
      },
    },
    '52': { class_type: 'VAEDecodeTiled', inputs: { samples: ['51', 0], vae: ['3', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } },
    '9': { class_type: 'SaveImage', inputs: { images: ['52', 0], filename_prefix: 'ai-fluence/qwen-edit' } },
  });
  return g;
}

/** Prompt négatif du modèle officiel Wan (en chinois : c'est la langue de son entraînement). */
const WAN_NEGATIVE =
  '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走';

/** Taille de la vidéo : le petit côté à 480 ou 720 px, les proportions de l'image de départ, multiples de 16. */
function videoSize(image: { width: number; height: number } | null, resolution: string) {
  const short = resolution === '720p' ? 720 : 480;
  const ratio = image ? image.width / image.height : 9 / 16;
  const round16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  return ratio >= 1 ? { width: round16(short * ratio), height: short } : { width: short, height: round16(short / ratio) };
}

/** Wan 2.2 image → vidéo 14B : deux experts (bruit fort puis faible), chacun avec sa LoRA lightx2v 4 étapes. */
export function buildWanI2V(values: Record<string, unknown>, ctx: BuildContext): Graph {
  const fps = 16;
  const seconds = num(values.duration_seconds, 3);
  const length = Math.floor((seconds * fps) / 4) * 4 + 1; // Wan : 4k + 1 images
  const size = videoSize(ctx.imageSizes[0] ?? null, String(values.resolution ?? '480p'));
  const steps = 4;
  const switchAt = 2;
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: ctx.files.high } },
    '2': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: ctx.files.low } },
    '3': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: ctx.files.loraHigh, strength_model: 1 } },
    '4': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['2', 0], lora_name: ctx.files.loraLow, strength_model: 1 } },
    // Calcul en bf16 : en fp16, choisi par défaut pour ces GGUF, Wan peut déborder (images noires).
    '20': { class_type: 'ModelComputeDtype', inputs: { model: ['3', 0], dtype: 'bf16' } },
    '21': { class_type: 'ModelComputeDtype', inputs: { model: ['4', 0], dtype: 'bf16' } },
    '5': { class_type: 'ModelSamplingSD3', inputs: { model: ['20', 0], shift: 5 } },
    '6': { class_type: 'ModelSamplingSD3', inputs: { model: ['21', 0], shift: 5 } },
    '7': { class_type: 'CLIPLoader', inputs: { clip_name: ctx.files.encoder, type: 'wan', device: 'default' } },
    '8': { class_type: 'VAELoader', inputs: { vae_name: ctx.files.vae } },
    '10': { class_type: 'CLIPTextEncode', inputs: { clip: ['7', 0], text: String(values.prompt ?? '') } },
    '11': { class_type: 'CLIPTextEncode', inputs: { clip: ['7', 0], text: WAN_NEGATIVE } },
    '12': { class_type: 'LoadImage', inputs: { image: ctx.images[0] } },
    '13': {
      class_type: 'WanImageToVideo',
      inputs: { positive: ['10', 0], negative: ['11', 0], vae: ['8', 0], start_image: ['12', 0], ...size, length, batch_size: 1 },
    },
    '14': {
      class_type: 'KSamplerAdvanced',
      inputs: {
        model: ['5', 0], positive: ['13', 0], negative: ['13', 1], latent_image: ['13', 2], add_noise: 'enable',
        noise_seed: seedOf(values.seed), steps, cfg: 1, sampler_name: 'euler', scheduler: 'simple',
        start_at_step: 0, end_at_step: switchAt, return_with_leftover_noise: 'enable',
      },
    },
    '15': {
      class_type: 'KSamplerAdvanced',
      inputs: {
        model: ['6', 0], positive: ['13', 0], negative: ['13', 1], latent_image: ['14', 0], add_noise: 'disable',
        noise_seed: 0, steps, cfg: 1, sampler_name: 'euler', scheduler: 'simple',
        start_at_step: switchAt, end_at_step: 10000, return_with_leftover_noise: 'disable',
      },
    },
    '16': { class_type: 'VAEDecodeTiled', inputs: { samples: ['15', 0], vae: ['8', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } },
    '17': { class_type: 'CreateVideo', inputs: { images: ['16', 0], fps } },
    '9': { class_type: 'SaveVideo', inputs: { video: ['17', 0], filename_prefix: 'ai-fluence/wan-2.2', format: 'mp4', 'format.codec': 'h264' } },
  };
}
