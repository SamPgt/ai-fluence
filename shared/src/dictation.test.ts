import { describe, expect, it } from 'vitest';
import { DICTATION_TERMS, dictationKeyterms } from './dictation';

const sources = {
  personas: ['Léa', 'Ancien royaume'],
  providers: ['OpenAI', 'Google'],
  models: ['Seedream 5.0 Flash', 'Nano Banana Pro', 'LTX 2.3 Spicy LoRA très longue'],
};

describe('dictationKeyterms', () => {
  it('personas d’abord, puis le vocabulaire, les fournisseurs et les modèles, sans doublon', () => {
    const terms = dictationKeyterms('deepgram', { ...sources, personas: ['Léa', 'léa ', 'LoRA'] });
    expect(terms.slice(0, 3)).toEqual(['Léa', 'LoRA', 'Sublime']);
    expect(terms).toContain('Seedream 5.0 Flash');
    expect(terms.filter(t => t.toLowerCase() === 'lora')).toHaveLength(1);
    expect(terms.length).toBeLessThanOrEqual(100);
  });

  it('ElevenLabs : 50 mots-clés de 20 caractères au plus', () => {
    const terms = dictationKeyterms('elevenlabs', sources);
    expect(terms).toHaveLength(Math.min(50, terms.length));
    expect(terms.every(t => t.length <= 20)).toBe(true);
    expect(terms).not.toContain('LTX 2.3 Spicy LoRA très longue');
  });

  it('Cartesia : 1 200 caractères au total au plus', () => {
    const many = { ...sources, models: Array.from({ length: 200 }, (_, i) => `Modèle numéro ${i}`) };
    const terms = dictationKeyterms('cartesia', many);
    expect(terms.join('').length).toBeLessThanOrEqual(1200);
    expect(terms.length).toBeLessThanOrEqual(100);
    expect(terms).toContain(DICTATION_TERMS[0]);
  });
});
