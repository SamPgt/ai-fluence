/**
 * Personas : des bibliothèques (références, LoRA), pas des lieux. Création depuis
 * la Bibliothèque, sections par persona puis Général, fiche avec sauvegarde
 * automatique (onglets Références et LoRA), bulles des personas utilisés dans un
 * fil et mise à la corbeille (sans toucher aux fils).
 */
import type { Page } from '@playwright/test'
import { expect, test } from './helpers'
import {
  getPersona,
  gotoLibrary,
  gotoPersona,
  hydrated,
  librarySections,
  listPersonas,
  listReferences,
  pngFile,
  saved,
  uploadReference,
} from './support-personas'

const VERT = '#22c55e'

/** Section d'un persona (ou de Général) dans la Bibliothèque. */
const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

/** Personas d'un fil, lus par l'API. */
async function threadPersonaIds(page: Page, id: string): Promise<string[]> {
  return (await (await page.request.get(`/api/threads/${id}`)).json()).thread.personaIds
}

/** Noms des sections de la Bibliothèque, dans l'ordre. */
const sectionNames = (page: Page) =>
  librarySections(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))

test.describe('Création', () => {
  test('« Ajouter » de la Bibliothèque crée le persona avec sa couleur et ouvre sa fiche @core @smoke', async ({
    page,
  }) => {
    await gotoLibrary(page)
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Nouveau persona')).toBeVisible()
    // Sans nom, le bouton reste désactivé.
    await expect(dialog.getByRole('button', { name: 'Créer et configurer' })).toBeDisabled()
    await dialog.getByLabel('Nom').fill('Alice Martin')
    await dialog.getByRole('button', { name: `Couleur ${VERT}` }).click()
    await dialog.getByRole('button', { name: 'Créer et configurer' }).click()

    await expect(page).toHaveURL(/\/personas\/[0-9a-f-]{36}$/)
    await expect(page.getByText('Paramétrage de Alice Martin')).toBeVisible()
    const [persona] = await listPersonas(page)
    expect(persona).toMatchObject({ name: 'Alice Martin', color: VERT })
    expect(page.url()).toContain(persona.id)

    // Sa section apparaît dans la Bibliothèque, avec les initiales sur la couleur choisie.
    await page.getByTestId('thread-panel').getByRole('link', { name: 'Bibliothèque' }).click()
    const own = section(page, 'Alice Martin')
    await expect(own).toBeVisible()
    const avatar = own.getByText('AM', { exact: true })
    await expect(avatar).toHaveCSS('background-color', 'rgb(34, 197, 94)')
  })

  test('Entrée dans le nom crée aussi le persona', async ({ page }) => {
    await gotoLibrary(page)
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click()
    await page.getByRole('dialog').getByLabel('Nom').fill('Bob')
    await page.getByRole('dialog').getByLabel('Nom').press('Enter')
    await expect(page.getByText('Paramétrage de Bob')).toBeVisible()
  })
})

