import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Pas `PORT` : Portly l'injecte pour le front (3070).
  API_PORT: z.coerce.number().default(3470),
  DATABASE_URL: z.string(),
  /** 32 octets hex : clé AES-256-GCM des clés API stockées en base. */
  APP_SECRET: z.string().regex(/^[0-9a-f]{64}$/i, 'APP_SECRET doit faire 64 caractères hex'),
  CLIENT_URL: z.string().default('http://localhost:3070'),
  DATA_DIR: z.string().default('~/Documents/ai-influence-app'),
  SPICY_API_BASE_URL: z.string().optional(),
  /** Optionnel : bibliothèque LoRA Civitai (recherche + téléchargements protégés). Ne quitte jamais le backend. */
  CIVITAI_KEY: z.string().optional(),
  /** Optionnel : librairie de photos libres de droits Unsplash (clé « Access Key »). Ne quitte jamais le backend. */
  UNSPLASH_ACCESS_KEY: z.string().optional(),
  /** Optionnel : librairie de photos libres de droits Pexels. Ne quitte jamais le backend. */
  PEXELS_API_KEY: z.string().optional(),
  /** Optionnel : dictée avec Deepgram Flux (clé au rôle « Member » pour les jetons temporaires). Ne quitte jamais le backend. */
  deepgramApiKey: z.string().optional(),
  /** Optionnel : dictée avec Cartesia Ink-2 (jetons temporaires « stt »). Ne quitte jamais le backend. */
  cartesiaApiKey: z.string().optional(),
  /** Tests uniquement : remplace SpicyAPI par un faux client (cf. services/spicy.fake). */
  SPICY_FAKE: z.stringbool().default(false),
});

const parsed = envSchema.parse(process.env);

function expandHome(p: string): string {
  return p.startsWith('~') ? resolve(homedir(), p.slice(2)) : resolve(p);
}

export const env = { ...parsed, DATA_DIR: expandHome(parsed.DATA_DIR) };
export { expandHome };
