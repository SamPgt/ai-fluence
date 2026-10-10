/**
 * Nettoyage des brouillons (localStorage) : un fil ou un persona mis à la
 * corbeille emporte ses brouillons, et rien d'autre.
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

test('persona mis à la corbeille : les brouillons de ses fils partent, pas les autres @core', async ({
  app,
  page,
}) => {
  const persona = await app.createPersona({ name: 'Alice' })
  const own = (await app.generate({ prompt: 'fil alice', personaId: persona.id })).thread
  const other = (await app.generate({ prompt: 'fil libre' })).thread
  await app.gotoThread(own.id)
  await app.prompt.fill('brouillon alice')
  await app.gotoThread(other.id)
  await app.prompt.fill('brouillon libre')
  await app.gotoNew()
  await app.prompt.fill('brouillon nouveau')
  expect(Object.keys(await app.drafts())).toHaveLength(3)

  await page.goto(`/personas/${persona.id}`)
  await page.getByRole('button', { name: /Supprimer le persona/ }).click()
  await page.getByRole('button', { name: 'Mettre à la corbeille' }).click()
  await expect(page).not.toHaveURL(new RegExp(persona.id))

  const drafts = await app.drafts()
  expect(drafts).not.toHaveProperty(own.id)
  expect(drafts[other.id].prompt).toBe('brouillon libre')
  expect(drafts.new.prompt).toBe('brouillon nouveau')
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
