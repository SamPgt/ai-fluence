/**
 * Workflows ComfyUI construits en code (le nombre d'images de référence varie d'une demande à l'autre).
 * Repris des modèles officiels de ComfyUI (`comfyui_workflow_templates`) et validés sur RTX 3060 12 Go
 * le 2026-10-10 (avec `--reserve-vram 1.5`) :
 *
 * - FLUX.2 klein 4B (fp8) : ~8 s en texte seul, 14–26 s avec 1 ou 2 références, sans débordement en RAM ;
 * - Qwen-Image-Edit-2511 (GGUF Q3_K_M + Lightning 4 étapes) : ~1 min, 1 à 1,7 Go en RAM (déchargement géré) ;
 * - Wan 2.2 image → vidéo 14B (GGUF Q3_K_M, LoRA lightx2v 4 étapes) : ~4 min 30 pour 3 s en 480p.
 * - LTX-2.3 distilled 22B (GGUF Q4_K_M, Gemma 3 12B Q4) : image → vidéo avec le son en une passe, ~5 min pour
 *   4 s en 512p, ~8–10 min pour 7 s en 720p (le 2026-10-11). Demande ~50 Go de mémoire virtuelle Windows
 *   (fichier d'échange) : sans elle, ComfyUI s'arrête net au chargement du modèle.
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
  /** Piste audio imposée (dossier `input` de ComfyUI) et sa durée : la vidéo suit cette voix. */
  audio?: { file: string; seconds: number };
  /** Retouche : masque peint (blanc = à refaire, dossier `input`) et son cadre dans l'image 1, en pixels. */
  mask?: { file: string; box: RetouchBox };
}

