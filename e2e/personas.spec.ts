/**
 * Personas : création depuis la barre, sélection (filtre des fils et persona du
 * composer), fiche avec sauvegarde automatique, blocs de contexte envoyés dans
 * le prompt, modèles par défaut, ordre de la barre et mise à la corbeille.
 */
import type { Page } from '@playwright/test'
import { expect, test } from './helpers'
import {
  bubble,
  center,
  dragTo,
  getPersona,
  gotoPersona,
  hydrated,
  listPersonas,
  pngFile,
  popover,
  railOrder,
  saved,
  sendAndCapture,
} from './support-personas'

const VERT = '#22c55e'

test.describe('Création', () => {
  test('le bouton + de la barre crée le persona avec sa couleur et ouvre sa fiche @core', async ({
    app,
    page,
  }) => {
    await app.gotoNew()
    await page.getByRole('button', { name: 'Nouveau persona' }).click()
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

    // La bulle apparaît dans la barre, avec les initiales sur la couleur choisie.
    const rail = bubble(page, 'Alice Martin')
    await expect(rail).toBeVisible()
    await expect(rail).toHaveText('AM')
    await expect(rail.locator('span').first()).toHaveCSS('background-color', 'rgb(34, 197, 94)')
  })

  test('le nouveau persona devient le persona sélectionné', async ({ app, page }) => {
    await app.gotoNew()
    await page.getByRole('button', { name: 'Nouveau persona' }).click()
    await page.getByRole('dialog').getByLabel('Nom').fill('Bob')
    await page.getByRole('dialog').getByLabel('Nom').press('Enter')
    await expect(page.getByText('Paramétrage de Bob')).toBeVisible()
    await app.gotoNew()
    // Le menu des références du persona est proposé dans le composer.
    await expect(page.getByTitle('Références de Bob')).toBeVisible()
  })
})

