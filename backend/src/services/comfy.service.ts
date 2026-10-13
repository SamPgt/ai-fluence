import { spawn, spawnSync } from 'node:child_process';
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ComfyStatus } from '@ai-fluence/shared';
import { env } from '../env.js';

/**
 * Pilotage du ComfyUI local. Outil local uniquement : actif seulement si `COMFYUI_URL` est renseigné.
 *
 * ComfyUI vit dans son propre processus (lancé en arrière-plan par la commande `COMFYUI_LAUNCH`) :
 * il survit aux redémarrages du backend (`tsx watch`), et son état réel est toujours lu via HTTP.
 * Seuls les états transitoires (démarrage, arrêt) et la dernière erreur sont gardés en mémoire.
 */

const PROBE_TIMEOUT_MS = 1500;
/** Premier démarrage : ComfyUI installe parfois des dépendances ou scanne les nœuds custom. */
const START_TIMEOUT_MS = 3 * 60_000;
const STOP_TIMEOUT_MS = 30_000;
const LOG_LINES = 30;

/**
 * Arrêt forcé d'un ComfyUI figé (souvent la VRAM saturée) : `comfy stop` refuse d'arrêter un serveur qui ne
 * répond plus, et comfy-cli refuse ensuite d'en lancer un autre. On retrouve le processus qui écoute sur le
 * port de `COMFYUI_URL`, on vérifie que c'est bien Python, et on arrête toute son arborescence. Fonctionne
 * quel que soit le lanceur (l'app, un terminal, comfy-cli).
 */
function comfyPort(): string {
  const url = new URL(env.COMFYUI_URL!);
  return url.port || (url.protocol === 'https:' ? '443' : '80');
}

/** PID du processus qui écoute sur le port de ComfyUI, s'il s'agit de Python. */
function listeningPid(): number | null {
  if (!env.COMFYUI_URL) return null;
  const port = comfyPort();
  let pid: number | null = null;
  if (process.platform === 'win32') {
    const out = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true }).stdout ?? '';
    for (const line of out.split(/\r?\n/)) {
      const [proto, local, , state, owner] = line.trim().split(/\s+/);
      if (proto === 'TCP' && local?.endsWith(`:${port}`) && state === 'LISTENING') pid = Number(owner);
    }
  } else {
    const out = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout ?? '';
    pid = Number(out.split('\n')[0]) || null;
  }
  if (!pid) return null;
  const name =
    process.platform === 'win32'
      ? (spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }).stdout ?? '')
      : (spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).stdout ?? '');
  return /python/i.test(name) ? pid : null;
}

/** Arrête l'arborescence du processus ComfyUI qui écoute sur le port. Renvoie true si un processus a été arrêté. */
async function forceStop(): Promise<boolean> {
  const pid = listeningPid();
  if (!pid) return false;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  else process.kill(pid, 'SIGKILL');
  pushLog(Buffer.from(`Arrêt forcé de ComfyUI (PID ${pid}).`));
  for (let i = 0; i < 20 && listeningPid(); i++) await new Promise(r => setTimeout(r, 250));
  return true;
}

let transient: { state: 'starting' | 'stopping'; since: number } | null = null;
let lastError: string | null = null;
let log: string[] = [];

interface SystemStats {
  system?: { comfyui_version?: string };
  devices?: { name?: string; vram_total?: number; vram_free?: number }[];
}

async function probe(): Promise<SystemStats | null> {
  if (!env.COMFYUI_URL) return null;
  try {
    const res = await fetch(new URL('/system_stats', env.COMFYUI_URL), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok ? ((await res.json()) as SystemStats) : null;
  } catch {
    return null;
  }
}

/** `cuda:0 NVIDIA GeForce RTX 3060 : cudaMallocAsync` → `NVIDIA GeForce RTX 3060`. */
function gpuName(raw: string): string {
  return raw.replace(/^\w+:\d+\s+/, '').replace(/\s+:\s+.*$/, '');
}

function pushLog(chunk: Buffer) {
  const lines = chunk
    .toString('utf8')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split(/\r?\n/)
    .map(l => l.trimEnd())
    .filter(Boolean);
  log = [...log, ...lines].slice(-LOG_LINES);
}

/** Lance une commande du .env (jamais une valeur venue d'une requête) et résout avec son code de sortie. */
function run(command: string): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(command, {
      shell: true,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', NO_COLOR: '1' },
    });
    child.stdout.on('data', pushLog);
    child.stderr.on('data', pushLog);
    child.on('error', err => {
      pushLog(Buffer.from(err.message));
      resolve(-1);
    });
    child.on('exit', code => resolve(code ?? -1));
  });
}

