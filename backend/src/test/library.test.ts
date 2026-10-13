/**
 * Librairies de photos (Unsplash, Pexels) : état, recherche (cache en base,
 * quota) et import d'une photo comme asset. fetch est remplacé : aucun appel
 * réel à unsplash.com ni à pexels.com.
 */
import { existsSync } from 'node:fs';
import { eq, like } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/index.js';
import { assets, libraryCache } from '../db/schema.js';
import { env } from '../env.js';
import { resetPexels } from '../services/pexels.service.js';
import { resetUnsplash } from '../services/unsplash.service.js';
import { FIXTURE_PNG, call, signup } from './helpers.js';

const realFetch = globalThis.fetch;
type Handler = (url: URL) => Response | Promise<Response>;

const isSource = (u: URL) => u.hostname.endsWith('unsplash.com') || u.hostname.endsWith('pexels.com');

/** Remplace fetch pour les hôtes Unsplash et Pexels (API et CDN d'images). */
function stubUnsplash(handler: Handler) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (isSource(url)) return handler(url);
    return realFetch(input, init);
  });
}
const stubPexels = stubUnsplash;

const calls = (spy: ReturnType<typeof stubUnsplash>) =>
  spy.mock.calls.map(c => new URL(String(c[0] instanceof URL ? c[0].href : c[0]))).filter(isSource);

const json = (data: unknown, status = 200, remaining = '42') =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Ratelimit-Remaining': remaining },
  });

const photo = (id: string) => ({
  id,
  width: 4000,
  height: 6000,
  color: '#a0b0c0',
  description: null,
  alt_description: `  Photo ${id}  `,
  urls: { raw: `https://images.unsplash.com/photo-${id}?ixid=abc`, small: `https://images.unsplash.com/photo-${id}?ixid=abc&w=400` },
  links: { html: `https://unsplash.com/photos/${id}`, download_location: `https://api.unsplash.com/photos/${id}/download?ixid=abc` },
  user: { name: 'Ada', username: 'ada', links: { html: 'https://unsplash.com/@ada' } },
});

beforeEach(() => {
  resetUnsplash();
  resetPexels();
  env.UNSPLASH_ACCESS_KEY = 'cle-unsplash-test';
  env.PEXELS_API_KEY = 'cle-pexels-test';
});

afterEach(() => {
  vi.restoreAllMocks();
  env.UNSPLASH_ACCESS_KEY = '';
  env.PEXELS_API_KEY = '';
});

describe('GET /library/status', () => {
  it('refuse sans session (401)', async () => {
    expect((await call('GET', '/library/status')).status).toBe(401);
  });

  it('suit la présence de chaque clé', async () => {
    const me = await signup();
    expect((await me.get('/library/status')).body).toEqual({ unsplash: true, pexels: true });
    env.UNSPLASH_ACCESS_KEY = '';
    expect((await me.get('/library/status')).body).toEqual({ unsplash: false, pexels: true });
  });

  it('refuse une source inconnue', async () => {
    expect((await (await signup()).get('/library/getty/search')).status).toBe(400);
  });
});

