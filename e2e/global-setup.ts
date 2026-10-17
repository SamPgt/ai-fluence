import { mkdirSync, rmSync } from 'node:fs'
import { request } from '@playwright/test'
import { APP_URL, AUTH_FILE, DATA_DIR, USER } from './env'
import { sql } from './db'

/** Base vide, un compte de test connecté avec une (fausse) clé SpicyAPI. */
export default async function globalSetup() {
  sql('TRUNCATE users RESTART IDENTITY CASCADE')
  rmSync(DATA_DIR, { recursive: true, force: true })
  mkdirSync(DATA_DIR, { recursive: true })

  const api = await request.newContext({ baseURL: APP_URL })
  const signup = await api.post('/api/auth/signup', { data: USER })
  if (!signup.ok()) throw new Error(`Inscription : ${signup.status()} ${await signup.text()}`)
  const key = await api.put('/api/settings/api-key', {
    data: { apiKey: 'sk-spicy-e2e-0000000000' },
  })
  if (!key.ok()) throw new Error(`Clé API : ${key.status()} ${await key.text()}`)
  await api.storageState({ path: AUTH_FILE })
  await api.dispose()
}