export async function getComfyStatus(): Promise<ComfyStatus> {
  const base: ComfyStatus = {
    enabled: Boolean(env.COMFYUI_URL),
    canControl: Boolean(env.COMFYUI_URL && env.COMFYUI_LAUNCH && env.COMFYUI_STOP),
    state: 'stopped',
    url: env.COMFYUI_URL ?? null,
    version: null,
    gpu: null,
    error: null,
    log,
    canDescribe: false,
  };
  if (!env.COMFYUI_URL) return base;

  const stats = await probe();
  const elapsed = transient ? Date.now() - transient.since : 0;

  if (stats) {
    if (transient?.state === 'stopping' && elapsed < STOP_TIMEOUT_MS) return { ...base, state: 'stopping' };
    transient = null;
    lastError = null;
    const device = stats.devices?.[0];
    return {
      ...base,
      state: 'running',
      canDescribe: await hasNodes(['JC', 'JC_ExtraOptions']).catch(() => false),
      version: stats.system?.comfyui_version ?? null,
      gpu: device?.name
        ? { name: gpuName(device.name), vramTotal: device.vram_total ?? 0, vramFree: device.vram_free ?? 0 }
        : null,
    };
  }

  if (transient?.state === 'starting') {
    if (elapsed < START_TIMEOUT_MS && !lastError) return { ...base, state: 'starting' };
    lastError ??= 'ComfyUI ne répond pas après le démarrage.';
  }
  transient = null;
  if (lastError) return { ...base, state: 'error', error: lastError };
  // Le port est ouvert mais ComfyUI ne répond pas : figé (souvent la VRAM saturée).
  if (listeningPid()) {
    return { ...base, state: 'error', error: 'ComfyUI ne répond plus (figé). « Démarrer » l’arrête et le relance.' };
  }
  return base;
}

export async function startComfy(): Promise<ComfyStatus> {
  if (!env.COMFYUI_URL || !env.COMFYUI_LAUNCH) throw new Error('Démarrage de ComfyUI non configuré.');
  if (transient || (await probe())) return getComfyStatus();

  transient = { state: 'starting', since: Date.now() };
  lastError = null;
  log = [];
  // Une ancienne instance figée bloquerait le lancement (« already running ») : on l'arrête d'abord.
  await forceStop();
  // On n'attend pas la fin : `--background` rend la main vite, mais une commande au premier plan ne la rendrait jamais.
  void run(env.COMFYUI_LAUNCH).then(code => {
    if (code !== 0 && transient?.state === 'starting') lastError = `La commande de démarrage a échoué (code ${code}).`;
  });
  return getComfyStatus();
}

export async function isComfyRunning(): Promise<boolean> {
  return Boolean(await probe());
}

// ── File d'attente et fichiers ────────────────────────────────

/** Identifie l'app auprès de ComfyUI (affiché dans sa file d'attente). */
const CLIENT_ID = 'ai-fluence';

async function comfyFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!env.COMFYUI_URL) throw new Error('ComfyUI n’est pas configuré (COMFYUI_URL).');
  try {
    return await fetch(new URL(path, env.COMFYUI_URL), init);
  } catch {
    throw new Error('ComfyUI ne répond pas. Démarre-le depuis la barre latérale.');
  }
}

interface NodeErrors {
  [node: string]: { class_type?: string; errors?: { message?: string; details?: string }[] };
}

// ── Mémoire vive ──────────────────────────────────────────────
//
// ComfyUI garde en RAM les modèles qu'il sort de la VRAM, pour les recharger vite. Quand la RAM déborde, Windows
// en envoie une partie dans la mémoire virtuelle (disque) : une vidéo LTX passe alors de 10 à 20 min, car les poids
// qui ne tiennent pas en VRAM sont relus depuis le disque à chaque étape. Avant chaque workflow, on estime la RAM
// qu'il lui faut (taille des fichiers de modèles qu'il charge et que le workflow précédent n'avait pas) : si
// ComfyUI n'en a pas assez de libre, on lui fait tout décharger avant (`/free`, appliqué entre deux workflows).
// Une série ou un enchaînement qui tient en RAM n'est jamais ralenti. Sans `COMFYUI_DIR` (ComfyUI distant), rien.