describe('GET /library/unsplash/search', () => {
  it('sans clé : refus clair, aucun appel', async () => {
    env.UNSPLASH_ACCESS_KEY = '';
    const spy = stubUnsplash(() => json([]));
    const res = await (await signup()).get('/library/unsplash/search');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('UNSPLASH_ACCESS_KEY');
    expect(calls(spy)).toHaveLength(0);
  });

  it('sans recherche : photos populaires, avec la clé et l’attribution @smoke', async () => {
    const spy = stubUnsplash(() => json(Array.from({ length: 30 }, (_, i) => photo(`p${i}`))));
    const res = await (await signup()).get('/library/unsplash/search');
    expect(res.status).toBe(200);
    expect(res.body.nextPage).toBe(2);
    expect(res.body.items[0]).toEqual({
      id: 'p0',
      description: 'Photo p0',
      width: 4000,
      height: 6000,
      color: '#a0b0c0',
      thumbUrl: 'https://images.unsplash.com/photo-p0?ixid=abc&w=400',
      pageUrl: 'https://unsplash.com/photos/p0?utm_source=ai_fluence&utm_medium=referral',
      author: { name: 'Ada', username: 'ada', profileUrl: 'https://unsplash.com/@ada?utm_source=ai_fluence&utm_medium=referral' },
    });
    const [url] = calls(spy);
    expect(url.pathname).toBe('/photos');
    expect(url.searchParams.get('order_by')).toBe('popular');
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Client-ID cle-unsplash-test');
  });

  it('recherche : contenu filtré, dernière page sans suite', async () => {
    const spy = stubUnsplash(() => json({ results: [photo('a')], total_pages: 2 }));
    const res = await (await signup()).get('/library/unsplash/search?query=gym&page=2');
    expect(res.body.nextPage).toBeNull();
    const [url] = calls(spy);
    expect(url.pathname).toBe('/search/photos');
    expect(url.searchParams.get('query')).toBe('gym');
    expect(url.searchParams.get('content_filter')).toBe('high');
  });

  it('réponse gardée en cache : un seul appel pour deux recherches identiques', async () => {
    const spy = stubUnsplash(() => json({ results: [photo('a')], total_pages: 1 }));
    const me = await signup();
    await me.get('/library/unsplash/search?query=cafe');
    await me.get('/library/unsplash/search?query=cafe');
    expect(calls(spy)).toHaveLength(1);
  });

  it('cache en base : gardé au redémarrage du serveur, partagé entre utilisateurs', async () => {
    const spy = stubUnsplash(() => json({ results: [photo('a')], total_pages: 1 }));
    await (await signup()).get('/library/unsplash/search?query=Gym%20 ');
    resetUnsplash(); // mémoire du serveur perdue
    const res = await (await signup({ email: 'b@test.fr' })).get('/library/unsplash/search?query=gym');
    expect(res.body.items).toHaveLength(1);
    expect(calls(spy)).toHaveLength(1);
  });

  it('au-delà de 24 h : rappel ; Unsplash en panne : la dernière réponse est servie', async () => {
    let down = false;
    const spy = stubUnsplash(() => (down ? json({ errors: ['x'] }, 500) : json({ results: [photo('a')], total_pages: 1 })));
    const me = await signup();
    await me.get('/library/unsplash/search?query=plage');
    await db.update(libraryCache).set({ fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    down = true;
    const res = await me.get('/library/unsplash/search?query=plage');
    expect(res.status).toBe(200);
    expect(res.body.items[0].id).toBe('a');
    expect(calls(spy)).toHaveLength(2);
  });

  it('quota épuisé : plus aucun appel, message clair (429)', async () => {
    const spy = stubUnsplash(() => json({ results: [photo('a')], total_pages: 1 }, 200, '0'));
    const me = await signup();
    expect((await me.get('/library/unsplash/search?query=un')).status).toBe(200);
    const res = await me.get('/library/unsplash/search?query=deux');
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Quota Unsplash');
    expect(calls(spy)).toHaveLength(1);
  });
});

describe('POST /library/unsplash/import', () => {
  const cdn = () => new Response(FIXTURE_PNG as BodyInit, { headers: { 'Content-Type': 'image/jpeg' } });

  it('importe une photo vue : téléchargement signalé, asset créé', async () => {
    const spy = stubUnsplash(url => {
      if (url.hostname === 'images.unsplash.com') return cdn();
      if (url.pathname.endsWith('/download')) return json({ url: 'x' });
      return json({ results: [photo('a')], total_pages: 1 });
    });
    const me = await signup();
    await me.get('/library/unsplash/search?query=rue');
    const res = await me.post('/library/unsplash/import', { photoId: 'a' });
    expect(res.status).toBe(201);
    expect(res.body.asset).toMatchObject({ kind: 'upload', mediaType: 'image', mime: 'image/jpeg' });

    const paths = calls(spy).map(u => `${u.hostname}${u.pathname}`);
    // Pas de nouvel appel pour lire la photo : ses liens viennent de la recherche.
    expect(paths).toEqual(['api.unsplash.com/search/photos', 'images.unsplash.com/photo-a', 'api.unsplash.com/photos/a/download']);
    const image = calls(spy)[1];
    expect(image.searchParams.get('w')).toBe('2048');
    expect(image.searchParams.get('ixid')).toBe('abc');

    const [row] = await db.select().from(assets).where(eq(assets.id, res.body.asset.id));
    expect(row.userId).toBe(me.user.id);
    expect(existsSync(row.filePath)).toBe(true);
  });

  it('photo jamais vue : lue sur l’API avant l’import', async () => {
    const spy = stubUnsplash(url => {
      if (url.hostname === 'images.unsplash.com') return cdn();
      if (url.pathname.endsWith('/download')) return json({ url: 'x' });
      return json(photo('b'));
    });
    const res = await (await signup()).post('/library/unsplash/import', { photoId: 'b' });
    expect(res.status).toBe(201);
    expect(calls(spy).map(u => u.pathname)[0]).toBe('/photos/b');
  });

  it('quota épuisé : l’import passe, le signalement est renvoyé après le prochain import', async () => {
    let quota = '0';
    const spy = stubUnsplash(url => {
      if (url.hostname === 'images.unsplash.com') return cdn();
      if (url.pathname.endsWith('/download')) return json({ url: 'x' }, 200, quota);
      return json({ results: [photo('a'), photo('b')], total_pages: 1 }, 200, quota);
    });
    const me = await signup();
    await me.get('/library/unsplash/search?query=cafe'); // quota à 0 après cet appel
    expect((await me.post('/library/unsplash/import', { photoId: 'a' })).status).toBe(201);
    expect(calls(spy).some(u => u.pathname === '/photos/a/download')).toBe(false);
    expect(await db.select().from(libraryCache).where(like(libraryCache.key, 'unsplash track:%'))).toHaveLength(1);

    resetUnsplash(); // heure suivante
    quota = '40';
    expect((await me.post('/library/unsplash/import', { photoId: 'b' })).status).toBe(201);
    const downloads = calls(spy).filter(u => u.pathname.endsWith('/download')).map(u => u.pathname);
    expect(downloads).toEqual(['/photos/b/download', '/photos/a/download']);
    expect(await db.select().from(libraryCache).where(like(libraryCache.key, 'unsplash track:%'))).toHaveLength(0);
  });

  it('refuse un identifiant invalide', async () => {
    const spy = stubUnsplash(() => json({}));
    const res = await (await signup()).post('/library/unsplash/import', { photoId: '../../me' });
    expect(res.status).toBe(400);
    expect(calls(spy)).toHaveLength(0);
  });
});

// ── Pexels ────────────────────────────────────────────────────

const pexelsPhoto = (id: number) => ({
  id,
  width: 3000,
  height: 2000,
  url: `https://www.pexels.com/photo/plage-${id}/`,
  photographer: 'Kelly Doe',
  photographer_url: 'https://www.pexels.com/@kelly-doe',
  avg_color: '#334455',
  alt: 'Une plage',
  src: { original: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg` },
});

const pexelsJson = (data: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('Pexels', () => {
  it('sans recherche : la sélection du jour, clé envoyée telle quelle, attribution', async () => {
    const spy = stubPexels(() => pexelsJson({ photos: [pexelsPhoto(7)], next_page: 'https://api.pexels.com/v1/curated?page=2' }));
    const res = await (await signup()).get('/library/pexels/search');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          id: '7',
          description: 'Une plage',
          width: 3000,
          height: 2000,
          color: '#334455',
          thumbUrl: 'https://images.pexels.com/photos/7/pexels-photo-7.jpeg?auto=compress&cs=tinysrgb&w=600',
          pageUrl: 'https://www.pexels.com/photo/plage-7/',
          author: { name: 'Kelly Doe', username: 'kelly-doe', profileUrl: 'https://www.pexels.com/@kelly-doe' },
        },
      ],
      nextPage: 2,
    });
    const [url] = calls(spy);
    expect(url.pathname).toBe('/v1/curated');
    expect((spy.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('cle-pexels-test');
  });

  it('recherche normalisée, gardée en cache', async () => {
    const spy = stubPexels(() => pexelsJson({ photos: [pexelsPhoto(7)] }));
    const me = await signup();
    expect((await me.get('/library/pexels/search?query=%20Sport%20')).body.nextPage).toBeNull();
    await me.get('/library/pexels/search?query=sport');
    expect(calls(spy)).toHaveLength(1);
    expect(calls(spy)[0].searchParams.get('query')).toBe('sport');
  });

  it('quota du mois épuisé : plus aucun appel jusqu’à sa remise à zéro', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 3 * 24 * 3600);
    const spy = stubPexels(() => pexelsJson({ photos: [] }, { 'X-Ratelimit-Remaining': '0', 'X-Ratelimit-Reset': reset }));
    const me = await signup();
    await me.get('/library/pexels/search?query=un');
    const res = await me.get('/library/pexels/search?query=deux');
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Quota Pexels atteint : réessaie dans \d+ h/);
    expect(calls(spy)).toHaveLength(1);
  });

  it('importe une photo vue en 2048 px, sans rappeler l’API', async () => {
    const spy = stubPexels(url =>
      url.hostname === 'images.pexels.com'
        ? new Response(FIXTURE_PNG as BodyInit, { headers: { 'Content-Type': 'image/png' } })
        : pexelsJson({ photos: [pexelsPhoto(7)] }),
    );
    const me = await signup();
    await me.get('/library/pexels/search?query=plage');
    const res = await me.post('/library/pexels/import', { photoId: '7' });
    expect(res.status).toBe(201);
    expect(res.body.asset).toMatchObject({ kind: 'upload', mime: 'image/png' });
    const urls = calls(spy);
    expect(urls.map(u => u.hostname)).toEqual(['api.pexels.com', 'images.pexels.com']);
    expect(urls[1].searchParams.get('w')).toBe('2048');
  });

  it('refuse un fichier qui n’est pas une image', async () => {
    stubPexels(url =>
      url.hostname === 'images.pexels.com'
        ? new Response('<html>', { headers: { 'Content-Type': 'text/html' } })
        : pexelsJson(pexelsPhoto(9)),
    );
    const res = await (await signup()).post('/library/pexels/import', { photoId: '9' });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('Format d’image Pexels inattendu');
  });
});
