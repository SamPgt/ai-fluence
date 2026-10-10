/**
 * Menu des modèles du composer : sections, ordre des recommandés et des
 * fournisseurs, sous-menus au survol, recherche, épinglage, badges, sélection.
 */
import { expect, test } from './helpers'
import {
  modelList,
  modelMenu,
  modelRow,
  openModelMenu,
  rowLabels,
  subMenu,
  subMenuLabels,
  subMenuRow,
} from './support-composer'

const PHOTO_RECOMMENDED = ['GPT Image 2.5', 'Qwen Image 3.0 Pro', 'Seedream 5.0 Pro', 'Nano Banana Pro']
const VIDEO_RECOMMENDED = ['Seedance 2.5', 'Wan 3.0 Prime', 'Kling 3.0', 'Wan 3.0']
const PHOTO_PROVIDERS = ['OpenAI', 'ByteDance', 'Alibaba', 'Google', 'Black Forest Labs']
const VIDEO_PROVIDERS = ['ByteDance', 'Alibaba', 'Kling', 'MiniMax', 'Lightricks']

test.describe('sections', () => {
  test('épinglés vides, recommandés photo dans l’ordre, fournisseurs puis groupes @core', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    const list = modelList(page)
    await expect(list).toContainText('Modèles épinglés')
    await expect(list).toContainText('Les modèles que tu épingles apparaissent ici.')
    await expect(list).toContainText('Modèles recommandés')
    await expect(list).toContainText('Fournisseurs')
    await expect(list).toContainText('Groupes')

    // Ordre des titres de section.
    const text = (await list.textContent()) ?? ''
    const positions = ['Modèles épinglés', 'Modèles recommandés', 'Fournisseurs', 'Groupes'].map((t) =>
      text.indexOf(t),
    )
    expect(positions).toEqual([...positions].sort((a, b) => a - b))

    // Sans épingle, la liste principale ne montre que les recommandés, du rang 1 au rang 4.
    expect(await rowLabels(modelMenu(page))).toEqual(PHOTO_RECOMMENDED)
    expect(await subMenuLabels(page)).toEqual([...PHOTO_PROVIDERS, 'Low cost', 'LoRA'])
  })

  test('en vidéo : recommandés vidéo dans l’ordre et fournisseurs vidéo seulement', async ({ app, page }) => {
    await app.gotoNew()
    await app.chooseMedia('Vidéo')
    await expect(app.modelPicker).toContainText('Seedance 2.0 Mini')
    await openModelMenu(page)
    expect(await rowLabels(modelMenu(page))).toEqual(VIDEO_RECOMMENDED)
    expect(await subMenuLabels(page)).toEqual([...VIDEO_PROVIDERS, 'Low cost', 'LoRA'])
  })

  test('le menu photo ne propose aucun modèle vidéo, et inversement', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    const search = page.getByPlaceholder('Rechercher un modèle')
    await search.fill('Seedance')
    await expect(modelMenu(page)).toContainText('Aucun modèle trouvé.')
    await search.fill('Seedream')
    expect((await rowLabels(modelMenu(page))).sort()).toEqual(['Seedream 5.0 Flash', 'Seedream 5.0 Pro'])
    await page.keyboard.press('Escape')

    await app.chooseMedia('Vidéo')
    await openModelMenu(page)
    await search.fill('Seedream')
    await expect(modelMenu(page)).toContainText('Aucun modèle trouvé.')
    await search.fill('Seedance')
    expect((await rowLabels(modelMenu(page))).sort()).toEqual(['Seedance 2.0 Mini', 'Seedance 2.5'])
  })

  test('groupes Low cost et LoRA : leurs modèles dans un sous-menu', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await subMenuRow(page, 'Low cost').hover()
    await expect(subMenu(page)).toBeVisible()
    expect((await rowLabels(subMenu(page))).sort()).toEqual(['Nano Banana 2.1', 'Seedream 5.0 Flash'])

    await subMenuRow(page, 'LoRA').hover()
    await expect(modelRow(subMenu(page), 'FLUX.1 Dev LoRA')).toBeVisible()
    expect((await rowLabels(subMenu(page))).sort()).toEqual([
      'FLUX.1 Dev LoRA',
      'Qwen Image 2512 LoRA',
      'Z-Image Turbo LoRA',
    ])
    await page.mouse.click(1420, 300)
    await expect(modelMenu(page)).toHaveCount(0)

    await app.chooseMedia('Vidéo')
    await openModelMenu(page)
    await subMenuRow(page, 'Low cost').hover()
    await expect(modelRow(subMenu(page), 'Seedance 2.0 Mini')).toBeVisible()
    expect(await rowLabels(subMenu(page))).toEqual(['Seedance 2.0 Mini'])
    await subMenuRow(page, 'LoRA').hover()
    await expect(modelRow(subMenu(page), 'Wan 2.2 LoRA')).toBeVisible()
    expect((await rowLabels(subMenu(page))).sort()).toEqual(['LTX 2.3 Spicy LoRA', 'MiniMax H3 LoRA', 'Wan 2.2 LoRA'])
  })
})

