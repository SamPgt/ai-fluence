import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../db/index.js';
import { assets, userSettings } from '../db/schema.js';
import { env } from '../env.js';
import { call, signup } from './helpers.js';

const KEY = 'sk-spicy-test-0000000000';
const SETTINGS_KEYS = ['apiKeyHint', 'defaultMediaDir', 'enhanceModel', 'hasApiKey', 'mediaDir'];

/** Dossier temporaire propre au test, dans .vitest-data. */
const tempDir = () => join(env.DATA_DIR, 'settings-tests', randomUUID().slice(0, 8));

describe('GET /settings', () => {
  it('renvoie exactement les champs attendus, sans champ obsolète', async () => {
    const me = await signup();
    const res = await me.get('/settings');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['settings']);
    expect(Object.keys(res.body.settings).sort()).toEqual(SETTINGS_KEYS);
    for (const gone of ['defaultImageFamily', 'defaultVideoFamily', 'falApiKey', 'hasFalKey', 'falKeyHint']) {
      expect(res.body.settings).not.toHaveProperty(gone);
    }
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('fal');
  });

  it('masque la clé API : indice seulement, jamais la clé complète', async () => {
    const me = await signup();
    const { settings } = (await me.get('/settings')).body;
    expect(settings.hasApiKey).toBe(true);
    expect(settings.apiKeyHint).toBe('sk-spicy-••••0000');
    expect(JSON.stringify(settings)).not.toContain(KEY);
    expect(JSON.stringify(settings)).not.toContain('test-0000000000');
  });

  it('stocke la clé chiffrée en base, jamais en clair', async () => {
    const me = await signup();
    const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, me.user.id));
    expect(row.spicyApiKeyEnc).toBeTruthy();
    expect(row.spicyApiKeyEnc).not.toContain(KEY);
  });

  it('sans clé : hasApiKey faux et indice null', async () => {
    const me = await signup({ apiKey: false });
    const { settings } = (await me.get('/settings')).body;
    expect(settings.hasApiKey).toBe(false);
    expect(settings.apiKeyHint).toBeNull();
  });

  it('propose par défaut un dossier média dans DATA_DIR et le modèle de reformulation par défaut', async () => {
    const me = await signup({ email: 'Jean.Dupont@test.local' });
    const { settings } = (await me.get('/settings')).body;
    expect(settings.defaultMediaDir).toBe(join(env.DATA_DIR, 'media', 'jean-dupont'));
    expect(settings.mediaDir).toBe(settings.defaultMediaDir);
    expect(isAbsolute(settings.mediaDir)).toBe(true);
    expect(settings.enhanceModel).toBe('deepseek/v4.1-flash/chat');
  });

  it('répond 401 sans session', async () => {
    expect((await call('GET', '/settings')).status).toBe(401);
  });
});

