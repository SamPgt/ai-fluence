import { mkdir } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { sql } from 'drizzle-orm';
import app from './app.js';
import { env } from './env.js';
import { client, db } from './db/index.js';
import { resumeWatchers } from './services/generation.service.js';
import { pollThumbnails } from './services/thumbnail.service.js';
import { schedulePurge } from './services/trash.service.js';

async function main() {
  await db.execute(sql`select 1`);
  const dbUrl = new URL(env.DATABASE_URL);
  console.log(`Connecté à PostgreSQL (${dbUrl.pathname.slice(1)}@${dbUrl.hostname})`);

  await mkdir(env.DATA_DIR, { recursive: true });
  console.log(`📁 Données locales : ${env.DATA_DIR}`);

  serve({ fetch: app.fetch, port: env.API_PORT });
  console.log(`🚀 API sur http://localhost:${env.API_PORT}`);

  await resumeWatchers();
  void pollThumbnails();
  schedulePurge();

  const shutdown = async () => {
    await client.end({ timeout: 2 });
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  console.error('Démarrage impossible :', err);
  process.exit(1);
});
