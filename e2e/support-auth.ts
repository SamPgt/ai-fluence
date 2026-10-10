/**
 * Aides locales aux specs auth, paramètres, corbeille et navigation.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { USER } from './env'

/** Contexte sans session : utilisateur déconnecté. */
export const LOGGED_OUT = { cookies: [], origins: [] }

/** Clé (fausse) remise en place après les tests qui la changent. */
export const E2E_KEY = 'sk-spicy-e2e-0000000000'

/** React a pris la main sur la page (sinon une saisie faite trop tôt est effacée). */
export async function hydrated(page: Page) {
  // La racine est marquée dès le début de l'hydratation : on attend en plus que
  // chaque bouton ait reçu ses props React (gestionnaires d'événements branchés).
  await page.waitForFunction(() => {
    const root = [document, document.documentElement, document.body].some((n) =>
      Object.keys(n).some((k) => k.startsWith('__reactContainer')),
    )
    const buttons = [...document.querySelectorAll('button')]
    return (
      root &&
      buttons.length > 0 &&
      buttons.every((b) => Object.keys(b).some((k) => k.startsWith('__reactProps')))
    )
  })
}

/** E-mail unique pour un compte créé pendant un test. */
export function uniqueEmail(prefix = 'compte') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@ai-fluence.test`
}

/** Crée un compte par l'API : la session est posée dans le contexte de `request`. */
export async function signupByApi(request: APIRequestContext, name = 'Autre Compte') {
  const user = { email: uniqueEmail(), password: 'mot-de-passe-1', name }
  const res = await request.post('/api/auth/signup', { data: user })
  expect(res.ok(), await res.text()).toBeTruthy()
  return user
}

/** Remet le compte de test partagé dans son état initial (nom, photo, dossier, clé). */
export async function restoreSharedUser(request: APIRequestContext) {
  expect((await request.patch('/api/auth/me', { data: { name: USER.name, avatarAssetId: null } })).ok()).toBeTruthy()
  expect((await request.patch('/api/settings', { data: { mediaDir: null } })).ok()).toBeTruthy()
  expect((await request.put('/api/settings/api-key', { data: { apiKey: E2E_KEY } })).ok()).toBeTruthy()
}

/** Page des paramètres, sur un onglet donné, prête à la saisie. */
export async function gotoSettings(page: Page, tab?: string) {
  await page.goto(tab ? `/parametres?tab=${tab}` : '/parametres')
  await hydrated(page)
  await expect(page.getByRole('tablist')).toBeVisible()
}

/** Titres des fils dans l'ordre de la liste de gauche. */
export async function threadTitles(page: Page): Promise<string[]> {
  const links = page.getByTestId('thread-panel').locator('a[href^="/t/"]')
  return links.evaluateAll((els) =>
    els.map((el) => (el.querySelector('span.truncate')?.textContent ?? '').trim()),
  )
}