test.describe('Sélection dans la barre', () => {
  test('filtre la liste des fils et fixe le persona du composer @core', async ({ app, page }) => {
    const alice = await app.createPersona({ name: 'Alice' })
    const bob = await app.createPersona({ name: 'Bob' })
    await app.generate({ prompt: 'fil alice', personaId: alice.id })
    await app.generate({ prompt: 'fil bob', personaId: bob.id })
    await app.generate({ prompt: 'fil sans persona' })

    await app.gotoNew()
    for (const t of ['fil alice', 'fil bob', 'fil sans persona'])
      await expect(page.getByRole('link', { name: t })).toBeVisible()

    await app.selectPersona('Alice')
    await expect(page.getByRole('link', { name: 'fil alice' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'fil bob' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'fil sans persona' })).toHaveCount(0)
    await expect(page.getByTitle('Références de Alice')).toBeVisible()

    await app.selectPersona('Bob')
    await expect(page.getByRole('link', { name: 'fil bob' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'fil alice' })).toHaveCount(0)
    await expect(page.getByTitle('Références de Bob')).toBeVisible()

    // « Tous les fils » : plus de persona, tout revient.
    await page.getByRole('button', { name: 'Tous les fils' }).click()
    for (const t of ['fil alice', 'fil bob', 'fil sans persona'])
      await expect(page.getByRole('link', { name: t })).toBeVisible()
    await expect(page.getByTitle(/^Références de/)).toHaveCount(0)
  })

  test('une demande envoyée avec un persona sélectionné lui appartient', async ({ app, page }) => {
    const alice = await app.createPersona({ name: 'Alice' })
    await app.gotoNew()
    await app.selectPersona('Alice')
    await app.prompt.fill('portrait au soleil')
    const { body, generation } = await sendAndCapture(page, () => app.send())
    expect(body.personaId).toBe(alice.id)
    expect(generation.personaId).toBe(alice.id)
    await expect(page).toHaveURL(/\/t\//)
  })

  test('la sélection survit au rechargement', async ({ app, page }) => {
    await app.createPersona({ name: 'Alice' })
    await app.generate({ prompt: 'fil libre' })
    await app.gotoNew()
    await app.selectPersona('Alice')
    await expect(page.getByRole('link', { name: 'fil libre' })).toHaveCount(0)
    await app.reload()
    await expect(page.getByTitle('Références de Alice')).toBeVisible()
    await expect(page.getByRole('link', { name: 'fil libre' })).toHaveCount(0)
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
    // La barre suit le nouveau nom.
    await expect(bubble(page, 'Alicia Keys')).toHaveText('AK')

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

  test('avatar : envoi d’une photo, gardée après rechargement, puis retirée', async ({
    app,
    page,
  }) => {
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
    // La bulle de la barre montre la photo.
    await expect(bubble(page, 'Alice').locator('img')).toBeVisible()

    await changer.hover()
    await page.getByRole('button', { name: 'Retirer la photo' }).click()
    await expect(changer.locator('img')).toHaveCount(0)
    await expect.poll(async () => (await getPersona(page, p.id)).avatarAssetId).toBeNull()
    await expect(page.getByRole('button', { name: /^Couleur / })).toHaveCount(8)
  })
})

/** Sort du bloc en cours (il passe en lecture), puis ajoute un bloc. */
async function addBlock(page: Page) {
  await page.getByText('Contexte du persona').click()
  await page.getByRole('button', { name: 'Ajouter un bloc' }).click()
}

test.describe('Blocs de contexte', () => {
  // Ancien bug (corrigé) : le bloc rétrécissait dès l'appui sur la souris, le
  // bouton « Ajouter un bloc » remontait sous le curseur et le clic était perdu.
  test('un clic sur « Ajouter un bloc » juste après la saisie ajoute le bloc', async ({
    app,
    page,
  }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id)
    await page.getByLabel('Titre du bloc').fill('Apparence')
    await page.getByLabel('Texte du bloc').fill('cheveux roux')
    await page.getByRole('button', { name: 'Ajouter un bloc' }).click()
    await expect(page.getByLabel('Titre du bloc')).toHaveCount(1, { timeout: 3000 })
    await expect(page.getByLabel('Titre du bloc')).toBeFocused({ timeout: 1000 })
  })

  test('ajout, modification puis suppression, enregistrés dans le persona', async ({
    app,
    page,
  }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id)

    // Le premier bloc est toujours là, sans bouton de suppression.
    const titles = page.getByLabel('Titre du bloc')
    await expect(titles).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Supprimer le bloc' })).toHaveCount(0)
    await titles.first().fill('Apparence')
    await page.getByLabel('Texte du bloc').first().fill('cheveux roux, yeux verts')

    await addBlock(page)
    // Le titre du nouveau bloc prend le focus.
    await expect(titles.last()).toBeFocused()
    await page.keyboard.type('Style')
    await page.getByLabel('Texte du bloc').last().fill('photo argentique')
    await expect(page.getByText('16 / 600')).toBeVisible()

    await expect
      .poll(async () => (await getPersona(page, p.id)).contextBlocks.map((b) => [b.title, b.text]))
      .toEqual([
        ['Apparence', 'cheveux roux, yeux verts'],
        ['Style', 'photo argentique'],
      ])

    // Hors du bloc, le texte passe en lecture ; le crayon le remet en édition.
    await page.getByText('Contexte du persona').click()
    await expect(page.getByLabel('Texte du bloc')).toHaveCount(0)
    await expect(page.getByText('cheveux roux, yeux verts')).toBeVisible()
    await page.getByRole('button', { name: 'Modifier le bloc' }).first().click()
    const text = page.getByLabel('Texte du bloc')
    await expect(text).toBeFocused()
    await text.fill('cheveux blonds')
    await page.getByLabel('Titre du bloc').fill('Physique')
    await expect
      .poll(async () => (await getPersona(page, p.id)).contextBlocks[0])
      .toMatchObject({ title: 'Physique', text: 'cheveux blonds' })

    // On sort d'abord du bloc en cours (voir le bug du clic perdu ci-dessus).
    await page.getByText('Contexte du persona').click()
    await page.getByRole('button', { name: 'Supprimer le bloc' }).click()
    await expect
      .poll(async () => (await getPersona(page, p.id)).contextBlocks.map((b) => b.title))
      .toEqual(['Physique'])

    await page.reload()
    await hydrated(page)
    await expect(page.getByText('Physique')).toBeVisible()
    await expect(page.getByText('cheveux blonds')).toBeVisible()
    await expect(page.getByText('photo argentique')).toHaveCount(0)
  })

  test('leur texte part dans le prompt final sous « # Contexte général » @core', async ({
    app,
    page,
  }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id)
    await page.getByLabel('Titre du bloc').fill('Apparence')
    await page.getByLabel('Texte du bloc').fill('cheveux   roux\net yeux verts')
    await addBlock(page)
    // Bloc sans titre : seulement le texte.
    await page.getByLabel('Texte du bloc').last().fill('toujours souriante')
    await addBlock(page)
    // Bloc vide : jamais envoyé.
    await expect.poll(async () => (await getPersona(page, p.id)).contextBlocks).toHaveLength(2)
    await saved(page)

    await app.gotoNew()
    await app.selectPersona('Alice')
    await app.prompt.fill('à la plage')
    const { generation } = await sendAndCapture(page, () => app.send())
    expect(generation.finalPrompt).toBe(
      [
        '# Prompt (important)',
        'à la plage',
        '',
        '# Contexte général',
        '- Apparence : cheveux roux et yeux verts',
        '- toujours souriante',
      ].join('\n'),
    )
    // La bulle du fil garde la demande seule.
    await expect(page.getByTestId('request-bubble')).toHaveText('à la plage')
    await expect(page.getByTestId('request-bubble')).not.toContainText('Contexte')
    expect((await app.getGeneration(generation.id)).finalPrompt).toContain('# Contexte général')
  })

  test('sans persona, pas de contexte général : le prompt part tel quel', async ({ app, page }) => {
    await app.createPersona({
      name: 'Alice',
      contextBlocks: [{ id: 'b1', title: 'Apparence', text: 'cheveux roux' }],
    })
    await app.gotoNew()
    await app.prompt.fill('une montagne')
    const { generation } = await sendAndCapture(page, () => app.send())
    expect(generation.finalPrompt).toBe('une montagne')
  })

  test('un bloc supprimé ne part plus dans le prompt', async ({ app, page }) => {
    const p = await app.createPersona({
      name: 'Alice',
      contextBlocks: [
        { id: 'b1', title: 'Apparence', text: 'cheveux roux' },
        { id: 'b2', title: 'Tenue', text: 'robe rouge' },
      ],
    })
    await gotoPersona(page, p.id)
    await page.getByRole('button', { name: 'Supprimer le bloc' }).click()
    await expect.poll(async () => (await getPersona(page, p.id)).contextBlocks).toHaveLength(1)

    const { generation } = await app.generate({ prompt: 'en ville', personaId: p.id })
    expect(generation.finalPrompt).toContain('# Contexte général\n- Apparence : cheveux roux')
    expect(generation.finalPrompt).not.toContain('robe rouge')
  })

  test('dix blocs au maximum : le bouton d’ajout disparaît', async ({ app, page }) => {
    const p = await app.createPersona({
      name: 'Alice',
      contextBlocks: Array.from({ length: 9 }, (_, i) => ({ id: `b${i}`, title: `T${i}`, text: `texte ${i}` })),
    })
    await gotoPersona(page, p.id)
    await page.getByRole('button', { name: 'Ajouter un bloc' }).click()
    await expect(page.getByRole('button', { name: 'Ajouter un bloc' })).toHaveCount(0)
  })
})