export interface RetouchBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const num =(v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const seedOf = (v: unknown) => (typeof v === 'number' ? v : randomInt(2 ** 31 - 1));

/** FLUX.2 klein 4B : texte → image, ou avec 1 à 3 images de référence (cohérence personnage / lieu). */
export function buildKlein(values: Record<string, unknown>, ctx: BuildContext, size: { width: number; height: number }): Graph {
  if (ctx.mask) return buildKleinRetouch(values, ctx, ctx.mask);
  const g: Graph = {
    // 4B en fp8 (UNETLoader), 9B en GGUF (UnetLoaderGGUF).
    '1': ctx.files.unet.endsWith('.gguf')
      ? { class_type: 'UnetLoaderGGUF', inputs: { unet_name: ctx.files.unet } }
      : { class_type: 'UNETLoader', inputs: { unet_name: ctx.files.unet, weight_dtype: 'default' } },
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
  // Force < 1 (« filtre ») : on part de l'image 1, légèrement bruitée, au lieu d'une toile vide. La composition et
  // l'anatomie viennent de l'image, klein n'apporte que sa peau et ses couleurs (la fin des étapes seulement).
  const strength = num(values.strength, 1);
  const filter = strength < 1 && ctx.images.length > 0;
  Object.assign(g, {
    '90': { class_type: 'EmptyFlux2LatentImage', inputs: { ...size, batch_size: 1 } },
    '91': { class_type: 'Flux2Scheduler', inputs: { steps, ...size } },
    '92': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '93': { class_type: 'RandomNoise', inputs: { noise_seed: seedOf(values.seed) } },
    '94': { class_type: 'CFGGuider', inputs: { model: ['1', 0], positive: pos, negative: neg, cfg: 1 } },
    '95': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['93', 0],
        guider: ['94', 0],
        sampler: ['92', 0],
        sigmas: filter ? ['98', 1] : ['91', 0],
        latent_image: filter ? ['12', 0] : ['90', 0],
      },
    },
    '96': { class_type: 'VAEDecodeTiled', inputs: { samples: ['95', 0], vae: ['3', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } },
    '9': { class_type: 'SaveImage', inputs: { images: ['96', 0], filename_prefix: 'ai-fluence/flux2-klein' } },
  });
  if (filter) g['98'] = { class_type: 'SplitSigmasDenoise', inputs: { sigmas: ['91', 0], denoise: strength } };
  return g;
}

/**
 * Retouche locale (inpainting) avec klein, en nœuds de base de ComfyUI : la zone peinte et du contexte autour
 * (2,5 fois sa taille, 384 px au moins) sont découpés et agrandis à ~1 Mpx ; klein repeint la zone en voyant le
 * reste de la découpe, la zone grisée (il ne recopie pas le défaut : une main ratée est refaite de zéro) ; le
 * résultat est recollé dans l'image d'origine avec un bord adouci, le reste de l'image ne bouge pas d'un pixel.
 *
 * Testé le 2026-10-13 (RTX 3060, klein 9B Q5) : une main refaite de zéro, posée sur un paréo ou tenant un verre,
 * naturelle et sans raccord visible, ~1 min. Z-Image (même découpe, masque de bruit) donnait une main vieillie à la
 * peau fausse ; Qwen Edit, une bonne main, en ~1 min 45.
 */
export function buildKleinRetouch(values: Record<string, unknown>, ctx: BuildContext, mask: { file: string; box: RetouchBox }): Graph {
  const size = ctx.imageSizes[0];
  if (!size) throw new Error('Retouche : taille de l’image inconnue.');
  const { width: W, height: H } = size;
  // Cadre de la découpe : la zone au centre, avec du contexte, dans les limites de l'image.
  const side = Math.max(384, Math.round(Math.max(mask.box.width, mask.box.height) * 2.5));
  const bw = Math.floor(Math.min(W, side) / 8) * 8;
  const bh = Math.floor(Math.min(H, side) / 8) * 8;
  const cx = mask.box.x + mask.box.width / 2;
  const cy = mask.box.y + mask.box.height / 2;
  const bx = Math.round(Math.max(0, Math.min(W - bw, cx - bw / 2)));
  const by = Math.round(Math.max(0, Math.min(H - bh, cy - bh / 2)));
  // Travail à ~1 Mpx (klein y est entraîné), multiples de 16.
  const scale = Math.sqrt((1024 * 1024) / (bw * bh));
  const tw = Math.max(256, Math.round((bw * scale) / 16) * 16);
  const th = Math.max(256, Math.round((bh * scale) / 16) * 16);
  const denoise = num(values.strength, 1);

  return {
    '1': { class_type: 'LoadImage', inputs: { image: ctx.images[0] } },
    '2': { class_type: 'LoadImageMask', inputs: { image: mask.file, channel: 'red' } },
    '3': { class_type: 'ImageCrop', inputs: { image: ['1', 0], width: bw, height: bh, x: bx, y: by } },
    '4': { class_type: 'CropMask', inputs: { mask: ['2', 0], x: bx, y: by, width: bw, height: bh } },
    '5': { class_type: 'ImageScale', inputs: { image: ['3', 0], upscale_method: 'lanczos', width: tw, height: th, crop: 'disabled' } },
    '6': { class_type: 'MaskToImage', inputs: { mask: ['4', 0] } },
    '7': { class_type: 'ImageScale', inputs: { image: ['6', 0], upscale_method: 'bilinear', width: tw, height: th, crop: 'disabled' } },
    '8': { class_type: 'ImageToMask', inputs: { image: ['7', 0], channel: 'red' } },
    // Zone repeinte un peu plus large que le masque : le modèle raccorde lui-même les bords.
    '12': { class_type: 'GrowMask', inputs: { mask: ['8', 0], expand: 16, tapered_corners: true } },
    // Référence vue par klein : la découpe, zone grisée.
    '10': { class_type: 'EmptyImage', inputs: { width: tw, height: th, batch_size: 1, color: 0x808080 } },
    '11': {
      class_type: 'ImageCompositeMasked',
      inputs: { destination: ['5', 0], source: ['10', 0], x: 0, y: 0, resize_source: false, mask: ['12', 0] },
    },
    '20': ctx.files.unet.endsWith('.gguf')
      ? { class_type: 'UnetLoaderGGUF', inputs: { unet_name: ctx.files.unet } }
      : { class_type: 'UNETLoader', inputs: { unet_name: ctx.files.unet, weight_dtype: 'default' } },
    '21': { class_type: 'CLIPLoader', inputs: { clip_name: ctx.files.encoder, type: 'flux2', device: 'default' } },
    '22': { class_type: 'VAELoader', inputs: { vae_name: ctx.files.vae } },
    '24': { class_type: 'DifferentialDiffusion', inputs: { model: ['20', 0] } },
    '25': { class_type: 'CLIPTextEncode', inputs: { clip: ['21', 0], text: String(values.prompt ?? '') } },
    '26': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['25', 0] } },
    '27': { class_type: 'VAEEncode', inputs: { pixels: ['5', 0], vae: ['22', 0] } },
    '28': { class_type: 'SetLatentNoiseMask', inputs: { samples: ['27', 0], mask: ['12', 0] } },
    '44': { class_type: 'VAEEncode', inputs: { pixels: ['11', 0], vae: ['22', 0] } },
    '31': { class_type: 'ReferenceLatent', inputs: { conditioning: ['25', 0], latent: ['44', 0] } },
    '32': { class_type: 'ReferenceLatent', inputs: { conditioning: ['26', 0], latent: ['44', 0] } },
    '33': { class_type: 'Flux2Scheduler', inputs: { steps: num(values.steps, 4), width: tw, height: th } },
    '34': { class_type: 'SplitSigmasDenoise', inputs: { sigmas: ['33', 0], denoise } },
    '35': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '36': { class_type: 'RandomNoise', inputs: { noise_seed: seedOf(values.seed) } },
    '37': { class_type: 'CFGGuider', inputs: { model: ['24', 0], positive: ['31', 0], negative: ['32', 0], cfg: 1 } },
    '38': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['36', 0],
        guider: ['37', 0],
        sampler: ['35', 0],
        sigmas: denoise < 1 ? ['34', 1] : ['33', 0],
        latent_image: ['28', 0],
      },
    },
    '39': {
      class_type: 'VAEDecodeTiled',
      inputs: { samples: ['38', 0], vae: ['22', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 },
    },
    // Recollage : à la taille de la découpe, masque élargi puis adouci.
    '80': { class_type: 'GrowMask', inputs: { mask: ['4', 0], expand: 6, tapered_corners: true } },
    '81': { class_type: 'FeatherMask', inputs: { mask: ['80', 0], left: 12, top: 12, right: 12, bottom: 12 } },
    '82': { class_type: 'ImageScale', inputs: { image: ['39', 0], upscale_method: 'lanczos', width: bw, height: bh, crop: 'disabled' } },
    '83': {
      class_type: 'ImageCompositeMasked',
      inputs: { destination: ['1', 0], source: ['82', 0], x: bx, y: by, resize_source: false, mask: ['81', 0] },
    },
    '9': { class_type: 'SaveImage', inputs: { images: ['83', 0], filename_prefix: 'ai-fluence/retouche' } },
  };
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
  // Format : par défaut celui de l'image 1 (`adaptive`) ; sinon une toile neuve aux proportions choisies, ~1 Mpx.
  const ratio = /^(\d+):(\d+)$/.exec(String(values.aspect_ratio ?? ''));
  const latent: [string, number] = ['50', 0];
  if (ratio) {
    const r = Number(ratio[1]) / Number(ratio[2]);
    const round16 = (n: number) => Math.max(256, Math.round(n / 16) * 16);
    const pixels = 1024 * 1024;
    g['50'] = {
      class_type: 'EmptySD3LatentImage',
      inputs: { width: round16(Math.sqrt(pixels * r)), height: round16(Math.sqrt(pixels / r)), batch_size: 1 },
    };
  } else {
    g['50'] = { class_type: 'VAEEncode', inputs: { pixels: images.image1, vae: ['3', 0] } };
  }
  Object.assign(g, {
    '51': {
      class_type: 'KSampler',
      inputs: {
        model: ['6', 0], positive: ['42', 0], negative: ['43', 0], latent_image: latent,
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

// ── Krea 2 Turbo : texte → image, image → image ──────────────

/**
 * Krea 2 Turbo (GGUF Q5_K_M, encodeur Qwen3-VL 4B, VAE de Qwen Image), d'après le modèle officiel de ComfyUI :
 * 8 étapes, CFG 1. Mesuré sur RTX 3060 (2026-10-11) : ~1 min 15 pour 1,3 Mpx une fois chargé (9,3 s/étape).
 * Image → image : l'image est ramenée à ~1,3 Mpx puis retravaillée à la force choisie (0,25 : « filtre » réalisme).
 */
export function buildKrea(values: Record<string, unknown>, ctx: BuildContext, size?: { width: number; height: number }): Graph {
  const g: Graph = {
    '10': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: ctx.files.unet } },
    '11': { class_type: 'CLIPLoader', inputs: { clip_name: ctx.files.encoder, type: 'krea2', device: 'default' } },
    '12': { class_type: 'VAELoader', inputs: { vae_name: ctx.files.vae } },
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['11', 0], text: String(values.prompt ?? '') } },
    '13': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['6', 0] } },
    '8': { class_type: 'VAEDecodeTiled', inputs: { samples: ['3', 0], vae: ['12', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'ai-fluence/krea-2' } },
  };
  let denoise = 1;
  if (ctx.images[0]) {
    g['20'] = { class_type: 'LoadImage', inputs: { image: ctx.images[0] } };
    g['21'] = { class_type: 'ImageScaleToTotalPixels', inputs: { image: ['20', 0], upscale_method: 'lanczos', megapixels: 1.3, resolution_steps: 16 } };
    g['5'] = { class_type: 'VAEEncode', inputs: { pixels: ['21', 0], vae: ['12', 0] } };
    denoise = num(values.strength, 0.3);
  } else {
    g['5'] = { class_type: 'EmptyLatentImage', inputs: { width: size?.width ?? 1024, height: size?.height ?? 1280, batch_size: 1 } };
  }
  g['3'] = {
    class_type: 'KSampler',
    inputs: {
      model: ['10', 0], positive: ['6', 0], negative: ['13', 0], latent_image: ['5', 0],
      seed: seedOf(values.seed), steps: num(values.steps, 8), cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise,
    },
  };
  return g;
}

