/**
 * Références d'un persona : bibliothèque sur sa fiche (envoi, ordre, retrait),
 * menu « Réf. » du composer, pièces jointes numérotées, compteur du modèle,
 * envoi dans l'ordre et affichage au-dessus de la demande dans le fil.
 */
import type { Page } from '@playwright/test'
import { expect, test } from './helpers'
import {
  center,
  dragTo,
  gotoPersona,
  listReferences,
  pngFile,
  popover,
  sendAndCapture,
  uploadReference,
} from './support-personas'

/** Carte « Bibliothèque de références » de la fiche persona. */
const library = (page: Page) =>
  page.locator('section', { has: page.getByRole('heading', { name: 'Bibliothèque de références' }) })

/** Vignettes de la bibliothèque (hors bouton d'ajout). */
const libraryThumbs = (page: Page) => library(page).locator('[aria-roledescription=sortable]')

/** Identifiants des images affichées, dans l'ordre (l'URL porte l'id de l'asset). */
async function srcIds(loc: import('@playwright/test').Locator): Promise<string[]> {
  return loc.locator('img').evaluateAll((els) =>
    els.map((e) => (e.getAttribute('src') ?? '').split('/').pop()!.split('?')[0]),
  )
}

/** Vignettes du menu « Réf. » (hors bouton d'ajout). */
const pickerThumbs = (page: Page) => popover(page).locator('button:has(img)')

async function openPicker(page: Page) {
  // Un autre menu (celui des modèles) peut finir de se fermer.
  await expect(popover(page)).toHaveCount(0)
  await page.getByRole('button', { name: /^Réf\./ }).click()
  await expect(popover(page).getByText(/^Références/)).toBeVisible()
}

test.describe('Bibliothèque sur la fiche persona', () => {
  test('envoi de plusieurs images : les plus récentes en premier', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id)
    await expect(libraryThumbs(page)).toHaveCount(0)

    await library(page)
      .locator('input[type=file]')
      .setInputFiles([pngFile('a.png'), pngFile('b.png'), pngFile('c.png')])
    await expect(libraryThumbs(page)).toHaveCount(3)

    const refs = await listReferences(page, p.id)
    expect(refs).toHaveLength(3)
    expect(refs.every((r) => r.isReference && r.personaId === p.id)).toBeTruthy()
    expect(await srcIds(libraryThumbs(page))).toEqual(refs.map((r) => r.id))

    // Gardées après rechargement.
    await page.reload()
    await expect(libraryThumbs(page)).toHaveCount(3)
  })

  test('glisser une vignette change l’ordre, enregistré côté serveur', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    for (const n of ['a', 'b', 'c']) await uploadReference(page, p.id, `${n}.png`)
    const before = (await listReferences(page, p.id)).map((r) => r.id)
    await gotoPersona(page, p.id)
    await expect(libraryThumbs(page)).toHaveCount(3)

    const saved = page.waitForRequest(
      (r) => r.method() === 'PUT' && r.url().endsWith('/api/assets/references/order'),
    )
    const from = await center(libraryThumbs(page).nth(2))
    const to = await center(libraryThumbs(page).nth(0))
    await dragTo(page, from, { x: to.x - 10, y: to.y })
    expect((await saved).postDataJSON()).toEqual({
      personaId: p.id,
      ids: [before[2], before[0], before[1]],
    })
    await expect.poll(() => srcIds(libraryThumbs(page))).toEqual([before[2], before[0], before[1]])
    await expect
      .poll(async () => (await listReferences(page, p.id)).map((r) => r.id))
      .toEqual([before[2], before[0], before[1]])
    // Le dépôt n'ouvre pas la visionneuse.
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('la croix retire une image de la bibliothèque', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    const a = await uploadReference(page, p.id, 'a.png')
    const b = await uploadReference(page, p.id, 'b.png')
    await gotoPersona(page, p.id)
    await expect(libraryThumbs(page)).toHaveCount(2)

    const first = libraryThumbs(page).first()
    await first.hover()
    await first.getByRole('button', { name: 'Retirer de la bibliothèque' }).click()
    await expect(libraryThumbs(page)).toHaveCount(1)
    expect(await srcIds(libraryThumbs(page))).toEqual([a.id])
    expect((await listReferences(page, p.id)).map((r) => r.id)).toEqual([a.id])
    expect(b.id).not.toBe(a.id)
  })

  test('un clic sur une vignette l’ouvre en grand', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    const a = await uploadReference(page, p.id)
    await gotoPersona(page, p.id)
    await libraryThumbs(page).first().click()
    await expect(page.getByRole('dialog').locator(`img[src*="${a.id}"]`)).toBeVisible()
  })
})

