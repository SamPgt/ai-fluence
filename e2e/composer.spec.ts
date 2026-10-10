/**
 * Contrôles du composer : photo / vidéo, résolution, proportions, série,
 * durée, paramètres, fichiers joints, bouton d'envoi et résultat dans le fil.
 */
import { expect, test } from './helpers'
import { fileInput, formatUsd, pngFile } from './support-composer'

const PRICE = formatUsd('0.01')

const resolution = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /^Résolution / })
const sendButton = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /^Générer/ })
const fileButton = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Ajouter un fichier' })
const paramsButton = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Paramètres du modèle' })

/**
 * Saisie dans le champ Durée : le champ sélectionne son contenu à l'image
 * suivante (requestAnimationFrame), on attend cette sélection avant de taper.
 */
async function typeDuration(page: import('@playwright/test').Page, text: string, key: 'Enter' | 'Escape') {
  const input = page.getByRole('textbox', { name: 'Durée' })
  await input.click()
  await expect
    .poll(() =>
      input.evaluate(
        (el: HTMLInputElement) => el.value.length > 0 && el.selectionStart === 0 && el.selectionEnd === el.value.length,
      ),
    )
    .toBe(true)
  await page.keyboard.type(text)
  await page.keyboard.press(key)
}

/** Barres de niveau remplies du bouton de résolution. */
const filledBars = (page: import('@playwright/test').Page) =>
  resolution(page)
    .locator('span[aria-hidden] > span')
    .evaluateAll((bars) => bars.filter((b) => b.classList.contains('bg-foreground')).length)

test.describe('photo / vidéo', () => {
  test('la bascule change le type, le texte d’aide et les réglages proposés @core', async ({ app, page }) => {
    await app.gotoNew()
    const photo = page.getByRole('radio', { name: 'Photo' })
    const video = page.getByRole('radio', { name: 'Vidéo' })
    await expect(photo).toHaveAttribute('aria-checked', 'true')
    await expect(video).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByPlaceholder('Décris l’image ou ajoute des références')).toBeVisible()
    await expect(app.count).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Durée' })).toHaveCount(0)

    await app.chooseMedia('Vidéo')
    await expect(video).toHaveAttribute('aria-checked', 'true')
    await expect(photo).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByPlaceholder('Décris la scène ou ajoute des références')).toBeVisible()
    await expect(app.modelPicker).toContainText('Seedance 2.0 Mini')
    await expect(app.count).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Durée' })).toBeVisible()

    await app.chooseMedia('Photo')
    await expect(photo).toHaveAttribute('aria-checked', 'true')
    await expect(app.count).toBeVisible()
  })

  test('chaque type garde son dernier modèle choisi', async ({ app }) => {
    await app.gotoNew()
    await app.chooseModel('GPT Image 2.5')
    await app.chooseMedia('Vidéo')
    await app.chooseModel('Kling 3.0')
    await app.chooseMedia('Photo')
    await expect(app.modelPicker).toContainText('GPT Image 2.5')
    await app.chooseMedia('Vidéo')
    await expect(app.modelPicker).toContainText('Kling 3.0')
  })
})

test.describe('résolution', () => {
  test('un clic passe à la valeur suivante, en boucle, avec les barres de niveau @core', async ({ app, page }) => {
    await app.gotoNew()
    // Seedream 5.0 Flash : 1K, 1.5K, 2K (2K par défaut).
    await expect(resolution(page)).toHaveAccessibleName('Résolution 2K')
    await expect(resolution(page)).toHaveText('2K')
    await expect(resolution(page).locator('span[aria-hidden] > span')).toHaveCount(3)
    expect(await filledBars(page)).toBe(3)

    await resolution(page).click()
    await expect(resolution(page)).toHaveAccessibleName('Résolution 1K')
    expect(await filledBars(page)).toBe(1)
    await resolution(page).click()
    await expect(resolution(page)).toHaveAccessibleName('Résolution 1.5K')
    expect(await filledBars(page)).toBe(2)
    await resolution(page).click()
    await expect(resolution(page)).toHaveAccessibleName('Résolution 2K')
    expect(await filledBars(page)).toBe(3)
  })

  test('les valeurs suivent le modèle (vidéo : 480P puis 720P)', async ({ app, page }) => {
    await app.gotoNew()
    await app.chooseMedia('Vidéo')
    await expect(resolution(page)).toHaveAccessibleName('Résolution 720P')
    await expect(resolution(page).locator('span[aria-hidden] > span')).toHaveCount(2)
    await resolution(page).click()
    await expect(resolution(page)).toHaveAccessibleName('Résolution 480P')
    expect(await filledBars(page)).toBe(1)
  })
})

