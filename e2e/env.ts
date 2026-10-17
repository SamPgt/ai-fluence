import { resolve } from 'node:path'

// Valeurs de `npm run dev:test` : une seule copie de test, une seule base (sublime-test).
// Jamais d'autre base ni d'autres ports (cf. CLAUDE.md, section Tests).
export const API_URL = 'http://localhost:3471'
export const APP_URL = 'http://localhost:3071'
export const TEST_DB_URL = 'postgresql://localhost:5432/sublime-test'
/** Médias générés pendant les tests (jamais le dossier réel). */
export const DATA_DIR = resolve(__dirname, '../.e2e-data')
export const AUTH_FILE = 'e2e/.auth/user.json'
export const USER = {
  email: 'e2e@sublime.test',
  password: 'e2e-password',
  name: 'E2E',
}