test.describe('Bibliothèque', () => {
  test('une section par persona dans leur ordre, puis Général, avec leurs références @core', async ({
    app,
    page,
  }) => {
    const alice = await app.createPersona({ name: 'Alice' })
    const bob = await app.createPersona({ name: 'Bob' })
    for (const n of ['a', 'b']) await uploadReference(page, alice.id, `${n}.png`)
    await uploadReference(page, 'general', 'g.png')
    await gotoLibrary(page)

    await expect.poll(() => sectionNames(page)).toEqual(['Alice', 'Bob', 'Général'])
    await expect(section(page, 'Alice')).toContainText('2 références')
    await expect(section(page, 'Bob')).toContainText('0 référence')
    await expect(section(page, 'Général')).toContainText('1 référence')
    await expect(section(page, 'Alice').locator('img')).toHaveCount(2)
    await expect(section(page, 'Général').locator('img')).toHaveCount(1)

    // « Voir tout » : la fiche du persona, ou la page Général.
    await section(page, 'Bob').getByRole('link', { name: 'Voir tout' }).click()
    await expect(page).toHaveURL(new RegExp(`/personas/${bob.id}$`))
    await expect(page.getByText('Paramétrage de Bob')).toBeVisible()
    await gotoLibrary(page)
    await section(page, 'Général').getByRole('link', { name: 'Voir tout' }).click()
    await expect(page).toHaveURL(/\/bibliotheque\/general$/)
    await expect(page.getByText('Ce qui n’appartient à aucun persona')).toBeVisible()
  })

  test('la carte « + » d’une section ajoute des images à ses références', async ({ app, page }) => {
    const alice = await app.createPersona({ name: 'Alice' })
    await gotoLibrary(page)
    const own = section(page, 'Alice')
    await expect(own.getByRole('button', { name: 'Ajouter aux références : Alice' })).toBeVisible()
    await own.locator('input[type=file]').setInputFiles([pngFile('a.png'), pngFile('b.png')])
    await expect(own.locator('img')).toHaveCount(2)
    await expect(own).toContainText('2 références')
    expect(await listReferences(page, alice.id)).toHaveLength(2)

    const general = section(page, 'Général')
    await expect(general.getByRole('button', { name: 'Ajouter aux références : Général' })).toBeVisible()
    await general.locator('input[type=file]').setInputFiles(pngFile('g.png'))
    await expect(general.locator('img')).toHaveCount(1)
    expect(await listReferences(page, 'general')).toHaveLength(1)
    expect(await listReferences(page, alice.id)).toHaveLength(2)
  })

  test('sans persona : Général seul', async ({ page }) => {
    await gotoLibrary(page)
    await expect.poll(() => sectionNames(page)).toEqual(['Général'])
  })

  test('un ordre enregistré par l’API est celui de la Bibliothèque', async ({ app, page }) => {
    const a = await app.createPersona({ name: 'Alice' })
    const b = await app.createPersona({ name: 'Bob' })
    const c = await app.createPersona({ name: 'Chloé' })
    const res = await page.request.put('/api/personas/order', { data: { ids: [b.id, c.id, a.id] } })
    expect(res.ok()).toBeTruthy()
    await gotoLibrary(page)
    await expect.poll(() => sectionNames(page)).toEqual(['Bob', 'Chloé', 'Alice', 'Général'])
  })
})

test.describe('Fiche : sauvegarde automatique', () => {
  test('nom et couleur enregistrés, gardés après rechargement @core', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id)
    const name = page.getByLabel('Nom du persona')
    await expect(name).toHaveValue('Alice')
    await name.fill('Alicia Keys')
    await page.getByRole('button', { name: `Couleur ${VERT}` }).click()

    await expect.poll(async () => (await getPersona(page, p.id)).name).toBe('Alicia Keys')
    await expect.poll(async () => (await getPersona(page, p.id)).color).toBe(VERT)
    await saved(page)

    await page.reload()
    await hydrated(page)
    await expect(page.getByLabel('Nom du persona')).toHaveValue('Alicia Keys')
    await expect(page.getByText('Paramétrage de Alicia Keys')).toBeVisible()
    await expect(page.getByRole('button', { name: `Couleur ${VERT}` })).toHaveClass(/ring-2/)
  })

  test('un nom vide n’est pas enregistré', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id)
    await page.getByLabel('Nom du persona').fill('')
    await page.waitForTimeout(1200)
    expect((await getPersona(page, p.id)).name).toBe('Alice')
  })

  test('avatar : envoi d’une photo, gardée après rechargement, puis retirée', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id)
    await page.locator('input[type=file][accept="image/*"]').setInputFiles(pngFile('avatar.png'))

    const changer = page.getByRole('button', { name: 'Changer l’avatar' })
    await expect(changer.locator('img')).toBeVisible()
    // Avec une photo, le choix de couleur disparaît.
    await expect(page.getByRole('button', { name: /^Couleur / })).toHaveCount(0)
    await expect.poll(async () => (await getPersona(page, p.id)).avatarAssetId).not.toBeNull()
    const { avatarAssetId } = await getPersona(page, p.id)

    await page.reload()
    await hydrated(page)
    await expect(changer.locator('img')).toHaveAttribute('src', new RegExp(avatarAssetId!))

    await changer.hover()
    await page.getByRole('button', { name: 'Retirer la photo' }).click()
    await expect(changer.locator('img')).toHaveCount(0)
    await expect.poll(async () => (await getPersona(page, p.id)).avatarAssetId).toBeNull()
    await expect(page.getByRole('button', { name: /^Couleur / })).toHaveCount(8)
  })

  test('onglets Références et LoRA seulement : ni contexte, ni raccourcis, ni modèles par défaut', async ({
    app,
    page,
  }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id)
    await expect(page.getByText('Identité', { exact: true })).toBeVisible()
    await expect(page.getByRole('tab')).toHaveText(['Références', 'LoRA'])
    await expect(page.getByText('Photos de références')).toBeVisible()
    await expect(page.getByText('Contexte du persona')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Automatique/ })).toHaveCount(0)

    await page.getByRole('tab', { name: 'LoRA' }).click()
    await expect(page).toHaveURL(/tab=lora/)
    await expect(page.getByText('Aucune LoRA pour ce persona.')).toBeVisible()
  })
})

