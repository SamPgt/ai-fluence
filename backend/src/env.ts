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
  // ComfyUI local (optionnel). Vide = fonctionnalité masquée dans l'app.
  COMFYUI_URL: optionalString(z.url()),
  /** Commande de démarrage, ex. `python -m comfy_cli launch --background`. Vide = pas de bouton Démarrer. */
  COMFYUI_LAUNCH: optionalString(z.string()),
  /** Commande d'arrêt, ex. `python -m comfy_cli stop --port 8188`. */
  COMFYUI_STOP: optionalString(z.string()),
  /** Dossier de ComfyUI : l'app y supprime sa copie de chaque image une fois rapatriée (`output/ai-fluence/`). */
  COMFYUI_DIR: optionalString(z.string()),
});

/** `VAR=` dans le .env donne une chaîne vide : on la traite comme absente. */
function optionalString<T extends z.ZodType<string>>(schema: T) {
  return z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());
}

const parsed = envSchema.parse(process.env);

function expandHome(p: string): string {
  return p.startsWith('~') ? resolve(homedir(), p.slice(2)) : resolve(p);
}

export const env = { ...parsed, DATA_DIR: expandHome(parsed.DATA_DIR) };
export { expandHome };
