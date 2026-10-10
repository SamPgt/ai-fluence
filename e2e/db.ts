import { execFileSync } from 'node:child_process'
import { TEST_DB_URL } from './env'

if (!/-test(\?|$)/.test(new URL(TEST_DB_URL).pathname + '')) {
  throw new Error(`Refus : ${TEST_DB_URL} n'est pas une base de test.`)
}

export function sql(query: string): string {
  return execFileSync('psql', [TEST_DB_URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
    // Pas de NOTICE « truncate cascades » dans la sortie des tests.
    env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' },
  }).trim()
}

/** Données de l'utilisateur effacées (le compte et sa clé restent). */
export function resetData() {
  sql('TRUNCATE generations, assets, threads, personas, prompt_presets RESTART IDENTITY CASCADE')
}