// ── LTX-2.3 : image → vidéo avec le son ───────────────────────

export const LTX_FPS = 25;
/**
 * Prompt négatif, celui du modèle officiel de ComfyUI (et la fin de liste contre l'écran de fin de vidéo YouTube
 * que LTX imite sur une fin silencieuse). Attention : à CFG 1 (modèle distillé), ComfyUI ignore le négatif ; il
 * ne servirait qu'avec un CFG plus élevé ou une guidance de type NAG.
 */
const LTX_NEGATIVE =
  'pc game, console game, video game, cartoon, childish, ugly, blurry, distorted face, bad teeth, ' +
  'black screen, end screen, title card, text, logo, watermark, subtitles, scene cut';
/** Sigmas du modèle distillé (8 étapes, CFG 1), repris du modèle officiel de ComfyUI. */
const LTX_DISTILLED_SIGMAS = '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0';

/**
 * Vidéo longue : au-delà de ce que tient une passe, des clips enchaînés. Chaque clip après le premier est guidé
 * par les dernières images du précédent (`LTXVAddGuide` à l'image 0), retirées au recollage : le mouvement
 * continue sans à-coup (testé sur RTX 3060 le 2026-10-11 : 2 clips, 18 s, jonction invisible, 13 min 30).
 * Une passe tient 15 s en 512p (9 min 20), un clip enchaîné ~9 s ; en 720p, on reste sur des clips de ~9 s.
 */
