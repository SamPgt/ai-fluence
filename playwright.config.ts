/**
 * Tests E2E : Playwright lance une copie complète de l'app (API :3471 + front
 * :3071) contre la base `ai-fluence-test`, avec un faux SpicyAPI (SPICY_FAKE) :
 * aucun appel réseau, aucun coût.
 */
import { defineConfig } from '@playwright/test'
import { API_URL, APP_URL, AUTH_FILE, CUSTOM, DATA_DIR, TEST_DB_URL } from './e2e/env'

export default defineConfig({
  testDir: './e2e',
  // Un dossier de résultats par copie de test (exécutions parallèles possibles).
  outputDir: `test-results/${new URL(APP_URL).port}`,
  // Une seule base de test partagée : un test à la fois.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: APP_URL,
    // Chrome installé sur la machine : pas de navigateur à télécharger.
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    storageState: AUTH_FILE,
    trace: 'retain-on-failure',
  },
  // Copie de l'app pour les tests (`npm run dev:test`) : back en NODE_ENV=test
  // sur la base ai-fluence-test (cross-env), front sur un autre port que le dev,
  // lancé une fois l'API prête (wait-on). Playwright attend le front.
  webServer: {
    command: CUSTOM ? customDevTest() : 'npm run dev:test',
    url: APP_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})

/** Même chose que `npm run dev:test`, sur d'autres ports et une autre base. */
function customDevTest() {
  const api = new URL(API_URL).port
  const app = new URL(APP_URL).port
  const back = [
    'cd backend && npx cross-env NODE_ENV=test',
    `DATABASE_URL=${TEST_DB_URL}`,
    `API_PORT=${api}`,
    `CLIENT_URL=${APP_URL}`,
    `DATA_DIR=${DATA_DIR}`,
    `APP_SECRET=${'0'.repeat(64)}`,
    'SPICY_FAKE=true CIVITAI_KEY= tsx src/index.ts',
  ].join(' ')
  const front = `npx wait-on -t 90000 http-get://localhost:${api}/health && cd frontend && npx cross-env VITE_BACKEND_URL=${API_URL} vite dev --port ${app} --strictPort`
  return `npx concurrently -k '${back}' '${front}'`
}
