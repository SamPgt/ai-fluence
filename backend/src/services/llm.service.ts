/**
 * Modèle de langage local (Ollama), pour l'aide à l'écriture des prompts. Outil local, comme ComfyUI : actif
 * seulement si `OLLAMA_URL` est défini et qu'Ollama répond. Le modèle est celui de `OLLAMA_MODEL`, sinon le premier
 * installé.
 *
 * Mémoire : un LLM de taille moyenne (Gemma 4 26B-A4B en IQ3, 11 Go) prend presque toute la VRAM d'une carte de
 * 12 Go. Avant de l'appeler, on sort de la carte les modèles de ComfyUI s'il ne génère rien ; avant chaque workflow
 * ComfyUI, on demande à Ollama de libérer les siens (`unloadLlm`). Ils ne se gênent donc jamais.
 */
import { env } from '../env.js';

interface OllamaModel {
  name: string;
  size: number;
}

async function ollama(path: string, init?: RequestInit, timeoutMs = 3000): Promise<Response | null> {
  if (!env.OLLAMA_URL) return null;
  return fetch(new URL(path, env.OLLAMA_URL), { ...init, signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
}

/** Modèle utilisé : celui de `OLLAMA_MODEL` s'il est installé, sinon le premier ; null si Ollama ne répond pas. */
export async function llmModel(): Promise<string | null> {
  const res = await ollama('/api/tags');
  if (!res?.ok) return null;
  const { models = [] } = (await res.json().catch(() => ({}))) as { models?: OllamaModel[] };
  if (env.OLLAMA_MODEL) return models.some(m => m.name === env.OLLAMA_MODEL) ? env.OLLAMA_MODEL : null;
  return models[0]?.name ?? null;
}

/** Taille du modèle (octets), et s'il est déjà chargé par Ollama. */
export async function llmState(model: string): Promise<{ size: number; loaded: boolean }> {
  const [tags, ps] = await Promise.all([ollama('/api/tags'), ollama('/api/ps')]);
  const list = async (res: Response | null) =>
    res?.ok ? (((await res.json().catch(() => ({}))) as { models?: OllamaModel[] }).models ?? []) : [];
  const size = (await list(tags)).find(m => m.name === model)?.size ?? 0;
  return { size, loaded: (await list(ps)).some(m => m.name === model) };
}

/** Sort de la mémoire les modèles qu'Ollama a chargés (avant un workflow ComfyUI). Sans effet s'il n'y en a pas. */
export async function unloadLlm(): Promise<void> {
  const res = await ollama('/api/ps');
  if (!res?.ok) return;
  const { models = [] } = (await res.json().catch(() => ({}))) as { models?: OllamaModel[] };
  await Promise.all(
    models.map(m =>
      ollama('/api/generate', { method: 'POST', body: JSON.stringify({ model: m.name, keep_alive: 0 }) }, 15_000),
    ),
  );
}

/**
 * Réponse JSON du modèle, au format donné (schéma JSON imposé par Ollama). Le modèle reste chargé 5 min : plusieurs
 * reformulations de suite ne le rechargent pas (un workflow ComfyUI le libère avant, voir `unloadLlm`).
 */
export async function chatJson<T>(model: string, system: string, user: string, schema: object): Promise<T> {
  const call = (think: boolean) =>
    ollama(
      '/api/chat',
      {
        method: 'POST',
        body: JSON.stringify({
          model,
          stream: false,
          // Pas de réflexion : une reformulation n'en a pas besoin, et elle doublerait l'attente.
          ...(think ? {} : { think: false }),
          format: schema,
          keep_alive: '5m',
          options: { temperature: 0.4 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      },
      180_000,
    );
  let res = await call(false);
  // Modèle sans mode « réflexion » : Ollama refuse le paramètre, on relance sans.
  if (res?.status === 400) res = await call(true);
  if (!res) throw new Error('Ollama ne répond pas.');
  const body = (await res.json().catch(() => null)) as { message?: { content?: string }; error?: string } | null;
  if (!res.ok) throw new Error(`Ollama : ${body?.error ?? `HTTP ${res.status}`}`);
  try {
    return JSON.parse(body?.message?.content ?? '') as T;
  } catch {
    throw new Error('Réponse du modèle illisible.');
  }
}
