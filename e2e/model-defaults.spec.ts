/**
 * Choix du modèle : persona, sinon modèle économique de l'app. Plus de modèle
 * général, de logo ni de couleur dans le paramétrage.
 */
import { expect, test } from './helpers'

const GPT = 'openai/gpt-image-2.5-sunburst'
const WAN_PRIME = 'alibaba/wan-3.0-prime'

test('sans persona : Seedream 5.0 Flash, puis Seedance 2.0 Mini en vidéo @core', async ({ app }) => {
  await app.gotoNew()
  await expect(app.modelPicker).toContainText('Seedream 5.0 Flash')
  await app.chooseMedia('Vidéo')
  await expect(app.modelPicker).toContainText('Seedance 2.0 Mini')
  await app.chooseMedia('Photo')
  await expect(app.modelPicker).toContainText('Seedream 5.0 Flash')
})

test('persona avec modèles par défaut : photo et vidéo @core', async ({ app }) => {
  await app.createPersona({ name: 'Alice', defaultImageFamily: GPT, defaultVideoFamily: WAN_PRIME })
  await app.gotoNew()
  await app.selectPersona('Alice')
  await expect(app.modelPicker).toContainText('GPT Image 2.5')
  await app.chooseMedia('Vidéo')
  await expect(app.modelPicker).toContainText('Wan 3.0 Prime')
})

test('fiche persona : même menu que le composer, choix puis retour à Automatique @core', async ({
  app,
  page,
}) => {
  const persona = await app.createPersona({ name: 'Alice' })
  await page.goto(`/personas/${persona.id}`)
  const photo = page.getByRole('button', { name: 'Automatique (Seedream 5.0 Flash)' })
  await expect(photo).toBeVisible()
  await expect(page.getByRole('button', { name: 'Automatique (Seedance 2.0 Mini)' })).toBeVisible()

  await photo.click()
  // Même menu que le composer : recherche, sections, logos.
  await expect(page.getByPlaceholder('Rechercher un modèle')).toBeVisible()
  await expect(page.getByText('Modèles recommandés')).toBeVisible()
  await app.pickInModelMenu('GPT Image 2.5')
  await expect(page.getByRole('button', { name: 'GPT Image 2.5' })).toBeVisible()
  await expect
    .poll(async () => (await (await page.request.get('/api/personas')).json()).personas[0].defaultImageFamily)
    .toBe(GPT)

  await page.getByRole('button', { name: 'Revenir au choix automatique' }).click()
  await expect(photo).toBeVisible()
  await expect
    .poll(async () => (await (await page.request.get('/api/personas')).json()).personas[0].defaultImageFamily)
    .toBeNull()
})

test('paramétrage : plus de modèle général, de logo ni de couleur', async ({ page }) => {
  await page.goto('/parametres')
  const tabs = page.getByRole('tablist')
  await expect(tabs.getByRole('tab', { name: 'Compte' })).toBeVisible()
  for (const name of ['Modèles', 'Logo', 'Couleur']) {
    await expect(tabs.getByRole('tab', { name })).toHaveCount(0)
  }
  const settings = await (await page.request.get('/api/settings')).json()
  expect(settings.settings).not.toHaveProperty('defaultImageFamily')
  expect(settings.settings).not.toHaveProperty('defaultVideoFamily')
})

test('boutons : fond sombre par défaut, clair seulement pour envoyer', async ({ app, page }) => {
  await page.goto('/parametres')
  const save = page.getByRole('button', { name: 'Enregistrer' }).first()
  const bg = await save.evaluate((el) => getComputedStyle(el).backgroundColor)
  // Pas de fond blanc (#fafafa ou proche).
  expect(bg).not.toMatch(/rgb\((2[4-5]\d), (2[4-5]\d), (2[4-5]\d)\)/)
  await app.gotoNew()
  await app.prompt.fill('un test')
  const send = page.getByRole('button', { name: /^Générer/ })
  const image = await send.evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(image).toContain('gradient')
})
