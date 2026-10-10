/**
 * Menu des raccourcis (contexte supplémentaire) au-dessus du composer : même
 * présentation que le menu des modèles, tags, recherche, envoi des contextes,
 * raccourcis propres à un persona ou à un type de média.
 */
import { expect, test } from './helpers'
import {
  contextTags,
  createPreset,
  modelMenu,
  openModelMenu,
  openShortcuts,
  shortcutOption,
  shortcutsButton,
  shortcutsMenu,
} from './support-composer'

test.describe('présentation', () => {
  test('même système que le menu des modèles : recherche, contenu arrondi, titres de section', async ({
    app,
    page,
  }) => {
    await createPreset(page, { label: 'Lumière dorée', text: 'golden hour lighting' })
    await app.gotoNew()
    // Rien de choisi : le bouton porte le mot « Raccourci ».
    await expect(shortcutsButton(page)).toHaveText('Raccourci')
    await openShortcuts(page)
    const menu = shortcutsMenu(page)

    const structure = async (root: import('@playwright/test').Locator) =>
      root.evaluate((el) => {
        const row = el.querySelector('.h-11')
        const title = el.querySelector('[cmdk-group-heading]') ?? el.querySelector('.thin-scrollbar > div > div')
        const style = title ? getComputedStyle(title) : null
        return {
          rounded: el.classList.contains('rounded-2xl'),
          width: el.classList.contains('w-80'),
          searchRow: Boolean(row?.querySelector('svg.lucide-search') && row.querySelector('input')),
          titleSize: style?.fontSize,
          titleWeight: style?.fontWeight,
        }
      })

    const shortcuts = await structure(menu)
    expect(shortcuts.rounded).toBe(true)
    expect(shortcuts.width).toBe(true)
    expect(shortcuts.searchRow).toBe(true)
    await expect(menu.getByPlaceholder('Rechercher un raccourci')).toBeFocused()
    await expect(menu.locator('[cmdk-group-heading]')).toHaveText('Contexte supplémentaire')
    await expect(menu.getByRole('link', { name: 'Gérer les raccourcis' })).toBeVisible()
    await page.keyboard.press('Escape')

    await openModelMenu(page)
    const models = await structure(modelMenu(page))
    expect(models.rounded && models.width && models.searchRow).toBe(true)
    // Titres de section identiques (taille et graisse).
    expect(shortcuts.titleSize).toBe(models.titleSize)
    expect(shortcuts.titleWeight).toBe(models.titleWeight)
  })

  test('chaque raccourci montre son nom, son texte et une case à cocher', async ({ app, page }) => {
    await createPreset(page, { label: 'Studio', text: 'studio portrait, softbox lighting' })
    await app.gotoNew()
    await openShortcuts(page)
    const option = shortcutOption(page, 'Studio')
    await expect(option).toContainText('Studio')
    await expect(option).toContainText('studio portrait, softbox lighting')
  })
})

