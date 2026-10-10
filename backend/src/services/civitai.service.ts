/**
 * Bibliothèque LoRA communautaire (Civitai).
 * La clé CIVITAI_KEY reste côté backend : elle sert à chercher et à obtenir
 * un lien signé temporaire au lancement d'une génération. SpicyAPI ne reçoit
 * que ce lien signé, jamais la clé.
 */
import { HTTPException } from 'hono/http-exception';
import {
  CIVITAI_BASE_MODELS,
  type CivitaiFile,
  type CivitaiLora,
  type CivitaiPreview,
  type CivitaiSearchResponse,
  type CivitaiSort,
  type CivitaiVariant,
} from '@ai-fluence/shared';
import { env } from '../env.js';

const API = 'https://civitai.com/api/v1';
const TIMEOUT_MS = 15_000;

/** Modèle de base Civitai → famille AI Fluence. */
const FAMILY_OF_BASE = new Map(
  Object.entries(CIVITAI_BASE_MODELS).flatMap(([family, bases]) => bases.map(b => [b, family] as const)),
);

function headers(): Record<string, string> {
  return env.CIVITAI_KEY ? { Authorization: `Bearer ${env.CIVITAI_KEY}` } : {};
}

// ── Types de la réponse Civitai (sous-ensemble utilisé) ───────

interface RawFile {
  name: string;
  type: string;
  sizeKB: number;
  downloadUrl: string;
  primary?: boolean;
}
interface RawImage {
  url: string;
  type: string;
  nsfwLevel: number;
}
interface RawVersion {
  id: number;
  name: string;
  baseModel: string;
  availability?: string;
  trainedWords?: string[];
  files: RawFile[];
  images: RawImage[];
}
interface RawModel {
  id: number;
  name: string;
  nsfw: boolean;
  creator?: { username?: string };
  stats?: { downloadCount?: number; thumbsUpCount?: number };
  modelVersions: RawVersion[];
}

// ── Recherche ─────────────────────────────────────────────────

export interface SearchArgs {
  family?: string;
  query?: string;
  sort: CivitaiSort;
  nsfw: boolean;
  cursor?: string;
}

const SEARCH_TTL_MS = 5 * 60 * 1000;
const searchCache = new Map<string, { at: number; data: CivitaiSearchResponse }>();

export async function searchLoras(args: SearchArgs): Promise<CivitaiSearchResponse> {
  const bases = args.family ? (CIVITAI_BASE_MODELS[args.family] ?? []) : [...FAMILY_OF_BASE.keys()];
  if (!bases.length) return { items: [], nextCursor: null };

  const qs = new URLSearchParams({ types: 'LORA', limit: '30', sort: args.sort, nsfw: String(args.nsfw) });
  for (const b of bases) qs.append('baseModels', b);
  if (args.query?.trim()) qs.set('query', args.query.trim());
  if (args.cursor) qs.set('cursor', args.cursor);
  const url = `${API}/models?${qs}`;

  const cached = searchCache.get(url);
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.data;

  let res: Response;
  try {
    res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HTTPException(502, { message: 'Civitai est injoignable pour le moment.' });
  }
  if (!res.ok) throw new HTTPException(502, { message: `Civitai a répondu ${res.status}.` });
  const body = (await res.json()) as { items?: RawModel[]; metadata?: { nextCursor?: string } };

  const allowed = new Set(bases);
  const items = (body.items ?? [])
    .map(m => toLora(m, allowed, args.nsfw))
    .filter((l): l is CivitaiLora => l !== null);
  const data = { items, nextCursor: body.metadata?.nextCursor ?? null };
  searchCache.set(url, { at: Date.now(), data });
  return data;
}

const isHigh = (s: string) => /high|hight/i.test(s);
const isLow = (s: string) => /low/i.test(s);

function modelFile(v: RawVersion): RawFile | undefined {
  const files = v.files.filter(f => f.type === 'Model' && f.name.toLowerCase().endsWith('.safetensors'));
  return files.find(f => f.primary) ?? files[0];
}

function toFile(f: RawFile, noise?: 'high' | 'low'): CivitaiFile {
  return { url: f.downloadUrl, fileName: f.name, sizeKB: Math.round(f.sizeKB), ...(noise ? { noise } : {}) };
}