const LTX_SINGLE_MAX_FRAMES: Record<string, number> = { '512p': 377, '720p': 233 };
const LTX_CLIP_FRAMES = 233;
/** Force du guide de l'image de fin (0,7 dans le modèle officiel « première et dernière image »). */
const LTX_END_STRENGTH = 0.9;
/** Images de recouvrement entre deux clips (8k + 1, ~0,7 s). */
const LTX_OVERLAP = 17;

/** Plus petit nombre d'images LTX (8k + 1) qui couvre `frames`. */
const ceil8k1 = (frames: number) => Math.max(1, Math.ceil((frames - 1) / 8)) * 8 + 1;

/** Nombre d'images LTX pour une durée : 8k + 1, au plus près. */
export function ltxFrames(seconds: number): number {
  return Math.max(1, Math.round((seconds * LTX_FPS) / 8)) * 8 + 1;
}

/**
 * Découpage d'une vidéo LTX : nombre de clips, images par clip, recouvrement et images au total.
 * `cover` : la vidéo doit durer au moins `seconds` (piste de voix imposée), sinon au plus près.
 */
export function ltxPlan(seconds: number, resolution: string, cover = false) {
  const wanted = cover ? ceil8k1(Math.ceil(seconds * LTX_FPS)) : ltxFrames(seconds);
  if (wanted <= (LTX_SINGLE_MAX_FRAMES[resolution] ?? LTX_CLIP_FRAMES)) {
    return { clips: 1, clipFrames: wanted, overlap: 0, frames: wanted };
  }
  const clips = Math.ceil((wanted - LTX_OVERLAP) / (LTX_CLIP_FRAMES - LTX_OVERLAP));
  const clipFrames = ceil8k1(Math.ceil((wanted + (clips - 1) * LTX_OVERLAP) / clips));
  return { clips, clipFrames, overlap: LTX_OVERLAP, frames: clipFrames + (clips - 1) * (clipFrames - LTX_OVERLAP) };
}

