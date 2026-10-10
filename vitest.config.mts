/**
 * `npm run test:unit` :
 * - unit : logique pure des trois paquets (sans base ni serveur) ;
 * - api : chaque endpoint Hono appelé par `app.fetch` (pas de serveur), sur la
 *   base `ai-fluence-test`, avec un faux SpicyAPI (aucun réseau, aucun coût).
 * Les tests de bout en bout sont dans e2e/ (Playwright).
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: { alias: { '@': here('./frontend/src') } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['{shared,frontend}/src/**/*.test.ts', 'backend/src/services/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'api',
          include: ['backend/src/test/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['backend/src/test/setup.ts'],
          // Une seule base de test : un fichier à la fois.
          fileParallelism: false,
          testTimeout: 20_000,
          // Appliqué avant le chargement des modules : prime sur backend/.env.
          env: {
            NODE_ENV: 'test',
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://localhost:5432/ai-fluence-test',
            APP_SECRET: '0'.repeat(64),
            CLIENT_URL: 'http://localhost:3071',
            DATA_DIR: here('./.vitest-data'),
            SPICY_FAKE: 'true',
            CIVITAI_KEY: '',
          },
        },
      },
    ],
  },
})
