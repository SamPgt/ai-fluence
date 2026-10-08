import { spawn } from 'node:child_process';
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
  return lastError ? { ...base, state: 'error', error: lastError } : base;
}

export async function startComfy(): Promise<ComfyStatus> {
  if (!env.COMFYUI_URL || !env.COMFYUI_LAUNCH) throw new Error('Démarrage de ComfyUI non configuré.');
  if (transient || (await probe())) return getComfyStatus();

  transient = { state: 'starting', since: Date.now() };
  lastError = null;
  log = [];
  // On n'attend pas la fin : `--background` rend la main vite, mais une commande au premier plan ne la rendrait jamais.
  void run(env.COMFYUI_LAUNCH).then(code => {
    if (code !== 0 && transient?.state === 'starting') lastError = `La commande de démarrage a échoué (code ${code}).`;
  });
  return getComfyStatus();
}

export async function stopComfy(): Promise<ComfyStatus> {
  if (!env.COMFYUI_URL || !env.COMFYUI_STOP) throw new Error('Arrêt de ComfyUI non configuré.');
  transient = { state: 'stopping', since: Date.now() };
  lastError = null;
  log = [];
  const code = await run(env.COMFYUI_STOP);
  // Échec sans ComfyUI qui répond (ex. déjà arrêté) : le but est atteint.
  if (code !== 0 && (await probe())) {
    transient = null;
    lastError = `La commande d'arrêt a échoué (code ${code}).`;
  }
  return getComfyStatus();
}