test.describe('Personas d’un fil', () => {
  test('les bulles des personas dont une référence a servi suivent le titre du fil @core', async ({
    app,
    page,
  }) => {
    const alice = await app.createPersona({ name: 'Alice' })
    const bob = await app.createPersona({ name: 'Bob' })
    await app.createPersona({ name: 'Chloé' })
    const a = await uploadReference(page, alice.id, 'a.png')
    const b = await uploadReference(page, bob.id, 'b.png')
    const { thread } = await app.generate({ prompt: 'duo', referenceAssetIds: [a.id, b.id] })
    expect((await threadPersonaIds(page, thread.id)).sort()).toEqual([alice.id, bob.id].sort())

    await app.gotoThread(thread.id)
    const bubbles = page.getByTestId('thread-personas').getByRole('link')
    await expect(bubbles).toHaveCount(2)
    await expect(bubbles.first()).toHaveAttribute('aria-label', 'Alice')
    await expect(bubbles.last()).toHaveAttribute('aria-label', 'Bob')
    await expect(page.getByTestId('thread-personas').getByRole('link', { name: 'Chloé' })).toHaveCount(0)

    // Une bulle mène à la fiche du persona.
    await bubbles.first().click()
    await expect(page).toHaveURL(new RegExp(`/personas/${alice.id}$`))
  })

  test('sans référence d’un persona, pas de bulle', async ({ app, page }) => {
    await app.createPersona({ name: 'Alice' })
    const { thread } = await app.generate({ prompt: 'seul' })
    expect(await threadPersonaIds(page, thread.id)).toEqual([])
    await app.gotoThread(thread.id)
    await expect(page.getByTestId('request-bubble')).toBeVisible()
    await expect(page.getByTestId('thread-personas')).toHaveCount(0)
  })

  test('une référence jointe depuis le composer ajoute la bulle après l’envoi', async ({ app, page }) => {
    const alice = await app.createPersona({ name: 'Alice' })
    await uploadReference(page, alice.id)
    const { thread } = await app.generate({ prompt: 'avant' })
    await app.gotoThread(thread.id)
    await expect(page.getByTestId('thread-personas')).toHaveCount(0)

    await page.getByRole('button', { name: /^Réf\./ }).click()
    await page
      .locator('[data-slot=popover-content]')
      .getByRole('region', { name: 'Références : Alice' })
      .locator('button:has(img)')
      .first()
      .click()
    await page.keyboard.press('Escape')
    await app.prompt.fill('avec alice')
    await app.send()
    await expect(page.getByTestId('thread-personas').getByRole('link', { name: 'Alice' })).toBeVisible()
  })
})