/** Taille LTX : le petit côté à 512 ou 704 px, les proportions de l'image de départ, multiples de 32. */
function ltxSize(image: { width: number; height: number } | null, resolution: string) {
  const short = resolution === '720p' ? 704 : 512;
  const ratio = image ? image.width / image.height : 9 / 16;
  const round32 = (n: number) => Math.max(32, Math.round(n / 32) * 32);
  return ratio >= 1 ? { width: round32(short * ratio), height: short } : { width: short, height: round32(short / ratio) };
}

/**
 * Passages du prompt (une ligne « --- » les sépare) : le passage de chaque clip, répartis dans l'ordre.
 * Sans séparateur, le même prompt pour toute la vidéo.
 */
export function ltxPassages(prompt: string, clips: number): string[] {
  const parts = prompt
    .split(/^\s*-{3,}\s*$/m)
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return Array.from({ length: clips }, () => parts[0] ?? '');
  return Array.from({ length: clips }, (_, c) => parts[Math.min(parts.length - 1, Math.floor((c * parts.length) / clips))]);
}

/**
 * LTX-2.3 distilled : anime l'image de départ et génère le son en même temps (voix, ambiance), en un ou
 * plusieurs clips enchaînés (cf. `ltxPlan`), dans un seul workflow.
 * Avec `ctx.audio` (voix du personnage, déjà allongée à la durée de `ltxPlan`), le son est imposé : chaque clip
 * reçoit sa tranche de la piste, encodée et figée (masque à 0), le modèle n'anime que l'image, lèvres calées
 * sur la voix. La piste d'origine est remise telle quelle dans la vidéo.
 * `saveAudio` : enregistre aussi la piste seule (création d'une voix de personnage).
 */
