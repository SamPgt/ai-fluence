import { describe, expect, it } from 'vitest';
import { APP_DEFAULT_FAMILY, MODEL_FAMILIES, PROVIDERS, familyIdOf, getFamily } from './models';

describe('modèles par défaut de l’app', () => {
  it('sont économiques et du bon type', () => {
    for (const media of ['image', 'video'] as const) {
      const f = getFamily(APP_DEFAULT_FAMILY[media]);
      expect(f, media).toBeDefined();
      expect(f!.media).toBe(media);
      expect(f!.lowCost).toBe(true);
    }
    expect(APP_DEFAULT_FAMILY).toEqual({
      image: 'bytedance/seedream-5.0-flash',
      video: 'bytedance/seedance-2.0-mini',
    });
  });
});

describe('catalogue', () => {
  it('GPT Image 2.5 est le modèle photo le mieux noté', () => {
    expect(MODEL_FAMILIES.find(f => f.media === 'image')!.id).toBe('openai/gpt-image-2.5-sunburst');
  });

  it('recommandés photo : rangs uniques, Nano Banana Pro en dernier', () => {
    const photo = MODEL_FAMILIES.filter(f => f.media === 'image' && f.recommended).sort(
      (a, b) => a.recommended! - b.recommended!,
    );
    expect(new Set(photo.map(f => f.recommended)).size).toBe(photo.length);
    expect(photo.at(-1)!.id).toBe('google/nano-banana-pro');
    expect(photo.at(-2)!.id).toBe('bytedance/seedream-5.0-pro');
  });

  it('chaque modèle a un fournisseur connu', () => {
    for (const f of MODEL_FAMILIES) expect(PROVIDERS[f.provider], f.id).toBeDefined();
  });

  it('ordre des fournisseurs du menu', () => {
    expect(Object.keys(PROVIDERS).slice(0, 5)).toEqual(['openai', 'bytedance', 'alibaba', 'google', 'black-forest-labs']);
  });

  it('familyIdOf retire la tâche du model ID', () => {
    expect(familyIdOf('bytedance/seedream-5.0-flash/text-to-image')).toBe('bytedance/seedream-5.0-flash');
  });
});
