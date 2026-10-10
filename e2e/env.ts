import { resolve } from 'node:path'

// Valeurs de `npm run dev:test`. Surchargeables (E2E_API_PORT, E2E_APP_PORT,
// E2E_DATABASE_URL) pour lancer plusieurs copies de test en parallèle.
const apiPort = process.env.E2E_API_PORT ?? '3471'
const appPort = process.env.E2E_APP_PORT ?? '3071'
export const CUSTOM = Boolean(process.env.E2E_API_PORT || process.env.E2E_APP_PORT || process.env.E2E_DATABASE_URL)
export const API_URL = `http://localhost:${apiPort}`
export const APP_URL = `http://localhost:${appPort}`
export const TEST_DB_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://localhost:5432/ai-fluence-test'
/** Médias générés pendant les tests (jamais le dossier réel). */
export const DATA_DIR = resolve(__dirname, CUSTOM ? `../.e2e-data-${appPort}` : '../.e2e-data')
export const AUTH_FILE = `e2e/.auth/user-${appPort}.json`
export const USER = {
  email: 'e2e@ai-fluence.test',
  password: 'e2e-password',
  name: 'E2E',
}
