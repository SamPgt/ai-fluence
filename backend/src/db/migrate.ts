/**
 * Migrations appliquées par le serveur lui-même, à chaque démarrage (y compris après un
 * rechargement automatique en développement) : une nouvelle table est toujours créée
 * avant que le code qui s'en sert ne tourne. Sans effet si la base est à jour.
 */
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './index.js';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
