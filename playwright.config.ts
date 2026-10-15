/**
 * Tests E2E : Playwright lance une copie complète de l'app (API :3471 + front
 * :3071) contre la base `sublime-test`, avec un faux SpicyAPI (SPICY_FAKE) :
 * aucun appel réseau, aucun coût.
 */
import { defineConfig } from '@playwright/test'
import { APP_URL, AUTH_FILE } from './e2e/env'

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
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
  // sur la base sublime-test (cross-env), front sur un autre port que le dev,
  // lancé une fois l'API prête (wait-on). Playwright attend le front.
  webServer: {
    command: 'npm run dev:test',
    url: APP_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})

