/**
 * Tests d'API : base de test vidée avant chaque test. Refuse toute autre base.
 */
import { mkdirSync } from 'node:fs';
import { afterAll, beforeEach } from 'vitest';
import { env } from '../env.js';
import { resetDb, settle } from './helpers.js';
import { client } from '../db/index.js';

if (!/-test$/.test(new URL(env.DATABASE_URL).pathname)) {
  throw new Error(`Refus : ${env.DATABASE_URL} n'est pas une base de test.`);
}
if (!env.SPICY_FAKE) throw new Error('Refus : SPICY_FAKE doit être actif (aucun appel SpicyAPI réel en test).');
mkdirSync(env.DATA_DIR, { recursive: true });

beforeEach(async () => {
  // Suivis de génération du test précédent terminés avant de vider la base.
  await settle();
  await resetDb();
});

afterAll(async () => {
  await settle();
  await client.end({ timeout: 2 });
});