test.describe('tags', () => {
  test('cocher un raccourci ajoute un tag au-dessus du composer, décocher le retire @core', async ({ app, page }) => {
    await createPreset(page, { label: 'Lumière dorée', text: 'golden hour lighting' })
    await app.gotoNew()
    await openShortcuts(page)
    await shortcutOption(page, 'Lumière dorée').click()
    // Le menu reste ouvert pour en cocher d'autres.
    await expect(shortcutsMenu(page)).toBeVisible()
    await expect(contextTags(page)).toHaveCount(1)
    await expect(contextTags(page)).toContainText('Lumière dorée')
    await expect(contextTags(page)).toHaveAttribute('title', 'golden hour lighting')
    // Le bouton « + » perd son texte dès qu'un tag est affiché.
    await expect(shortcutsButton(page)).toHaveText('')

    await shortcutOption(page, 'Lumière dorée').click()
    await expect(contextTags(page)).toHaveCount(0)
    await expect(shortcutsButton(page)).toHaveText('Raccourci')
  })

  test('au-delà de 5 tags, un badge « N+ » résume les autres', async ({ app, page }) => {
    const labels = ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept']
    for (const label of labels) await createPreset(page, { label, text: `texte ${label}` })
    await app.gotoNew()
    await openShortcuts(page)
    for (const label of labels.slice(0, 5)) await shortcutOption(page, label).click()
    await expect(contextTags(page)).toHaveCount(5)
    await expect(page.getByRole('button', { name: /^\d+\+$/ })).toHaveCount(0)

    await shortcutOption(page, 'Six').click()
    await shortcutOption(page, 'Sept').click()
    await expect(contextTags(page)).toHaveCount(5)
    const more = page.getByRole('button', { name: '2+', exact: true })
    await expect(more).toBeVisible()
    await expect(more).toHaveAttribute('title', '2 autre(s) contexte(s)')

    // Le badge rouvre le menu.
    await page.keyboard.press('Escape')
    await expect(shortcutsMenu(page)).toHaveCount(0)
    await more.click()
    await expect(shortcutsMenu(page)).toBeVisible()
  })

  test('au survol d’un tag, une croix permet de le retirer', async ({ app, page }) => {
    await createPreset(page, { label: 'Ciné 35mm', text: 'cinematic shot, 35mm film' })
    await createPreset(page, { label: 'Anime', text: 'anime style' })
    await app.gotoNew()
    await openShortcuts(page)
    await shortcutOption(page, 'Ciné 35mm').click()
    await shortcutOption(page, 'Anime').click()
    await page.keyboard.press('Escape')
    await expect(contextTags(page)).toHaveCount(2)

    const cross = page.getByRole('button', { name: 'Retirer Ciné 35mm' })
    await expect(cross).toBeHidden()
    await contextTags(page).filter({ hasText: 'Ciné 35mm' }).hover()
    await expect(cross).toBeVisible()
    await cross.click()
    await expect(contextTags(page)).toHaveCount(1)
    await expect(contextTags(page)).toContainText('Anime')
  })

  test('un clic sur un tag rouvre le menu', async ({ app, page }) => {
    await createPreset(page, { label: 'Anime', text: 'anime style' })
    await app.gotoNew()
    await openShortcuts(page)
    await shortcutOption(page, 'Anime').click()
    await page.keyboard.press('Escape')
    await expect(shortcutsMenu(page)).toHaveCount(0)
    await contextTags(page).getByRole('button', { name: 'Anime', exact: true }).click()
    await expect(shortcutsMenu(page)).toBeVisible()
  })

  test('les raccourcis cochés sont gardés au rechargement', async ({ app, page }) => {
    await createPreset(page, { label: 'Anime', text: 'anime style' })
    await app.gotoNew()
    await app.prompt.fill('un dragon')
    await openShortcuts(page)
    await shortcutOption(page, 'Anime').click()
    await page.keyboard.press('Escape')
    await app.reload()
    await expect(contextTags(page)).toContainText('Anime')
  })
})

test.describe('recherche', () => {
  test('filtre par nom ou par texte, message quand rien ne correspond', async ({ app, page }) => {
    await createPreset(page, { label: 'Lumière dorée', text: 'golden hour lighting' })
    await createPreset(page, { label: 'Studio', text: 'softbox lighting, clean background' })
    await createPreset(page, { label: 'Anime', text: 'vibrant colors' })
    await app.gotoNew()
    await openShortcuts(page)
    const search = shortcutsMenu(page).getByPlaceholder('Rechercher un raccourci')
    const options = shortcutsMenu(page).getByRole('option')
    await expect(options).toHaveCount(3)

    await search.fill('dorée')
    await expect(options).toHaveCount(1)
    await expect(options).toContainText('Lumière dorée')

    await search.fill('lighting')
    await expect(options).toHaveCount(2)
    await expect(shortcutOption(page, 'Anime')).toHaveCount(0)

    await search.fill('zzz introuvable')
    await expect(options).toHaveCount(0)
    await expect(shortcutsMenu(page)).toContainText('Aucun résultat.')

    await search.fill('')
    await expect(options).toHaveCount(3)
  })
})

test.describe('navigation', () => {
  test('« Gérer les raccourcis » ouvre l’onglet Raccourcis des paramètres', async ({ app, page }) => {
    await app.gotoNew()
    await openShortcuts(page)
    await shortcutsMenu(page).getByRole('link', { name: 'Gérer les raccourcis' }).click()
    await expect(page).toHaveURL(/\/parametres\?tab=shortcuts/)
    await expect(page.getByRole('tab', { name: 'Raccourcis' })).toHaveAttribute('aria-selected', 'true')
    await expect(shortcutsMenu(page)).toHaveCount(0)
  })
})

