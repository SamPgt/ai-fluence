import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Balance, CreditsResponse, Settings } from '@ai-fluence/shared';
import { db } from '../db/index.js';
import { generations, userSettings } from '../db/schema.js';
import { env, expandHome } from '../env.js';
import { apiKeyHint, encryptSecret } from '../lib/crypto.js';
import { auth } from '../middleware/auth.js';
import { defaultMediaDir, getSettingsRow, mediaDirOf, type SettingsRow } from '../services/settings.service.js';
import { callSpicy, clientFor, clientForUser, invalidateCatalog } from '../services/spicy.service.js';
import type { AppEnv, SessionUser } from '../types.js';

function toSettings(user: SessionUser, row: SettingsRow): Settings {
  return {
    hasApiKey: Boolean(row.spicyApiKeyEnc),
    apiKeyHint: row.spicyApiKeyHint,
    mediaDir: mediaDirOf(user, row),
    defaultMediaDir: defaultMediaDir(user),
    enhanceModel: row.enhanceModel,
  };
}

const updateSchema = z.object({
  mediaDir: z.string().trim().max(500).nullable().optional(),
  enhanceModel: z.string().min(3).optional(),
});

async function balanceOf(userId: string): Promise<Balance | null> {
  const row = await getSettingsRow(userId);
  if (!row.spicyApiKeyEnc) return null;
  const client = await clientForUser(userId);
  const b = await callSpicy(() => client.getBalance());
  return { available: b.available, held: b.held, total: b.total };
}

const settingsRoutes = new Hono<AppEnv>()
  .use(auth)
  .get('/', async c => {
    const user = c.get('user');
    return c.json({ settings: toSettings(user, await getSettingsRow(user.id)) });
  })
  .patch('/', zValidator('json', updateSchema), async c => {
    const user = c.get('user');
    await getSettingsRow(user.id);
    const body = c.req.valid('json');
    const patch: Partial<SettingsRow> = { updatedAt: new Date() };
    if (body.mediaDir !== undefined) {
      if (body.mediaDir) {
        // Vérifié avant de compléter `~` : expandHome rend tout chemin absolu.
        const raw = body.mediaDir.trim();
        if (raw !== '~' && !raw.startsWith('~/') && !isAbsolute(raw)) {
          return c.json({ error: 'Le dossier doit être un chemin absolu.' }, 400);
        }
        const dir = expandHome(raw);
        try {
          await mkdir(dir, { recursive: true });
        } catch {
          return c.json({ error: 'Impossible de créer ce dossier.' }, 400);
        }
        patch.mediaDir = dir;
      } else patch.mediaDir = null;
    }
    if (body.enhanceModel !== undefined) patch.enhanceModel = body.enhanceModel;
    const [row] = await db.update(userSettings).set(patch).where(eq(userSettings.userId, user.id)).returning();
    return c.json({ settings: toSettings(user, row) });
  })
  .put('/api-key', zValidator('json', z.object({ apiKey: z.string().trim().min(10).max(400) })), async c => {
    const user = c.get('user');
    const { apiKey } = c.req.valid('json');
    // On vérifie la clé avant de l'enregistrer (appel gratuit).
    await callSpicy(() => clientFor(apiKey).getBalance());
    await getSettingsRow(user.id);
    const [row] = await db
      .update(userSettings)
      .set({ spicyApiKeyEnc: encryptSecret(apiKey), spicyApiKeyHint: apiKeyHint(apiKey), updatedAt: new Date() })
      .where(eq(userSettings.userId, user.id))
      .returning();
    invalidateCatalog(user.id);
    return c.json({ settings: toSettings(user, row) });
  })
  .delete('/api-key', async c => {
    const user = c.get('user');
    await getSettingsRow(user.id);
    const [row] = await db
      .update(userSettings)
      .set({ spicyApiKeyEnc: null, spicyApiKeyHint: null, updatedAt: new Date() })
      .where(eq(userSettings.userId, user.id))
      .returning();
    invalidateCatalog(user.id);
    return c.json({ settings: toSettings(user, row) });
  })
  .post('/open-media-dir', async c => {
    const user = c.get('user');
    const dir = mediaDirOf(user, await getSettingsRow(user.id));
    await mkdir(dir, { recursive: true });
    // Outil local : ouvre le dossier dans le Finder (jamais pendant les tests).
    if (env.NODE_ENV !== 'test') execFile('open', [dir]);
    return c.json({ ok: true });
  })
  .get('/balance', async c => {
    return c.json({ balance: await balanceOf(c.get('user').id) });
  })
  .get('/credits', async c => {
    const user = c.get('user');
    const [agg] = await db
      .select({
        spent: sql<string>`coalesce(sum(${generations.cost}::numeric) filter (where ${generations.status} = 'succeeded'), 0)::text`,
        count: sql<number>`count(*) filter (where ${generations.status} = 'succeeded')::int`,
      })
      .from(generations)
      .where(eq(generations.userId, user.id));

    const balance = await balanceOf(user.id);
    let usage: CreditsResponse['usage'] = null;
    if (balance) {
      const to = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
      const from = new Date(Date.now() - 29 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const client = await clientForUser(user.id);
      const report = await client.getUsage({ from, to }).catch(() => null);
      if (report) usage = { from: report.from, to: report.to, totalSpend: report.totalSpend, tasks: report.totalCalls };
    }
    return c.json({
      balance,
      spentInApp: agg?.spent ?? '0',
      generationCount: agg?.count ?? 0,
      usage,
    } satisfies CreditsResponse);
  });

export default settingsRoutes;