describe('PATCH /settings', () => {
  it('accepte un dossier absolu et le crée sur le disque', async () => {
    const me = await signup();
    const dir = tempDir();
    expect(existsSync(dir)).toBe(false);
    const res = await me.patch('/settings', { mediaDir: dir });
    expect(res.status).toBe(200);
    expect(res.body.settings.mediaDir).toBe(dir);
    expect(statSync(dir).isDirectory()).toBe(true);
    expect((await me.get('/settings')).body.settings.mediaDir).toBe(dir);
  });

  it('enregistre les nouveaux fichiers dans le dossier choisi', async () => {
    const me = await signup();
    const dir = tempDir();
    await me.patch('/settings', { mediaDir: dir });
    const asset = await me.uploadAsset();
    const [{ filePath }] = await db.select({ filePath: assets.filePath }).from(assets).where(eq(assets.id, asset.id));
    expect(filePath.startsWith(dir)).toBe(true);
  });

  it('retire les espaces autour du chemin', async () => {
    const me = await signup();
    const dir = tempDir();
    const res = await me.patch('/settings', { mediaDir: `  ${dir}  ` });
    expect(res.status).toBe(200);
    expect(res.body.settings.mediaDir).toBe(dir);
  });

  // Ancien bug (corrigé) : `expandHome` passe tout chemin dans `path.resolve`, qui le rend absolu par
  // rapport au dossier courant. La vérification `isAbsolute` ne refuse donc jamais rien,
  // et un chemin relatif crée un dossier à côté du processus au lieu d'être refusé.
  it('refuse un chemin relatif avec 400', async () => {
    const me = await signup();
    const res = await me.patch('/settings', { mediaDir: `.vitest-data/settings-tests/relatif-${randomUUID().slice(0, 8)}` });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/absolu/);
  });

  it('refuse avec 400 un dossier impossible à créer', async () => {
    const me = await signup();
    const base = tempDir();
    mkdirSync(base, { recursive: true });
    const file = join(base, 'fichier.txt');
    writeFileSync(file, 'x');
    const res = await me.patch('/settings', { mediaDir: join(file, 'sous-dossier') });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Impossible de créer/);
    expect((await me.get('/settings')).body.settings.mediaDir).toBe((await me.get('/settings')).body.settings.defaultMediaDir);
  });

  it('revient au dossier par défaut avec null', async () => {
    const me = await signup();
    await me.patch('/settings', { mediaDir: tempDir() });
    const res = await me.patch('/settings', { mediaDir: null });
    expect(res.status).toBe(200);
    expect(res.body.settings.mediaDir).toBe(res.body.settings.defaultMediaDir);
  });

  it('revient au dossier par défaut avec une chaîne vide', async () => {
    const me = await signup();
    await me.patch('/settings', { mediaDir: tempDir() });
    const res = await me.patch('/settings', { mediaDir: '   ' });
    expect(res.status).toBe(200);
    expect(res.body.settings.mediaDir).toBe(res.body.settings.defaultMediaDir);
  });

  it('change le modèle de reformulation sans toucher au dossier', async () => {
    const me = await signup();
    const dir = tempDir();
    await me.patch('/settings', { mediaDir: dir });
    const res = await me.patch('/settings', { enhanceModel: 'autre/modele/chat' });
    expect(res.status).toBe(200);
    expect(res.body.settings.enhanceModel).toBe('autre/modele/chat');
    expect(res.body.settings.mediaDir).toBe(dir);
  });

  it('accepte un corps vide sans rien changer', async () => {
    const me = await signup();
    const before = (await me.get('/settings')).body.settings;
    const res = await me.patch('/settings', {});
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual(before);
  });

  it.each([
    ['un modèle de moins de 3 caractères', { enhanceModel: 'ab' }],
    ['un modèle qui n’est pas une chaîne', { enhanceModel: 12 }],
    ['un dossier de plus de 500 caractères', { mediaDir: `/${'a'.repeat(500)}` }],
    ['un dossier qui n’est pas une chaîne', { mediaDir: 42 }],
  ])('refuse %s avec 400', async (_label, body) => {
    const me = await signup();
    expect((await me.patch('/settings', body)).status).toBe(400);
  });

  it('crée la ligne de paramètres si elle manque', async () => {
    const me = await signup({ apiKey: false });
    await db.delete(userSettings).where(eq(userSettings.userId, me.user.id));
    const res = await me.patch('/settings', { enhanceModel: 'abc/def' });
    expect(res.status).toBe(200);
    expect(res.body.settings.enhanceModel).toBe('abc/def');
  });
});

describe('PUT /settings/api-key', () => {
  it("enregistre la clé et renvoie l'indice", async () => {
    const me = await signup({ apiKey: false });
    const res = await me.put('/settings/api-key', { apiKey: '  sk-spicy-abcdef123456wxyz  ' });
    expect(res.status).toBe(200);
    expect(res.body.settings.hasApiKey).toBe(true);
    expect(res.body.settings.apiKeyHint).toBe('sk-spicy-••••wxyz');
    expect(JSON.stringify(res.body)).not.toContain('abcdef123456');
  });

  it("utilise les 4 premiers caractères pour l'indice d'une clé sans préfixe", async () => {
    const me = await signup({ apiKey: false });
    const res = await me.put('/settings/api-key', { apiKey: 'abcd-efgh-ijkl-9876' });
    expect(res.body.settings.apiKeyHint).toBe('abcd••••9876');
  });

  it('remplace une clé existante', async () => {
    const me = await signup();
    const res = await me.put('/settings/api-key', { apiKey: 'sk-spicy-nouvelle-cle-1111' });
    expect(res.status).toBe(200);
    expect(res.body.settings.apiKeyHint).toBe('sk-spicy-••••1111');
  });

  it.each([
    ['une clé de moins de 10 caractères', { apiKey: 'court' }],
    ['une clé faite d’espaces', { apiKey: '              ' }],
    ['une clé de plus de 400 caractères', { apiKey: 'k'.repeat(401) }],
    ['une clé absente', {}],
  ])('refuse %s avec 400', async (_label, body) => {
    const me = await signup({ apiKey: false });
    expect((await me.put('/settings/api-key', body)).status).toBe(400);
    expect((await me.get('/settings')).body.settings.hasApiKey).toBe(false);
  });
});