test.describe('proportions', () => {
  test('le menu montre la forme de chaque format et applique le choix @core', async ({ app, page }) => {
    await app.gotoNew()
    await app.ratio.click()
    const panel = page.locator('[data-slot=popover-content]').filter({ hasText: 'Proportions' })
    await expect(panel).toBeVisible()

    const shape = (name: string) =>
      panel.getByRole('button', { name, exact: true }).locator('span[aria-hidden]')
    const size = async (name: string) => {
      const box = await shape(name).boundingBox()
      return { w: Math.round(box!.width), h: Math.round(box!.height) }
    }
    const wide = await size('16:9')
    const tall = await size('9:16')
    const square = await size('1:1')
    expect(wide.w).toBeGreaterThan(wide.h)
    expect(tall.h).toBeGreaterThan(tall.w)
    expect(square.w).toBe(square.h)

    await panel.getByRole('button', { name: '16:9', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(app.ratio).toHaveText('16:9')
    const trigger = await app.ratio.locator('span[aria-hidden]').boundingBox()
    expect(trigger!.width).toBeGreaterThan(trigger!.height)

    // À la réouverture, le format choisi est mis en avant.
    await app.ratio.click()
    await expect(panel.getByRole('button', { name: '16:9', exact: true })).toHaveClass(/(^|\s)bg-accent(\s|$)/)
    await expect(panel.getByRole('button', { name: '1:1', exact: true })).not.toHaveClass(/(^|\s)bg-accent(\s|$)/)
  })

  test('« adaptive » s’affiche « Auto » en vidéo', async ({ app, page }) => {
    await app.gotoNew()
    await app.chooseMedia('Vidéo')
    await app.ratio.click()
    const panel = page.locator('[data-slot=popover-content]').filter({ hasText: 'Proportions' })
    // Format libre : carré en pointillés.
    await expect(panel.getByRole('button', { name: 'Auto', exact: true }).locator('span[aria-hidden]')).toHaveClass(
      /border-dashed/,
    )
    await panel.getByRole('button', { name: 'Auto', exact: true }).click()
    await expect(app.ratio).toHaveText('Auto')
  })
})

test.describe('série', () => {
  test('le nombre d’images passe de x1 à x4, x8 puis x1, sans barres @core', async ({ app }) => {
    await app.gotoNew()
    await expect(app.count).toHaveAccessibleName("Nombre d'images x1")
    await expect(app.count.locator('span[aria-hidden]')).toHaveCount(0)
    await app.count.click()
    await expect(app.count).toHaveAccessibleName("Nombre d'images x4")
    await expect(app.count).toHaveText('x4')
    await app.count.click()
    await expect(app.count).toHaveAccessibleName("Nombre d'images x8")
    await app.count.click()
    await expect(app.count).toHaveAccessibleName("Nombre d'images x1")
  })

  test('caché en vidéo, et la vidéo part toujours en un seul exemplaire', async ({ app, page }) => {
    await app.gotoNew()
    await app.count.click()
    await expect(app.count).toHaveText('x4')
    await app.chooseMedia('Vidéo')
    await expect(app.count).toHaveCount(0)

    await app.prompt.fill('une vague')
    const request = page.waitForRequest((r) => r.url().endsWith('/api/generations') && r.method() === 'POST')
    await app.send()
    expect((await request).postDataJSON().count).toBe(1)
  })
})

test.describe('durée (vidéo)', () => {
  test('− et + passent d’une valeur à l’autre, bornés @core', async ({ app, page }) => {
    await app.gotoNew()
    await app.chooseMedia('Vidéo')
    const input = page.getByRole('textbox', { name: 'Durée' })
    const minus = page.getByRole('button', { name: 'Durée : moins' })
    const plus = page.getByRole('button', { name: 'Durée : plus' })
    // Seedance 2.0 Mini : Auto, puis 4 à 15 s (5 s par défaut).
    await expect(input).toHaveValue('5s')
    await plus.click()
    await expect(input).toHaveValue('6s')
    await minus.click()
    await minus.click()
    await expect(input).toHaveValue('4s')
    await minus.click()
    await expect(input).toHaveValue('Auto')
    await expect(minus).toBeDisabled()
  })

  test('une valeur saisie au-dessus du maximum devient le maximum', async ({ app, page }) => {
    await app.gotoNew()
    await app.chooseMedia('Vidéo')
    const input = page.getByRole('textbox', { name: 'Durée' })
    await typeDuration(page, '99', 'Enter')
    await expect(input).not.toBeFocused()
    await expect(input).toHaveValue('15s')
    await expect(page.getByRole('button', { name: 'Durée : plus' })).toBeDisabled()
  })

  test('une valeur saisie sous le minimum devient le minimum', async ({ app, page }) => {
    await app.gotoNew()
    await app.chooseMedia('Vidéo')
    const input = page.getByRole('textbox', { name: 'Durée' })
    await typeDuration(page, '1', 'Enter')
    await expect(input).toHaveValue('4s')
    // Une valeur valide est gardée telle quelle.
    await typeDuration(page, '9', 'Enter')
    await expect(input).toHaveValue('9s')
  })

  test('Échap annule la saisie', async ({ app, page }) => {
    // Ancien bug (corrigé) : la perte de focus qui suit Échap enregistrait la valeur tapée.
    await app.gotoNew()
    await app.chooseMedia('Vidéo')
    const input = page.getByRole('textbox', { name: 'Durée' })
    await typeDuration(page, '12', 'Escape')
    await expect(input).not.toBeFocused()
    await expect(input).toHaveValue('5s')
  })

  test('la durée choisie part avec la demande', async ({ app, page }) => {
    await app.gotoNew()
    await app.chooseMedia('Vidéo')
    await page.getByRole('button', { name: 'Durée : plus' }).click()
    await app.prompt.fill('un chat qui saute')
    const request = page.waitForRequest((r) => r.url().endsWith('/api/generations') && r.method() === 'POST')
    await app.send()
    expect((await request).postDataJSON().params.duration_seconds).toBe(6)
  })
})

test.describe('paramètres du modèle', () => {
  const panelOf = (page: import('@playwright/test').Page) =>
    page.locator('[data-slot=popover-content]').filter({ hasText: 'Réinitialiser' })
  const dotOf = (page: import('@playwright/test').Page) => paramsButton(page).locator('span[title$="modifié(s)"]')

  test('désactivé quand le modèle n’a pas d’autre réglage que ceux de la barre', async ({ app, page }) => {
    await app.gotoNew()
    // Seedream 5.0 Flash : résolution et proportions sont déjà dans la barre.
    await expect(paramsButton(page)).toBeDisabled()
  })

  test('bouton sans bordure, réglage modifié signalé par un point, puis réinitialisé @core', async ({
    app,
    page,
  }) => {
    await app.gotoNew()
    await app.chooseModel('Qwen Image 3.0 Pro')
    const button = paramsButton(page)
    await expect(button).toBeEnabled()
    expect(await button.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px')
    await expect(dotOf(page)).toHaveCount(0)

    await button.click()
    const panel = panelOf(page)
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('Paramètres')
    await expect(panel).toContainText('Optimisation du prompt')
    await expect(panel).toContainText('Prompt négatif')
    const select = panel.getByRole('combobox')
    await expect(select).toHaveText('direct')
    await select.click()
    await page.getByRole('option', { name: 'agent' }).click()
    await expect(select).toHaveText('agent')
    await expect(dotOf(page)).toHaveCount(1)
    await expect(dotOf(page)).toHaveAttribute('title', '1 réglage(s) modifié(s)')

    // Deuxième réglage modifié : le compteur suit.
    await panel.getByRole('switch').click()
    await expect(dotOf(page)).toHaveAttribute('title', '2 réglage(s) modifié(s)')

    await panel.getByRole('button', { name: 'Réinitialiser' }).click()
    await expect(select).toHaveText('direct')
    await expect(panel.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    await expect(dotOf(page)).toHaveCount(0)
  })

  test('revenir à la valeur par défaut retire le point', async ({ app, page }) => {
    await app.gotoNew()
    await app.chooseModel('Qwen Image 3.0 Pro')
    await paramsButton(page).click()
    const select = panelOf(page).getByRole('combobox')
    await select.click()
    await page.getByRole('option', { name: 'agent' }).click()
    await expect(dotOf(page)).toHaveCount(1)
    await select.click()
    await page.getByRole('option', { name: 'direct' }).click()
    await expect(dotOf(page)).toHaveCount(0)
  })

  test('les réglages rapides de la barre ne sont pas répétés dans le panneau', async ({ app, page }) => {
    await app.gotoNew()
    await app.chooseModel('Qwen Image 3.0 Pro')
    await paramsButton(page).click()
    const panel = panelOf(page)
    await expect(panel).toBeVisible()
    await expect(panel).not.toContainText('Résolution')
    await expect(panel).not.toContainText('Proportions')
  })

  test('le réglage choisi part avec la demande', async ({ app, page }) => {
    await app.gotoNew()
    await app.chooseModel('Qwen Image 3.0 Pro')
    await paramsButton(page).click()
    await panelOf(page).getByRole('combobox').click()
    await page.getByRole('option', { name: 'agent' }).click()
    // La liste du menu déroulant doit être refermée avant le clic extérieur.
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await page.waitForTimeout(300)
    await page.mouse.click(1420, 300)
    await expect(panelOf(page)).toHaveCount(0)
    await app.prompt.fill('un phare')
    const request = page.waitForRequest((r) => r.url().endsWith('/api/generations') && r.method() === 'POST')
    await app.send()
    expect((await request).postDataJSON().params.prompt_optimization_mode).toBe('agent')
  })
})

test.describe('fichiers joints', () => {
  test('le bouton + affiche le nombre d’images jointes sur le maximum du modèle', async ({ app, page }) => {
    await app.gotoNew()
    await expect(fileButton(page)).toHaveText('0/10')
    await expect(fileButton(page)).toHaveAttribute('title', /10 au maximum pour ce modèle/)
    await app.attachFile()
    await expect(app.attachments).toHaveCount(1)
    await expect(fileButton(page)).toHaveText('1/10')

    await app.chooseModel('Qwen Image 3.0 Pro')
    await expect(fileButton(page)).toHaveText('1/3')
  })

  test('trop d’images : le compteur passe en ambre et un avertissement s’affiche', async ({ app, page }) => {
    await app.gotoNew()
    await app.chooseModel('Qwen Image 3.0 Pro')
    await app.prompt.fill('quatre images')
    await fileInput(page).setInputFiles([1, 2, 3, 4].map((i) => pngFile(`ref-${i}.png`)))
    await expect(app.attachments).toHaveCount(4)
    await expect(fileButton(page)).toHaveText('4/3')
    await expect(fileButton(page).locator('span.tabular-nums')).toHaveClass(/text-amber-300/)
    await expect(page.getByText("Trop d'images pour ce modèle (3 au maximum) : retire-en 1 pour envoyer.")).toBeVisible()
  })

  test('trop d’images : l’envoi est bloqué @core', async ({ app, page }) => {
    // Ancien bug (corrigé) : le bouton restait actif et les images en trop étaient ignorées.
    await app.gotoNew()
    await app.chooseModel('Qwen Image 3.0 Pro')
    await app.prompt.fill('quatre images')
    await fileInput(page).setInputFiles([1, 2, 3, 4].map((i) => pngFile(`ref-${i}.png`)))
    await expect(fileButton(page)).toHaveText('4/3')
    await expect(page.getByText(/Trop d'images pour ce modèle/)).toBeVisible()
    await expect(sendButton(page)).toBeDisabled({ timeout: 3_000 })
  })

  test('retirer une image met à jour le compteur', async ({ app, page }) => {
    await app.gotoNew()
    await fileInput(page).setInputFiles([pngFile('a.png'), pngFile('b.png')])
    await expect(fileButton(page)).toHaveText('2/10')
    await app.attachments.first().hover()
    await app.attachments.first().getByRole('button', { name: 'Retirer' }).click()
    await expect(app.attachments).toHaveCount(1)
    await expect(fileButton(page)).toHaveText('1/10')
  })

  test('une image dans un format refusé affiche une erreur', async ({ app, page }) => {
    await app.gotoNew()
    await fileInput(page).setInputFiles({ name: 'photo.bmp', mimeType: 'image/bmp', buffer: Buffer.from('BM') })
    await expect(page.getByText(/photo\.bmp : Formats acceptés : JPEG, PNG, WebP, GIF, MP4, WebM\./)).toBeVisible()
    await expect(app.attachments).toHaveCount(0)
    await expect(fileButton(page)).toHaveText('0/10')
  })

  test('un fichier qui n’est ni une image ni une vidéo affiche une erreur', async ({ app, page }) => {
    // Ancien bug (corrigé) : un fichier texte (ou PDF) était ignoré en silence.
    await app.gotoNew()
    await fileInput(page).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('bonjour') })
    await expect(page.getByText(/notes\.txt : Formats acceptés/)).toBeVisible({ timeout: 3_000 })
  })
})

test.describe('envoi', () => {
  test('bouton désactivé sans prompt, puis prix affiché une fois le devis reçu @core', async ({ app, page }) => {
    await app.gotoNew()
    await expect(sendButton(page)).toHaveAccessibleName('Générer')
    await expect(sendButton(page)).toBeDisabled()

    await app.prompt.fill('un renard dans la neige')
    const button = page.getByRole('button', { name: `Générer pour ${PRICE}` })
    await expect(button).toBeEnabled()
    await expect(page.getByText(`≈ ${PRICE}`)).toBeVisible()

    // Des espaces seuls ne suffisent pas.
    await app.prompt.fill('   ')
    await expect(sendButton(page)).toHaveAccessibleName('Générer')
    await expect(sendButton(page)).toBeDisabled()
  })

  test('Maj+Entrée fait un retour à la ligne, Entrée envoie', async ({ app, page }) => {
    await app.gotoNew()
    await app.prompt.click()
    await page.keyboard.type('première ligne')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('deuxième ligne')
    await expect(app.prompt).toHaveValue('première ligne\ndeuxième ligne')
    await expect(page).toHaveURL(/\/$/)

    await expect(page.getByRole('button', { name: `Générer pour ${PRICE}` })).toBeEnabled()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/t\/[0-9a-f-]+$/)
    await expect(page.getByTestId('request-bubble')).toContainText('première ligne')
    await expect(page.getByTestId('request-bubble')).toContainText('deuxième ligne')
    await expect(app.prompt).toHaveValue('')
  })

  test('Entrée sans prompt n’envoie rien', async ({ app, page }) => {
    await app.gotoNew()
    let sent = false
    page.on('request', (r) => {
      if (r.url().endsWith('/api/generations') && r.method() === 'POST') sent = true
    })
    await app.prompt.click()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    expect(sent).toBe(false)
    await expect(page).toHaveURL(/\/$/)
  })

  test('la génération apparaît dans le fil avec le modèle et le logo du fournisseur', async ({ app, page }) => {
    await app.gotoNew()
    await app.chooseModel('GPT Image 2.5')
    await app.prompt.fill('un phare breton au lever du jour')
    await app.send()
    await expect(page).toHaveURL(/\/t\/[0-9a-f-]+$/)
    await expect(page.getByTestId('request-bubble')).toHaveText('un phare breton au lever du jour')
    const model = page.getByTestId('request-model')
    await expect(model).toHaveText('GPT Image 2.5')
    await expect(model.locator('img[src="/providers/openai.svg"]')).toBeAttached()
    await expect(page.getByRole('img', { name: 'un phare breton au lever du jour' })).toBeVisible()
  })

  test('une série x4 donne 4 résultats et « Série · 4 images » @core', async ({ app, page }) => {
    await app.gotoNew()
    await app.count.click()
    await expect(app.count).toHaveText('x4')
    await app.prompt.fill('quatre variantes')
    await app.send()
    await expect(page).toHaveURL(/\/t\/[0-9a-f-]+$/)
    await expect(page.getByText('Série · 4 images')).toBeVisible()
    await expect(page.getByRole('img', { name: 'quatre variantes' })).toHaveCount(4)
    await expect(page.getByTestId('request-model')).toHaveText('Seedream 5.0 Flash')
    // Le nombre choisi reste pour la demande suivante.
    await expect(app.count).toHaveText('x4')
  })

  test('une génération en échec affiche son message d’erreur @core', async ({ app, page }) => {
    await app.gotoNew()
    await app.prompt.fill('ceci va échouer FAIL_TEST')
    await app.send()
    await expect(page).toHaveURL(/\/t\/[0-9a-f-]+$/)
    await expect(page.getByText('Échec simulé.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Modifier la demande', exact: true }).last()).toBeVisible()
  })

  test('dans un fil existant, la nouvelle génération s’ajoute sous la précédente', async ({ app, page }) => {
    const { thread } = await app.generate({ prompt: 'première demande' })
    await app.gotoThread(thread.id)
    await app.prompt.fill('deuxième demande')
    await app.send()
    await expect(page.getByTestId('request-bubble')).toHaveCount(2)
    await expect(page.getByTestId('request-bubble').last()).toHaveText('deuxième demande')
    await expect(page).toHaveURL(new RegExp(`/t/${thread.id}$`))
  })
})

test.describe('sans clé API', () => {
  test('message pour ajouter la clé, aucun modèle et envoi impossible @core', async ({ app, page }) => {
    const removed = await page.request.delete('/api/settings/api-key')
    expect(removed.ok()).toBeTruthy()
    try {
      await page.goto('/')
      const banner = page.getByRole('link', { name: /Ajoute ta clé API SpicyAPI pour commencer à générer/ })
      await expect(banner).toBeVisible()
      await expect(page.getByText('Clé API manquante')).toBeVisible()
      await expect(app.modelPicker).toContainText('Choisir un modèle')
      await app.prompt.fill('sans clé')
      await page.waitForTimeout(800)
      await expect(sendButton(page)).toHaveAccessibleName('Générer')
      await expect(sendButton(page)).toBeDisabled()

      await banner.click()
      await expect(page).toHaveURL(/\/parametres\?tab=api-key/)
      await expect(banner).toHaveCount(0)
    } finally {
      const back = await page.request.put('/api/settings/api-key', {
        data: { apiKey: 'sk-spicy-e2e-0000000000' },
      })
      expect(back.ok()).toBeTruthy()
    }
  })
})