const GB = 1024 ** 3;
/** RAM laissée au système et aux autres applications. */
const RAM_MARGIN = 3 * GB;
const MODEL_EXT = /\.(safetensors|gguf|ckpt|pt|pth|bin|onnx|sft)$/i;
const MODEL_INDEX_TTL_MS = 5 * 60_000;
let modelIndex: { at: number; sizes: Map<string, number> } | null = null;
/** Fichiers de modèles du dernier workflow envoyé : déjà en mémoire quand le suivant démarre. */
let lastModels = new Set<string>();

/** Taille de chaque fichier de `models/` (par nom de fichier), relue toutes les 5 min. */
async function modelSizes(): Promise<Map<string, number>> {
  if (modelIndex && Date.now() - modelIndex.at < MODEL_INDEX_TTL_MS) return modelIndex.sizes;
  const sizes = new Map<string, number>();
  const entries = await readdir(path.join(env.COMFYUI_DIR!, 'models'), { recursive: true, withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isFile() || !MODEL_EXT.test(e.name)) continue;
    const s = await stat(path.join(e.parentPath, e.name)).catch(() => null);
    if (s) sizes.set(e.name.toLowerCase(), s.size);
  }
  modelIndex = { at: Date.now(), sizes };
  return sizes;
}

/** Taille d'un fichier de modèle de ComfyUI (null sans `COMFYUI_DIR`, ou introuvable). */
export async function modelFileSize(name: string): Promise<number | null> {
  if (!env.COMFYUI_DIR) return null;
  return (await modelSizes()).get(name.replace(/\\/g, '/').split('/').pop()!.toLowerCase()) ?? null;
}

/** Noms des fichiers de modèles cités par un workflow (`unet_name`, `clip_name`, `lora_name`…). */
function graphModels(graph: unknown): Set<string> {
  const files = new Set<string>();
  for (const node of Object.values((graph ?? {}) as Record<string, { inputs?: Record<string, unknown> }>)) {
    for (const value of Object.values(node.inputs ?? {})) {
      if (typeof value === 'string' && MODEL_EXT.test(value)) files.add(path.basename(value.replace(/\\/g, '/')).toLowerCase());
    }
  }
  return files;
}

async function freeRamIfNeeded(graph: unknown): Promise<void> {
  if (!env.COMFYUI_DIR) return;
  const models = graphModels(graph);
  const previous = lastModels;
  lastModels = models;
  const sizes = await modelSizes();
  const needed = [...models].filter(f => !previous.has(f)).reduce((sum, f) => sum + (sizes.get(f) ?? 0), 0);
  if (!needed) return;
  const stats = (await probe()) as { system?: { ram_free?: number } } | null;
  const free = stats?.system?.ram_free;
  if (free == null || free >= needed + RAM_MARGIN) return;
  console.info(`[comfy] RAM libre ${(free / GB).toFixed(1)} Go < ${((needed + RAM_MARGIN) / GB).toFixed(1)} Go nécessaires : déchargement des modèles.`);
  await comfyFetch('/free', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  });
}

/** Met un workflow (format API) dans la file de ComfyUI et renvoie son `prompt_id`. */
export async function queuePrompt(graph: unknown): Promise<string> {
  // Ne bloque jamais une génération : au pire, elle sera lente.
  await freeRamIfNeeded(graph).catch(() => undefined);
  const res = await comfyFetch('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: CLIENT_ID }),
  });
  const body = (await res.json().catch(() => null)) as {
    prompt_id?: string;
    error?: { message?: string };
    node_errors?: NodeErrors;
  } | null;
  if (res.ok && body?.prompt_id) return body.prompt_id;

  // Erreurs de validation : on remonte le nœud fautif (modèle absent, nœud custom manquant…).
  const details = Object.values(body?.node_errors ?? {})
    .flatMap(n => (n.errors ?? []).map(e => `${n.class_type ?? 'Nœud'} : ${e.message ?? ''}${e.details ? ` (${e.details})` : ''}`))
    .join(' ; ');
  throw new Error(details || body?.error?.message || `ComfyUI a refusé le workflow (HTTP ${res.status}).`);
}

/** Listes de fichiers (modèles, LoRA…) proposées par un nœud, gardées quelques secondes. */
const OPTIONS_TTL_MS = 15_000;
const optionsCache = new Map<string, { at: number; options: string[] }>();