/** Variante légère servie par le CDN Civitai (`anim=false` donne l'image fixe d'une vidéo). */
function cdn(url: string, transform: string): string {
  return url.replace(/\/(original=true|width=\d+)\//, `/${transform}/`);
}

function toPreview(i: RawImage): CivitaiPreview {
  const video = i.type === 'video';
  return {
    url: cdn(i.url, video ? 'anim=false,transcode=true,width=450' : 'width=450'),
    ...(video ? { videoUrl: cdn(i.url, 'transcode=true,width=450') } : {}),
    nsfw: i.nsfwLevel > 1,
  };
}

// Les "mots déclencheurs" Civitai sont parfois des prompts entiers : on garde les courts.
function shortTriggers(v: RawVersion): string[] {
  return [
    ...new Set(
      (v.trainedWords ?? [])
        .flatMap(w => w.split(','))
        .map(w => w.trim())
        .filter(w => w && w.length <= 60),
    ),
  ].slice(0, 5);
}

/** Fichier(s) d'une famille : la version la plus récente, ou la paire HIGH + LOW pour Wan 2.2. */
function toVariant(family: string, versions: RawVersion[]): CivitaiVariant {
  let main = versions[0];
  let files: CivitaiFile[] = [toFile(modelFile(main)!)];

  // Wan 2.2 A14B : les passes HIGH et LOW sont souvent publiées comme deux versions.
  if (family === 'alibaba/wan-2.2-lora') {
    const label = (v: RawVersion) => `${v.name} ${modelFile(v)!.name}`;
    const high = versions.find(v => isHigh(label(v)));
    const low = versions.find(v => isLow(label(v)) && v.baseModel === (high ?? v).baseModel);
    if (high && low) {
      main = high;
      files = [toFile(modelFile(high)!, 'high'), toFile(modelFile(low)!, 'low')];
    } else if (high || low) {
      main = (high ?? low)!;
      files = [toFile(modelFile(main)!, high ? 'high' : 'low')];
    }
  }

  return {
    family,
    baseModel: main.baseModel,
    versionId: main.id,
    versionName: main.name,
    triggerWords: shortTriggers(main),
    files,
  };
}

function toLora(m: RawModel, allowed: Set<string>, nsfw: boolean): CivitaiLora | null {
  const versions = m.modelVersions.filter(
    v => allowed.has(v.baseModel) && (v.availability ?? 'Public') === 'Public' && modelFile(v),
  );
  if (!versions.length) return null;

  // Une même LoRA Civitai publie souvent un fichier par modèle : une variante par famille.
  const byFamily = new Map<string, RawVersion[]>();
  for (const v of versions) {
    const family = FAMILY_OF_BASE.get(v.baseModel)!;
    byFamily.set(family, [...(byFamily.get(family) ?? []), v]);
  }
  const variants = [...byFamily].map(([family, vs]) => toVariant(family, vs));
  const first = variants[0];
  const main = versions.find(v => v.id === first.versionId)!;

  const previews: CivitaiPreview[] = main.images
    .map(toPreview)
    .filter(p => nsfw || !p.nsfw)
    .slice(0, 4);
  if (!previews.length && !nsfw) return null;

  return {
    modelId: m.id,
    versionId: first.versionId,
    name: m.name.trim().slice(0, 60),
    versionName: first.versionName,
    creator: m.creator?.username ?? '',
    pageUrl: `https://civitai.com/models/${m.id}?modelVersionId=${first.versionId}`,
    family: first.family,
    baseModel: first.baseModel,
    triggerWords: first.triggerWords,
    previews,
    files: first.files,
    downloads: m.stats?.downloadCount ?? 0,
    likes: m.stats?.thumbsUpCount ?? 0,
    nsfw: m.nsfw,
    variants,
  };
}

// ── Lien de téléchargement pour SpicyAPI ──────────────────────

const RESOLVE_TTL_MS = 10 * 60 * 1000;
const resolved = new Map<string, { at: number; url: string }>();

const isCivitaiDownload = (u: URL) => u.hostname === 'civitai.com' && u.pathname.startsWith('/api/download/');

/**
 * Les téléchargements Civitai demandent souvent une clé. On demande la
 * redirection avec la clé, et on renvoie le lien signé temporaire vers lequel
 * Civitai redirige. Les autres liens (Hugging Face…) sont renvoyés tels quels.
 */
export async function resolveLoraUrl(path: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(path);
  } catch {
    return path;
  }
  if (!isCivitaiDownload(u)) return path;

  const cached = resolved.get(path);
  if (cached && Date.now() - cached.at < RESOLVE_TTL_MS) return cached.url;

  let res: Response;
  try {
    res = await fetch(path, {
      method: 'HEAD',
      redirect: 'manual',
      headers: headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new HTTPException(502, { message: 'Civitai est injoignable : impossible de récupérer la LoRA.' });
  }
  const location = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && location) {
    resolved.set(path, { at: Date.now(), url: location });
    return location;
  }
  if (res.status === 401 || res.status === 403) {
    throw new HTTPException(400, {
      message: env.CIVITAI_KEY
        ? 'Civitai refuse le téléchargement de cette LoRA (accès anticipé ou payant).'
        : 'Cette LoRA Civitai demande une clé : ajoute CIVITAI_KEY dans backend/.env.',
    });
  }
  if (res.ok) return path;
  throw new HTTPException(400, { message: `LoRA Civitai introuvable (${res.status}).` });
}

export const civitaiEnabled = () => Boolean(env.CIVITAI_KEY);
