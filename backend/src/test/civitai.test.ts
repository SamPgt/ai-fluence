/**
 * Bibliothèque LoRA Civitai : état, recherche (avec une fausse réponse
 * Civitai, fetch est remplacé) et résolution des liens de téléchargement au
 * lancement d'une génération. Aucun appel réel à civitai.com.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../env.js';
import { fakeSpicyClient } from '../services/spicy.fake.js';
import { call, signup } from './helpers.js';

const Z_IMAGE_LORA = 'alibaba/z-image-turbo-lora';
const FLUX_LORA = 'black-forest-labs/flux-1-dev-lora';
const WAN_22_LORA = 'alibaba/wan-2.2-lora';

const realFetch = globalThis.fetch;
const client = fakeSpicyClient as unknown as Record<string, (...args: any[]) => Promise<any>>;

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/**
 * Remplace fetch : les URL civitai.com passent par `handler`, les autres
 * (fichiers de sortie du faux SpicyAPI en data:) gardent le vrai fetch.
 */
function stubCivitai(handler: Handler) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).hostname.endsWith('civitai.com')) return handler(url, init);
    return realFetch(input, init);
  });
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** Appels fetch faits vers Civitai. */
const civitaiCalls = (spy: ReturnType<typeof stubCivitai>) =>
  spy.mock.calls
    .map(c => ({ url: String(typeof c[0] === 'string' ? c[0] : (c[0] as Request).url ?? c[0]), init: c[1] as RequestInit | undefined }))
    .filter(c => c.url.includes('civitai.com'));

// ── Fausse réponse Civitai ─────────────────────────────────────

const file = (name: string, url: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: 'Model',
  sizeKB: 1234.6,
  downloadUrl: url,
  ...extra,
});
const image = (url: string, nsfwLevel = 1, type = 'image') => ({ url, type, nsfwLevel });

const MULTI_MODEL = {
  id: 101,
  name: '  Belle LoRA multi modèles avec un nom vraiment très très long pour la coupe  ',
  nsfw: false,
  creator: { username: 'alice' },
  stats: { downloadCount: 500, thumbsUpCount: 42 },
  modelVersions: [
    {
      id: 11,
      name: 'v2 Z',
      baseModel: 'ZImageTurbo',
      trainedWords: ['sks woman, red hair', 'x'.repeat(61), 'sks woman', 'a', 'b', 'c', 'd'],
      files: [
        { name: 'data.zip', type: 'Training Data', sizeKB: 10, downloadUrl: 'https://civitai.com/api/download/models/0' },
        file('autre.safetensors', 'https://civitai.com/api/download/models/110'),
        file('belle.safetensors', 'https://civitai.com/api/download/models/11', { primary: true }),
      ],
      images: [
        image('https://image.civitai.com/abc/original=true/1.jpeg'),
        image('https://image.civitai.com/abc/width=1024/2.mp4', 1, 'video'),
        image('https://image.civitai.com/abc/original=true/3.jpeg', 8),
      ],
    },
    {
      id: 12,
      name: 'v1 Flux',
      baseModel: 'Flux.1 D',
      files: [file('belle-flux.safetensors', 'https://civitai.com/api/download/models/12')],
      images: [],
    },
    // Modèle de base non pris en charge : ignoré.
    {
      id: 13,
      name: 'SDXL',
      baseModel: 'SDXL 1.0',
      files: [file('sdxl.safetensors', 'https://civitai.com/api/download/models/13')],
      images: [image('https://image.civitai.com/abc/original=true/4.jpeg')],
    },
    // Accès anticipé : ignoré.
    {
      id: 14,
      name: 'early',
      baseModel: 'ZImageTurbo',
      availability: 'EarlyAccess',
      files: [file('early.safetensors', 'https://civitai.com/api/download/models/14')],
      images: [image('https://image.civitai.com/abc/original=true/5.jpeg')],
    },
  ],
};

/** Aucune version compatible : écarté. */
const SDXL_ONLY = {
  id: 102,
  name: 'SDXL seul',
  nsfw: false,
  modelVersions: [
    {
      id: 21,
      name: 'v1',
      baseModel: 'SDXL 1.0',
      files: [file('s.safetensors', 'https://civitai.com/api/download/models/21')],
      images: [image('https://image.civitai.com/x/original=true/a.jpeg')],
    },
  ],
};

