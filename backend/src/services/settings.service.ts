import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/index.js';
import { userSettings } from '../db/schema.js';
import { env } from '../env.js';
import { decryptSecret } from '../lib/crypto.js';
import type { SessionUser } from '../types.js';

export type SettingsRow = typeof userSettings.$inferSelect;

export async function getSettingsRow(userId: string): Promise<SettingsRow> {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  if (row) return row;
  const [created] = await db.insert(userSettings).values({ userId }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return again;
}

function slug(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'user'
  );
}

export function defaultMediaDir(user: Pick<SessionUser, 'email'>): string {
  return join(env.DATA_DIR, 'media', slug(user.email.split('@')[0]));
}

export function mediaDirOf(user: Pick<SessionUser, 'email'>, row: SettingsRow): string {
  return row.mediaDir || defaultMediaDir(user);
}

export async function requireApiKey(userId: string): Promise<string> {
  const row = await getSettingsRow(userId);
  if (!row.spicyApiKeyEnc) {
    throw new HTTPException(412, {
      message: 'Aucune clé API SpicyAPI. Ajoute-la dans Paramètres → Clé API.',
    });
  }
  return decryptSecret(row.spicyApiKeyEnc);
}

export { slug };