test.describe('Mise à la corbeille', () => {
  test('« Supprimer le persona » puis confirmation : il quitte la Bibliothèque, les fils restent @core', async ({
    app,
    page,
  }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await app.createPersona({ name: 'Bob' })
    const { thread } = await app.generateWithPersona(p.id, { prompt: 'fil alice' })
    await gotoPersona(page, p.id)

    await page.getByRole('button', { name: 'Supprimer le persona' }).click()
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await expect(dialog.getByText('Mettre Alice à la corbeille ?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Mettre à la corbeille' }).click()

    await expect(page).toHaveURL(/\/bibliotheque$/)
    await expect(page.getByText('Alice mis à la corbeille')).toBeVisible()
    await expect.poll(() => sectionNames(page)).toEqual(['Bob', 'Général'])
    expect((await listPersonas(page)).map((x) => x.name)).toEqual(['Bob'])
    // Le fil reste, sans la bulle du persona parti.
    await expect(page.getByTestId('thread-panel').getByRole('link', { name: /fil alice/ })).toBeVisible()
    expect((await page.request.get(`/api/threads/${thread.id}`)).ok()).toBeTruthy()
    expect(await threadPersonaIds(page, thread.id)).toEqual([])
  })

  test('annuler la confirmation garde le persona', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id)
    await page.getByRole('button', { name: 'Supprimer le persona' }).click()
    await page.getByRole('button', { name: 'Annuler' }).click()
    await expect(page.getByText('Paramétrage de Alice')).toBeVisible()
    expect(await listPersonas(page)).toHaveLength(1)
  })

  test('« Annuler » dans la notification restaure le persona', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id)
    await page.getByRole('button', { name: 'Supprimer le persona' }).click()
    await page.getByRole('button', { name: 'Mettre à la corbeille' }).click()
    await expect(page).toHaveURL(/\/bibliotheque$/)
    await expect.poll(() => sectionNames(page)).toEqual(['Général'])
    await page.locator('[data-sonner-toast]').getByRole('button', { name: 'Annuler' }).click()
    await expect.poll(() => sectionNames(page)).toEqual(['Alice', 'Général'])
    expect(await listPersonas(page)).toHaveLength(1)
  })

  test('une fiche inconnue affiche « Persona introuvable »', async ({ page }) => {
    await page.goto('/personas/00000000-0000-4000-8000-000000000000')
    await expect(page.getByText('Persona introuvable.')).toBeVisible()
  })
})

test('Bibliothèque : la recherche filtre les sections par nom', async ({ app, page }) => {
  await app.createPersona({ name: 'Léa' })
  await app.createPersona({ name: 'Max' })
  await gotoLibrary(page)
  await expect(librarySections(page)).toHaveCount(3)
  const search = page.getByRole('textbox', { name: 'Rechercher dans la bibliothèque' })
  await search.fill('lé')
  await expect(librarySections(page)).toHaveCount(1)
  await expect(librarySections(page)).toHaveAttribute('aria-label', 'Léa')
  await search.fill('zzz')
  await expect(page.getByText('Aucun persona ne correspond à « zzz ».')).toBeVisible()
  await search.fill('gén')
  await expect(librarySections(page)).toHaveAttribute('aria-label', 'Général')
})

test('Bibliothèque : Général montre ses raccourcis, un clic les modifie', async ({ page }) => {
  const created = await page.request.post('/api/presets', {
    data: { label: 'Lumière douce', text: 'soft light', media: 'all' },
  })
  expect(created.ok()).toBeTruthy()
  const count = ((await (await page.request.get('/api/presets')).json()).presets as unknown[]).length
  await gotoLibrary(page)
  const general = librarySections(page).last()
  await expect(general).toHaveAttribute('aria-label', 'Général')
  await expect(general).toContainText(`${count} raccourci${count > 1 ? 's' : ''}`)
  await general.getByRole('button', { name: 'Lumière douce' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await general.getByRole('button', { name: 'Raccourci', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
