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
import { isComfyRunning } from './comfy.service.js';

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
  slots: Partial<Record<'prompt' | 'negative_prompt' | 'seed' | 'steps' | 'strength' | 'width' | 'height' | 'image', Slot>>;
}

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
} satisfies LocalEndpoint['slots'];

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
 * `image` : nom du fichier déjà envoyé dans le dossier `input` de ComfyUI.
 */
export function buildGraph(endpoint: LocalEndpoint, input: Record<string, unknown>, image?: string): Graph {
  const graph = JSON.parse(readFileSync(WORKFLOWS_DIR + endpoint.file, 'utf8')) as Graph;
  const values: Record<string, unknown> = { ...input, image };
  const props = endpoint.schema.properties ?? {};
  for (const [key, prop] of Object.entries(props)) {
    if (values[key] === undefined && prop.default !== undefined) values[key] = prop.default;
  }
  if (endpoint.slots.width && endpoint.slots.height) Object.assign(values, sizeFor(String(values.aspect_ratio ?? '9:16')));

  for (const [key, slot] of Object.entries(endpoint.slots)) {
    const value = values[key];
    if (value === undefined) continue;
    const node = graph[slot[0]];
    if (!node) throw new Error(`Workflow ${endpoint.file} : nœud ${slot[0]} introuvable.`);
    node.inputs[slot[1]] = value;
  }
  return graph;
}

/** Familles locales du catalogue : présentes seulement si ComfyUI est configuré. */
export async function getLocalFamilies(): Promise<CatalogFamily[]> {
  if (!env.COMFYUI_URL) return [];
  const running = await isComfyRunning();
  return LOCAL_FAMILIES.map(def => {
    const tasks: CatalogFamily['tasks'] = {};
    for (const endpoint of Object.values(LOCAL_ENDPOINTS[def.id] ?? {})) {
      tasks[endpoint.task] = { modelId: endpoint.modelId, schema: endpoint.schema, startingPrice: null, policyTier: null };
    }
    const ready = running && Object.keys(tasks).length > 0;
    return {
      ...def,
      provider: 'comfy',
      tasks,
      available: ready,
      unavailableReason: ready ? null : 'Démarre ComfyUI pour l’utiliser',
    };
  });
}

/** Endpoint local d'un model ID (`local/z-image-turbo/text-to-image`). */
export function localEndpoint(modelId: string): LocalEndpoint | undefined {
  for (const tasks of Object.values(LOCAL_ENDPOINTS)) {
    for (const endpoint of Object.values(tasks)) if (endpoint.modelId === modelId) return endpoint;
  }
  return undefined;
}
