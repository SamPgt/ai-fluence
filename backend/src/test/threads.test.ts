/**
 * Fils de discussion : liste, recherche, détail, renommage, épinglage et mise à la corbeille.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Thread } from '@ai-fluence/shared';
import app from '../app.js';
import { db } from '../db/index.js';
import { threads } from '../db/schema.js';
import { call, signup, type Agent } from './helpers.js';

/** Crée un fil vide directement en base (plus rapide qu'une génération). */
async function insertThread(owner: Agent, data: Partial<typeof threads.$inferInsert> = {}) {
  const [row] = await db
    .insert(threads)
    .values({ userId: owner.user.id, title: 'Fil de test', ...data })
    .returning();
  return row;
}

async function setUpdatedAt(id: string, date: Date) {
  await db.update(threads).set({ updatedAt: date }).where(eq(threads.id, id));
}

const ids = (list: { id: string }[]) => list.map(t => t.id);

describe('authentification', () => {
  it('toutes les routes des fils exigent une session', async () => {
    const id = randomUUID();
    expect((await call('GET', '/threads')).status).toBe(401);
    expect((await call('GET', '/threads/search?q=a')).status).toBe(401);
    expect((await call('GET', `/threads/${id}`)).status).toBe(401);
    expect((await call('PATCH', `/threads/${id}`, { title: 'x' })).status).toBe(401);
    expect((await call('DELETE', `/threads/${id}`)).status).toBe(401);
  });
});