test.describe('sous-menus des fournisseurs', () => {
  test('le survol d’un fournisseur ouvre ses seuls modèles', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await expect(subMenu(page)).toHaveCount(0)
    await subMenuRow(page, 'OpenAI').hover()
    await expect(subMenu(page)).toBeVisible()
    expect(await rowLabels(subMenu(page))).toEqual(['GPT Image 2.5'])

    await subMenuRow(page, 'Google').hover()
    await expect(modelRow(subMenu(page), 'Nano Banana Pro')).toBeVisible()
    expect((await rowLabels(subMenu(page))).sort()).toEqual(['Nano Banana 2.1', 'Nano Banana Pro'])
  })

  test('passer d’un fournisseur à l’autre change le sous-menu, qui reste ouvert @core', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await subMenuRow(page, 'OpenAI').hover()
    await expect(modelRow(subMenu(page), 'GPT Image 2.5')).toBeVisible()
    await subMenuRow(page, 'ByteDance').hover()
    await expect(modelRow(subMenu(page), 'Seedream 5.0 Pro')).toBeVisible()
    // Régression : le sous-menu se refermait aussitôt après le changement.
    await page.waitForTimeout(600)
    await expect(subMenu(page)).toHaveCount(1)
    await expect(subMenu(page)).toBeVisible()
    expect((await rowLabels(subMenu(page))).sort()).toEqual(['Seedream 5.0 Flash', 'Seedream 5.0 Pro'])
    await expect(subMenuRow(page, 'ByteDance')).toHaveClass(/bg-white\/\[0\.05\]/)

    await subMenuRow(page, 'Alibaba').hover()
    await expect(modelRow(subMenu(page), 'Qwen Image 3.0 Pro')).toBeVisible()
    await page.waitForTimeout(600)
    await expect(subMenu(page)).toBeVisible()
    await expect(modelRow(subMenu(page), 'Seedream 5.0 Pro')).toHaveCount(0)
  })

  test('le sous-menu reste ouvert pendant son survol et se ferme quand la souris le quitte', async ({
    app,
    page,
  }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await subMenuRow(page, 'ByteDance').hover()
    await expect(subMenu(page)).toBeVisible()
    await modelRow(subMenu(page), 'Seedream 5.0 Pro').hover()
    await page.waitForTimeout(600)
    await expect(subMenu(page)).toBeVisible()

    // La souris part loin des deux panneaux : seul le sous-menu se ferme.
    await page.mouse.move(1420, 300)
    await expect(subMenu(page)).toHaveCount(0)
    await expect(modelMenu(page)).toBeVisible()
  })

  test('survoler une ligne de modèle du menu principal referme le sous-menu', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await subMenuRow(page, 'OpenAI').hover()
    await expect(subMenu(page)).toBeVisible()
    await modelRow(modelMenu(page), 'Qwen Image 3.0 Pro').hover()
    await expect(subMenu(page)).toHaveCount(0)
    await expect(modelMenu(page)).toBeVisible()
  })

  test('choisir un modèle dans un sous-menu ferme tout le menu', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await subMenuRow(page, 'Google').hover()
    await modelRow(subMenu(page), 'Nano Banana Pro').click()
    await expect(modelMenu(page)).toHaveCount(0)
    await expect(subMenu(page)).toHaveCount(0)
    await expect(app.modelPicker).toContainText('Nano Banana Pro')
    await expect(app.modelPicker.locator('img[src="/providers/google.svg"]')).toBeVisible()
  })

  test('un clic hors du menu ferme tout, même avec un sous-menu ouvert @core', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await subMenuRow(page, 'ByteDance').hover()
    await expect(subMenu(page)).toBeVisible()
    // Zone vide à droite du fil, hors des deux panneaux.
    await page.mouse.click(1420, 300)
    await expect(subMenu(page)).toHaveCount(0)
    await expect(modelMenu(page)).toHaveCount(0)
    await expect(app.modelPicker).toContainText('Seedream 5.0 Flash')
  })

  test('un clic hors du menu le ferme aussi sans sous-menu ouvert', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await page.mouse.click(1420, 300)
    await expect(modelMenu(page)).toHaveCount(0)
  })
})

