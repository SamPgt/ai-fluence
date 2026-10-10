import { expect, test } from './helpers'

test('l’app démarre avec le modèle économique par défaut @core', async ({ app }) => {
  await app.gotoNew()
  await expect(app.modelPicker).toContainText('Seedream 5.0 Flash')
})

test('une génération (faux SpicyAPI) apparaît dans son fil @core', async ({ app, page }) => {
  const { thread, generation } = await app.generate({ prompt: 'une pomme' })
  expect(generation.outputs).toHaveLength(1)
  await app.gotoThread(thread.id)
  await expect(page.getByText('une pomme').first()).toBeVisible()
})