/** Fichier .ckpt seulement : écarté. */
const NO_SAFETENSORS = {
  id: 103,
  name: 'Ancien format',
  nsfw: false,
  modelVersions: [
    {
      id: 31,
      name: 'v1',
      baseModel: 'Qwen',
      files: [file('old.ckpt', 'https://civitai.com/api/download/models/31')],
      images: [image('https://image.civitai.com/x/original=true/b.jpeg')],
    },
  ],
};

/** Aperçus tous explicites : écarté hors mode NSFW. */
const NSFW_PREVIEWS = {
  id: 104,
  name: 'Aperçus explicites',
  nsfw: true,
  modelVersions: [
    {
      id: 41,
      name: 'v1',
      baseModel: 'Qwen',
      files: [file('n.safetensors', 'https://civitai.com/api/download/models/41')],
      images: [image('https://image.civitai.com/x/original=true/c.jpeg', 16)],
    },
  ],
};

/** Wan 2.2 : passes HIGH et LOW publiées en deux versions. */
const WAN_PAIR = {
  id: 105,
  name: 'Wan duo',
  nsfw: false,
  modelVersions: [
    {
      id: 52,
      name: 'LOW v1',
      baseModel: 'Wan Video 2.2 I2V-A14B',
      trainedWords: ['wanword'],
      files: [file('duo_low.safetensors', 'https://civitai.com/api/download/models/52')],
      images: [image('https://image.civitai.com/w/original=true/l.jpeg')],
    },
    {
      id: 51,
      name: 'HIGH v1',
      baseModel: 'Wan Video 2.2 I2V-A14B',
      trainedWords: ['wanword'],
      files: [file('duo_high.safetensors', 'https://civitai.com/api/download/models/51')],
      images: [image('https://image.civitai.com/w/original=true/h.jpeg')],
    },
  ],
};

const PAYLOAD = {
  items: [MULTI_MODEL, SDXL_ONLY, NO_SAFETENSORS, NSFW_PREVIEWS, WAN_PAIR],
  metadata: { nextCursor: 'curseur-suivant' },
};

/** Recherche unique (le service garde 5 min en cache chaque URL). */
const uniqueQuery = () => `q-${randomUUID().slice(0, 8)}`;

afterEach(() => {
  vi.restoreAllMocks();
  env.CIVITAI_KEY = '';
});

// ── État ──────────────────────────────────────────────────────