test.describe('défilement', () => {
  test('défiler la liste ne ferme pas le menu et ne fait pas sauter le défilement', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    const list = modelList(page)
    const scrollTop = () => list.evaluate((el) => el.scrollTop)
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

    await list.hover()
    await page.mouse.wheel(0, 150)
    await expect.poll(scrollTop).toBeGreaterThan(0)
    const first = await scrollTop()
    await page.waitForTimeout(500)
    await expect(modelMenu(page)).toBeVisible()
    expect(await scrollTop()).toBe(first)
  })

  test('défiler avec un sous-menu ouvert garde le menu et la position', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    const list = modelList(page)
    const scrollTop = () => list.evaluate((el) => el.scrollTop)
    await subMenuRow(page, 'ByteDance').hover()
    await expect(subMenu(page)).toBeVisible()

    await page.mouse.wheel(0, 120)
    await expect.poll(scrollTop).toBeGreaterThan(0)
    const first = await scrollTop()
    await page.waitForTimeout(500)
    await expect(modelMenu(page)).toBeVisible()
    expect(await scrollTop()).toBe(first)

    // Le focus reste dans le menu principal (le sous-menu ne le prend jamais).
    expect(await modelMenu(page).evaluate((el) => el.contains(document.activeElement))).toBe(true)
  })
})

test.describe('recherche', () => {
  test('filtre par nom de modèle @core', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await page.getByPlaceholder('Rechercher un modèle').fill('nano banana')
    expect((await rowLabels(modelMenu(page))).sort()).toEqual(['Nano Banana 2.1', 'Nano Banana Pro'])
    // Pendant une recherche, plus de sections ni de fournisseurs.
    await expect(modelList(page)).not.toContainText('Modèles recommandés')
    await expect(modelList(page)).not.toContainText('Fournisseurs')
  })

  test('filtre par fournisseur', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    const search = page.getByPlaceholder('Rechercher un modèle')
    await search.fill('openai')
    expect(await rowLabels(modelMenu(page))).toEqual(['GPT Image 2.5'])
    await search.fill('Black Forest')
    expect(await rowLabels(modelMenu(page))).toEqual(['FLUX.1 Dev LoRA'])
  })

  test('aucun résultat : message dédié, puis retour aux sections en vidant la recherche', async ({
    app,
    page,
  }) => {
    await app.gotoNew()
    await openModelMenu(page)
    const search = page.getByPlaceholder('Rechercher un modèle')
    await expect(search).toBeFocused()
    await search.fill('zzz introuvable')
    await expect(modelMenu(page)).toContainText('Aucun modèle trouvé.')
    await expect(modelMenu(page).getByRole('menuitemradio')).toHaveCount(0)
    await search.fill('')
    await expect(modelList(page)).toContainText('Modèles recommandés')
  })

  test('la recherche est vidée à la réouverture du menu', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await page.getByPlaceholder('Rechercher un modèle').fill('gpt')
    await page.keyboard.press('Escape')
    await expect(modelMenu(page)).toHaveCount(0)
    await openModelMenu(page)
    await expect(page.getByPlaceholder('Rechercher un modèle')).toHaveValue('')
  })
})

