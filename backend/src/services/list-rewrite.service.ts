/**
 * Reformulation d'éléments de liste : des lignes écrites pour Stable Diffusion (suites de
 * tags) deviennent de courtes phrases, par le modèle de texte des workflows (payant, prix
 * annoncé avant). Par paquets de 50 lignes, lancés ensemble.
 */
import { HTTPException } from 'hono/http-exception';
import { WORKFLOW_TEXT_MODEL_DEFAULT, type ListRewriteQuoteResponse, type ListRewriteResponse } from '@sublime/shared';
import { estimateChat, runChat, type ChatRequest } from './chat.service.js';

/** Lignes reformulées au plus par demande. */
export const REWRITE_MAX = 200;
const CHUNK = 50;

const SYSTEM =
  'Tu reçois une liste numérotée d’éléments écrits pour Stable Diffusion (tags séparés par des virgules). ' +
  'Réécris chaque élément en une courte description naturelle en français : une seule phrase de 25 mots au ' +
  'plus, qui garde le sens et les détails visuels, sans tags de qualité (masterpiece, best quality…) ni ' +
  'nombre de personnes (1girl…). Réponds uniquement par la liste, une ligne par élément, numérotée comme ' +
  'l’entrée (« 1. … »), avec exactement le même nombre de lignes.';

const requests = (items: string[]): ChatRequest[] => {
  const out: ChatRequest[] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    out.push({
      model: WORKFLOW_TEXT_MODEL_DEFAULT,
      system: SYSTEM,
      text: chunk.map((it, n) => `${n + 1}. ${it}`).join('\n'),
      imageIds: [],
      // Une phrase française par ligne : une soixantaine de tokens au plus.
      maxTokens: chunk.length * 60 + 200,
    });
  }
  return out;
};

function checkCount(items: string[]) {
  if (!items.length) throw new HTTPException(400, { message: 'Aucun élément à reformuler.' });
  if (items.length > REWRITE_MAX) throw new HTTPException(400, { message: `${REWRITE_MAX} éléments au plus.` });
}

export async function quoteRewrite(userId: string, items: string[]): Promise<ListRewriteQuoteResponse> {
  checkCount(items);
  const costs = await Promise.all(requests(items).map(r => estimateChat(userId, r)));
  return { count: items.length, estimatedCost: String(Number(costs.reduce((s, c) => s + Number(c), 0).toFixed(6))) };
}

/** Lignes « 3. texte » de la réponse, par numéro. */
function parseNumbered(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
    if (m && m[2].trim()) out.set(Number(m[1]), m[2].trim());
  }
  return out;
}

/** Éléments reformulés, dans le même ordre ; une ligne manquante dans la réponse garde son texte d'origine. */
export async function rewriteItems(userId: string, items: string[]): Promise<ListRewriteResponse> {
  checkCount(items);
  const reqs = requests(items);
  const results = await Promise.all(reqs.map(r => runChat(userId, r)));
  const rewritten = results.flatMap((res, c) => {
    const lines = parseNumbered(res.text);
    return items.slice(c * CHUNK, (c + 1) * CHUNK).map((original, n) => lines.get(n + 1) ?? original);
  });
  const cost = results.reduce((s, r) => s + Number(r.cost ?? 0), 0);
  return { items: rewritten, cost: cost ? String(Number(cost.toFixed(6))) : null };
}
