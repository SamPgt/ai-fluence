/**
 * Migrations au démarrage : toutes celles du dossier sont appliquées, et relancer
 * ne change rien (base déjà à jour).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../db/index.js';
import { MIGRATIONS_FOLDER, runMigrations } from '../db/migrate.js';

const applied = async () =>
  ((await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)) as unknown as { n: number }[])[0].n;

describe('migrations au démarrage', () => {
  it('toutes les migrations du dossier sont appliquées ; relancer ne fait rien @smoke', async () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'));
    await runMigrations();
    expect(await applied()).toBe(journal.entries.length);
    await runMigrations();
    expect(await applied()).toBe(journal.entries.length);
  });
});
