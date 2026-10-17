import { describe, expect, it } from 'vitest';
import { appDefault, buildInput, imageInputInfo, resolveTask, type InputSchema } from './input';

describe('resolveTask', () => {
  const photo = ['text-to-image', 'image-to-image'] as const;
  const video = ['text-to-video', 'image-to-video', 'reference-to-video'] as const;
  const none = { images: 0, videos: 0 };

  it('photo : texte seul, puis avec images', () => {
    expect(resolveTask('image', photo, none)).toEqual({ ok: true, task: 'text-to-image' });
    expect(resolveTask('image', photo, { images: 2, videos: 0 })).toEqual({ ok: true, task: 'image-to-image' });
  });

  it('photo : refuse une vidéo, ou une image sans image-to-image', () => {
    expect(resolveTask('image', photo, { images: 0, videos: 1 }).ok).toBe(false);
    expect(resolveTask('image', ['text-to-image'], { images: 1, videos: 0 }).ok).toBe(false);
    expect(resolveTask('image', ['image-to-image'], none).ok).toBe(false);
  });

  it('vidéo : texte, image de départ, références', () => {
    expect(resolveTask('video', video, none)).toEqual({ ok: true, task: 'text-to-video' });
    expect(resolveTask('video', video, { images: 1, videos: 0 })).toEqual({ ok: true, task: 'image-to-video' });
    expect(resolveTask('video', video, { images: 1, videos: 0 }, 'reference')).toEqual({
      ok: true,
      task: 'reference-to-video',
    });
    expect(resolveTask('video', video, { images: 0, videos: 1 })).toEqual({ ok: true, task: 'reference-to-video' });
    expect(resolveTask('video', ['image-to-video'], { images: 0, videos: 1 }).ok).toBe(false);
  });
});

describe('appDefault', () => {
  it('qualité high quand le modèle la propose, sinon le défaut du schéma', () => {
    expect(appDefault('quality', { enum: ['low', 'high'], default: 'low' })).toBe('high');
    expect(appDefault('quality', { enum: ['low', 'medium'], default: 'low' })).toBe('low');
    expect(appDefault('aspect_ratio', { default: '1:1' })).toBe('1:1');
  });
});

describe('buildInput', () => {
  const schema: InputSchema = {
    properties: {
      prompt: { type: 'string' },
      num_outputs: { type: 'integer' },
      output_format: { enum: ['jpeg', 'png'], default: 'jpeg' },
      official_fallback: { type: 'boolean' },
      quality: { enum: ['low', 'high'], default: 'low' },
      image_urls: { type: 'array', maxItems: 2 },
      loras: { type: 'array', maxItems: 1 },
    },
  };
  const base = { schema, prompt: '  une pomme  ', params: {}, images: [], videos: [], loras: [] };

  it('réglages imposés : une image, PNG, relance officielle, qualité high', () => {
    const { input } = buildInput({ ...base, task: 'text-to-image' });
    expect(input).toMatchObject({
      prompt: 'une pomme',
      num_outputs: 1,
      output_format: 'png',
      official_fallback: true,
      quality: 'high',
    });
  });

  it('le choix de l’utilisateur passe avant le défaut de l’app', () => {
    const { input } = buildInput({ ...base, task: 'text-to-image', params: { quality: 'low' } });
    expect(input.quality).toBe('low');
  });

  it('images dans l’ordre, au-delà du maximum comptées comme ignorées', () => {
    const { input, dropped } = buildInput({ ...base, task: 'image-to-image', images: ['a', 'b', 'c'] });
    expect(input.image_urls).toEqual(['a', 'b']);
    expect(dropped).toBe(1);
  });

  it('une seule image acceptée : la première', () => {
    const single: InputSchema = { properties: { image_url: { type: 'string' } } };
    const { input, dropped } = buildInput({ ...base, schema: single, task: 'image-to-image', images: ['a', 'b'] });
    expect(input.image_url).toBe('a');
    expect(dropped).toBe(1);
  });

  it('vidéo : image de début puis de fin', () => {
    const i2v: InputSchema = { properties: { image_url: {}, last_image_url: {} } };
    const { input } = buildInput({ ...base, schema: i2v, task: 'image-to-video', images: ['debut', 'fin'] });
    expect(input).toMatchObject({ image_url: 'debut', last_image_url: 'fin' });
  });

  it('LoRA plafonnées au maximum du schéma', () => {
    const { input, lorasApplied } = buildInput({
      ...base,
      task: 'text-to-image',
      loras: [
        { path: 'https://a', scale: 1 },
        { path: 'https://b', scale: 0.5 },
      ],
    });
    expect(input.loras).toEqual([{ path: 'https://a', scale: 1 }]);
    expect(lorasApplied).toBe(1);
  });
});

describe('imageInputInfo', () => {
  it('photo : nombre d’images lu dans le schéma', () => {
    expect(imageInputInfo('image', { 'image-to-image': { schema: { properties: { image_urls: { maxItems: 14 } } } } })).toEqual({
      max: 14,
      mode: 'reference',
    });
    expect(imageInputInfo('image', {})).toEqual({ max: 0, mode: 'none' });
  });

  it('vidéo : début et fin, ou références', () => {
    const tasks = {
      'image-to-video': { schema: { properties: { image_url: {}, last_image_url: {} } } },
      'reference-to-video': { schema: { properties: { reference_image_urls: { maxItems: 4 } } } },
    };
    expect(imageInputInfo('video', tasks)).toEqual({ max: 2, mode: 'start-frame' });
    expect(imageInputInfo('video', tasks, 'reference')).toEqual({ max: 4, mode: 'reference' });
  });
});
