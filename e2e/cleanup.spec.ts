/**
 * Nettoyage des brouillons (localStorage) : un fil mis à la corbeille emporte
 * son brouillon, et rien d'autre. Un persona n'a pas de fil : sa suppression
 * ne touche à aucun brouillon.
 */
import { DRAFTS_KEY, expect, test } from './helpers'

test('fil mis à la corbeille depuis la liste : son brouillon part, les autres restent @core', async ({
  app,
}) => {
  const a = (await app.generate({ prompt: 'fil un' })).thread
  const b = (await app.generate({ prompt: 'fil deux' })).thread
  await app.gotoThread(a.id)
  await app.prompt.fill('brouillon un')
  await app.openThread('fil deux')
  await app.prompt.fill('brouillon deux')
  await app.gotoNew()
  await app.prompt.fill('brouillon nouveau')
  expect(Object.keys(await app.drafts()).sort()).toEqual([a.id, b.id, 'new'].sort())

  await app.trashFromList('fil un')
  const drafts = await app.drafts()
  expect(drafts).not.toHaveProperty(a.id)
  expect(drafts[b.id].prompt).toBe('brouillon deux')
  expect(drafts.new.prompt).toBe('brouillon nouveau')
})

test('fil affiché mis à la corbeille : son brouillon ne revient pas', async ({ app, page }) => {
  const a = (await app.generate({ prompt: 'fil courant' })).thread
  await app.gotoThread(a.id)
  await app.prompt.fill('brouillon courant')
  await app.trashFromList('fil courant')
  await expect(page).not.toHaveURL(/\/t\//)
  await app.ready()
  expect(await app.drafts()).not.toHaveProperty(a.id)
  await expect(app.prompt).toHaveValue('')
})

test('fil restauré depuis la corbeille : sans brouillon', async ({ app, page }) => {
  const a = (await app.generate({ prompt: 'fil restaure' })).thread
  await app.gotoThread(a.id)
  await app.prompt.fill('brouillon perdu')
  await app.trashFromList('fil restaure')
  await expect(page).not.toHaveURL(/\/t\//)
  expect((await page.request.post(`/api/trash/threads/${a.id}/restore`)).ok()).toBeTruthy()
  await app.gotoThread(a.id)
  await expect(app.prompt).toHaveValue('')
  expect(await app.drafts()).not.toHaveProperty(a.id)
})

test('persona mis à la corbeille : les fils et leurs brouillons restent', async ({ app, page }) => {
  const persona = await app.createPersona({ name: 'Alice' })
  // Une référence d'Alice a servi dans ce fil : il n'appartient pas pour autant au persona.
  const used = (await app.generateWithPersona(persona.id, { prompt: 'fil alice' })).thread
  await app.gotoThread(used.id)
  await app.prompt.fill('brouillon alice')
  await app.gotoNew()
  await app.prompt.fill('brouillon nouveau')
  expect(Object.keys(await app.drafts())).toHaveLength(2)

  await page.goto(`/personas/${persona.id}`)
  await page.getByRole('button', { name: /Supprimer le persona/ }).click()
  await page.getByRole('button', { name: 'Mettre à la corbeille' }).click()
  await expect(page).toHaveURL(/\/bibliotheque$/)

  const drafts = await app.drafts()
  expect(drafts[used.id].prompt).toBe('brouillon alice')
  expect(drafts.new.prompt).toBe('brouillon nouveau')
  await expect(page.getByTestId('thread-panel').getByRole('link', { name: /fil alice/ })).toBeVisible()
})

test('un brouillon vide n’est jamais enregistré', async ({ app }) => {
  const a = (await app.generate({ prompt: 'fil vide' })).thread
  await app.gotoThread(a.id)
  await app.count.click()
  await app.chooseRatio('16:9')
  await app.chooseModel('GPT Image 2.5')
  expect(await app.drafts()).toEqual({})
  // Texte écrit puis effacé : retiré aussi.
  await app.prompt.fill('temporaire')
  expect(await app.drafts()).toHaveProperty(a.id)
  await app.prompt.fill('')
  expect(await app.drafts()).toEqual({})
})

test('stockage corrompu : l’app fonctionne et réécrit des brouillons valides', async ({
  app,
  page,
}) => {
  await app.gotoNew()
  await page.evaluate((k) => localStorage.setItem(k, '{pas du json'), DRAFTS_KEY)
  await app.reload()
  await expect(app.modelPicker).toContainText('Seedream 5.0 Flash')
  await app.prompt.fill('reprise')
  expect((await app.drafts()).new.prompt).toBe('reprise')
})
