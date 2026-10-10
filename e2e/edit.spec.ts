/**
 * Éditer / Animer : nouvelle intention, le composer repart de zéro avec l'image.
 * Numéros des vignettes, crayon sur l'image à modifier, consigne envoyée au modèle.
 */
import { expect, test } from './helpers'

const GPT = 'openai/gpt-image-2.5-sunburst'

test.describe('Éditer', () => {
  test('repart de zéro : image en position 1 avec le crayon, modèle de la génération @core', async ({
    app,
  }) => {
    const { thread } = await app.generate({ prompt: 'fil edit', family: GPT })
    await app.gotoThread(thread.id)
    await app.chooseModel('Qwen Image 3.0 Pro')
    await app.prompt.fill('un ancien brouillon')
    await app.attachFile()
    await expect(app.attachments).toHaveCount(1)

    await app.resultAction('Éditer (image → image)')
    await expect(app.prompt).toHaveValue('')
    await expect(app.attachments).toHaveCount(1)
    await expect(app.tags.first()).toHaveAttribute('title', 'Image à modifier')
    await expect(app.tags.first().locator('svg')).toHaveCount(1)
    await expect(app.modelPicker).toContainText('GPT Image 2.5')
  })

  test('faux clic : départ sans rien écrire, composer vide au retour @core', async ({ app }) => {
    const { thread } = await app.generate({ prompt: 'fil faux clic' })
    await app.gotoThread(thread.id)
    await app.resultAction('Éditer (image → image)')
    await expect(app.attachments).toHaveCount(1)
    expect(await app.drafts()).not.toHaveProperty(thread.id)
    await app.gotoNew()
    await app.openThread('fil faux clic')
    await expect(app.attachments).toHaveCount(0)
  })

  test('avec du texte : le brouillon d’édition est gardé', async ({ app }) => {
    const { thread } = await app.generate({ prompt: 'fil garde' })
    await app.gotoThread(thread.id)
    await app.resultAction('Éditer (image → image)')
    await app.prompt.fill('change le fond')
    await app.gotoNew()
    await app.openThread('fil garde')
    await expect(app.prompt).toHaveValue('change le fond')
    await expect(app.attachments).toHaveCount(1)
    await expect(app.tags.first()).toHaveAttribute('title', 'Image à modifier')
  })

  test('une image jointe à la main après Éditer garde le brouillon', async ({ app }) => {
    const { thread } = await app.generate({ prompt: 'fil ajout' })
    await app.gotoThread(thread.id)
    await app.resultAction('Éditer (image → image)')
    await app.attachFile()
    await expect(app.attachments).toHaveCount(2)
    await app.gotoNew()
    await app.openThread('fil ajout')
    await expect(app.attachments).toHaveCount(2)
  })

  test('numéros des vignettes : crayon, 2, 3, puis 1, 2 une fois l’image à modifier retirée', async ({
    app,
  }) => {
    const { thread } = await app.generate({ prompt: 'fil numeros' })
    await app.gotoThread(thread.id)
    await app.resultAction('Éditer (image → image)')
    await app.attachFile()
    await expect(app.attachments).toHaveCount(2)
    await app.attachFile()
    await expect(app.attachments).toHaveCount(3)
    await expect(app.tags).toHaveText(['', '2', '3'])
    await app.attachments.first().hover()
    await app.attachments.first().getByRole('button', { name: 'Retirer' }).click()
    await expect(app.tags).toHaveText(['1', '2'])
  })

  test('la consigne part au modèle, jamais dans la bulle du fil @core', async ({ app, page }) => {
    const { thread } = await app.generate({ prompt: 'fil consigne' })
    await app.gotoThread(thread.id)
    await app.resultAction('Éditer (image → image)')
    await app.attachFile()
    await expect(app.attachments).toHaveCount(2)
    await app.prompt.fill('change le fond')
    const created = page.waitForResponse((r) => r.url().endsWith('/api/generations') && r.request().method() === 'POST')
    await app.send()
    const { generation } = await (await created).json()
    expect(generation.prompt).toBe('change le fond')
    expect(generation.finalPrompt).toContain('Edit image 1')
    await expect(page.getByText('change le fond').first()).toBeVisible()
    await expect(page.getByText(/Edit image 1/)).toHaveCount(0)
  })

  test('image à modifier retirée : plus de consigne', async ({ app, page }) => {
    const { thread } = await app.generate({ prompt: 'fil sans consigne' })
    await app.gotoThread(thread.id)
    await app.resultAction('Éditer (image → image)')
    await app.attachFile()
    await expect(app.attachments).toHaveCount(2)
    await app.attachments.first().hover()
    await app.attachments.first().getByRole('button', { name: 'Retirer' }).click()
    await app.prompt.fill('un nouveau décor')
    const created = page.waitForResponse((r) => r.url().endsWith('/api/generations') && r.request().method() === 'POST')
    await app.send()
    const { generation } = await (await created).json()
    expect(generation.finalPrompt).not.toContain('Edit image 1')
  })
})

test('Animer : repart de zéro avec l’image de début et le modèle vidéo économique @core', async ({
  app,
}) => {
  const { thread } = await app.generate({ prompt: 'fil animer' })
  await app.gotoThread(thread.id)
  await app.prompt.fill('un ancien brouillon')
  await app.resultAction('Animer (image → vidéo)')
  await expect(app.prompt).toHaveValue('')
  await expect(app.attachments).toHaveCount(1)
  await expect(app.modelPicker).toContainText('Seedance 2.0 Mini')
  await expect(app.tags).toHaveText(['Début'])
})

test('fil : les images sources sont au-dessus de la bulle, la bulle ne garde que le texte', async ({
  app,
  page,
}) => {
  const { thread } = await app.generate({ prompt: 'fil sources' })
  await app.gotoThread(thread.id)
  await app.attachFile()
  await expect(app.attachments).toHaveCount(1)
  await app.prompt.fill('avec une source')
  await app.send()
  const bubble = page.getByTestId('request-bubble').filter({ hasText: 'avec une source' })
  await expect(bubble).toBeVisible()
  await expect(bubble.locator('img')).toHaveCount(0)
  const refs = page.getByTestId('request-references')
  await expect(refs.locator('img')).toHaveCount(1)
  // Les images sont au-dessus de la bulle.
  const [r, b] = [await refs.boundingBox(), await bubble.boundingBox()]
  expect(r!.y + r!.height).toBeLessThanOrEqual(b!.y)
})
