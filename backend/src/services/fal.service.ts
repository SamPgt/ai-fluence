/**
 * fal.ai : entraînement des LoRA (SpicyAPI ne sait que les utiliser).
 * La clé est propre à chaque utilisateur, chiffrée en base comme la clé SpicyAPI.
 */
import { HTTPException } from 'hono/http-exception';

const TIMEOUT_MS = 15_000;

/** Appel gratuit qui répond 401 si la clé est invalide. */
export async function verifyFalKey(apiKey: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch('https://api.fal.ai/v1/models?limit=1', {
      headers: { Authorization: `Key ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new HTTPException(502, { message: 'fal est injoignable pour le moment.' });
  }
  if (res.status === 401 || res.status === 403) {
    throw new HTTPException(400, { message: 'Clé fal refusée. Vérifie-la dans ton tableau de bord fal.' });
  }
  if (!res.ok) throw new HTTPException(502, { message: `fal a répondu ${res.status}.` });
}