test.describe('épingles', () => {
  test('épingler un modèle le place dans « Modèles épinglés », même après rechargement @core', async ({
    app,
    page,
  }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await subMenuRow(page, 'ByteDance').hover()
    const row = modelRow(subMenu(page), 'Seedream 5.0 Flash')
    await row.hover()
    await row.getByRole('button', { name: 'Épingler' }).click()

    // Le sous-menu montre maintenant l'épingle pleine.
    await expect(row.getByRole('button', { name: 'Désépingler' })).toBeVisible()
    await page.mouse.move(1420, 300)
    await expect(subMenu(page)).toHaveCount(0)
    await expect(modelList(page)).not.toContainText('Les modèles que tu épingles apparaissent ici.')
    expect(await rowLabels(modelMenu(page))).toEqual(['Seedream 5.0 Flash', ...PHOTO_RECOMMENDED])

    // Préférence en cookie : gardée au rechargement.
    const cookies = await page.context().cookies()
    expect(cookies.some((c) => decodeURIComponent(c.value).includes('bytedance/seedream-5.0-flash'))).toBe(true)
    await page.keyboard.press('Escape')
    await app.reload()
    await openModelMenu(page)
    expect(await rowLabels(modelMenu(page))).toEqual(['Seedream 5.0 Flash', ...PHOTO_RECOMMENDED])
  })

  test('désépingler retire le modèle des épinglés', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    const gpt = modelRow(modelMenu(page), 'GPT Image 2.5').first()
    await gpt.hover()
    await gpt.getByRole('button', { name: 'Épingler' }).click()
    // Un modèle recommandé épinglé apparaît deux fois : épinglés puis recommandés.
    expect(await rowLabels(modelMenu(page))).toEqual(['GPT Image 2.5', ...PHOTO_RECOMMENDED])

    const pinned = modelRow(modelMenu(page), 'GPT Image 2.5').first()
    await pinned.getByRole('button', { name: 'Désépingler' }).click()
    await expect(modelList(page)).toContainText('Les modèles que tu épingles apparaissent ici.')
    expect(await rowLabels(modelMenu(page))).toEqual(PHOTO_RECOMMENDED)
  })

  test('épingler ne choisit pas le modèle et ne ferme pas le menu', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    const row = modelRow(modelMenu(page), 'Qwen Image 3.0 Pro')
    await row.hover()
    await row.getByRole('button', { name: 'Épingler' }).click()
    await expect(modelMenu(page)).toBeVisible()
    await expect(app.modelPicker).toContainText('Seedream 5.0 Flash')
  })

  test('les épingles sont propres à chaque type de média', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    const row = modelRow(modelMenu(page), 'GPT Image 2.5')
    await row.hover()
    await row.getByRole('button', { name: 'Épingler' }).click()
    await page.keyboard.press('Escape')
    await app.chooseMedia('Vidéo')
    await openModelMenu(page)
    await expect(modelList(page)).toContainText('Les modèles que tu épingles apparaissent ici.')
    expect(await rowLabels(modelMenu(page))).toEqual(VIDEO_RECOMMENDED)
  })
})