test.describe('Menu « Réf. » du composer', () => {
  test('absent sans persona, présent avec la bibliothèque du persona', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    const refs = [await uploadReference(page, p.id, 'a.png'), await uploadReference(page, p.id, 'b.png')]
    await app.gotoNew()
    await expect(page.getByRole('button', { name: /^Réf\./ })).toHaveCount(0)

    await app.selectPersona('Alice')
    await openPicker(page)
    await expect(pickerThumbs(page)).toHaveCount(2)
    // Même ordre que la bibliothèque (les plus récentes en premier).
    expect(await srcIds(pickerThumbs(page))).toEqual([refs[1].id, refs[0].id])
    // Compteur du modèle par défaut (Seedream 5.0 Flash : 10 images).
    await expect(popover(page).getByText('0 / 10')).toBeVisible()
    await expect(popover(page).getByRole('link', { name: 'Gérer' })).toHaveAttribute(
      'href',
      `/personas/${p.id}`,
    )
  })

  test('sans référence, une aide invite à en ajouter', async ({ app, page }) => {
    await app.createPersona({ name: 'Alice' })
    await app.gotoNew()
    await app.selectPersona('Alice')
    await openPicker(page)
    await expect(popover(page).getByText(/Ajoute 3 à 5 photos/)).toBeVisible()
  })

  test('cocher ajoute des pièces jointes numérotées, décocher les retire @core', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    for (const n of ['a', 'b', 'c']) await uploadReference(page, p.id, `${n}.png`)
    await app.gotoNew()
    await app.selectPersona('Alice')
    await openPicker(page)
    const thumbs = pickerThumbs(page)
    const ids = await srcIds(thumbs)

    await thumbs.nth(1).click()
    await expect(app.attachments).toHaveCount(1)
    await expect(app.tags).toHaveText(['1'])
    await expect(popover(page).getByText('1 / 10')).toBeVisible()
    await thumbs.nth(0).click()
    await thumbs.nth(2).click()
    await expect(app.attachments).toHaveCount(3)
    await expect(app.tags).toHaveText(['1', '2', '3'])
    await expect(app.tags.nth(1)).toHaveAttribute('title', 'Image 2')
    // Ordre des pièces jointes : celui des clics.
    expect(await srcIds(app.attachments)).toEqual([ids[1], ids[0], ids[2]])
    await expect(popover(page).getByText('3 / 10')).toBeVisible()
    // Les vignettes cochées portent la coche (classe ring-brand).
    await expect(thumbs.nth(0)).toHaveClass(/ring-brand/)

    // Décocher la première choisie : les numéros se recalent.
    await thumbs.nth(1).click()
    await expect(app.attachments).toHaveCount(2)
    await expect(app.tags).toHaveText(['1', '2'])
    expect(await srcIds(app.attachments)).toEqual([ids[0], ids[2]])
    await expect(thumbs.nth(1)).not.toHaveClass(/ring-brand/)

    // Le bouton du menu et le bouton « + » montrent les compteurs.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /^Réf\./ })).toContainText('(2)')
    await expect(page.getByRole('button', { name: 'Ajouter un fichier' })).toHaveText('2/10')
  })

  test('maximum du modèle atteint : les autres vignettes sont désactivées', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    for (const n of ['a', 'b', 'c', 'd']) await uploadReference(page, p.id, `${n}.png`)
    await app.gotoNew()
    await app.selectPersona('Alice')
    // Qwen Image 2512 LoRA : 3 images au maximum.
    await app.chooseModel('Qwen Image 2512 LoRA')
    await openPicker(page)
    await expect(popover(page).getByText('0 / 3')).toBeVisible()
    const thumbs = pickerThumbs(page)
    for (const i of [0, 1, 2]) await thumbs.nth(i).click()
    await expect(app.attachments).toHaveCount(3)
    await expect(popover(page).getByText('3 / 3')).toBeVisible()
    await expect(thumbs.nth(3)).toBeDisabled()
    await expect(thumbs.nth(3)).toHaveAttribute('title', 'Maximum atteint pour ce modèle (3)')
    // Une vignette cochée reste cliquable pour la retirer.
    await thumbs.nth(0).click()
    await expect(app.attachments).toHaveCount(2)
    await expect(thumbs.nth(3)).toBeEnabled()
  })

  test('modèle d’édition à une image : le menu devient « Édition », compteur 1', async ({
    app,
    page,
  }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await uploadReference(page, p.id)
    await app.gotoNew()
    await app.selectPersona('Alice')
    await app.chooseModel('Z-Image Turbo LoRA')
    await expect(page.getByRole('button', { name: /^Édition/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ajouter un fichier' })).toHaveText('0/1')
  })

  test('le « + » du menu ajoute des images à la bibliothèque', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await app.gotoNew()
    await app.selectPersona('Alice')
    await openPicker(page)
    await popover(page)
      .locator('input[type=file]')
      .setInputFiles([pngFile('x.png'), pngFile('y.png')])
    await expect(pickerThumbs(page)).toHaveCount(2)
    expect(await listReferences(page, p.id)).toHaveLength(2)
    // Ajoutées à la bibliothèque, pas encore jointes.
    await expect(app.attachments).toHaveCount(0)
  })
})