test.describe('Modèles par défaut', () => {
  test('photo et vidéo choisis sur la fiche, gardés après rechargement', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id)
    await page.getByRole('button', { name: 'Automatique (Seedream 5.0 Flash)' }).click()
    await app.pickInModelMenu('Nano Banana Pro')
    await expect(popover(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Automatique (Seedance 2.0 Mini)' }).click()
    await app.pickInModelMenu('Kling 3.0')
    await expect
      .poll(async () => {
        const x = await getPersona(page, p.id)
        return [x.defaultImageFamily, x.defaultVideoFamily]
      })
      .toEqual(['google/nano-banana-pro', 'kling/3.0'])

    await page.reload()
    await hydrated(page)
    await expect(page.getByRole('button', { name: 'Nano Banana Pro' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Kling 3.0' })).toBeVisible()

    // Retour à Automatique pour la vidéo seulement.
    await page.getByRole('button', { name: 'Revenir au choix automatique' }).last().click()
    await expect(page.getByRole('button', { name: 'Automatique (Seedance 2.0 Mini)' })).toBeVisible()
    await expect
      .poll(async () => (await getPersona(page, p.id)).defaultVideoFamily)
      .toBeNull()
    expect((await getPersona(page, p.id)).defaultImageFamily).toBe('google/nano-banana-pro')
  })

  test('le menu vidéo de la fiche ne propose que des modèles vidéo', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id)
    await page.getByRole('button', { name: 'Automatique (Seedance 2.0 Mini)' }).click()
    await page.getByPlaceholder('Rechercher un modèle').fill('Seedream')
    await expect(
      page.locator('[data-slot=popover-content]').getByText('Seedream 5.0 Flash', { exact: true }),
    ).toHaveCount(0)
  })
})

test.describe('Ordre de la barre', () => {
  test('glisser une bulle change l’ordre, enregistré côté serveur', async ({ app, page }) => {
    await app.createPersona({ name: 'Alice' })
    await app.createPersona({ name: 'Bob' })
    await app.createPersona({ name: 'Chloé' })
    await app.gotoNew()
    expect(await railOrder(page)).toEqual(['Alice', 'Bob', 'Chloé'])

    const from = await center(bubble(page, 'Chloé'))
    const to = await center(bubble(page, 'Alice'))
    const order = page.waitForRequest(
      (r) => r.method() === 'PUT' && r.url().endsWith('/api/personas/order'),
    )
    await dragTo(page, from, { x: to.x, y: to.y - 10 })
    await order
    await expect.poll(() => railOrder(page)).toEqual(['Chloé', 'Alice', 'Bob'])
    await expect
      .poll(async () => (await listPersonas(page)).map((p) => p.name))
      .toEqual(['Chloé', 'Alice', 'Bob'])
    // Le dépôt ne sélectionne pas le persona déplacé.
    await expect(page.getByTitle(/^Références de/)).toHaveCount(0)

    await app.reload()
    expect(await railOrder(page)).toEqual(['Chloé', 'Alice', 'Bob'])
  })

  test('un ordre enregistré par l’API est celui de la barre', async ({ app, page }) => {
    const a = await app.createPersona({ name: 'Alice' })
    const b = await app.createPersona({ name: 'Bob' })
    const c = await app.createPersona({ name: 'Chloé' })
    const res = await page.request.put('/api/personas/order', { data: { ids: [b.id, c.id, a.id] } })
    expect(res.ok()).toBeTruthy()
    await app.gotoNew()
    await expect.poll(() => railOrder(page)).toEqual(['Bob', 'Chloé', 'Alice'])
  })
})

test.describe('Mise à la corbeille', () => {
  test('« Supprimer le persona » puis confirmation : il quitte la barre @core', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await app.createPersona({ name: 'Bob' })
    const { thread } = await app.generate({ prompt: 'fil alice', personaId: p.id })
    await gotoPersona(page, p.id)

    await page.getByRole('button', { name: 'Supprimer le persona' }).click()
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await expect(dialog.getByText('Mettre Alice à la corbeille ?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Mettre à la corbeille' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Alice mis à la corbeille')).toBeVisible()
    await expect(bubble(page, 'Alice')).toHaveCount(0)
    await expect(bubble(page, 'Bob')).toBeVisible()
    expect((await listPersonas(page)).map((x) => x.name)).toEqual(['Bob'])
    // Ses fils partent avec lui.
    await expect(page.getByRole('link', { name: 'fil alice' })).toHaveCount(0)
    const res = await page.request.get(`/api/threads/${thread.id}`)
    expect(res.ok()).toBeFalsy()
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
    await expect(bubble(page, 'Alice')).toHaveCount(0)
    await page.locator('[data-sonner-toast]').getByRole('button', { name: 'Annuler' }).click()
    await expect(bubble(page, 'Alice')).toBeVisible()
    await expect(page.getByTitle('Références de Alice')).toBeVisible()
  })

  test('une fiche inconnue affiche « Persona introuvable »', async ({ page }) => {
    await page.goto('/personas/00000000-0000-4000-8000-000000000000')
    await expect(page.getByText('Persona introuvable.')).toBeVisible()
  })
})