test.describe('badges', () => {
  test('la durée habituelle n’apparaît qu’après une génération réussie', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await page.getByPlaceholder('Rechercher un modèle').fill('Seedream 5.0 Flash')
    const row = modelRow(modelMenu(page), 'Seedream 5.0 Flash')
    await expect(row).toBeVisible()
    await expect(row.getByText(/^\d+(s|m)$/)).toHaveCount(0)

    await app.generate({ prompt: 'durée habituelle' })
    await page.keyboard.press('Escape')
    await app.gotoNew()
    await openModelMenu(page)
    await page.getByPlaceholder('Rechercher un modèle').fill('Seedream 5.0')
    await expect(modelRow(modelMenu(page), 'Seedream 5.0 Flash').getByText(/^\d+(s|m)$/)).toBeVisible()
    // Les autres modèles, jamais utilisés, restent sans durée.
    await expect(modelRow(modelMenu(page), 'Seedream 5.0 Pro').getByText(/^\d+(s|m)$/)).toHaveCount(0)
  })

  test('nombre d’images de référence, avec infobulle après un court délai', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await page.getByPlaceholder('Rechercher un modèle').fill('Qwen Image 3.0 Pro')
    const row = modelRow(modelMenu(page), 'Qwen Image 3.0 Pro')
    const badge = row.locator('span.rounded-full', { has: page.locator('svg') }).filter({ hasText: /^3$/ })
    await expect(badge).toBeVisible()

    const tooltip = page.getByRole('tooltip').filter({ hasText: /Jusqu.à 3 images de référence/ })
    await badge.hover()
    // Pas d'infobulle immédiate : elle ne surgit pas en balayant la liste.
    await page.waitForTimeout(200)
    await expect(tooltip).toHaveCount(0)
    await expect(tooltip).toBeAttached({ timeout: 2_000 })
  })

  test('le badge d’images suit le modèle : 2 pour Kling 3.0 (début et fin)', async ({ app, page }) => {
    await app.gotoNew()
    await app.chooseMedia('Vidéo')
    await openModelMenu(page)
    await page.getByPlaceholder('Rechercher un modèle').fill('Kling 3.0')
    const row = modelRow(modelMenu(page), 'Kling 3.0')
    await expect(row).toBeVisible()
    await expect(row.locator('span.rounded-full', { has: page.locator('svg') })).toHaveText('2')
  })
})

test.describe('sélection', () => {
  test('coche sur le modèle choisi uniquement', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await page.getByPlaceholder('Rechercher un modèle').fill('Seedream')
    const flash = modelRow(modelMenu(page), 'Seedream 5.0 Flash')
    const pro = modelRow(modelMenu(page), 'Seedream 5.0 Pro')
    await expect(flash).toHaveAttribute('aria-checked', 'true')
    await expect(flash.locator('svg.lucide-check')).toBeVisible()
    await expect(pro).toHaveAttribute('aria-checked', 'false')
    await expect(pro.locator('svg.lucide-check')).toHaveCount(0)
  })

  test('choisir un modèle ferme le menu et met à jour le bouton avec le logo du fournisseur @core', async ({
    app,
    page,
  }) => {
    await app.gotoNew()
    await expect(app.modelPicker.locator('img[src="/providers/bytedance.svg"]')).toBeVisible()
    await openModelMenu(page)
    await modelRow(modelMenu(page), 'GPT Image 2.5').click()
    await expect(modelMenu(page)).toHaveCount(0)
    await expect(app.modelPicker).toContainText('GPT Image 2.5')
    await expect(app.modelPicker.locator('img[src="/providers/openai.svg"]')).toBeVisible()
    await expect(app.modelPicker.locator('img[src="/providers/bytedance.svg"]')).toHaveCount(0)

    // À la réouverture, la coche a suivi.
    await openModelMenu(page)
    await expect(modelRow(modelMenu(page), 'GPT Image 2.5')).toHaveAttribute('aria-checked', 'true')
  })

  test('le clavier choisit aussi un modèle (Entrée sur la ligne)', async ({ app, page }) => {
    await app.gotoNew()
    await openModelMenu(page)
    await modelRow(modelMenu(page), 'Qwen Image 3.0 Pro').focus()
    await page.keyboard.press('Enter')
    await expect(modelMenu(page)).toHaveCount(0)
    await expect(app.modelPicker).toContainText('Qwen Image 3.0 Pro')
  })
})