/** Valeurs possibles d'une entrée de nœud (ex. `UNETLoader.unet_name` = fichiers de `diffusion_models`). */
export async function getNodeOptions(nodeClass: string, input: string): Promise<string[]> {
  const key = `${nodeClass}.${input}`;
  const cached = optionsCache.get(key);
  if (cached && Date.now() - cached.at < OPTIONS_TTL_MS) return cached.options;
  const res = await comfyFetch(`/object_info/${nodeClass}`);
  const info = (await res.json()) as Record<string, { input?: { required?: Record<string, unknown[]> } }>;
  // Deux formats selon la version : `[[...valeurs]]` ou `["COMBO", { options: [...] }]`.
  const spec = info[nodeClass]?.input?.required?.[input];
  const options = Array.isArray(spec?.[0])
    ? (spec[0] as string[])
    : (((spec?.[1] as { options?: string[] } | undefined)?.options) ?? []);
  optionsCache.set(key, { at: Date.now(), options });
  return options;
}

/** Les nœuds (custom) sont-ils installés dans ComfyUI ? */
export async function hasNodes(nodeClasses: string[]): Promise<boolean> {
  const checks = await Promise.all(
    nodeClasses.map(async nodeClass => {
      const info = (await (await comfyFetch(`/object_info/${nodeClass}`)).json().catch(() => ({}))) as Record<string, unknown>;
      return nodeClass in info;
    }),
  );
  return checks.every(Boolean);
}

export interface ComfyFile {
  filename: string;
  subfolder: string;
  type: string;
}

export type PromptState =
  | { state: 'queued' | 'running' }
  /** `durationMs` : temps d'exécution dans ComfyUI, sans l'attente dans la file. */
  | {
      state: 'succeeded';
      files: ComfyFile[];
      durationMs: number | null;
      /** Fichiers de chaque nœud de sortie (un workflow peut enregistrer une vidéo et une piste audio). */
      outputs: Record<string, ComfyFile[]>;
    }
  | { state: 'failed'; message: string }
  /** Ni dans l'historique ni dans la file : ComfyUI a redémarré entre-temps. */
  | { state: 'lost' };

interface HistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
  /** Images et vidéos sous `images`, pistes audio (`SaveAudio`) sous `audio`. */
  outputs?: Record<string, { images?: ComfyFile[]; audio?: ComfyFile[] }>;
}

export async function getPromptState(promptId: string, outputNode: string): Promise<PromptState> {
  const history = (await (await comfyFetch(`/history/${promptId}`)).json()) as Record<string, HistoryEntry>;
  const entry = history[promptId];
  if (entry) {
    if (entry.status?.status_str === 'error') {
      const err = entry.status.messages?.find(([type]) => type === 'execution_error')?.[1];
      const message = err ? `${err.node_type ?? 'ComfyUI'} : ${err.exception_message ?? 'erreur'}` : 'La génération a échoué dans ComfyUI.';
      return { state: 'failed', message: String(message).trim() };
    }
    if (entry.status?.completed) {
      const outputs = Object.fromEntries(
        Object.entries(entry.outputs ?? {}).map(([node, o]) => [node, [...(o.images ?? []), ...(o.audio ?? [])].filter(f => f.type === 'output')]),
      );
      const files = outputs[outputNode] ?? [];
      const at = (type: string) => entry.status?.messages?.find(([t]) => t === type)?.[1]?.timestamp as number | undefined;
      const start = at('execution_start');
      const end = at('execution_success');
      return files.length
        ? { state: 'succeeded', files, durationMs: start && end ? end - start : null, outputs }
        : { state: 'failed', message: 'ComfyUI n’a produit aucune image.' };
    }
  }
  const queue = (await (await comfyFetch('/queue')).json()) as { queue_running?: unknown[][]; queue_pending?: unknown[][] };
  if (queue.queue_running?.some(item => item[1] === promptId)) return { state: 'running' };
  if (queue.queue_pending?.some(item => item[1] === promptId)) return { state: 'queued' };
  // Entre la fin d'exécution et l'écriture de l'historique, le prompt peut n'être nulle part un court instant.
  return entry ? { state: 'running' } : { state: 'lost' };
}

/**
 * Libère la VRAM de ComfyUI (modèles gardés en mémoire) pour un autre outil local (le serveur de voix),
 * seulement si sa file est vide : une génération en cours n'est jamais gênée.
 */
