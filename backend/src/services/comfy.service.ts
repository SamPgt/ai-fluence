import { spawn, spawnSync } from 'node:child_process';
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

/** Met un workflow (format API) dans la file de ComfyUI et renvoie son `prompt_id`. */
export async function queuePrompt(graph: unknown): Promise<string> {
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
  | { state: 'succeeded'; files: ComfyFile[]; durationMs: number | null }
  | { state: 'failed'; message: string }
  /** Ni dans l'historique ni dans la file : ComfyUI a redémarré entre-temps. */
  | { state: 'lost' };

interface HistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
  outputs?: Record<string, { images?: ComfyFile[] }>;
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
      const files = (entry.outputs?.[outputNode]?.images ?? []).filter(f => f.type === 'output');
      const at = (type: string) => entry.status?.messages?.find(([t]) => t === type)?.[1]?.timestamp as number | undefined;
      const start = at('execution_start');
      const end = at('execution_success');
      return files.length
        ? { state: 'succeeded', files, durationMs: start && end ? end - start : null }
        : { state: 'failed', message: 'ComfyUI n’a produit aucune image.' };
    }
  }
  const queue = (await (await comfyFetch('/queue')).json()) as { queue_running?: unknown[][]; queue_pending?: unknown[][] };
  if (queue.queue_running?.some(item => item[1] === promptId)) return { state: 'running' };
  if (queue.queue_pending?.some(item => item[1] === promptId)) return { state: 'queued' };
  // Entre la fin d'exécution et l'écriture de l'historique, le prompt peut n'être nulle part un court instant.
  return entry ? { state: 'running' } : { state: 'lost' };
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

/** Envoie une image locale dans le dossier `input` de ComfyUI et renvoie le nom à donner à `LoadImage`. */
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
