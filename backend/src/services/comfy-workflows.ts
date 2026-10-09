/**
 * Workflows ComfyUI exposés comme modèles locaux.
 *
 * Un endpoint = un workflow exporté au format API (`backend/comfy-workflows/…json`, menu
 * « Export (API) » de ComfyUI) + un schéma de paramètres au format des schémas SpicyAPI
 * (le composer construit le formulaire avec, sans code en plus) + les nœuds à remplir.
 *
 * AJOUTER UN WORKFLOW = déposer son JSON, déclarer ici ses paramètres et ses nœuds,
 * et ajouter la famille dans `LOCAL_FAMILIES` (shared/src/models.ts).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LOCAL_FAMILIES, type CatalogFamily, type InputSchema, type TaskKind } from '@ai-fluence/shared';
import { env } from '../env.js';
import { getNodeOptions, hasNodes, isComfyRunning } from './comfy.service.js';

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

/** Entrée d'un nœud du workflow : [id du nœud, nom de l'entrée]. */
type Slot = [node: string, input: string];

export interface LocalEndpoint {
  modelId: string;
  task: TaskKind;
  schema: InputSchema;
  /** Fichier du workflow, relatif à `backend/comfy-workflows/`. */
  file: string;
  /** Nœud `SaveImage` dont on récupère les images. */
  outputNode: string;
  /** Où écrire chaque valeur de l'`input`. `width`/`height` viennent de `aspect_ratio`. */
  slots: Partial<Record<'prompt' | 'negative_prompt' | 'seed' | 'steps' | 'strength' | 'width' | 'height' | 'image' | 'model', Slot>>;
  /**
   * Paramètre `model` : fichier au choix parmi ceux installés dans ComfyUI (liste lue en direct).
   * `match` filtre les fichiers compatibles avec le workflow.
   */
  model?: { loader: string; input: string; match: RegExp; preferred: string };
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
  seed: { type: 'integer', minimum: 0, maximum: MAX_SEED },
};

const Z_IMAGE_SLOTS = {
  prompt: ['67', 'text'],
  negative_prompt: ['71', 'text'],
  seed: ['70', 'seed'],
  steps: ['70', 'steps'],
  model: ['66', 'unet_name'],
} satisfies LocalEndpoint['slots'];

/** Z-Image : tous les fichiers de `diffusion_models` dont le nom évoque Z-Image (Turbo, finetunes…). */
const Z_IMAGE_MODEL: LocalEndpoint['model'] = {
  loader: 'UNETLoader',
  input: 'unet_name',
  match: /z[-_ ]?image/i,
  preferred: 'zImageTurbo_turbo.safetensors',
};

/** La LoRA s'applique au modèle chargé (66), avant le réglage d'échantillonnage (69). */
const Z_IMAGE_LORA: LocalEndpoint['lora'] = { from: ['66', 0], to: ['69', 'model'] };

/** Le visage s'applique à l'image décodée (65), avant l'enregistrement (9). */
const Z_IMAGE_FACE: LocalEndpoint['faceSwap'] = { from: ['65', 0], to: ['9', 'images'] };

export const LOCAL_ENDPOINTS: Record<string, Partial<Record<TaskKind, LocalEndpoint>>> = {
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
      model: Z_IMAGE_MODEL,
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
      model: Z_IMAGE_MODEL,
      lora: Z_IMAGE_LORA,
      faceSwap: Z_IMAGE_FACE,
    },
  },
};

/** Dimensions multiples de 16 pour un ratio `L:H`, autour de `TARGET_PIXELS`. */
export function sizeFor(aspectRatio: string): { width: number; height: number } {
  const [w, h] = aspectRatio.split(':').map(Number);
  const ratio = w && h ? w / h : 9 / 16;
  const round16 = (n: number) => Math.max(256, Math.round(n / 16) * 16);
  return { width: round16(Math.sqrt(TARGET_PIXELS * ratio)), height: round16(Math.sqrt(TARGET_PIXELS / ratio)) };
}

/**
 * Remplit le workflow avec l'`input` construit par `buildInput` (prompt, paramètres, seed).
 * `files` : noms des fichiers déjà envoyés dans le dossier `input` de ComfyUI
 * (`image` : image de départ, `face` : visage à appliquer).
 */
export function buildGraph(
  endpoint: LocalEndpoint,
  input: Record<string, unknown>,
  files: { image?: string; face?: string } = {},
): Graph {
  const graph = JSON.parse(readFileSync(WORKFLOWS_DIR + endpoint.file, 'utf8')) as Graph;
  const values: Record<string, unknown> = { ...input, image: files.image };
  const props = endpoint.schema.properties ?? {};
  for (const [key, prop] of Object.entries(props)) {
    if (values[key] === undefined && prop.default !== undefined) values[key] = prop.default;
  }
  // Taille imposée (miniatures), sinon déduite des proportions.
  const fixedSize = typeof input.width === 'number' && typeof input.height === 'number';
  if (endpoint.slots.width && endpoint.slots.height && !fixedSize) Object.assign(values, sizeFor(String(values.aspect_ratio ?? '9:16')));

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
async function liveSchema(endpoint: LocalEndpoint, faces: boolean): Promise<InputSchema> {
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
  if (endpoint.model) {
    const { loader, input, match, preferred } = endpoint.model;
    const files = (await getNodeOptions(loader, input)).filter(f => match.test(f));
    if (files.length) {
      properties.model = { type: 'string', enum: files, default: files.includes(preferred) ? preferred : files[0] };
    }
  }
  if (endpoint.lora) {
    const loras = await getNodeOptions('LoraLoaderModelOnly', 'lora_name');
    if (loras.length) {
      properties.lora = { type: 'string', enum: [NO_LORA, ...loras], default: NO_LORA };
      properties.lora_strength = { type: 'number', default: 1, minimum: 0, maximum: 2 };
    }
  }
  return { ...endpoint.schema, properties };
}

/** Familles locales du catalogue : présentes seulement si ComfyUI est configuré. */
export async function getLocalFamilies(): Promise<CatalogFamily[]> {
  if (!env.COMFYUI_URL) return [];
  const running = await isComfyRunning();
  const faces = running && (await canSwapFaces());
  return Promise.all(
    LOCAL_FAMILIES.map(async (def): Promise<CatalogFamily> => {
      const tasks: CatalogFamily['tasks'] = {};
      const endpoints = Object.values(LOCAL_ENDPOINTS[def.id] ?? {});
      for (const endpoint of endpoints) {
        // ComfyUI arrêté : schéma de base, la famille est de toute façon indisponible.
        const schema = running ? await liveSchema(endpoint, faces).catch(() => endpoint.schema) : endpoint.schema;
        tasks[endpoint.task] = { modelId: endpoint.modelId, schema, startingPrice: null, policyTier: null };
      }
      const ready = running && Object.keys(tasks).length > 0;
      return {
        ...def,
        provider: 'comfy',
        supportsFace: faces && endpoints.some(e => e.faceSwap),
        tasks,
        available: ready,
        unavailableReason: ready ? null : 'Démarre ComfyUI pour l’utiliser',
      };
    }),
  );
}

/** Endpoint local d'un model ID (`local/z-image-turbo/text-to-image`). */
export function localEndpoint(modelId: string): LocalEndpoint | undefined {
  for (const tasks of Object.values(LOCAL_ENDPOINTS)) {
    for (const endpoint of Object.values(tasks)) if (endpoint.modelId === modelId) return endpoint;
  }
  return undefined;
}