describe('DELETE /settings/api-key', () => {
  it("efface la clé : hasApiKey faux et plus d'indice", async () => {
    const me = await signup();
    const res = await me.del('/settings/api-key');
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ hasApiKey: false, apiKeyHint: null });
    expect((await me.get('/settings')).body.settings.hasApiKey).toBe(false);
  });

  it('les endpoints qui ont besoin de la clé répondent ensuite 412', async () => {
    const me = await signup();
    // Catalogue mis en cache avant l'effacement : il doit être invalidé.
    expect((await me.get('/catalog')).status).toBe(200);
    await me.del('/settings/api-key');
    const checks = [
      await me.get('/catalog'),
      await me.post('/generations/quote', { family: 'bytedance/seedream-5.0-flash', prompt: 'x' }),
      await me.post('/generations', { family: 'bytedance/seedream-5.0-flash', prompt: 'x' }),
      await me.post('/prompts/enhance', { prompt: 'x', media: 'image' }),
    ];
    for (const res of checks) {
      expect(res.status, JSON.stringify(res.body)).toBe(412);
      expect(res.body.error).toMatch(/clé API/);
    }
  });

  it('fonctionne aussi sans clé enregistrée', async () => {
    const me = await signup({ apiKey: false });
    const res = await me.del('/settings/api-key');
    expect(res.status).toBe(200);
    expect(res.body.settings.hasApiKey).toBe(false);
  });
});

describe('POST /settings/open-media-dir', () => {
  it('répond ok et crée le dossier média par défaut', async () => {
    const me = await signup({ email: `ouvrir-${randomUUID().slice(0, 6)}@test.local` });
    const dir = (await me.get('/settings')).body.settings.mediaDir;
    const res = await me.post('/settings/open-media-dir');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(statSync(dir).isDirectory()).toBe(true);
  });

  it('crée le dossier choisi s’il manque encore', async () => {
    const me = await signup();
    const dir = tempDir();
    await me.get('/settings');
    // Dossier enregistré sans passer par PATCH : il n'existe pas encore sur le disque.
    await db.update(userSettings).set({ mediaDir: dir }).where(eq(userSettings.userId, me.user.id));
    expect(existsSync(dir)).toBe(false);
    expect((await me.post('/settings/open-media-dir')).status).toBe(200);
    expect(existsSync(dir)).toBe(true);
  });
});

describe('GET /settings/balance', () => {
  it('renvoie le solde du faux SpicyAPI', async () => {
    const me = await signup();
    const res = await me.get('/settings/balance');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ balance: { available: '10', held: '0', total: '10' } });
  });

  it('renvoie null sans clé', async () => {
    const me = await signup({ apiKey: false });
    const res = await me.get('/settings/balance');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ balance: null });
  });
});

describe('GET /settings/credits', () => {
  it('commence à zéro', async () => {
    const me = await signup();
    const res = await me.get('/settings/credits');
    expect(res.status).toBe(200);
    expect(res.body.spentInApp).toBe('0');
    expect(res.body.generationCount).toBe(0);
    expect(res.body.balance).toEqual({ available: '10', held: '0', total: '10' });
    expect(res.body.usage).toMatchObject({ totalSpend: '0', tasks: 0 });
    expect(res.body.usage.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.usage.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.usage.from < res.body.usage.to).toBe(true);
  });

  it('compte les générations réussies et leur coût', async () => {
    const me = await signup();
    await me.generate();
    await me.generate({ prompt: 'une poire' });
    const res = await me.get('/settings/credits');
    expect(res.status).toBe(200);
    expect(res.body.generationCount).toBe(2);
    expect(Number(res.body.spentInApp)).toBeCloseTo(0.02);
  });

  it("ne compte pas les générations d'un autre utilisateur", async () => {
    const a = await signup();
    const b = await signup();
    await a.generate();
    const res = await b.get('/settings/credits');
    expect(res.body.generationCount).toBe(0);
    expect(res.body.spentInApp).toBe('0');
  });

  it('sans clé : solde et usage null, compteurs de l’app toujours là', async () => {
    const me = await signup();
    await me.generate();
    await me.del('/settings/api-key');
    const res = await me.get('/settings/credits');
    expect(res.status).toBe(200);
    expect(res.body.balance).toBeNull();
    expect(res.body.usage).toBeNull();
    expect(res.body.generationCount).toBe(1);
    expect(Number(res.body.spentInApp)).toBeCloseTo(0.01);
  });
});
