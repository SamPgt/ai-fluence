/**
 * Faux client SpicyAPI pour les tests (SPICY_FAKE=1) : aucune requête réseau,
 * aucun coût. Le catalogue est une capture réelle (test/fixtures/spicy-models.json),
 * les tâches réussissent tout de suite avec une petite image. Un prompt
 * contenant FAIL_TEST donne une tâche en échec (pour tester l'affichage des erreurs),
 * SLOW_TEST une tâche qui reste en cours un instant (pour tester un arrêt).
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { SpicyClient } from '@spicyapi/sdk';

const fixture = (name: string) => new URL(`../test/fixtures/${name}`, import.meta.url);
const MODELS = JSON.parse(readFileSync(fixture('spicy-models.json'), 'utf8'));
const OUTPUT_URL = `data:image/png;base64,${readFileSync(fixture('output.png')).toString('base64')}`;
const PRICE = '0.01';
const inAnHour = () => new Date(Date.now() + 3600_000).toISOString();

export const FAIL_MARKER = 'FAIL_TEST';
const failing = new Set<string>();
export const SLOW_MARKER = 'SLOW_TEST';
/** Tâches lentes : en cours jusqu'à cette date. */
const slow = new Map<string, number>();

const fake = {
  listModels: async () => ({ items: MODELS }),
  quoteTask: async () => ({
    quoteId: randomUUID(),
    estimatedCost: PRICE,
    maxCharge: PRICE,
    quantity: '1',
    unit: 'per_image',
    expiresAt: inAnHour(),
  }),
  createTask: async ({ input }: { input: Record<string, unknown> }) => {
    const taskId = randomUUID();
    if (String(input.prompt ?? '').includes(FAIL_MARKER)) failing.add(taskId);
    if (String(input.prompt ?? '').includes(SLOW_MARKER)) slow.set(taskId, Date.now() + 1500);
    return { taskId, estimatedCost: PRICE };
  },
  getTask: async (taskId: string) =>
    (slow.get(taskId) ?? 0) > Date.now()
      ? { taskId, state: 'running', cost: PRICE, settled: false }
      : failing.has(taskId)
      ? {
          taskId,
          state: 'failed',
          cost: '0',
          settled: true,
          errorCode: 'fake_failure',
          errorMessage: 'Échec simulé.',
        }
      : {
          taskId,
          state: 'succeeded',
          cost: PRICE,
          settled: true,
          output: { assets: [{ url: OUTPUT_URL, mime: 'image/png' }] },
        },
  uploadFile: async () => ({
    uri: `spicy://fake/${randomUUID()}`,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  }),
  getBalance: async () => ({ available: '10', held: '0', total: '10' }),
  getUsage: async ({ from, to }: { from: string; to: string }) => ({
    from,
    to,
    totalSpend: '0',
    totalCalls: 0,
  }),
  end: async () => {},
};

export const fakeSpicyClient = fake as unknown as SpicyClient;