test.describe('envoi', () => {
  test('les raccourcis cochés partent dans la demande et dans « # Détails » du prompt final @core', async ({
    app,
    page,
  }) => {
    const golden = await createPreset(page, { label: 'Lumière dorée', text: 'golden hour lighting' })
    const studio = await createPreset(page, { label: 'Studio', text: 'softbox lighting' })
    await createPreset(page, { label: 'Anime', text: 'anime style' })
    await app.gotoNew()
    await openShortcuts(page)
    await shortcutOption(page, 'Lumière dorée').click()
    await shortcutOption(page, 'Studio').click()
    await page.keyboard.press('Escape')
    await app.prompt.fill('un portrait')

    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/generations') && r.request().method() === 'POST',
    )
    await app.send()
    const res = await response
    expect([...res.request().postDataJSON().contextIds].sort()).toEqual([golden.id, studio.id].sort())

    const { generation } = await res.json()
    const saved = await app.getGeneration(generation.id)
    expect(saved.finalPrompt).toContain('# Prompt (important)\nun portrait')
    expect(saved.finalPrompt).toContain('# Détails\nLumière dorée : golden hour lighting\nStudio : softbox lighting')
    expect(saved.finalPrompt).not.toContain('anime style')
    // La bulle de la demande garde le texte saisi seul.
    await expect(page.getByTestId('request-bubble')).toHaveText('un portrait')
  })

  test('sans raccourci, le prompt part tel quel', async ({ app, page }) => {
    await createPreset(page, { label: 'Anime', text: 'anime style' })
    await app.gotoNew()
    await app.prompt.fill('un portrait simple')
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/generations') && r.request().method() === 'POST',
    )
    await app.send()
    const res = await response
    expect(res.request().postDataJSON().contextIds).toEqual([])
    const saved = await app.getGeneration((await res.json()).generation.id)
    expect(saved.finalPrompt).toBe('un portrait simple')
  })
})

test.describe('portée', () => {
  test('un raccourci de persona n’apparaît que pour ce persona', async ({ app, page }) => {
    const alice = await app.createPersona({ name: 'Alice' })
    await app.createPersona({ name: 'Bea' })
    await createPreset(page, { label: 'Partout', text: 'everywhere' })
    await createPreset(page, { label: 'Tenue Alice', text: 'red dress', personaId: alice.id })
    await app.gotoNew()

    await openShortcuts(page)
    await expect(shortcutOption(page, 'Partout')).toBeVisible()
    await expect(shortcutOption(page, 'Tenue Alice')).toHaveCount(0)
    await page.keyboard.press('Escape')

    await app.selectPersona('Alice')
    await openShortcuts(page)
    await expect(shortcutOption(page, 'Partout')).toBeVisible()
    await expect(shortcutOption(page, 'Tenue Alice')).toBeVisible()
    await shortcutOption(page, 'Tenue Alice').click()
    await page.keyboard.press('Escape')
    await expect(contextTags(page)).toContainText('Tenue Alice')

    // Autre persona : le raccourci d'Alice disparaît, son tag aussi.
    await app.selectPersona('Bea')
    await expect(contextTags(page)).toHaveCount(0)
    await openShortcuts(page)
    await expect(shortcutOption(page, 'Tenue Alice')).toHaveCount(0)
    await expect(shortcutOption(page, 'Partout')).toBeVisible()
  })

  test('un raccourci photo ou vidéo n’apparaît que pour ce type de média', async ({ app, page }) => {
    await createPreset(page, { label: 'Pour tout', text: 'all media', media: 'all' })
    await createPreset(page, { label: 'Photo iPhone', text: 'candid iPhone photo', media: 'image' })
    await createPreset(page, { label: 'Travelling', text: 'slow dolly in', media: 'video' })
    await app.gotoNew()

    await openShortcuts(page)
    await expect(shortcutOption(page, 'Pour tout')).toBeVisible()
    await expect(shortcutOption(page, 'Photo iPhone')).toBeVisible()
    await expect(shortcutOption(page, 'Travelling')).toHaveCount(0)
    await shortcutOption(page, 'Photo iPhone').click()
    await page.keyboard.press('Escape')
    await expect(contextTags(page)).toContainText('Photo iPhone')

    await app.chooseMedia('Vidéo')
    // Le tag photo n'est plus affiché en vidéo.
    await expect(contextTags(page)).toHaveCount(0)
    await openShortcuts(page)
    await expect(shortcutOption(page, 'Pour tout')).toBeVisible()
    await expect(shortcutOption(page, 'Travelling')).toBeVisible()
    await expect(shortcutOption(page, 'Photo iPhone')).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Et il ne part pas avec une vidéo.
    await app.prompt.fill('une vague')
    const request = page.waitForRequest((r) => r.url().endsWith('/api/generations') && r.method() === 'POST')
    await app.send()
    expect((await request).postDataJSON().contextIds).toEqual([])
  })

  test('un raccourci désactivé n’apparaît pas dans le menu', async ({ app, page }) => {
    await createPreset(page, { label: 'Actif', text: 'on' })
    await createPreset(page, { label: 'Éteint', text: 'off', enabled: false })
    await app.gotoNew()
    await openShortcuts(page)
    await expect(shortcutOption(page, 'Actif')).toBeVisible()
    await expect(shortcutOption(page, 'Éteint')).toHaveCount(0)
  })
})
