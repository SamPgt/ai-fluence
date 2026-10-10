import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import { SESSION_COOKIE } from '../lib/session.js';
import { PASSWORD, call, sessionCookie, signup } from './helpers.js';

const newEmail = () => `u-${Math.random().toString(36).slice(2, 10)}@test.local`;

/** Cookie de session posé par la réponse, avec ses attributs. */
function rawSessionCookie(headers: Headers): string | undefined {
  return headers.getSetCookie().find(c => c.startsWith(`${SESSION_COOKIE}=`));
}

describe('POST /auth/signup', () => {
  it('crée le compte, répond 201 et pose un cookie de session httpOnly', async () => {
    const email = newEmail();
    const res = await call('POST', '/auth/signup', { email, name: 'Alice', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, name: 'Alice', avatarUrl: null });
    expect(res.body.user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(res.body.user.createdAt).toString()).not.toBe('Invalid Date');
    // Aucune donnée sensible renvoyée.
    expect(Object.keys(res.body.user).sort()).toEqual(['avatarUrl', 'createdAt', 'email', 'id', 'name']);
    const raw = rawSessionCookie(res.headers);
    expect(raw).toBeTruthy();
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Path=\//);
    expect(raw).toMatch(/SameSite=Lax/i);
  });

  it('le cookie reçu ouvre une session valide', async () => {
    const res = await call('POST', '/auth/signup', { email: newEmail(), name: 'Bob', password: PASSWORD });
    const me = await call('GET', '/auth/me', undefined, sessionCookie(res));
    expect(me.body.user.id).toBe(res.body.user.id);
  });

  it("enregistre l'e-mail en minuscules", async () => {
    const res = await call('POST', '/auth/signup', { email: 'Alice.MAJ@Test.Local', name: 'Alice', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('alice.maj@test.local');
  });

  it('ne stocke jamais le mot de passe en clair', async () => {
    const res = await call('POST', '/auth/signup', { email: newEmail(), name: 'Alice', password: PASSWORD });
    const [row] = await db.select().from(users).where(eq(users.id, res.body.user.id));
    expect(row.passwordHash).not.toBe(PASSWORD);
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('crée les raccourcis par défaut du nouveau compte', async () => {
    const me = await signup();
    const res = await me.get('/presets');
    expect(res.status).toBe(200);
    expect(res.body.presets).toHaveLength(8);
    expect(res.body.presets.map((p: { label: string }) => p.label)).toContain('Photo iPhone');
    expect(res.body.presets.map((p: { position: number }) => p.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(res.body.presets.every((p: { enabled: boolean; personaId: string | null }) => p.enabled && p.personaId === null)).toBe(true);
  });

  it('refuse un e-mail déjà utilisé avec 409, sans tenir compte de la casse', async () => {
    const email = newEmail();
    expect((await call('POST', '/auth/signup', { email, name: 'A', password: PASSWORD })).status).toBe(201);
    const again = await call('POST', '/auth/signup', { email, name: 'B', password: PASSWORD });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/existe déjà/);
    const upper = await call('POST', '/auth/signup', { email: email.toUpperCase(), name: 'C', password: PASSWORD });
    expect(upper.status).toBe(409);
    expect(rawSessionCookie(upper.headers)).toBeUndefined();
  });

  it.each([
    ['un e-mail invalide', { email: 'pas-un-email', name: 'A', password: PASSWORD }],
    ['un e-mail absent', { name: 'A', password: PASSWORD }],
    ['un mot de passe de moins de 8 caractères', { email: 'court@test.local', name: 'A', password: '1234567' }],
    ['un mot de passe de plus de 200 caractères', { email: 'long@test.local', name: 'A', password: 'x'.repeat(201) }],
    ['un mot de passe absent', { email: 'absent@test.local', name: 'A' }],
    ['un nom vide', { email: 'vide@test.local', name: '', password: PASSWORD }],
    ['un nom fait seulement d’espaces', { email: 'espaces@test.local', name: '   ', password: PASSWORD }],
    ['un nom de plus de 60 caractères', { email: 'nom@test.local', name: 'n'.repeat(61), password: PASSWORD }],
  ])('refuse %s avec 400', async (_label, body) => {
    const res = await call('POST', '/auth/signup', body);
    expect(res.status).toBe(400);
    expect(rawSessionCookie(res.headers)).toBeUndefined();
    expect(await db.$count(users)).toBe(0);
  });

  it('refuse un corps absent avec 400', async () => {
    expect((await call('POST', '/auth/signup')).status).toBe(400);
  });
});

describe('POST /auth/login', () => {
  it('connecte avec le bon mot de passe et pose un nouveau cookie', async () => {
    const me = await signup();
    const res = await call('POST', '/auth/login', { email: me.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: me.user.id, email: me.email });
    const cookie = sessionCookie(res);
    expect(cookie).not.toBe(me.cookie);
    expect((await call('GET', '/auth/me', undefined, cookie)).body.user.id).toBe(me.user.id);
    // L'ancienne session reste valide (plusieurs appareils).
    expect((await me.get('/auth/me')).body.user.id).toBe(me.user.id);
    expect(await db.$count(sessions, eq(sessions.userId, me.user.id))).toBe(2);
  });

  it("accepte l'e-mail avec une casse différente", async () => {
    const me = await signup();
    const res = await call('POST', '/auth/login', { email: me.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(me.user.id);
  });

  it('refuse un mauvais mot de passe avec 401, sans cookie', async () => {
    const me = await signup();
    const res = await call('POST', '/auth/login', { email: me.email, password: 'mauvais-mot-de-passe' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect/);
    expect(rawSessionCookie(res.headers)).toBeUndefined();
  });

  it('refuse un e-mail inconnu avec 401 et le même message', async () => {
    await signup();
    const unknown = await call('POST', '/auth/login', { email: 'inconnu@test.local', password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toMatch(/incorrect/);
  });

  it.each([
    ['un e-mail invalide', { email: 'nope', password: PASSWORD }],
    ['un mot de passe vide', { email: 'a@test.local', password: '' }],
    ['un corps vide', {}],
  ])('refuse %s avec 400', async (_label, body) => {
    expect((await call('POST', '/auth/login', body)).status).toBe(400);
  });
});

describe('POST /auth/logout', () => {
  it('invalide la session : /auth/me renvoie null et les routes protégées 401', async () => {
    const me = await signup();
    expect((await me.get('/personas')).status).toBe(200);
    const res = await me.post('/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Le cookie est effacé côté navigateur.
    expect(rawSessionCookie(res.headers)).toMatch(/Max-Age=0/i);
    expect((await me.get('/auth/me')).body).toEqual({ user: null });
    expect((await me.get('/personas')).status).toBe(401);
    expect(await db.$count(sessions, eq(sessions.userId, me.user.id))).toBe(0);
  });

  it("ne ferme que la session courante, pas celles des autres appareils", async () => {
    const me = await signup();
    const other = sessionCookie(await call('POST', '/auth/login', { email: me.email, password: PASSWORD }));
    await me.post('/auth/logout');
    expect((await call('GET', '/auth/me', undefined, other)).body.user.id).toBe(me.user.id);
  });

  it('répond 200 même sans session', async () => {
    const res = await call('POST', '/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('GET /auth/me', () => {
  it('renvoie user null sans session', async () => {
    const res = await call('GET', '/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });

  it('renvoie user null avec un cookie inconnu', async () => {
    const res = await call('GET', '/auth/me', undefined, `${SESSION_COOKIE}=jeton-invente`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });

  it("renvoie l'utilisateur connecté", async () => {
    const me = await signup({ name: 'Camille' });
    const res = await me.get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual(me.user);
    expect(res.body.user.name).toBe('Camille');
  });

  it('ignore une session expirée', async () => {
    const me = await signup();
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, me.user.id));
    expect((await me.get('/auth/me')).body).toEqual({ user: null });
    expect((await me.get('/settings')).status).toBe(401);
  });
});

describe('PATCH /auth/me', () => {
  it('modifie le nom (sans espaces autour)', async () => {
    const me = await signup({ name: 'Ancien' });
    const res = await me.patch('/auth/me', { name: '  Nouveau nom  ' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: me.user.id, name: 'Nouveau nom', email: me.email });
    expect((await me.get('/auth/me')).body.user.name).toBe('Nouveau nom');
  });

  // Ancien bug (corrigé) : avec un corps vide, la route appelle `db.update(users).set({})`. Drizzle refuse
  // une mise à jour sans valeur et la requête finit en 500 au lieu de renvoyer l'utilisateur inchangé.
  it('accepte un corps vide sans rien changer', async () => {
    const me = await signup({ name: 'Stable' });
    const res = await me.patch('/auth/me', {});
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Stable');
  });

  it('définit puis retire la photo de profil', async () => {
    const me = await signup();
    const asset = await me.uploadAsset();
    const set = await me.patch('/auth/me', { avatarAssetId: asset.id });
    expect(set.status).toBe(200);
    expect(set.body.user.avatarUrl).toBe(`/api/media/${asset.id}`);
    expect((await me.get('/auth/me')).body.user.avatarUrl).toBe(`/api/media/${asset.id}`);
    // L'image est bien servie.
    expect((await me.get(`/media/${asset.id}`)).status).toBe(200);

    const unset = await me.patch('/auth/me', { avatarAssetId: null });
    expect(unset.status).toBe(200);
    expect(unset.body.user.avatarUrl).toBeNull();
    expect((await me.get('/auth/me')).body.user.avatarUrl).toBeNull();
  });

  it('refuse une photo de profil inconnue avec 400', async () => {
    const me = await signup();
    const res = await me.patch('/auth/me', { avatarAssetId: crypto.randomUUID() });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/introuvable/);
  });

  it("refuse l'image d'un autre utilisateur avec 400", async () => {
    const a = await signup();
    const b = await signup();
    const asset = await a.uploadAsset();
    const res = await b.patch('/auth/me', { avatarAssetId: asset.id });
    expect(res.status).toBe(400);
    expect((await b.get('/auth/me')).body.user.avatarUrl).toBeNull();
  });

  it('refuse une vidéo comme photo de profil avec 400', async () => {
    const me = await signup();
    const video = await me.uploadAsset({ mime: 'video/mp4' });
    expect((await me.patch('/auth/me', { avatarAssetId: video.id })).status).toBe(400);
  });

  it.each([
    ['un nom vide', { name: '' }],
    ['un nom fait seulement d’espaces', { name: '   ' }],
    ['un nom de plus de 60 caractères', { name: 'n'.repeat(61) }],
    ['un identifiant de photo qui n’est pas un UUID', { avatarAssetId: 'pas-un-uuid' }],
    ['un nom qui n’est pas une chaîne', { name: 42 }],
  ])('refuse %s avec 400', async (_label, body) => {
    const me = await signup({ name: 'Intact' });
    expect((await me.patch('/auth/me', body)).status).toBe(400);
    expect((await me.get('/auth/me')).body.user.name).toBe('Intact');
  });

  it('répond 401 sans session', async () => {
    const res = await call('PATCH', '/auth/me', { name: 'Pirate' });
    expect(res.status).toBe(401);
  });

  it("ne modifie pas l'e-mail même s'il est envoyé", async () => {
    const me = await signup();
    const res = await me.patch('/auth/me', { name: 'X', email: 'pirate@test.local' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(me.email);
  });
});