describe('GET /civitai/status', () => {
  it('refuse sans session (401)', async () => {
    expect((await call('GET', '/civitai/status')).status).toBe(401);
  });

  it('désactivé sans CIVITAI_KEY', async () => {
    const me = await signup();
    const res = await me.get('/civitai/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false });
  });

  it('activé avec CIVITAI_KEY', async () => {
    env.CIVITAI_KEY = 'cle-civitai-test';
    const me = await signup();
    expect((await me.get('/civitai/status')).body).toEqual({ enabled: true });
  });
});

// ── Recherche ─────────────────────────────────────────────────

describe('GET /civitai/search', () => {
  it('refuse sans session (401)', async () => {
    const spy = stubCivitai(() => json(PAYLOAD));
    expect((await call('GET', '/civitai/search')).status).toBe(401);
    expect(civitaiCalls(spy)).toHaveLength(0);
  });

  it('transforme la réponse Civitai en LoRA prêtes à importer', async () => {
    const spy = stubCivitai(() => json(PAYLOAD));
    const me = await signup();
    const res = await me.get(`/civitai/search?query=${uniqueQuery()}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(civitaiCalls(spy)).toHaveLength(1);
    expect(res.body.nextCursor).toBe('curseur-suivant');
    // SDXL seul, .ckpt seul et aperçus explicites sont écartés.
    expect(res.body.items.map((l: { modelId: number }) => l.modelId)).toEqual([101, 105]);

    const multi = res.body.items[0];
    expect(multi).toEqual({
      modelId: 101,
      versionId: 11,
      name: MULTI_MODEL.name.trim().slice(0, 60),
      versionName: 'v2 Z',
      creator: 'alice',
      pageUrl: 'https://civitai.com/models/101?modelVersionId=11',
      family: Z_IMAGE_LORA,
      baseModel: 'ZImageTurbo',
      // Découpés aux virgules, sans doublon, 60 caractères max, 5 au plus.
      triggerWords: ['sks woman', 'red hair', 'a', 'b', 'c'],
      previews: [
        { url: 'https://image.civitai.com/abc/width=450/1.jpeg', nsfw: false },
        {
          url: 'https://image.civitai.com/abc/anim=false,transcode=true,width=450/2.mp4',
          videoUrl: 'https://image.civitai.com/abc/transcode=true,width=450/2.mp4',
          nsfw: false,
        },
      ],
      // Fichier principal choisi, taille arrondie.
      files: [{ url: 'https://civitai.com/api/download/models/11', fileName: 'belle.safetensors', sizeKB: 1235 }],
      downloads: 500,
      likes: 42,
      nsfw: false,
      variants: [
        {
          family: Z_IMAGE_LORA,
          baseModel: 'ZImageTurbo',
          versionId: 11,
          versionName: 'v2 Z',
          triggerWords: ['sks woman', 'red hair', 'a', 'b', 'c'],
          files: [{ url: 'https://civitai.com/api/download/models/11', fileName: 'belle.safetensors', sizeKB: 1235 }],
        },
        {
          family: FLUX_LORA,
          baseModel: 'Flux.1 D',
          versionId: 12,
          versionName: 'v1 Flux',
          triggerWords: [],
          files: [{ url: 'https://civitai.com/api/download/models/12', fileName: 'belle-flux.safetensors', sizeKB: 1235 }],
        },
      ],
    });
  });

  it('Wan 2.2 : regroupe les passes HIGH et LOW en une variante', async () => {
    stubCivitai(() => json(PAYLOAD));
    const me = await signup();
    const res = await me.get(`/civitai/search?query=${uniqueQuery()}`);
    const wan = res.body.items.find((l: { modelId: number }) => l.modelId === 105);
    expect(wan).toMatchObject({
      family: WAN_22_LORA,
      versionId: 51,
      versionName: 'HIGH v1',
      triggerWords: ['wanword'],
      files: [
        { url: 'https://civitai.com/api/download/models/51', fileName: 'duo_high.safetensors', sizeKB: 1235, noise: 'high' },
        { url: 'https://civitai.com/api/download/models/52', fileName: 'duo_low.safetensors', sizeKB: 1235, noise: 'low' },
      ],
      creator: '',
      downloads: 0,
      likes: 0,
    });
    expect(wan.variants).toHaveLength(1);
  });

  it('mode NSFW : garde les aperçus explicites', async () => {
    const spy = stubCivitai(() => json(PAYLOAD));
    const me = await signup();
    const res = await me.get(`/civitai/search?nsfw=true&query=${uniqueQuery()}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((l: { modelId: number }) => l.modelId)).toEqual([101, 104, 105]);
    const multi = res.body.items[0];
    expect(multi.previews).toHaveLength(3);
    expect(multi.previews[2]).toEqual({ url: 'https://image.civitai.com/abc/width=450/3.jpeg', nsfw: true });
    expect(new URL(civitaiCalls(spy)[0].url).searchParams.get('nsfw')).toBe('true');
  });

  it('construit la requête Civitai : type, tri, modèles de base, recherche et curseur', async () => {
    const spy = stubCivitai(() => json({ items: [] }));
    const me = await signup();
    const q = uniqueQuery();
    const res = await me.get(
      `/civitai/search?family=${encodeURIComponent(WAN_22_LORA)}&query=${encodeURIComponent(`  ${q}  `)}&sort=Newest&cursor=abc`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });
    const [{ url, init }] = civitaiCalls(spy);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://civitai.com/api/v1/models');
    expect(u.searchParams.get('types')).toBe('LORA');
    expect(u.searchParams.get('limit')).toBe('30');
    expect(u.searchParams.get('sort')).toBe('Newest');
    expect(u.searchParams.get('nsfw')).toBe('false');
    expect(u.searchParams.get('query')).toBe(q);
    expect(u.searchParams.get('cursor')).toBe('abc');
    expect(u.searchParams.getAll('baseModels')).toEqual(['Wan Video 2.2 T2V-A14B', 'Wan Video 2.2 I2V-A14B']);
    // Sans CIVITAI_KEY : aucun en-tête d'autorisation.
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('sans famille : cherche dans tous les modèles de base pris en charge, tri par défaut', async () => {
    const spy = stubCivitai(() => json({ items: [] }));
    const me = await signup();
    await me.get(`/civitai/search?query=${uniqueQuery()}`);
    const u = new URL(civitaiCalls(spy)[0].url);
    expect(u.searchParams.get('sort')).toBe('Most Downloaded');
    expect(u.searchParams.getAll('baseModels')).toEqual(
      expect.arrayContaining(['Qwen', 'ZImageTurbo', 'Flux.1 D', 'Wan Video 2.2 T2V-A14B', 'LTXV 2.3', 'LTXV2']),
    );
  });

  it('sans recherche : pas de paramètre query', async () => {
    const spy = stubCivitai(() => json({ items: [] }));
    const me = await signup();
    // Curseur unique pour éviter le cache.
    await me.get(`/civitai/search?family=${encodeURIComponent(FLUX_LORA)}&query=%20%20&cursor=${uniqueQuery()}`);
    const u = new URL(civitaiCalls(spy)[0].url);
    expect(u.searchParams.has('query')).toBe(false);
    expect(u.searchParams.getAll('baseModels')).toEqual(['Flux.1 D']);
  });

  it('envoie la clé Civitai quand elle est configurée', async () => {
    env.CIVITAI_KEY = 'cle-civitai-test';
    const spy = stubCivitai(() => json({ items: [] }));
    const me = await signup();
    await me.get(`/civitai/search?query=${uniqueQuery()}`);
    const { init } = civitaiCalls(spy)[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer cle-civitai-test');
  });

  it('famille sans LoRA Civitai : liste vide, sans appel', async () => {
    const spy = stubCivitai(() => json(PAYLOAD));
    const me = await signup();
    for (const family of ['bytedance/seedream-5.0-flash', 'acme/inconnu']) {
      const res = await me.get(`/civitai/search?family=${encodeURIComponent(family)}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
    }
    expect(civitaiCalls(spy)).toHaveLength(0);
  });

  it('garde une recherche en cache (un seul appel Civitai)', async () => {
    const spy = stubCivitai(() => json(PAYLOAD));
    const me = await signup();
    const q = uniqueQuery();
    const a = await me.get(`/civitai/search?query=${q}`);
    const b = await me.get(`/civitai/search?query=${q}`);
    expect(b.body).toEqual(a.body);
    expect(civitaiCalls(spy)).toHaveLength(1);
  });

  it.each([
    ['recherche trop longue', `query=${'a'.repeat(101)}`],
    ['tri inconnu', 'sort=Random'],
    ['nsfw invalide', 'nsfw=oui'],
    ['curseur trop long', `cursor=${'c'.repeat(201)}`],
  ])('400 de validation : %s', async (_label, qs) => {
    const spy = stubCivitai(() => json(PAYLOAD));
    const me = await signup();
    const res = await me.get(`/civitai/search?${qs}`);
    expect(res.status).toBe(400);
    expect(civitaiCalls(spy)).toHaveLength(0);
  });

  it('502 quand Civitai est injoignable', async () => {
    stubCivitai(() => {
      throw new TypeError('fetch failed');
    });
    const me = await signup();
    const res = await me.get(`/civitai/search?query=${uniqueQuery()}`);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Civitai est injoignable pour le moment.');
  });

  it('502 quand Civitai répond une erreur', async () => {
    stubCivitai(() => json({ error: 'boom' }, 503));
    const me = await signup();
    const res = await me.get(`/civitai/search?query=${uniqueQuery()}`);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Civitai a répondu 503.');
  });

  it('une erreur Civitai n’est pas gardée en cache', async () => {
    let fail = true;
    const spy = stubCivitai(() => (fail ? json({}, 500) : json(PAYLOAD)));
    const me = await signup();
    const q = uniqueQuery();
    expect((await me.get(`/civitai/search?query=${q}`)).status).toBe(502);
    fail = false;
    expect((await me.get(`/civitai/search?query=${q}`)).status).toBe(200);
    expect(civitaiCalls(spy)).toHaveLength(2);
  });
});

// ── Liens de téléchargement résolus au lancement ───────────────

describe('LoRA Civitai dans une génération', () => {
  let downloadUrl: string;
  beforeEach(() => {
    // Lien unique : le service garde 10 min en cache chaque lien résolu.
    downloadUrl = `https://civitai.com/api/download/models/${Math.floor(Math.random() * 1e9)}`;
  });

  async function personaWithCivitaiLora() {
    const me = await signup();
    const persona = await me.createPersona({
      name: 'Léa',
      loras: [{ label: 'Civitai', path: downloadUrl, family: Z_IMAGE_LORA, triggerWords: [] }] as any,
    });
    const genBody = {
      family: Z_IMAGE_LORA,
      prompt: 'un portrait',
      personaId: persona.id,
      loraIds: [persona.loras[0].id],
    };
    return { me, genBody };
  }

  it('le devis ne contacte pas Civitai', async () => {
    const spy = stubCivitai(() => new Response(null, { status: 302, headers: { location: 'https://signed.example/x' } }));
    const { me, genBody } = await personaWithCivitaiLora();
    const res = await me.post('/generations/quote', genBody);
    expect(res.status).toBe(200);
    expect(res.body.quote.lorasApplied).toBe(1);
    expect(civitaiCalls(spy)).toHaveLength(0);
  });

  it('la création envoie à SpicyAPI le lien signé vers lequel Civitai redirige', async () => {
    env.CIVITAI_KEY = 'cle-civitai-test';
    const signed = 'https://b2.civitai-cdn.example/lora.safetensors?sig=abc';
    const spy = stubCivitai(() => new Response(null, { status: 307, headers: { location: signed } }));
    const create = vi.spyOn(client, 'createTask');
    const { me, genBody } = await personaWithCivitaiLora();
    const res = await me.post('/generations', genBody);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [head] = civitaiCalls(spy);
    expect(head.url).toBe(downloadUrl);
    expect(head.init).toMatchObject({ method: 'HEAD', redirect: 'manual' });
    expect((head.init?.headers as Record<string, string>).Authorization).toBe('Bearer cle-civitai-test');
    const input = (create.mock.calls[0][0] as { input: Record<string, unknown> }).input;
    expect(input.loras).toEqual([{ path: signed, scale: 1 }]);
    // La clé Civitai n'est jamais transmise à SpicyAPI.
    expect(JSON.stringify(create.mock.calls)).not.toContain('cle-civitai-test');
  });

  it('lien accessible sans redirection : envoyé tel quel', async () => {
    stubCivitai(() => new Response(null, { status: 200 }));
    const create = vi.spyOn(client, 'createTask');
    const { me, genBody } = await personaWithCivitaiLora();
    expect((await me.post('/generations', genBody)).status).toBe(201);
    const input = (create.mock.calls[0][0] as { input: Record<string, unknown> }).input;
    expect(input.loras).toEqual([{ path: downloadUrl, scale: 1 }]);
  });

  it('400 quand Civitai demande une clé absente', async () => {
    stubCivitai(() => new Response(null, { status: 401 }));
    const create = vi.spyOn(client, 'createTask');
    const { me, genBody } = await personaWithCivitaiLora();
    const res = await me.post('/generations', genBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Cette LoRA Civitai demande une clé : ajoute CIVITAI_KEY dans backend/.env.');
    expect(create).not.toHaveBeenCalled();
  });

  it('400 quand Civitai refuse malgré la clé (accès anticipé)', async () => {
    env.CIVITAI_KEY = 'cle-civitai-test';
    stubCivitai(() => new Response(null, { status: 403 }));
    const { me, genBody } = await personaWithCivitaiLora();
    const res = await me.post('/generations', genBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Civitai refuse le téléchargement de cette LoRA (accès anticipé ou payant).');
  });

  it('400 quand la LoRA Civitai est introuvable', async () => {
    stubCivitai(() => new Response(null, { status: 404 }));
    const { me, genBody } = await personaWithCivitaiLora();
    const res = await me.post('/generations', genBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LoRA Civitai introuvable (404).');
  });

  it('502 quand Civitai est injoignable', async () => {
    stubCivitai(() => {
      throw new TypeError('fetch failed');
    });
    const { me, genBody } = await personaWithCivitaiLora();
    const res = await me.post('/generations', genBody);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Civitai est injoignable : impossible de récupérer la LoRA.');
  });
});