test.describe('Bouton « + » du composer', () => {
  test('joint des fichiers numérotés, sans les mettre dans la bibliothèque', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await app.gotoNew()
    await app.selectPersona('Alice')
    const plus = page.getByRole('button', { name: 'Ajouter un fichier' })
    await expect(plus).toHaveText('0/10')
    await expect(plus).toHaveAttribute('title', 'Ajouter des images (10 au maximum pour ce modèle)')

    await page
      .locator('input[type=file][accept*="image/gif"]')
      .setInputFiles([pngFile('u1.png'), pngFile('u2.png')])
    await expect(app.attachments).toHaveCount(2)
    await expect(app.tags).toHaveText(['1', '2'])
    await expect(plus).toHaveText('2/10')
    expect(await listReferences(page, p.id)).toHaveLength(0)

    // La croix d'une pièce jointe la retire.
    await app.attachments.first().hover()
    await app.attachments.first().getByRole('button', { name: 'Retirer' }).click()
    await expect(app.attachments).toHaveCount(1)
    await expect(app.tags).toHaveText(['1'])
    await expect(plus).toHaveText('1/10')
  })

  test('au-delà du maximum, le compteur passe en alerte', async ({ app, page }) => {
    await app.gotoNew()
    await app.chooseModel('Qwen Image 2512 LoRA')
    await page
      .locator('input[type=file][accept*="image/gif"]')
      .setInputFiles(['1', '2', '3', '4'].map((n) => pngFile(`${n}.png`)))
    await expect(app.attachments).toHaveCount(4)
    const counter = page.getByRole('button', { name: 'Ajouter un fichier' }).locator('span')
    await expect(counter).toHaveText('4/3')
    await expect(counter).toHaveClass(/text-amber-300/)
  })
})

test.describe('Envoi', () => {
  test('les références partent dans l’ordre et s’affichent au-dessus de la demande @core', async ({
    app,
    page,
  }) => {
    const p = await app.createPersona({ name: 'Alice' })
    for (const n of ['a', 'b', 'c']) await uploadReference(page, p.id, `${n}.png`)
    await app.gotoNew()
    await app.selectPersona('Alice')
    await openPicker(page)
    const ids = await srcIds(pickerThumbs(page))
    await pickerThumbs(page).nth(2).click()
    await pickerThumbs(page).nth(0).click()
    await page.keyboard.press('Escape')
    // Puis un fichier joint à la main, en dernier.
    await page.locator('input[type=file][accept*="image/gif"]').setInputFiles(pngFile('main.png'))
    await expect(app.attachments).toHaveCount(3)
    const attached = await srcIds(app.attachments)
    expect(attached.slice(0, 2)).toEqual([ids[2], ids[0]])

    await app.prompt.fill('elle sur la plage')
    const { body, generation } = await sendAndCapture(page, () => app.send())
    expect(body.referenceAssetIds).toEqual(attached)
    expect(generation.references.map((r) => r.id)).toEqual(attached)
    expect(generation.task).toBe('image-to-image')

    // Dans le fil : les images au-dessus de la bulle, dans le même ordre.
    await expect(page).toHaveURL(/\/t\//)
    const shown = page.getByTestId('request-references')
    await expect(shown.locator('img')).toHaveCount(3)
    expect(await srcIds(shown)).toEqual(attached)
    const refBox = await shown.boundingBox()
    const bubbleBox = await page.getByTestId('request-bubble').boundingBox()
    expect(refBox!.y + refBox!.height).toBeLessThanOrEqual(bubbleBox!.y)
    // Le composer est vidé après l'envoi.
    await expect(app.attachments).toHaveCount(0)

    // Toujours là après rechargement (lu depuis le serveur).
    await page.reload()
    await expect(page.getByTestId('request-references').locator('img')).toHaveCount(3)
    expect(await srcIds(page.getByTestId('request-references'))).toEqual(attached)
  })

  test('sans image jointe, aucune référence au-dessus de la demande', async ({ app, page }) => {
    const { thread } = await app.generate({ prompt: 'sans image' })
    await app.gotoThread(thread.id)
    await expect(page.getByTestId('request-bubble')).toHaveText('sans image')
    await expect(page.getByTestId('request-references')).toHaveCount(0)
  })
})
