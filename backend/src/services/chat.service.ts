/**
 * Modèles de texte (SpicyAPI, protocole OpenAI Chat) : un seul point d'appel pour les
 * nœuds Décrire une image et Texte IA. Les images partent comme copies SpicyAPI
 * (`spicy://…`). En test (SPICY_FAKE), réponse simulée, aucun appel réseau ;
 * un texte contenant FAIL_TEST simule un échec.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/index.js';
import { assets } from '../db/schema.js';
import { env } from '../env.js';
import { requireApiKey } from './settings.service.js';
import { callSpicy, clientForUser, getModels } from './spicy.service.js';
import { FAIL_MARKER } from './spicy.fake.js';

const CHAT_URL = 'https://api.spicyapi.ai/v1/chat/completions';
/** Une description ou une reformulation tient largement dans cette réponse. */
const MAX_TOKENS = 1200;

export interface ChatRequest {
  model: string;
  system: string;
  text: string;
  /** Images (ids de médias du compte), lues par le modèle. */
  imageIds: string[];
}

/**
 * Devis approché : le prix au millier de tokens du modèle, pour une demande type
 * (consigne et réponse, plus environ 1 000 tokens par image). Le coût réel arrive après.
 */
export async function estimateChat(userId: string, req: ChatRequest): Promise<string> {
  // Tests : prix simulé (le catalogue de test ne contient pas tous les modèles de texte).
  if (env.SPICY_FAKE) return '0.001';
  const model = (await getModels(userId)).find(m => m.model === req.model);
  if (!model?.enabled) throw new HTTPException(400, { message: `Le modèle de texte ${req.model} n’est pas disponible avec cette clé.` });
  const pricing = (model.pricing ?? []) as { unit?: string; price?: string }[];
  const per1k = Number(pricing.find(p => p.unit === 'per_1k_tokens')?.price ?? 0);
  const tokens = 500 + req.text.length / 3 + req.imageIds.length * 1000 + MAX_TOKENS;
  return String(Number(((tokens / 1000) * per1k).toFixed(6)));
}

/** Appel du modèle : renvoie le texte produit et, si SpicyAPI le donne, le coût de la tâche. */
export async function runChat(userId: string, req: ChatRequest): Promise<{ text: string; cost: string | null }> {
  if (req.text.includes(FAIL_MARKER)) throw new HTTPException(502, { message: 'Le modèle de texte a échoué (simulation).' });
  if (env.SPICY_FAKE) {
    return {
      text: req.imageIds.length
        ? `Description simulée de ${req.imageIds.length} image${req.imageIds.length > 1 ? 's' : ''}.`
        : `Texte reformulé : ${req.text}`,
      cost: '0.001',
    };
  }
  const client = await clientForUser(userId);
  const rows = req.imageIds.length
    ? await db.select().from(assets).where(and(eq(assets.userId, userId), inArray(assets.id, req.imageIds)))
    : [];
  const byId = new Map(rows.map(r => [r.id, r]));
  const uris: string[] = [];
  for (const id of req.imageIds) {
    const asset = byId.get(id);
    if (!asset) continue;
    uris.push((await callSpicy(() => client.uploadFile(asset.filePath))).uri);
  }

  const apiKey = await requireApiKey(userId);
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: req.model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: req.system },
        {
          role: 'user',
          content: [{ type: 'text', text: req.text }, ...uris.map(url => ({ type: 'image_url', image_url: { url } }))],
        },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  }).catch(() => null);
  if (!res) throw new HTTPException(502, { message: 'SpicyAPI ne répond pas.' });
  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
    msg?: string;
  } | null;
  if (!res.ok) throw new HTTPException(502, { message: data?.error?.message ?? data?.msg ?? 'Le modèle de texte a échoué.' });
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new HTTPException(502, { message: 'Le modèle de texte n’a rien renvoyé.' });

  // Coût réel : la tâche SpicyAPI de l'appel (son id est dans l'en-tête).
  const taskId = res.headers.get('X-Spicy-Task-Id');
  const cost = taskId ? ((await client.getTask(taskId).catch(() => null))?.cost ?? null) : null;
  return { text, cost };
}

/** Consignes système des nœuds de texte. */
export const SYSTEM_PROMPTS = {
  describe:
    'Tu décris des images pour qu’un modèle de génération puisse les reproduire. Décris précisément : ' +
    'sujet, apparence, tenue, pose, décor, lumière, cadrage et style. Réponds par une description en un ' +
    'paragraphe, sans titre ni liste, sans commentaire.',
  llm:
    'Tu aides à écrire des prompts pour la génération d’images et de vidéos. Applique la consigne au texte ' +
    'fourni. Réponds uniquement par le résultat, sans titre, sans guillemets et sans commentaire.',
} as const;