describe('GET /threads', () => {
  it('renvoie une liste vide pour un nouvel utilisateur', async () => {
    const me = await signup();
    const res = await me.get('/threads');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ threads: [] });
  });

  it('crée un fil à la première génération avec le prompt comme titre, le coût et la couverture', async () => {
    const me = await signup();
    const { generation, thread } = await me.generate({ prompt: 'un chat sur un toit' });
    const res = await me.get('/threads');
    expect(res.status).toBe(200);
    expect(res.body.threads).toHaveLength(1);
    const t: Thread = res.body.threads[0];
    expect(t.id).toBe(thread.id);
    expect(t.title).toBe('un chat sur un toit');
    expect(t.personaId).toBeNull();
    expect(t.isPinned).toBe(false);
    expect(t.generationCount).toBe(1);
    expect(Number(t.totalCost)).toBeCloseTo(0.01);
    expect(t.coverUrl).toBe(generation.outputs[0].url);
    expect(t.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(t.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('additionne le coût et compte les générations du même fil', async () => {
    const me = await signup();
    const { thread } = await me.generate();
    const second = await me.generate({ threadId: thread.id, prompt: 'deuxième essai' });
    expect(second.thread.id).toBe(thread.id);
    const t: Thread = (await me.get('/threads')).body.threads[0];
    expect(t.generationCount).toBe(2);
    expect(Number(t.totalCost)).toBeCloseTo(0.02);
    expect(t.coverUrl).toBe(second.generation.outputs[0].url);
  });

  it('un fil sans génération a un coût nul et pas de couverture', async () => {
    const me = await signup();
    await insertThread(me);
    const t: Thread = (await me.get('/threads')).body.threads[0];
    expect(t.totalCost).toBe('0');
    expect(t.generationCount).toBe(0);
    expect(t.coverUrl).toBeNull();
  });

  it('trie les fils épinglés en premier, puis du plus récent au plus ancien', async () => {
    const me = await signup();
    const old = await insertThread(me, { title: 'ancien' });
    const recent = await insertThread(me, { title: 'récent' });
    const pinnedOld = await insertThread(me, { title: 'épinglé ancien', isPinned: true });
    const pinnedRecent = await insertThread(me, { title: 'épinglé récent', isPinned: true });
    await setUpdatedAt(old.id, new Date('2026-01-01T00:00:00Z'));
    await setUpdatedAt(recent.id, new Date('2026-03-01T00:00:00Z'));
    await setUpdatedAt(pinnedOld.id, new Date('2025-01-01T00:00:00Z'));
    await setUpdatedAt(pinnedRecent.id, new Date('2025-06-01T00:00:00Z'));
    const res = await me.get('/threads');
    expect(ids(res.body.threads)).toEqual([pinnedRecent.id, pinnedOld.id, recent.id, old.id]);
  });

  it('une nouvelle génération fait remonter son fil en tête', async () => {
    const me = await signup();
    const a = await me.generate({ prompt: 'premier fil' });
    const b = await me.generate({ prompt: 'second fil' });
    expect(ids((await me.get('/threads')).body.threads)).toEqual([b.thread.id, a.thread.id]);
    await me.generate({ threadId: a.thread.id });
    expect(ids((await me.get('/threads')).body.threads)).toEqual([a.thread.id, b.thread.id]);
  });

  it('filtre par persona, et « none » donne les fils sans persona', async () => {
    const me = await signup();
    const p1 = await me.createPersona({ name: 'Alice' });
    const p2 = await me.createPersona({ name: 'Bob' });
    const t1 = await insertThread(me, { personaId: p1.id });
    const t2 = await insertThread(me, { personaId: p2.id });
    const t0 = await insertThread(me);
    expect(ids((await me.get(`/threads?personaId=${p1.id}`)).body.threads)).toEqual([t1.id]);
    expect(ids((await me.get(`/threads?personaId=${p2.id}`)).body.threads)).toEqual([t2.id]);
    expect(ids((await me.get('/threads?personaId=none')).body.threads)).toEqual([t0.id]);
    expect((await me.get('/threads')).body.threads).toHaveLength(3);
  });

  it('une génération avec un persona range le fil sous ce persona', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Chloé' });
    const { thread } = await me.generate({ personaId: p.id });
    expect(ids((await me.get(`/threads?personaId=${p.id}`)).body.threads)).toEqual([thread.id]);
    expect((await me.get('/threads?personaId=none')).body.threads).toEqual([]);
  });

  it('un persona inconnu donne une liste vide', async () => {
    const me = await signup();
    await insertThread(me);
    const res = await me.get(`/threads?personaId=${randomUUID()}`);
    expect(res.status).toBe(200);
    expect(res.body.threads).toEqual([]);
  });

  // Ancien bug (corrigé) : `personaId` n'est validé que comme une chaîne. Une valeur qui n'est
  // ni un UUID ni « none » part telle quelle dans Postgres et provoque une erreur 500.
  it('refuse un personaId qui n’est pas un UUID par une erreur 400', async () => {
    const me = await signup();
    const res = await me.get('/threads?personaId=pas-un-uuid');
    expect(res.status).toBe(400);
  });

  it('n’affiche ni les fils des autres utilisateurs ni les fils à la corbeille', async () => {
    const me = await signup();
    const other = await signup();
    const mine = await insertThread(me);
    await insertThread(me, { deletedAt: new Date() });
    await insertThread(other);
    expect(ids((await me.get('/threads')).body.threads)).toEqual([mine.id]);
  });

  it('limite la liste à 200 fils', async () => {
    const me = await signup();
    await db.insert(threads).values(Array.from({ length: 205 }, (_, i) => ({ userId: me.user.id, title: `fil ${i}` })));
    expect((await me.get('/threads')).body.threads).toHaveLength(200);
  });
});

describe('GET /threads/search', () => {
  it('trouve un fil par son titre, sans tenir compte de la casse', async () => {
    const me = await signup();
    const t = await insertThread(me, { title: 'Plage au coucher du soleil' });
    await insertThread(me, { title: 'Montagne' });
    const res = await me.get('/threads/search?q=PLAGE');
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([{ threadId: t.id, threadTitle: 'Plage au coucher du soleil', matchedPrompt: null }]);
  });

  it('trouve un fil par le prompt d’une de ses générations', async () => {
    const me = await signup();
    const { thread } = await me.generate({ prompt: 'un dragon violet' });
    await me.patch(`/threads/${thread.id}`, { title: 'Sans rapport' });
    const res = await me.get('/threads/search?q=dragon');
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([{ threadId: thread.id, threadTitle: 'Sans rapport', matchedPrompt: 'un dragon violet' }]);
  });

  it('ne renvoie qu’un résultat par fil même si plusieurs prompts correspondent', async () => {
    const me = await signup();
    const { thread } = await me.generate({ prompt: 'chien noir' });
    await me.generate({ threadId: thread.id, prompt: 'chien blanc' });
    const res = await me.get('/threads/search?q=chien');
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].threadId).toBe(thread.id);
    expect(['chien noir', 'chien blanc']).toContain(res.body.results[0].matchedPrompt);
  });

  it('trie les résultats du plus récent au plus ancien', async () => {
    const me = await signup();
    const a = await insertThread(me, { title: 'forêt A' });
    const b = await insertThread(me, { title: 'forêt B' });
    const c = await insertThread(me, { title: 'forêt C' });
    await setUpdatedAt(a.id, new Date('2026-02-01T00:00:00Z'));
    await setUpdatedAt(b.id, new Date('2026-03-01T00:00:00Z'));
    await setUpdatedAt(c.id, new Date('2026-01-01T00:00:00Z'));
    const res = await me.get('/threads/search?q=for%C3%AAt');
    expect(res.body.results.map((r: { threadId: string }) => r.threadId)).toEqual([b.id, a.id, c.id]);
  });

  it('traite % et _ comme des caractères ordinaires', async () => {
    const me = await signup();
    const pct = await insertThread(me, { title: 'remise 50% ce soir' });
    const und = await insertThread(me, { title: 'fichier_final' });
    await insertThread(me, { title: 'rien de spécial' });
    await insertThread(me, { title: 'fichierXfinal' });
    const byPct = await me.get('/threads/search?q=%25');
    expect(byPct.body.results.map((r: { threadId: string }) => r.threadId)).toEqual([pct.id]);
    const byUnd = await me.get('/threads/search?q=_');
    expect(byUnd.body.results.map((r: { threadId: string }) => r.threadId)).toEqual([und.id]);
  });

  it('ignore les fils des autres utilisateurs et les fils à la corbeille', async () => {
    const me = await signup();
    const other = await signup();
    const mine = await insertThread(me, { title: 'licorne' });
    await insertThread(me, { title: 'licorne supprimée', deletedAt: new Date() });
    await insertThread(other, { title: 'licorne de l’autre' });
    const res = await me.get('/threads/search?q=licorne');
    expect(res.body.results.map((r: { threadId: string }) => r.threadId)).toEqual([mine.id]);
  });

  it('renvoie une liste vide quand rien ne correspond', async () => {
    const me = await signup();
    await insertThread(me, { title: 'abc' });
    const res = await me.get('/threads/search?q=zzz');
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('refuse une recherche absente, vide ou faite d’espaces par une erreur 400', async () => {
    const me = await signup();
    expect((await me.get('/threads/search')).status).toBe(400);
    expect((await me.get('/threads/search?q=')).status).toBe(400);
    expect((await me.get('/threads/search?q=%20%20')).status).toBe(400);
  });

  it('refuse une recherche de plus de 200 caractères par une erreur 400', async () => {
    const me = await signup();
    expect((await me.get(`/threads/search?q=${'a'.repeat(201)}`)).status).toBe(400);
    expect((await me.get(`/threads/search?q=${'a'.repeat(200)}`)).status).toBe(200);
  });

  it('limite la recherche à 30 résultats', async () => {
    const me = await signup();
    await db.insert(threads).values(Array.from({ length: 35 }, (_, i) => ({ userId: me.user.id, title: `océan ${i}` })));
    expect((await me.get('/threads/search?q=oc%C3%A9an')).body.results).toHaveLength(30);
  });

  // Ancien bug (corrigé) : la limite de 30 est appliquée après un tri par identifiant de fil, et le
  // tri par date n'est fait qu'ensuite. Au-delà de 30 fils trouvés, on obtient donc
  // 30 fils pris au hasard au lieu des 30 plus récents.
  it('au-delà de 30 fils trouvés, garde les 30 plus récents', async () => {
    const me = await signup();
    const rows = await db
      .insert(threads)
      .values(Array.from({ length: 40 }, (_, i) => ({ userId: me.user.id, title: `désert ${i}` })))
      .returning();
    for (const [i, row] of rows.entries()) await setUpdatedAt(row.id, new Date(Date.UTC(2026, 0, 1 + i)));
    const expected = rows.slice(10).map(r => r.id).reverse();
    const res = await me.get('/threads/search?q=d%C3%A9sert');
    expect(res.body.results.map((r: { threadId: string }) => r.threadId)).toEqual(expected);
  });
});

describe('GET /threads/:id', () => {
  it('renvoie le fil et ses générations de la plus ancienne à la plus récente', async () => {
    const me = await signup();
    const first = await me.generate({ prompt: 'première' });
    const second = await me.generate({ threadId: first.thread.id, prompt: 'deuxième' });
    const third = await me.generate({ threadId: first.thread.id, prompt: 'troisième' });
    const res = await me.get(`/threads/${first.thread.id}`);
    expect(res.status).toBe(200);
    expect(res.body.thread.id).toBe(first.thread.id);
    expect(res.body.thread.generationCount).toBe(3);
    expect(Number(res.body.thread.totalCost)).toBeCloseTo(0.03);
    expect(res.body.generations.map((g: { id: string }) => g.id)).toEqual([
      first.generation.id,
      second.generation.id,
      third.generation.id,
    ]);
    const g = res.body.generations[0];
    expect(g.prompt).toBe('première');
    expect(g.status).toBe('succeeded');
    expect(g.threadId).toBe(first.thread.id);
    expect(g.outputs).toHaveLength(1);
    expect(g.outputs[0].url).toMatch(/^\/api\/media\//);
  });

  it('renvoie un fil vide sans génération', async () => {
    const me = await signup();
    const t = await insertThread(me, { title: 'vide' });
    const res = await me.get(`/threads/${t.id}`);
    expect(res.status).toBe(200);
    expect(res.body.thread).toMatchObject({ id: t.id, title: 'vide', generationCount: 0, totalCost: '0', coverUrl: null });
    expect(res.body.generations).toEqual([]);
  });

  it('répond 404 pour un fil inconnu', async () => {
    const me = await signup();
    const res = await me.get(`/threads/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Fil introuvable.');
  });

  it('répond 404 pour le fil d’un autre utilisateur', async () => {
    const me = await signup();
    const other = await signup();
    const t = await insertThread(other);
    expect((await me.get(`/threads/${t.id}`)).status).toBe(404);
  });

  it('répond 404 pour un fil à la corbeille', async () => {
    const me = await signup();
    const t = await insertThread(me, { deletedAt: new Date() });
    expect((await me.get(`/threads/${t.id}`)).status).toBe(404);
  });

  it('répond 404 pour un identifiant qui n’est pas un UUID', async () => {
    const me = await signup();
    const res = await me.get('/threads/pas-un-uuid');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Introuvable.');
  });
});

describe('PATCH /threads/:id', () => {
  it('renomme un fil en retirant les espaces autour du titre', async () => {
    const me = await signup();
    const t = await insertThread(me, { title: 'avant' });
    const res = await me.patch(`/threads/${t.id}`, { title: '  après  ' });
    expect(res.status).toBe(200);
    expect(res.body.thread).toMatchObject({ id: t.id, title: 'après', isPinned: false });
    expect((await me.get(`/threads/${t.id}`)).body.thread.title).toBe('après');
  });

  it('accepte un titre de 120 caractères', async () => {
    const me = await signup();
    const t = await insertThread(me);
    const res = await me.patch(`/threads/${t.id}`, { title: 'a'.repeat(120) });
    expect(res.status).toBe(200);
    expect(res.body.thread.title).toHaveLength(120);
  });

  it('refuse un titre vide, fait d’espaces, trop long ou mal typé par une erreur 400', async () => {
    const me = await signup();
    const t = await insertThread(me, { title: 'inchangé' });
    for (const title of ['', '   ', 'a'.repeat(121), 42, null]) {
      expect((await me.patch(`/threads/${t.id}`, { title })).status, JSON.stringify(title)).toBe(400);
    }
    expect((await me.get(`/threads/${t.id}`)).body.thread.title).toBe('inchangé');
  });

  it('épingle puis désépingle un fil', async () => {
    const me = await signup();
    const a = await insertThread(me, { title: 'a' });
    const b = await insertThread(me, { title: 'b' });
    await setUpdatedAt(a.id, new Date('2026-01-01T00:00:00Z'));
    await setUpdatedAt(b.id, new Date('2026-02-01T00:00:00Z'));
    const pin = await me.patch(`/threads/${a.id}`, { isPinned: true });
    expect(pin.status).toBe(200);
    expect(pin.body.thread.isPinned).toBe(true);
    expect(pin.body.thread.title).toBe('a');
    expect(ids((await me.get('/threads')).body.threads)).toEqual([a.id, b.id]);
    const unpin = await me.patch(`/threads/${a.id}`, { isPinned: false });
    expect(unpin.body.thread.isPinned).toBe(false);
    expect(ids((await me.get('/threads')).body.threads)).toEqual([b.id, a.id]);
  });

  it('refuse un isPinned qui n’est pas un booléen par une erreur 400', async () => {
    const me = await signup();
    const t = await insertThread(me);
    expect((await me.patch(`/threads/${t.id}`, { isPinned: 'oui' })).status).toBe(400);
  });

  it('change le persona d’un fil, ou le retire avec null', async () => {
    const me = await signup();
    const p = await me.createPersona({ name: 'Dora' });
    const t = await insertThread(me);
    const set = await me.patch(`/threads/${t.id}`, { personaId: p.id });
    expect(set.status).toBe(200);
    expect(set.body.thread.personaId).toBe(p.id);
    expect(ids((await me.get(`/threads?personaId=${p.id}`)).body.threads)).toEqual([t.id]);
    const unset = await me.patch(`/threads/${t.id}`, { personaId: null });
    expect(unset.body.thread.personaId).toBeNull();
  });

  it('refuse un personaId qui n’est pas un UUID par une erreur 400', async () => {
    const me = await signup();
    const t = await insertThread(me);
    expect((await me.patch(`/threads/${t.id}`, { personaId: 'abc' })).status).toBe(400);
  });

  // Ancien bug (corrigé) : la propriété du persona n'est pas vérifiée. On peut ranger son fil sous
  // le persona d'un autre utilisateur. Le comportement attendu est un refus (404).
  it('refuse de ranger un fil sous le persona d’un autre utilisateur', async () => {
    const me = await signup();
    const other = await signup();
    const theirs = await other.createPersona({ name: 'Étrangère' });
    const t = await insertThread(me);
    const res = await me.patch(`/threads/${t.id}`, { personaId: theirs.id });
    expect(res.status).toBe(404);
  });

  // Même règle que pour le compte et les raccourcis : un corps vide ne change rien.
  it('accepte un corps sans aucun champ et renvoie le fil inchangé', async () => {
    const me = await signup();
    const t = await insertThread(me);
    const res = await me.patch(`/threads/${t.id}`, {});
    expect(res.status).toBe(200);
    expect(res.body.thread.id).toBe(t.id);
    expect(res.body.thread.title).toBe(t.title);
  });

  it('refuse un corps JSON mal formé par une erreur 400', async () => {
    const me = await signup();
    const t = await insertThread(me);
    const res = await app.fetch(
      new Request(`http://api.test/threads/${t.id}`, {
        method: 'PATCH',
        headers: { Cookie: me.cookie, 'Content-Type': 'application/json' },
        body: '{ pas du json',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('répond 404 pour un fil inconnu, d’un autre utilisateur ou à la corbeille', async () => {
    const me = await signup();
    const other = await signup();
    const theirs = await insertThread(other, { title: 'à eux' });
    const trashed = await insertThread(me, { deletedAt: new Date() });
    for (const id of [randomUUID(), theirs.id, trashed.id]) {
      const res = await me.patch(`/threads/${id}`, { title: 'piratage' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Fil introuvable.');
    }
    expect((await other.get(`/threads/${theirs.id}`)).body.thread.title).toBe('à eux');
  });

  it('répond 404 pour un identifiant qui n’est pas un UUID', async () => {
    const me = await signup();
    expect((await me.patch('/threads/123', { title: 'x' })).status).toBe(404);
  });
});

describe('DELETE /threads/:id', () => {
  it('met le fil à la corbeille : il disparaît de la liste, du détail et de la recherche', async () => {
    const me = await signup();
    const { thread } = await me.generate({ prompt: 'à supprimer' });
    const res = await me.del(`/threads/${thread.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await me.get('/threads')).body.threads).toEqual([]);
    expect((await me.get(`/threads/${thread.id}`)).status).toBe(404);
    expect((await me.get('/threads/search?q=supprimer')).body.results).toEqual([]);
    // Suppression douce : la ligne reste en base avec sa date de suppression.
    const [row] = await db.select().from(threads).where(eq(threads.id, thread.id));
    expect(row.deletedAt).toBeInstanceOf(Date);
  });

  it('le fil supprimé apparaît dans la corbeille', async () => {
    const me = await signup();
    const t = await insertThread(me, { title: 'en corbeille' });
    await me.del(`/threads/${t.id}`);
    const trash = await me.get('/trash');
    expect(trash.status).toBe(200);
    expect(trash.body.threads.map((x: { id: string }) => x.id)).toEqual([t.id]);
  });

  it('ses résultats disparaissent de la galerie', async () => {
    const me = await signup();
    const { thread } = await me.generate();
    expect((await me.get('/assets/gallery')).body.items).toHaveLength(1);
    await me.del(`/threads/${thread.id}`);
    expect((await me.get('/assets/gallery')).body.items).toEqual([]);
  });

  it('une génération dans un fil supprimé est refusée', async () => {
    const me = await signup();
    const t = await insertThread(me);
    await me.del(`/threads/${t.id}`);
    const res = await me.post('/generations', {
      family: 'bytedance/seedream-5.0-flash',
      prompt: 'x',
      params: {},
      referenceAssetIds: [],
      threadId: t.id,
    });
    expect(res.status).toBe(404);
  });

  it('répond 404 si le fil est déjà à la corbeille', async () => {
    const me = await signup();
    const t = await insertThread(me);
    expect((await me.del(`/threads/${t.id}`)).status).toBe(200);
    const again = await me.del(`/threads/${t.id}`);
    expect(again.status).toBe(404);
    expect(again.body.error).toBe('Fil introuvable.');
  });

  it('répond 404 pour un fil inconnu ou d’un autre utilisateur, sans le toucher', async () => {
    const me = await signup();
    const other = await signup();
    const theirs = await insertThread(other);
    expect((await me.del(`/threads/${randomUUID()}`)).status).toBe(404);
    expect((await me.del(`/threads/${theirs.id}`)).status).toBe(404);
    expect(ids((await other.get('/threads')).body.threads)).toEqual([theirs.id]);
  });

  it('répond 404 pour un identifiant qui n’est pas un UUID', async () => {
    const me = await signup();
    expect((await me.del('/threads/zzz')).status).toBe(404);
  });
});