export async function freeComfyMemory(): Promise<void> {
  if (!env.COMFYUI_URL || !(await probe())) return;
  const queue = (await (await comfyFetch('/queue')).json()) as { queue_running?: unknown[]; queue_pending?: unknown[] };
  if (queue.queue_running?.length || queue.queue_pending?.length) return;
  await comfyFetch('/free', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  });
}

/**
 * Attend la fin d'un workflow qui produit du texte (`PreviewAny`) et renvoie ce texte.
 * Pour des tâches courtes (description d'image) : l'appelant attend la réponse.
 */
export async function waitForText(promptId: string, node: string, timeoutMs = 5 * 60_000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise(r => setTimeout(r, 1000));
    const history = (await (await comfyFetch(`/history/${promptId}`)).json()) as Record<
      string,
      { status?: HistoryEntry['status']; outputs?: Record<string, { text?: string[] }> }
    >;
    const entry = history[promptId];
    if (!entry) continue;
    if (entry.status?.status_str === 'error') {
      const err = entry.status.messages?.find(([type]) => type === 'execution_error')?.[1];
      throw new Error(err ? `${err.node_type ?? 'ComfyUI'} : ${err.exception_message ?? 'erreur'}`.trim() : 'Échec dans ComfyUI.');
    }
    if (entry.status?.completed) {
      const text = entry.outputs?.[node]?.text?.join(' ').trim();
      if (!text) throw new Error('ComfyUI n’a renvoyé aucun texte.');
      return text;
    }
  }
  throw new Error('ComfyUI met trop de temps à répondre.');
}

/** Retire un prompt de la file de ComfyUI, ou l'interrompt s'il est en cours d'exécution. */
export async function cancelPrompt(promptId: string): Promise<void> {
  const queue = (await (await comfyFetch('/queue')).json()) as { queue_running?: unknown[][] };
  if (queue.queue_running?.some(item => item[1] === promptId)) {
    await comfyFetch('/interrupt', { method: 'POST' });
  } else {
    await comfyFetch('/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
    });
  }
}

/**
 * Envoie un fichier local (image, ou piste audio pour `LoadAudio`) dans le dossier `input` de ComfyUI
 * et renvoie le nom à donner au nœud de chargement.
 */
export async function uploadImage(data: Uint8Array, filename: string, mime: string): Promise<string> {
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(data)], { type: mime }), filename);
  form.append('overwrite', 'true');
  const res = await comfyFetch('/upload/image', { method: 'POST', body: form });
  const body = (await res.json().catch(() => null)) as { name?: string; subfolder?: string } | null;
  if (!res.ok || !body?.name) throw new Error(`Envoi de l’image à ComfyUI impossible (HTTP ${res.status}).`);
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

export async function downloadFile(file: ComfyFile): Promise<{ data: Uint8Array; mime: string }> {
  const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
  const res = await comfyFetch(`/view?${query}`);
  if (!res.ok) throw new Error(`Téléchargement du résultat ComfyUI impossible (HTTP ${res.status}).`);
  return { data: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get('content-type') ?? 'image/png' };
}

/**
 * Supprime la copie d'un résultat dans le dossier `output` de ComfyUI, une fois rapatrié dans les médias de l'app.
 * Seulement les fichiers de l'app (`output/ai-fluence/…`) ; sans `COMFYUI_DIR`, rien n'est supprimé.
 */
export async function deleteOutputFile(file: ComfyFile): Promise<void> {
  if (!env.COMFYUI_DIR || file.type !== 'output' || !file.subfolder.startsWith('ai-fluence')) return;
  const base = path.resolve(env.COMFYUI_DIR, 'output');
  const target = path.resolve(base, file.subfolder, file.filename);
  if (!target.startsWith(base + path.sep)) return;
  await unlink(target).catch(() => undefined);
}

export async function stopComfy(): Promise<ComfyStatus> {
  if (!env.COMFYUI_URL || !env.COMFYUI_STOP) throw new Error('Arrêt de ComfyUI non configuré.');
  transient = { state: 'stopping', since: Date.now() };
  lastError = null;
  log = [];
  const code = await run(env.COMFYUI_STOP);
  // `comfy stop` refuse d'arrêter un ComfyUI figé : on force l'arrêt du processus lancé par l'app.
  const forced = await forceStop();
  if (code !== 0 && !forced && (await probe())) {
    transient = null;
    lastError = `La commande d'arrêt a échoué (code ${code}).`;
  }
  return getComfyStatus();
}
