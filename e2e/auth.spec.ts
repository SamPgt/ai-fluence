/**
 * Authentification : inscription, connexion, déconnexion et routes protégées.
 * Chaque test tourne dans un contexte sans session, pour ne jamais toucher à
 * la session partagée du compte e2e.
 */
import { expect, test } from '@playwright/test'
import { USER } from './env'
import { hydrated, LOGGED_OUT, signupByApi, uniqueEmail } from './support-auth'

test.describe('déconnecté', () => {
  test.use({ storageState: LOGGED_OUT })

  test('l’inscription crée le compte et ouvre l’app sur les clés API @core', async ({ page }) => {
    await page.goto('/inscription')
    await hydrated(page)
    await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible()
    const email = uniqueEmail('inscription')
    await page.getByLabel('Nom').fill('Nouvelle Personne')
    await page.getByLabel('E-mail').fill(email)
    await page.getByLabel('Mot de passe').fill('mot-de-passe-1')
    await page.getByRole('button', { name: 'Créer le compte' }).click()

    await expect(page).toHaveURL(/\/parametres\?tab=api-key/)
    await expect(page.getByRole('tab', { name: 'Clés API' })).toHaveAttribute('data-state', 'active')
    await expect(page.getByLabel('Clé SpicyAPI')).toBeVisible()
    // Le compte est bien connecté : son menu porte son nom.
    await page.getByRole('button', { name: 'Menu utilisateur' }).click()
    await expect(page.getByRole('menu')).toContainText('Nouvelle Personne')
    await expect(page.getByRole('menu')).toContainText(email)
  })

  test('l’inscription avec un e-mail déjà pris affiche une erreur', async ({ page }) => {
    await page.goto('/inscription')
    await hydrated(page)
    await page.getByLabel('Nom').fill('Doublon')
    await page.getByLabel('E-mail').fill(USER.email)
    await page.getByLabel('Mot de passe').fill('mot-de-passe-1')
    await page.getByRole('button', { name: 'Créer le compte' }).click()
    await expect(page.getByText('Un compte existe déjà avec cet e-mail.')).toBeVisible()
    await expect(page).toHaveURL(/\/inscription/)
  })

  test('l’inscription refuse un mot de passe trop court', async ({ page }) => {
    await page.goto('/inscription')
    await hydrated(page)
    await page.getByLabel('Nom').fill('Court')
    await page.getByLabel('E-mail').fill(uniqueEmail('court'))
    await page.getByLabel('Mot de passe').fill('abc')
    await page.getByRole('button', { name: 'Créer le compte' }).click()
    // Validation du navigateur (minLength 8) : on reste sur la page.
    await expect(page).toHaveURL(/\/inscription/)
    expect(await page.getByLabel('Mot de passe').evaluate((el: HTMLInputElement) => el.validity.tooShort)).toBe(true)
  })

  test('la connexion avec un mauvais mot de passe affiche une erreur', async ({ page }) => {
    await page.goto('/connexion')
    await hydrated(page)
    await page.getByLabel('E-mail').fill(USER.email)
    await page.getByLabel('Mot de passe').fill('pas-le-bon')
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByText('E-mail ou mot de passe incorrect.')).toBeVisible()
    await expect(page).toHaveURL(/\/connexion/)
  })

  test('la connexion réussie ouvre l’app @core', async ({ page }) => {
    await page.goto('/connexion')
    await hydrated(page)
    await page.getByLabel('E-mail').fill(USER.email)
    await page.getByLabel('Mot de passe').fill(USER.password)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: 'Menu utilisateur' })).toBeVisible()
    await expect(page.getByTestId('model-picker')).toBeVisible()
  })

  test('les liens passent de la connexion à l’inscription et retour', async ({ page }) => {
    await page.goto('/connexion')
    await hydrated(page)
    await page.getByRole('link', { name: 'Créer un compte' }).click()
    await expect(page).toHaveURL(/\/inscription/)
    await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible()
    await page.getByRole('link', { name: 'Se connecter' }).click()
    await expect(page).toHaveURL(/\/connexion/)
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  })

  test('le bouton de connexion a le dégradé clair et un spinner fin pendant l’envoi', async ({ page }) => {
    // Réponse retenue pour observer l'état « en cours ».
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    await page.route('**/api/auth/login', async (route) => {
      await held
      await route.continue()
    })
    await page.goto('/connexion')
    await hydrated(page)
    const button = page.getByRole('button', { name: 'Se connecter' })
    const background = await button.evaluate((el) => getComputedStyle(el).backgroundImage)
    expect(background).toContain('linear-gradient')
    expect(background).toContain('rgb(252, 252, 252)')
    expect(background).toContain('rgb(180, 180, 180)')

    await page.getByLabel('E-mail').fill(USER.email)
    await page.getByLabel('Mot de passe').fill(USER.password)
    await button.click()
    const spinner = page.getByLabel('Connexion en cours')
    await expect(spinner).toBeVisible()
    await expect(spinner).toHaveAttribute('stroke-width', '1.5')
    await expect(page.locator('button[type=submit]')).toBeDisabled()
    release()
    await expect(page).toHaveURL(/\/$/)
  })

  for (const path of ['/', '/parametres', '/corbeille', '/galerie', '/t/00000000-0000-0000-0000-000000000000']) {
    test(`la route protégée ${path} renvoie vers la connexion`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/connexion$/)
      await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    })
  }

  test('la déconnexion depuis le menu utilisateur ramène à la connexion @core', async ({ page }) => {
    // Compte à part : déconnecter le compte e2e invaliderait la session partagée.
    const user = await signupByApi(page.request, 'Compte Sortant')
    await page.goto('/')
    await hydrated(page)
    await page.getByRole('button', { name: 'Menu utilisateur' }).click()
    await expect(page.getByRole('menu')).toContainText(user.email)
    await page.getByRole('menuitem', { name: 'Déconnexion' }).click()
    await expect(page).toHaveURL(/\/connexion$/)

    // La session est bien détruite : l'app redemande la connexion.
    await page.goto('/parametres')
    await expect(page).toHaveURL(/\/connexion$/)
    const me = await (await page.request.get('/api/auth/me')).json()
    expect(me.user).toBeNull()
  })
})

test.describe('connecté', () => {
  test('les pages de connexion et d’inscription renvoient vers l’app', async ({ page }) => {
    await page.goto('/connexion')
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/inscription')
    await expect(page).toHaveURL(/\/$/)
  })
})
