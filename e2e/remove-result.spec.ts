/**
 * Menu « … » d'un résultat : « Supprimer le résultat » (image seule) ou
 * « Supprimer le lot » (série), remplacé par « Contenu supprimé », annulable.
 */
import { expect, test } from './helpers'

test('supprimer le résultat : emplacement « Contenu supprimé », puis Annuler le remet @core', async ({ app, page }) => {
  const { thread } = await app.generate({ prompt: 'fil suppression' })
  await app.gotoThread(thread.id)
  await expect(page.locator('img[alt="fil suppression"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Options du résultat' }).click()
  await page.getByRole('menuitem', { name: 'Supprimer le résultat' }).click()
  await expect(page.getByTestId('removed-result')).toHaveText('Contenu supprimé')
  await expect(page.locator('img[alt="fil suppression"]')).toHaveCount(0)
  // Plus de coût ni de « Relancer » sous un contenu supprimé.
  await expect(page.getByTestId('result-cost')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Relancer' })).toHaveCount(0)
  // La demande reste.
  await expect(page.getByTestId('request-bubble')).toHaveText('fil suppression')
  await page.getByRole('button', { name: 'Annuler' }).click()
  await expect(page.locator('img[alt="fil suppression"]')).toHaveCount(1)
  await expect(page.getByTestId('removed-result')).toHaveCount(0)
})

test('une série propose « Supprimer le lot » et retire les 4 images', async ({ app, page }) => {
  const { thread } = await app.generate({ prompt: 'fil lot', params: {} })
  // Série de 4 depuis le composer.
  await app.gotoThread(thread.id)
  await app.prompt.fill('quatre images')
  await app.count.click()
  await app.send()
  await expect(page.getByText('Série · 4 images')).toBeVisible()
  const menus = page.getByRole('button', { name: 'Options du résultat' })
  await menus.last().click()
  await page.getByRole('menuitem', { name: 'Supprimer le lot' }).click()
  await expect(page.getByTestId('removed-result')).toHaveCount(1)
  await expect(page.locator('img[alt="quatre images"]')).toHaveCount(0)
  // Plus de « Série · 4 images » au-dessus d'un contenu supprimé.
  await expect(page.getByText('Série · 4 images')).toHaveCount(0)
  // La première génération est intacte.
  await expect(page.locator('img[alt="fil lot"]')).toHaveCount(1)
  await page.reload()
  await app.ready()
  await expect(page.getByTestId('removed-result')).toHaveCount(1)
  await expect(page.getByText('Série · 4 images')).toHaveCount(0)
  // Emplacement étroit : 190 px.
  expect((await page.getByTestId('removed-result').boundingBox())!.width).toBe(190)
})
