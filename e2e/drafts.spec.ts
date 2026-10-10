/**
 * Brouillons du composer : un par fil (plus un pour le nouveau fil), enregistrés
 * dans le navigateur. Un composer vide (ni texte ni image) repart du générique.
 */
import { expect, test } from './helpers'

const GPT = 'openai/gpt-image-2.5-sunburst'
const QWEN = 'alibaba/qwen-image-3.0-pro'

test.describe('nouveau fil', () => {
  test('le brouillon et ses réglages survivent au rechargement @core', async ({ app }) => {
    await app.gotoNew()
    await app.prompt.fill('une plage au coucher du soleil')
    await app.chooseRatio('16:9')
    await app.count.click()
    await app.reload()
    await expect(app.prompt).toHaveValue('une plage au coucher du soleil')
    await expect(app.ratio).toContainText('16:9')
    await expect(app.count).toHaveAccessibleName("Nombre d'images x4")
  })

  test('composer vide : réglages et modèle repartent du générique @core', async ({ app }) => {
    await app.gotoNew()
    const defaultRatio = await app.ratio.textContent()
    await app.chooseModel('GPT Image 2.5')
    await app.chooseRatio('16:9')
    await app.count.click()
    expect(await app.drafts()).toEqual({})
    await app.reload()
    await expect(app.modelPicker).toContainText('Seedream 5.0 Flash')
    await expect(app.ratio).toHaveText(defaultRatio!)
    await expect(app.count).toHaveAccessibleName("Nombre d'images x1")
  })

  test('un seul brouillon quel que soit le persona choisi', async ({ app }) => {
    await app.createPersona({ name: 'Alice', defaultImageFamily: GPT })
    await app.createPersona({ name: 'Bea', defaultImageFamily: QWEN })
    await app.gotoNew()
    await app.selectPersona('Alice')
    await expect(app.modelPicker).toContainText('GPT Image 2.5')
    await app.prompt.fill('portrait en studio')
    await app.selectPersona('Bea')
    await expect(app.prompt).toHaveValue('portrait en studio')
    // Demande commencée : le modèle choisi avec elle reste.
    await expect(app.modelPicker).toContainText('GPT Image 2.5')
    expect(Object.keys(await app.drafts())).toEqual(['new'])
  })

  test('composer vide : changer de persona reprend son modèle', async ({ app }) => {
    await app.createPersona({ name: 'Alice', defaultImageFamily: GPT })
    await app.createPersona({ name: 'Bea', defaultImageFamily: QWEN })
    await app.gotoNew()
    await app.selectPersona('Alice')
    await expect(app.modelPicker).toContainText('GPT Image 2.5')
    await app.selectPersona('Bea')
    await expect(app.modelPicker).toContainText('Qwen Image 3.0 Pro')
  })

  test('envoi : le fil créé garde les réglages, le brouillon du nouveau fil est vidé @core', async ({
    app,
    page,
  }) => {
    await app.gotoNew()
    await app.prompt.fill('un chat roux')
    await app.count.click()
    await app.send()
    await expect(page).toHaveURL(/\/t\//)
    await expect(app.prompt).toHaveValue('')
    await expect(app.count).toHaveAccessibleName("Nombre d'images x4")
    expect(await app.drafts()).not.toHaveProperty('new')
    await app.gotoNew()
    await expect(app.prompt).toHaveValue('')
    await expect(app.count).toHaveAccessibleName("Nombre d'images x1")
  })
})

test.describe('fils existants', () => {
  test('chaque fil garde son brouillon, sans déborder sur les autres @core', async ({ app }) => {
    const a = (await app.generate({ prompt: 'fil alpha' })).thread
    const b = (await app.generate({ prompt: 'fil beta' })).thread
    await app.gotoThread(a.id)
    const defaultRatio = await app.ratio.textContent()
    await app.prompt.fill('texte A')
    await app.chooseRatio('16:9')
    await app.count.click()

    await app.openThread('fil beta')
    await expect(app.prompt).toHaveValue('')
    await expect(app.ratio).toHaveText(defaultRatio!)
    await expect(app.count).toHaveAccessibleName("Nombre d'images x1")
    await app.prompt.fill('texte B')

    await app.openThread('fil alpha')
    await expect(app.prompt).toHaveValue('texte A')
    await expect(app.ratio).toContainText('16:9')
    await expect(app.count).toHaveAccessibleName("Nombre d'images x4")

    await app.openThread('fil beta')
    await expect(app.prompt).toHaveValue('texte B')

    const drafts = await app.drafts()
    expect(drafts[a.id].prompt).toBe('texte A')
    expect(drafts[b.id].prompt).toBe('texte B')

    // Et après rechargement.
    await app.gotoThread(a.id)
    await expect(app.prompt).toHaveValue('texte A')
  })

  test('composer vide en arrivant : dernier modèle utilisé dans le fil', async ({ app }) => {
    const { thread } = await app.generate({ prompt: 'fil gpt', family: GPT })
    await app.gotoThread(thread.id)
    await expect(app.modelPicker).toContainText('GPT Image 2.5')
    // Changement sans rien écrire : perdu au retour.
    await app.chooseModel('Qwen Image 3.0 Pro')
    await app.gotoNew()
    await app.openThread('fil gpt')
    await expect(app.modelPicker).toContainText('GPT Image 2.5')
    // Avec du texte : gardé.
    await app.chooseModel('Qwen Image 3.0 Pro')
    await app.prompt.fill('une idée')
    await app.gotoNew()
    await app.openThread('fil gpt')
    await expect(app.modelPicker).toContainText('Qwen Image 3.0 Pro')
    await expect(app.prompt).toHaveValue('une idée')
  })

  test('après un envoi : réglages gardés sur le fil, génériques au retour', async ({ app }) => {
    const { thread } = await app.generate({ prompt: 'fil envoi' })
    await app.gotoThread(thread.id)
    await app.prompt.fill('deuxième demande')
    await app.count.click()
    await app.send()
    await expect(app.prompt).toHaveValue('')
    await expect(app.count).toHaveAccessibleName("Nombre d'images x4")
    expect(await app.drafts()).not.toHaveProperty(thread.id)
    await app.gotoNew()
    await app.openThread('fil envoi')
    await expect(app.count).toHaveAccessibleName("Nombre d'images x1")
  })

  test('une image jointe à la main suffit à garder le brouillon', async ({ app }) => {
    const { thread } = await app.generate({ prompt: 'fil image' })
    await app.gotoThread(thread.id)
    await app.attachFile()
    await expect(app.attachments).toHaveCount(1)
    await app.count.click()
    await app.gotoNew()
    await app.openThread('fil image')
    await expect(app.attachments).toHaveCount(1)
    await expect(app.count).toHaveAccessibleName("Nombre d'images x4")
  })
})
