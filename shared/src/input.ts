/**
 * Choix de la tâche et construction de l'`input` SpicyAPI à partir du schéma
 * live du modèle. Partagé : le front s'en sert pour savoir quels paramètres
 * afficher, le backend pour construire la requête réellement envoyée.
 */
import type { MediaKind, TaskKind } from './models';

/** Sous-ensemble de JSON Schema utilisé par les schémas d'input SpicyAPI. */
export interface JsonSchemaProp {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  title?: string;
  description?: string;
  items?: JsonSchemaProp & { properties?: Record<string, JsonSchemaProp> };
  maxItems?: number;
  minItems?: number;
}

export interface InputSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

/** Champs pris en charge par le composer (prompt, références, LoRA), donc absents du formulaire de paramètres. */
export const COMPOSER_FIELDS = new Set([
  'prompt',
  'image_url',
  'image_urls',
  'last_image_url',
  'reference_image_urls',
  'reference_video_urls',
  'reference_audio_urls',
  'reference_file_url',
  'reference_link_url',
  'loras',
  'high_noise_loras',
  'low_noise_loras',
  'mask_url',
  'audio_url',
  'video_url',
  'multi_prompt',
  'analysis_task_id',
  'swap_targets',
]);

/** Mode d'utilisation des pièces jointes pour la vidéo. */
export type VideoRefMode = 'start-frame' | 'reference';

export interface AttachmentCounts {
  images: number;
  videos: number;
}

export type TaskResolution =
  | { ok: true; task: TaskKind }
  | { ok: false; reason: string };

export function resolveTask(
  media: MediaKind,
  available: ReadonlySet<TaskKind> | readonly TaskKind[],
  attachments: AttachmentCounts,
  refMode: VideoRefMode = 'start-frame',
): TaskResolution {
  const has = (t: TaskKind) =>
    available instanceof Set ? available.has(t) : (available as readonly TaskKind[]).includes(t);
  const total = attachments.images + attachments.videos;

  if (media === 'image') {
    if (attachments.videos > 0) return { ok: false, reason: 'Un modèle photo ne prend pas de vidéo en entrée.' };
    if (attachments.images > 0) {
      return has('image-to-image')
        ? { ok: true, task: 'image-to-image' }
        : { ok: false, reason: "Ce modèle n'accepte pas d'image en entrée." };
    }
    return has('text-to-image')
      ? { ok: true, task: 'text-to-image' }
      : { ok: false, reason: 'Ce modèle a besoin d’une image en entrée.' };
  }

  if (total === 0) {
    return has('text-to-video')
      ? { ok: true, task: 'text-to-video' }
      : { ok: false, reason: 'Ce modèle a besoin d’une image de départ.' };
  }
  if (attachments.videos > 0 || refMode === 'reference') {
    if (has('reference-to-video')) return { ok: true, task: 'reference-to-video' };
    if (attachments.videos > 0) return { ok: false, reason: "Ce modèle n'accepte pas de vidéo en référence." };
  }
  if (has('image-to-video')) return { ok: true, task: 'image-to-video' };
  if (has('reference-to-video')) return { ok: true, task: 'reference-to-video' };
  return { ok: false, reason: "Ce modèle n'accepte pas d'image en entrée." };
}

export interface LoraEntry {
  path: string;
  scale: number;
  /** Wan 2.2 : la LoRA vise la passe HIGH, LOW, ou les deux (champ `loras`). */
  noise?: 'high' | 'low' | 'both';
}

export interface BuildInputArgs {
  schema: InputSchema;
  task: TaskKind;
  prompt: string;
  params: Record<string, unknown>;
  /** URIs déjà utilisables par SpicyAPI (`spicy://…` ou https). */
  images: string[];
  videos: string[];
  loras: LoraEntry[];
}

export interface BuiltInput {
  input: Record<string, unknown>;
  /** Pièces jointes ignorées faute de place dans le schéma (pour prévenir l'utilisateur). */
  dropped: number;
  lorasApplied: number;
}

function cap<T>(list: T[], prop: JsonSchemaProp | undefined): T[] {
  const max = prop?.maxItems;
  return typeof max === 'number' ? list.slice(0, max) : list;
}

/** Ne garde que les paramètres connus du schéma, avec le bon type. */
export function sanitizeParams(
  schema: InputSchema,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const props = schema.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(params)) {
    const prop = props[key];
    if (!prop || COMPOSER_FIELDS.has(key)) continue;
    if (raw === undefined || raw === null || raw === '') continue;
    let value: unknown = raw;
    if (prop.type === 'integer' || prop.type === 'number') {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) continue;
      value = prop.type === 'integer' ? Math.round(n) : n;
    } else if (prop.type === 'boolean') {
      value = raw === true || raw === 'true';
    }
    if (prop.enum && !prop.enum.includes(value)) continue;
    out[key] = value;
  }
  return out;
}

export function buildInput(args: BuildInputArgs): BuiltInput {
  const props = args.schema.properties ?? {};
  const input: Record<string, unknown> = sanitizeParams(args.schema, args.params);
  let dropped = 0;
  let lorasApplied = 0;

  if (props.prompt && args.prompt.trim()) input.prompt = args.prompt.trim();

  const images = [...args.images];
  const videos = [...args.videos];

  if (args.task === 'image-to-image') {
    if (props.image_urls) {
      const kept = cap(images, props.image_urls);
      dropped += images.length - kept.length;
      input.image_urls = kept;
    } else if (props.image_url) {
      input.image_url = images[0];
      dropped += Math.max(0, images.length - 1);
    }
  } else if (args.task === 'image-to-video') {
    input.image_url = images[0];
    if (images[1] && props.last_image_url) input.last_image_url = images[1];
    dropped += Math.max(0, images.length - (props.last_image_url ? 2 : 1)) + videos.length;
  } else if (args.task === 'reference-to-video') {
    if (images.length) {
      if (props.reference_image_urls) {
        const kept = cap(images, props.reference_image_urls);
        dropped += images.length - kept.length;
        input.reference_image_urls = kept;
      } else dropped += images.length;
    }
    if (videos.length) {
      if (props.reference_video_urls) {
        const kept = cap(videos, props.reference_video_urls);
        dropped += videos.length - kept.length;
        input.reference_video_urls = kept;
      } else dropped += videos.length;
    }
  } else {
    dropped += images.length + videos.length;
  }

  if (args.loras.length) {
    const buckets: Record<'loras' | 'high_noise_loras' | 'low_noise_loras', { path: string; scale: number }[]> = {
      loras: [],
      high_noise_loras: [],
      low_noise_loras: [],
    };
    for (const l of args.loras) {
      const entry = { path: l.path, scale: l.scale };
      if (l.noise === 'high' && props.high_noise_loras) buckets.high_noise_loras.push(entry);
      else if (l.noise === 'low' && props.low_noise_loras) buckets.low_noise_loras.push(entry);
      else if (props.loras) buckets.loras.push(entry);
    }
    for (const key of Object.keys(buckets) as (keyof typeof buckets)[]) {
      const list = cap(buckets[key], props[key]);
      if (list.length) {
        input[key] = list;
        lorasApplied += list.length;
      }
    }
  }

  return { input, dropped, lorasApplied };
}

/** Le schéma accepte-t-il des LoRA ? */
export function schemaSupportsLoras(schema: InputSchema | undefined): boolean {
  const p = schema?.properties ?? {};
  return Boolean(p.loras || p.high_noise_loras || p.low_noise_loras);
}
