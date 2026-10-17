/**
 * Mots-clés de la dictée : le vocabulaire qu'on veut voir bien transcrit (noms de personas,
 * jargon de l'app et de l'IA, fournisseurs, modèles). Envoyés aux trois modèles de dictée,
 * dans la limite de chacun.
 */
import type { DictationProvider } from './api';

/** Vocabulaire de l'app et de la génération d'images ou de vidéos. */
export const DICTATION_TERMS = [
  'Sublime',
  'LoRA',
  'prompt',
  'persona',
  'workflow',
  'Bibliothèque',
  'Galerie',
  'raccourci',
  'référence',
  'image 1',
  'image 2',
  'image 3',
  'upscale',
  'upscaler',
  'inpainting',
  'outpainting',
  'seed',
  'CFG',
  'prompt négatif',
  'aspect ratio',
  '16:9',
  '9:16',
  '4:5',
  '1:1',
  '4K',
  '2K',
  'text-to-image',
  'image-to-image',
  'image-to-video',
  'IA',
  'LLM',
  'speech to text',
  'text to speech',
  'ElevenLabs',
  'Deepgram',
  'Cartesia',
  'SpicyAPI',
  'Civitai',
  'Unsplash',
  'Pexels',
  'Instagram',
  'TikTok',
  'reel',
  'story',
  'UGC',
  'influenceuse',
  'selfie',
  'plan drone',
  'travelling',
  'golden hour',
  'bokeh',
  '35mm',
  'photoréaliste',
  'cinématique',
];

/** Limites de chaque fournisseur : nombre de mots-clés, longueur d'un mot-clé, longueur totale. */
const LIMITS: Record<DictationProvider, { count: number; length: number; total: number }> = {
  deepgram: { count: 100, length: 100, total: Infinity },
  cartesia: { count: 100, length: 100, total: 1200 },
  elevenlabs: { count: 50, length: 20, total: Infinity },
  // Whisper : les mots-clés partent en amorce (`initial_prompt`), courte pour ne pas l'influencer trop.
  whisper: { count: 40, length: 40, total: 300 },
};

/**
 * Liste par ordre d'importance (personas, vocabulaire, fournisseurs, modèles), sans doublon,
 * coupée selon les limites du fournisseur.
 */
export function dictationKeyterms(
  provider: DictationProvider,
  sources: { personas: string[]; providers: string[]; models: string[] },
): string[] {
  const { count, length, total } = LIMITS[provider];
  const seen = new Set<string>();
  const out: string[] = [];
  let chars = 0;
  for (const raw of [...sources.personas, ...DICTATION_TERMS, ...sources.providers, ...sources.models]) {
    const term = raw.trim().replace(/\s+/g, ' ');
    const key = term.toLowerCase();
    if (!term || term.length > length || seen.has(key)) continue;
    if (out.length >= count || chars + term.length > total) break;
    seen.add(key);
    out.push(term);
    chars += term.length;
  }
  return out;
}