export function buildLtx(values: Record<string, unknown>, ctx: BuildContext, opts: { saveAudio?: boolean } = {}): Graph {
  const resolution = String(values.resolution ?? '512p');
  const size = ltxSize(ctx.imageSizes[0] ?? null, resolution);
  const plan = ctx.audio ? ltxPlan(ctx.audio.seconds, resolution, true) : ltxPlan(num(values.duration_seconds, 5), resolution);
  const passages = ltxPassages(String(values.prompt ?? ''), plan.clips);
  const seed = seedOf(values.seed);
  const L = plan.clipFrames;
  const K = plan.overlap;

  const g: Graph = {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: ctx.files.unet } },
    '2': { class_type: 'DualCLIPLoaderGGUF', inputs: { clip_name1: ctx.files.encoder, clip_name2: ctx.files.connectors, type: 'ltxv' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: ctx.files.vae } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: ctx.files.audioVae } },
    '5': { class_type: 'LoadImage', inputs: { image: ctx.images[0] } },
    '6': { class_type: 'ImageScale', inputs: { image: ['5', 0], upscale_method: 'lanczos', ...size, crop: 'center' } },
    '7': { class_type: 'LTXVPreprocess', inputs: { image: ['6', 0], img_compression: 18 } },
    '9': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: LTX_NEGATIVE } },
    '16': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '17': { class_type: 'ManualSigmas', inputs: { sigmas: LTX_DISTILLED_SIGMAS } },
  };
  // Image de fin : préparée comme l'image de départ, posée en guide sur la dernière image du dernier clip.
  if (ctx.images[1]) {
    g['40'] = { class_type: 'LoadImage', inputs: { image: ctx.images[1] } };
    g['41'] = { class_type: 'ImageScale', inputs: { image: ['40', 0], upscale_method: 'lanczos', ...size, crop: 'center' } };
    g['42'] = { class_type: 'LTXVPreprocess', inputs: { image: ['41', 0], img_compression: 18 } };
  }
  if (ctx.audio) {
    g['30'] = { class_type: 'LoadAudio', inputs: { audio: ctx.audio.file } };
    g['32'] = { class_type: 'SolidMask', inputs: { value: 0, ...size } };
  }

  // Un passage = un encodage du texte (les clips du même passage le partagent).
  const conditioning = new Map<string, string>();
  const conditioningOf = (text: string) => {
    let id = conditioning.get(text);
    if (!id) {
      id = `c${conditioning.size}`;
      g[`${id}_t`] = { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text } };
      g[id] = { class_type: 'LTXVConditioning', inputs: { positive: [`${id}_t`, 0], negative: ['9', 0], frame_rate: LTX_FPS } };
      conditioning.set(text, id);
    }
    return id;
  };

  let images: [string, number] | null = null; // images recollées jusqu'ici
  let previous: [string, number] | null = null; // images décodées du clip précédent
  let audio: [string, number] | null = null; // son généré recollé (sans voix imposée)
  for (let c = 0; c < plan.clips; c++) {
    const p = `k${c}_`;
    const cond = conditioningOf(passages[c]);
    let positive: [string, number] = [cond, 0];
    let negative: [string, number] = [cond, 1];
    let video: [string, number];
    g[`${p}lat`] = { class_type: 'EmptyLTXVLatentVideo', inputs: { ...size, length: L, batch_size: 1 } };
    if (c === 0) {
      g[`${p}img`] = {
        class_type: 'LTXVImgToVideoInplace',
        inputs: { vae: ['3', 0], image: ['7', 0], latent: [`${p}lat`, 0], strength: 1, bypass: false },
      };
      video = [`${p}img`, 0];
    } else {
      // Guide : les K dernières images du clip précédent, au début de celui-ci.
      g[`${p}tail`] = { class_type: 'ImageFromBatch', inputs: { image: previous, batch_index: L - K, length: K } };
      g[`${p}guide`] = {
        class_type: 'LTXVAddGuide',
        inputs: { positive, negative, vae: ['3', 0], latent: [`${p}lat`, 0], image: [`${p}tail`, 0], frame_idx: 0, strength: 1 },
      };
      positive = [`${p}guide`, 0];
      negative = [`${p}guide`, 1];
      video = [`${p}guide`, 2];
    }
    let guided = c > 0;
    if (ctx.images[1] && c === plan.clips - 1) {
      g[`${p}end`] = {
        class_type: 'LTXVAddGuide',
        inputs: { positive, negative, vae: ['3', 0], latent: video, image: ['42', 0], frame_idx: -1, strength: LTX_END_STRENGTH },
      };
      positive = [`${p}end`, 0];
      negative = [`${p}end`, 1];
      video = [`${p}end`, 2];
      guided = true;
    }
    const start = c * (L - K);
    if (ctx.audio) {
      g[`${p}cut`] = { class_type: 'TrimAudioDuration', inputs: { audio: ['30', 0], start_index: start / LTX_FPS, duration: L / LTX_FPS } };
      g[`${p}aenc`] = { class_type: 'LTXVAudioVAEEncode', inputs: { audio: [`${p}cut`, 0], audio_vae: ['4', 0] } };
      g[`${p}alat`] = { class_type: 'SetLatentNoiseMask', inputs: { samples: [`${p}aenc`, 0], mask: ['32', 0] } };
    } else {
      g[`${p}alat`] = {
        class_type: 'LTXVEmptyLatentAudio',
        inputs: { frames_number: L, frame_rate: LTX_FPS, batch_size: 1, audio_vae: ['4', 0] },
      };
    }
    g[`${p}av`] = { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: video, audio_latent: [`${p}alat`, 0] } };
    g[`${p}noise`] = { class_type: 'RandomNoise', inputs: { noise_seed: (seed + c) % 2 ** 31 } };
    g[`${p}cfg`] = { class_type: 'CFGGuider', inputs: { model: ['1', 0], positive, negative, cfg: 1 } };
    g[`${p}smp`] = {
      class_type: 'SamplerCustomAdvanced',
      inputs: { noise: [`${p}noise`, 0], guider: [`${p}cfg`, 0], sampler: ['16', 0], sigmas: ['17', 0], latent_image: [`${p}av`, 0] },
    };
    g[`${p}sep`] = { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: [`${p}smp`, 0] } };
    let samples: [string, number] = [`${p}sep`, 0];
    if (guided) {
      // Retire les images des guides (fin du clip précédent, image de fin) ajoutées au latent.
      g[`${p}crop`] = { class_type: 'LTXVCropGuides', inputs: { positive, negative, latent: [`${p}sep`, 0] } };
      samples = [`${p}crop`, 2];
    }
    g[`${p}dec`] = {
      class_type: 'VAEDecodeTiled',
      inputs: { samples, vae: ['3', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 },
    };
    previous = [`${p}dec`, 0];
    if (c === 0) {
      images = previous;
    } else {
      // Les K premières images reprennent la fin du clip précédent : on ne garde que la suite.
      g[`${p}new`] = { class_type: 'ImageFromBatch', inputs: { image: previous, batch_index: K, length: L - K } };
      g[`${p}cat`] = { class_type: 'ImageBatch', inputs: { image1: images, image2: [`${p}new`, 0] } };
      images = [`${p}cat`, 0];
    }
    if (!ctx.audio) {
      g[`${p}adec`] = { class_type: 'LTXVAudioVAEDecode', inputs: { samples: [`${p}sep`, 1], audio_vae: ['4', 0] } };
      if (c === 0) {
        audio = [`${p}adec`, 0];
      } else {
        g[`${p}atrim`] = {
          class_type: 'TrimAudioDuration',
          inputs: { audio: [`${p}adec`, 0], start_index: K / LTX_FPS, duration: (L - K) / LTX_FPS },
        };
        g[`${p}acat`] = { class_type: 'AudioConcat', inputs: { audio1: audio, audio2: [`${p}atrim`, 0], direction: 'after' } };
        audio = [`${p}acat`, 0];
      }
    }
  }

  g['23'] = { class_type: 'CreateVideo', inputs: { images, audio: ctx.audio ? ['30', 0] : audio, fps: LTX_FPS } };
  g['9000'] = {
    class_type: 'SaveVideo',
    inputs: { video: ['23', 0], filename_prefix: 'ai-fluence/ltx-2.3', format: 'mp4', 'format.codec': 'h264' },
  };
  if (opts.saveAudio) g['9001'] = { class_type: 'SaveAudio', inputs: { audio, filename_prefix: 'ai-fluence/voix' } };
  return g;
}
