/**
 * Dictée dans le composer : le texte arrive en gris à la position du curseur, Entrée le
 * valide (sans envoyer), Échap l'annule, ⌥M lance ou valide. En test, la dictée est simulée
 * (« Bonjour depuis la dictée »), sans micro ni appel à ElevenLabs.
 */
import { expect, test } from './helpers'
import { hydrated } from './support-auth'

const SAID = 'Bonjour depuis la dictée'

test('dicter : texte en gris au curseur, Entrée valide sans envoyer @core @smoke', async ({ app, page }) => {
  await app.gotoNew()
  await app.prompt.fill('début fin')
  // Curseur entre les deux mots.
  await app.prompt.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 6))
  await page.getByRole('button', { name: 'Dicter' }).click()
  const preview = page.getByTestId('dictation-preview')
  await expect(preview).toContainText(`début ${SAID} fin`)
  await expect(preview.locator('span')).toHaveText(`${SAID} `)
  await expect(app.prompt).toHaveAttribute('readonly', '')

  await app.prompt.press('Enter')
  await expect(app.prompt).toHaveValue(`début ${SAID} fin`)
  await expect(preview).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Dicter' })).toBeVisible()
  // Rien n'est parti : on est toujours sur le fil vierge.
  await expect(page).toHaveURL(/\/nouveau$/)
})

test('Échap annule la dictée et rend le texte d’avant', async ({ app, page }) => {
  await app.gotoNew()
  await app.prompt.fill('garde-moi')
  await page.getByRole('button', { name: 'Dicter' }).click()
  await expect(page.getByTestId('dictation-preview')).toContainText(SAID)
  await app.prompt.press('Escape')
  await expect(app.prompt).toHaveValue('garde-moi')
  await expect(page.getByTestId('dictation-preview')).toHaveCount(0)
})

test('⌥M lance la dictée, puis la valide', async ({ app, page }) => {
  await app.gotoNew()
  await page.keyboard.press('Alt+m')
  await expect(page.getByTestId('dictation-preview')).toContainText(SAID)
  await page.keyboard.press('Alt+m')
  await expect(app.prompt).toHaveValue(SAID)
})

test('⌥M en AZERTY sur Mac (caractère « µ ») lance aussi la dictée', async ({ app, page }) => {
  await app.gotoNew()
  // Touche M d'un clavier AZERTY : emplacement « Semicolon », caractère « µ » avec Option.
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'µ', code: 'Semicolon', altKey: true, bubbles: true }),
    ),
  )
  await expect(page.getByTestId('dictation-preview')).toContainText(SAID)
})

test('Paramétrage, Général : modèle de dictée rangé en Rapide / Précis, sans clé serveur grisé', async ({ page }) => {
  await page.goto('/parametres')
  await hydrated(page)
  const field = page.getByRole('button', { name: 'Modèle de dictée' })
  await expect(field).toContainText('ElevenLabs Scribe v2 Realtime')
  await field.click()
  const menu = page.getByTestId('dictation-menu')
  await expect(menu).toContainText('Rapide')
  await expect(menu).toContainText('Précis')
  // Deepgram et Cartesia : pas de clé sur le serveur de test.
  await expect(menu.getByRole('menuitemradio', { name: /Deepgram Flux/ })).toHaveAttribute('aria-disabled', 'true')
  await expect(menu.getByRole('menuitemradio', { name: /Cartesia Ink-2/ })).toHaveAttribute('aria-disabled', 'true')
  await expect(menu.getByRole('menuitemradio', { name: /ElevenLabs/ })).toHaveAttribute('aria-checked', 'true')
})

test('pendant la dictée, Entrée valide même sans focus dans le composer', async ({ app, page }) => {
  await app.gotoNew()
  await page.getByRole('button', { name: 'Dicter' }).click()
  await expect(page.getByTestId('dictation-preview')).toContainText(SAID)
  // Focus ailleurs : sur le lien Galerie de la sidebar (Entrée l'ouvrirait normalement).
  await page.getByTestId('thread-panel').getByRole('link', { name: 'Galerie' }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/nouveau$/)
  await expect(app.prompt).toHaveValue(SAID)
})

test('Réinitialiser pendant la dictée l’arrête et vide tout ; Annuler rend le texte d’avant', async ({ app, page }) => {
  await app.gotoNew()
  await app.prompt.fill('texte d’avant')
  await page.getByRole('button', { name: 'Dicter' }).click()
  await expect(page.getByTestId('dictation-preview')).toContainText(SAID)
  // Pendant la dictée : pas de placeholder.
  await expect(app.prompt).toHaveAttribute('placeholder', '')
  await page.getByRole('button', { name: 'Réinitialiser le composer' }).click()
  await expect(page.getByTestId('dictation-preview')).toHaveCount(0)
  await expect(app.prompt).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Dicter' })).toBeVisible()
  await page.getByRole('button', { name: 'Annuler' }).click()
  await expect(app.prompt).toHaveValue('texte d’avant')
})
