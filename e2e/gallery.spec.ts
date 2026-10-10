/**
 * Galerie (/galerie) : tous les résultats générés, du plus récent au plus ancien,
 * visionneuse, lien vers le fil, pagination « Charger plus » et état vide.
 */
import type { Page } from '@playwright/test'
import { expect, test } from './helpers'
import { createGeneration, generateDone, uploadImage, waitThreadDone } from './support-thread'

const items = (page: Page) => page.getByTestId('gallery-item')
const viewer = (page: Page) => page.getByRole('dialog', { name: 'Aperçu' })

async function gotoGallery(page: Page) {
  await page.goto('/galerie')
  await expect(page.getByText('Galerie', { exact: true })).toBeVisible()
}

test('galerie vide : un message l’indique, pas de pagination', async ({ app, page }) => {
  void app
  await gotoGallery(page)
  await expect(page.getByText('Rien ici pour l’instant.')).toBeVisible()
  await expect(items(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Charger plus' })).toHaveCount(0)
})

test('les fichiers envoyés à la main n’apparaissent pas, seulement les résultats', async ({ app, page }) => {
  void app
  await uploadImage(page)
  await gotoGallery(page)
  await expect(page.getByText('Rien ici pour l’instant.')).toBeVisible()
})

test('liste les résultats du plus récent au plus ancien @core', async ({ app, page }) => {
  void app
  for (const prompt of ['premier resultat', 'deuxieme resultat', 'troisieme resultat']) {
    await generateDone(page, { prompt })
  }
  await gotoGallery(page)
  await expect(items(page)).toHaveCount(3)
  const links = items(page).getByRole('link')
  await expect(links.nth(0)).toContainText('troisieme resultat')
  await expect(links.nth(1)).toContainText('deuxieme resultat')
  await expect(links.nth(2)).toContainText('premier resultat')
  await expect(links.nth(0)).toContainText('Seedream 5.0 Flash')
})

test('une série donne une case par image', async ({ app, page }) => {
  void app
  await generateDone(page, { prompt: 'serie en galerie', count: 4 })
  await gotoGallery(page)
  await expect(items(page)).toHaveCount(4)
})

test('clic sur un résultat : la visionneuse s’ouvre, Échap la ferme', async ({ app, page }) => {
  void app
  const { generation } = await generateDone(page, { prompt: 'a voir en grand' })
  await gotoGallery(page)
  await items(page).first().getByRole('button').click()
  await expect(viewer(page)).toBeVisible()
  await expect(viewer(page).locator('img')).toHaveAttribute('src', new RegExp(generation.outputs[0].id))
  await page.keyboard.press('Escape')
  await expect(viewer(page)).toHaveCount(0)
})

test('le lien d’un résultat mène à son fil', async ({ app, page }) => {
  const { thread } = await generateDone(page, { prompt: 'retour au fil' })
  await gotoGallery(page)
  const link = items(page).first().getByRole('link')
  await expect(link).toHaveAttribute('href', `/t/${thread.id}`)
  await items(page).first().hover()
  await link.click()
  await expect(page).toHaveURL(new RegExp(`/t/${thread.id}$`))
  await app.ready()
  await expect(page.getByTestId('request-bubble')).toHaveText('retour au fil')
})

test('un upscale apparaît aussi, avec un lien vers le fil de sa source', async ({ app, page }) => {
  void app
  const { thread, generation } = await generateDone(page, { prompt: 'source agrandie' })
  const res = await page.request.post('/api/generations/upscale', {
    data: { assetId: generation.outputs[0].id, resolution: '2k' },
  })
  expect(res.status(), await res.text()).toBe(201)
  await waitThreadDone(page, thread.id, 2)
  await gotoGallery(page)
  await expect(items(page)).toHaveCount(2)
  await expect(items(page).first().getByRole('link')).toHaveAttribute('href', `/t/${thread.id}`)
  await expect(items(page).first().getByRole('link')).toContainText('(sans prompt)')
})

test('les résultats d’un fil à la corbeille sont masqués', async ({ app, page }) => {
  await generateDone(page, { prompt: 'resultat garde' })
  const { thread } = await generateDone(page, { prompt: 'resultat jete' })
  await app.trashThread(thread.id)
  await gotoGallery(page)
  await expect(items(page)).toHaveCount(1)
  await expect(items(page).first()).toContainText('resultat garde')
})

test('filtre par persona', async ({ app, page }) => {
  const persona = await app.createPersona({ name: 'Iris' })
  await generateDone(page, { prompt: 'sans persona' })
  await generateDone(page, { prompt: 'avec iris', personaId: persona.id })
  await gotoGallery(page)
  await expect(items(page)).toHaveCount(2)
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Iris' }).click()
  await expect(items(page)).toHaveCount(1)
  await expect(items(page).first()).toContainText('avec iris')
})

test('« Charger plus » affiche la page suivante, puis disparaît @core', async ({ app, page }) => {
  void app
  test.setTimeout(120_000)
  // 6 séries de 12 : 72 résultats, pour des pages de 60.
  let last = ''
  for (let i = 1; i <= 6; i++) {
    last = `lot ${i}`
    const { thread } = await createGeneration(page, { prompt: last, count: 12 })
    await waitThreadDone(page, thread.id, 12)
  }
  await gotoGallery(page)
  await expect(items(page)).toHaveCount(60)
  await expect(items(page).first()).toContainText(last)
  const more = page.getByRole('button', { name: 'Charger plus' })
  await expect(more).toBeVisible()
  await more.click()
  await expect(items(page)).toHaveCount(72)
  await expect(items(page).last()).toContainText('lot 1')
  await expect(more).toHaveCount(0)
})
