/**
 * Choix du modèle : modèle par défaut du Paramétrage (onglet Général), sinon
 * modèle économique de l'app. Un persona n'a plus de modèle par défaut.
 */
import { expect, test } from './helpers'
import { gotoSettings, hydrated } from './support-auth'

const GPT = 'openai/gpt-image-2.5-sunburst'
const WAN_PRIME = 'alibaba/wan-3.0-prime'

test('sans modèle par défaut : Seedream 5.0 Flash, puis Seedance 2.0 Mini en vidéo @core', async ({ app }) => {
  await app.gotoNew()
  await expect(app.modelPicker).toContainText('Seedream 5.0 Flash')
  await app.chooseMedia('Vidéo')
  await expect(app.modelPicker).toContainText('Seedance 2.0 Mini')
  await app.chooseMedia('Photo')
  await expect(app.modelPicker).toContainText('Seedream 5.0 Flash')
})

const defaults = async (page: import('@playwright/test').Page) => {
  const { settings } = await (await page.request.get('/api/settings')).json()
  return { image: settings.defaultImageFamily, video: settings.defaultVideoFamily }
}

test('Paramétrage, onglet Général : le modèle choisi sert pour un nouveau fil @core @smoke', async ({
  app,
  page,
}) => {
  await gotoSettings(page)
  await expect(page.getByRole('tab', { name: 'Général' })).toHaveAttribute('data-state', 'active')
  const photo = page.getByRole('button', { name: 'Seedream 5.0 Flash par défaut' })
  await expect(photo).toBeVisible()
  await expect(page.getByRole('button', { name: 'Seedance 2.0 Mini par défaut' })).toBeVisible()

  await photo.click()
  // Même menu que le composer : recherche, sections, logos.
  await expect(page.getByPlaceholder('Rechercher un modèle')).toBeVisible()
  await expect(page.getByText('Modèles recommandés')).toBeVisible()
  await app.pickInModelMenu('GPT Image 2.5')
  await expect(page.getByRole('button', { name: 'GPT Image 2.5' })).toBeVisible()
  await expect.poll(async () => (await defaults(page)).image).toBe(GPT)

  // Nouveau fil : le modèle par défaut est proposé d'office.
  await app.gotoNew()
  await expect(app.modelPicker).toContainText('GPT Image 2.5')
})

test('modèle vidéo par défaut, puis retour à Automatique', async ({ app, page }) => {
  expect((await page.request.patch('/api/settings', { data: { defaultVideoFamily: WAN_PRIME } })).ok()).toBeTruthy()
  await app.gotoNew()
  await expect(app.modelPicker).toContainText('Seedream 5.0 Flash')
  await app.chooseMedia('Vidéo')
  await expect(app.modelPicker).toContainText('Wan 3.0 Prime')

  await gotoSettings(page)
  await expect(page.getByRole('button', { name: 'Wan 3.0 Prime' })).toBeVisible()
  await page.getByRole('button', { name: 'Revenir au choix automatique' }).click()
  await expect(page.getByRole('button', { name: 'Seedance 2.0 Mini par défaut' })).toBeVisible()
  await expect.poll(async () => (await defaults(page)).video).toBeNull()
})

test('fiche persona : plus de modèle par défaut', async ({ app, page }) => {
  const persona = await app.createPersona({ name: 'Alice' })
  await page.goto(`/personas/${persona.id}`)
  await expect(page.getByText('Paramétrage de Alice')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Automatique/ })).toHaveCount(0)
})

test('boutons : fond sombre par défaut, clair seulement pour envoyer', async ({ app, page }) => {
  await page.goto('/parametres')
  await hydrated(page)
  const save = page.getByRole('button', { name: 'Changer la photo', exact: true })
  const bg = await save.evaluate((el) => getComputedStyle(el).backgroundColor)
  // Pas de fond blanc (#fafafa ou proche).
  expect(bg).not.toMatch(/rgb\((2[4-5]\d), (2[4-5]\d), (2[4-5]\d)\)/)
  await app.gotoNew()
  await app.prompt.fill('un test')
  const send = page.getByRole('button', { name: /^Générer/ })
  const image = await send.evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(image).toContain('gradient')
})
