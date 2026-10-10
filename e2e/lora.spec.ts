/**
 * LoRA d'un persona : ajout par lien sur la fiche, import depuis la bibliothèque
 * Civitai (simulée dans le navigateur, jamais civitai.com), choix dans le menu
 * des raccourcis du composer (mots déclencheurs, 3 LoRA au maximum), envoi
 * (loraIds, loraWords, section « # Lora ») et pastille « Tags · N » du fil.
 */
import type { Page, Route } from '@playwright/test'
import type { CivitaiLora, CivitaiSearchResponse, Generation, PersonaLora } from '@ai-fluence/shared'
import { expect, test, type App } from './helpers'
import { PNG, getPersona, gotoPersona, popover, saved, sendAndCapture } from './support-personas'

const Z_IMAGE = 'alibaba/z-image-turbo-lora'
const FLUX = 'black-forest-labs/flux-1-dev-lora'
const QWEN_LORA = 'alibaba/qwen-image-2512-lora'

// Liens fictifs (hôte réservé .test) : jamais résolus auprès de Civitai.
const loraUrl = (name: string) => `https://lora.example.test/${name}.safetensors`

const LORAS: PersonaLora[] = [
  {
    id: 'l1',
    label: 'Visage Alice',
    path: loraUrl('alice'),
    scale: 0.8,
    family: Z_IMAGE,
    triggerWords: ['ohwx alice', 'sourire', 'motcache'],
    hiddenWords: ['motcache'],
  },
  { id: 'l2', label: 'Style Film', path: loraUrl('film'), scale: 1, family: Z_IMAGE, triggerWords: ['filmgrain'] },
  { id: 'l3', label: 'Sans mot', path: loraUrl('nu'), scale: 1, family: Z_IMAGE, triggerWords: [] },
  { id: 'l4', label: 'Quatrième', path: loraUrl('quatre'), scale: 1, family: Z_IMAGE, triggerWords: ['quatre'] },
  { id: 'l5', label: 'Flux seulement', path: loraUrl('flux'), scale: 1, family: FLUX, triggerWords: ['fluxword'] },
]

// ── Bibliothèque Civitai simulée ─────────────────────────────

const file = (name: string) => ({ url: loraUrl(name), fileName: `${name}.safetensors`, sizeKB: 1200 })

const PORTRAIT: CivitaiLora = {
  modelId: 4242,
  versionId: 11,
  name: 'Portrait Doux',
  versionName: 'v1',
  creator: 'artiste',
  pageUrl: 'https://civitai.com/models/4242',
  family: Z_IMAGE,
  baseModel: 'ZImageTurbo',
  triggerWords: ['doux portrait'],
  previews: [{ url: 'https://image.example.test/portrait.png', nsfw: false }],
  files: [file('portrait-z')],
  downloads: 12_500,
  likes: 340,
  nsfw: false,
  variants: [
    {
      family: Z_IMAGE,
      baseModel: 'ZImageTurbo',
      versionId: 11,
      versionName: 'v1',
      triggerWords: ['doux portrait'],
      files: [file('portrait-z')],
    },
    {
      family: FLUX,
      baseModel: 'Flux.1 D',
      versionId: 12,
      versionName: 'v1 flux',
      triggerWords: ['soft flux'],
      files: [file('portrait-flux')],
    },
  ],
}

const NEON: CivitaiLora = {
  ...PORTRAIT,
  modelId: 5151,
  versionId: 21,
  name: 'Lumière Néon',
  pageUrl: 'https://civitai.com/models/5151',
  family: FLUX,
  baseModel: 'Flux.1 D',
  triggerWords: ['neonlight'],
  files: [file('neon')],
  variants: [
    {
      family: FLUX,
      baseModel: 'Flux.1 D',
      versionId: 21,
      versionName: 'v2',
      triggerWords: ['neonlight'],
      files: [file('neon')],
    },
  ],
}

/**
 * Intercepte les appels du navigateur à /api/civitai/* et les images des
 * aperçus. Renvoie la liste des recherches reçues (paramètres).
 */
async function mockCivitai(page: Page, items: CivitaiLora[] = [PORTRAIT, NEON]) {
  const searches: URLSearchParams[] = []
  await page.route('**/api/civitai/status', (route: Route) => route.fulfill({ json: { enabled: true } }))
  await page.route('**/api/civitai/search**', (route: Route) => {
    const q = new URL(route.request().url()).searchParams
    searches.push(q)
    const family = q.get('family')
    const text = q.get('query')?.toLowerCase()
    const body: CivitaiSearchResponse = {
      items: items.filter(
        (i) =>
          (!family || i.variants.some((v) => v.family === family)) &&
          (!text || i.name.toLowerCase().includes(text)),
      ),
      nextCursor: null,
    }
    return route.fulfill({ json: body })
  })
  await page.route(/image\.example\.test/, (route: Route) =>
    route.fulfill({ body: PNG, contentType: 'image/png' }),
  )
  // Filet de sécurité : rien ne doit partir vers Civitai.
  const leaks: string[] = []
  await page.route(/civitai\.com/, (route: Route) => {
    leaks.push(route.request().url())
    return route.abort()
  })
  return { searches, leaks }
}

// ── Composer ─────────────────────────────────────────────────

/** Persona avec ses LoRA, sélectionné dans un nouveau fil, modèle Z-Image Turbo LoRA. */
async function composerWithLoras(app: App, loras: PersonaLora[] = LORAS) {
  const persona = await app.createPersona({ name: 'Alice', loras })
  await app.gotoNew()
  await app.selectPersona('Alice')
  await app.chooseModel('Z-Image Turbo LoRA')
  // Le menu des modèles finit de se fermer.
  await expect(popover(app.page)).toHaveCount(0)
  return persona
}

async function openShortcuts(page: Page) {
  await page.getByRole('button', { name: 'Ajouter un raccourci' }).click()
  await expect(popover(page).locator('[cmdk-input]')).toBeVisible()
}

const option = (page: Page, name: string) =>
  popover(page).getByRole('option', {
    // « Sans mot » porte aussi la mention « Sans mot déclencheur ».
    name: name === 'Sans mot' ? /^Sans mot/ : name,
    exact: true,
  })

/** Tags violets de la rangée au-dessus du composer (un par mot choisi). */
const loraTags = (page: Page) => page.locator('span.border-violet-500\\/30:has(> button)')

test.describe('Fiche persona : LoRA par lien', () => {
  test('lien, nom, force, modèle, mots déclencheurs et mot masqué enregistrés @core', async ({
    app,
    page,
  }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id, 'lora')
    await expect(page.getByText('Aucune LoRA pour ce persona.')).toBeVisible()

    await page.getByRole('button', { name: 'Ajouter une LoRA par lien' }).click()
    await page.getByPlaceholder('Nom', { exact: true }).fill('Visage Alice')
    await page.getByPlaceholder(/^https:\/\/huggingface\.co/).fill(loraUrl('alice'))
    await page.locator('input[type=range]').fill('1.5')
    await expect(page.getByText('1.50')).toBeVisible()

    // Modèle : Qwen Image 2512 LoRA par défaut, on passe à Z-Image Turbo.
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: 'Z-Image Turbo LoRA · photo' }).click()

    const words = page.getByLabel('Ajouter un mot déclencheur')
    await words.fill('ohwx alice')
    await words.press('Enter')
    // Plusieurs mots d'un coup, séparés par des virgules.
    await words.fill('sourire, motcache')
    await words.press('Enter')
    await expect(page.getByRole('button', { name: 'Ne plus proposer ohwx alice' })).toBeVisible()
    await page.getByRole('button', { name: 'Ne plus proposer motcache' }).click()
    await expect(page.getByRole('button', { name: 'Proposer motcache' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    await expect
      .poll(async () => (await getPersona(page, p.id)).loras)
      .toEqual([
        expect.objectContaining({
          label: 'Visage Alice',
          path: loraUrl('alice'),
          scale: 1.5,
          family: Z_IMAGE,
          triggerWords: ['ohwx alice', 'sourire', 'motcache'],
          hiddenWords: ['motcache'],
        }),
      ])
    await saved(page)

    await page.reload()
    await expect(page.getByPlaceholder('Nom', { exact: true })).toHaveValue('Visage Alice')
    await expect(page.getByRole('combobox')).toHaveText('Z-Image Turbo LoRA · photo')
    await expect(page.locator('input[type=range]')).toHaveValue('1.5')
    await expect(page.getByRole('button', { name: 'Proposer motcache' })).toBeVisible()
  })

  test('supprimer un mot puis retirer la LoRA', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice', loras: [LORAS[0]] })
    await gotoPersona(page, p.id, 'lora')
    await page.getByRole('button', { name: 'Supprimer sourire' }).click()
    await expect
      .poll(async () => (await getPersona(page, p.id)).loras[0].triggerWords)
      .toEqual(['ohwx alice', 'motcache'])

    await page.getByRole('button', { name: 'Retirer', exact: true }).click()
    await expect(page.getByText('Aucune LoRA pour ce persona.')).toBeVisible()
    await expect.poll(async () => (await getPersona(page, p.id)).loras).toEqual([])
  })

  test('un lien qui n’est pas en https est refusé', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id, 'lora')
    await page.getByRole('button', { name: 'Ajouter une LoRA par lien' }).click()
    await page.getByPlaceholder(/^https:\/\/huggingface\.co/).fill('http://exemple.test/lora.safetensors')
    await expect(page.getByText('Non sauvegardé')).toBeVisible()
    expect((await getPersona(page, p.id)).loras).toEqual([])
  })

  test('douze LoRA au maximum : le bouton d’ajout se désactive', async ({ app, page }) => {
    const loras = Array.from({ length: 12 }, (_, i) => ({ ...LORAS[1], id: `x${i}`, label: `L${i}` }))
    const p = await app.createPersona({ name: 'Alice', loras })
    await gotoPersona(page, p.id, 'lora')
    await expect(page.getByRole('button', { name: 'Ajouter une LoRA par lien' })).toBeDisabled()
  })
})

test.describe('Fiche persona : bibliothèque Civitai (simulée)', () => {
  test('import d’une LoRA disponible pour deux modèles, puis réglage des modèles @core', async ({
    app,
    page,
  }) => {
    const { searches, leaks } = await mockCivitai(page)
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id, 'lora')

    await page.getByRole('button', { name: 'Bibliothèque' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Bibliothèque communautaire')).toBeVisible()
    const card = dialog.getByRole('button', { name: 'Portrait Doux' })
    await expect(card).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Lumière Néon' })).toBeVisible()
    // Famille du premier modèle, et le nombre d'autres modèles.
    await expect(card).toContainText('Z-Image Turbo +1')
    await expect(card).toContainText('doux portrait')
    expect(searches[0].get('sort')).toBe('Most Downloaded')
    expect(searches[0].get('nsfw')).toBe('false')

    await card.click()
    await expect(card).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Portrait Doux ajoutée')).toBeVisible()
    await dialog.getByRole('button', { name: 'Fermer' }).click()
    await expect(dialog).toHaveCount(0)

    // Une seule ligne pour les deux modèles.
    await expect(page.getByPlaceholder('Nom', { exact: true })).toHaveValue('Portrait Doux')
    await expect(page.getByRole('button', { name: '2 modèles' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Voir sur Civitai' })).toHaveAttribute(
      'href',
      PORTRAIT.pageUrl,
    )
    await expect
      .poll(async () => (await getPersona(page, p.id)).loras.map((l) => [l.family, l.path, l.triggerWords]))
      .toEqual([
        [Z_IMAGE, loraUrl('portrait-z'), ['doux portrait']],
        [FLUX, loraUrl('portrait-flux'), ['soft flux']],
      ])
    const [row] = (await getPersona(page, p.id)).loras
    expect(row.group?.key).toBe('civitai:4242')
    expect(row.sourceUrl).toBe(PORTRAIT.pageUrl)
    expect(row.previewUrl).toBe(PORTRAIT.previews[0].url)

    // On décoche FLUX : seule la ligne Z-Image reste.
    await page.getByRole('button', { name: '2 modèles' }).click()
    await popover(page).getByRole('button', { name: 'FLUX.1 Dev LoRA · photo' }).click()
    await expect(
      page.locator('[data-slot=popover-trigger]', { hasText: 'Z-Image Turbo LoRA · photo' }),
    ).toBeVisible()
    await expect
      .poll(async () => (await getPersona(page, p.id)).loras.map((l) => l.family))
      .toEqual([Z_IMAGE])
    // Le dernier modèle ne se décoche pas.
    await expect(popover(page).getByRole('button', { name: 'Z-Image Turbo LoRA · photo' })).toBeDisabled()
    expect(leaks).toEqual([])
  })

  test('un second clic sur la carte retire la LoRA importée', async ({ app, page }) => {
    await mockCivitai(page)
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id, 'lora')
    await page.getByRole('button', { name: 'Bibliothèque' }).click()
    const card = page.getByRole('dialog').getByRole('button', { name: 'Lumière Néon' })
    await card.click()
    await expect.poll(async () => (await getPersona(page, p.id)).loras).toHaveLength(1)
    await card.click()
    await expect(card).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(async () => (await getPersona(page, p.id)).loras).toEqual([])
  })

  test('une LoRA déjà dans le persona apparaît cochée', async ({ app, page }) => {
    await mockCivitai(page)
    const p = await app.createPersona({
      name: 'Alice',
      loras: [{ ...LORAS[4], id: 'n1', label: 'Néon', path: loraUrl('neon') }],
    })
    await gotoPersona(page, p.id, 'lora')
    await page.getByRole('button', { name: 'Bibliothèque' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Lumière Néon' })).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByRole('button', { name: 'Portrait Doux' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('filtres : modèle, tri, contenu adulte et recherche partent dans la requête', async ({
    app,
    page,
  }) => {
    const { searches } = await mockCivitai(page)
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id, 'lora')
    await page.getByRole('button', { name: 'Bibliothèque' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Portrait Doux' })).toBeVisible()

    await dialog.getByRole('button', { name: /^FLUX\.1 Dev/ }).click()
    await expect.poll(() => searches.at(-1)?.get('family')).toBe(FLUX)
    // Une seule famille : l'étiquette du modèle disparaît des cartes.
    await expect(dialog.getByRole('button', { name: 'Portrait Doux' })).not.toContainText('+1')

    await dialog.getByRole('button', { name: 'Les plus récentes' }).click()
    await expect.poll(() => searches.at(-1)?.get('sort')).toBe('Newest')
    await dialog.getByRole('switch').click()
    await expect.poll(() => searches.at(-1)?.get('nsfw')).toBe('true')

    await dialog.getByPlaceholder('Rechercher…').fill('néon')
    await expect.poll(() => searches.at(-1)?.get('query')).toBe('néon')
    await expect(dialog.getByRole('button', { name: 'Portrait Doux' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Lumière Néon' })).toBeVisible()

    await dialog.getByPlaceholder('Rechercher…').fill('introuvable')
    await expect(dialog.getByText('Aucune LoRA ne correspond.')).toBeVisible()
  })

  test('erreur de la bibliothèque : le message s’affiche', async ({ app, page }) => {
    await page.route('**/api/civitai/search**', (route) =>
      route.fulfill({ status: 502, json: { error: 'Civitai est injoignable.' } }),
    )
    const p = await app.createPersona({ name: 'Alice' })
    await gotoPersona(page, p.id, 'lora')
    await page.getByRole('button', { name: 'Bibliothèque' }).click()
    await expect(page.getByRole('dialog').getByText('Civitai est injoignable.')).toBeVisible()
  })
})

test.describe('Composer : menu des LoRA et raccourcis', () => {
  test('seules les LoRA du modèle choisi sont proposées, sans les mots masqués', async ({
    app,
    page,
  }) => {
    await composerWithLoras(app)
    await openShortcuts(page)
    await expect(popover(page).getByPlaceholder('Rechercher une LoRA ou un raccourci')).toBeVisible()
    await expect(popover(page).getByText('LoRA · 0 / 3')).toBeVisible()
    for (const name of ['Visage Alice', 'Style Film', 'Sans mot', 'Quatrième', 'ohwx alice', 'sourire'])
      await expect(option(page, name)).toBeVisible()
    await expect(option(page, 'motcache')).toHaveCount(0)
    await expect(option(page, 'Flux seulement')).toHaveCount(0)
    await expect(option(page, 'Sans mot')).toContainText('Sans mot déclencheur')
    await expect(popover(page).getByRole('link', { name: 'Gérer les LoRA' })).toBeVisible()

    // Autre modèle LoRA : ses propres LoRA.
    await page.keyboard.press('Escape')
    await app.chooseModel('FLUX.1 Dev LoRA')
    await expect(popover(page)).toHaveCount(0)
    await openShortcuts(page)
    await expect(option(page, 'Flux seulement')).toBeVisible()
    await expect(option(page, 'Visage Alice')).toHaveCount(0)

    // Modèle sans LoRA : plus de section LoRA.
    await page.keyboard.press('Escape')
    await app.chooseModel('Seedream 5.0 Flash')
    await expect(popover(page)).toHaveCount(0)
    await openShortcuts(page)
    await expect(popover(page).getByPlaceholder('Rechercher un raccourci')).toBeVisible()
    await expect(popover(page).getByText(/^LoRA ·/)).toHaveCount(0)
  })

  test('cocher une LoRA prend son premier mot, chaque mot se choisit ensuite', async ({
    app,
    page,
  }) => {
    await composerWithLoras(app)
    await openShortcuts(page)
    await option(page, 'Visage Alice').click()
    await expect(popover(page).getByText('LoRA · 1 / 3')).toBeVisible()
    await expect(loraTags(page)).toHaveText(['ohwx alice'])
    await expect(loraTags(page).first()).toHaveClass(/violet/)
    await expect(loraTags(page).first()).toHaveAttribute('title', 'Visage Alice')

    await option(page, 'sourire').click()
    await expect(loraTags(page)).toHaveText(['ohwx alice', 'sourire'])
    // Décocher un mot le retire, la LoRA reste chargée.
    await option(page, 'ohwx alice').click()
    await expect(loraTags(page)).toHaveText(['sourire'])
    await expect(popover(page).getByText('LoRA · 1 / 3')).toBeVisible()

    // Décocher la LoRA retire tous ses tags.
    await option(page, 'Visage Alice').click()
    await expect(loraTags(page)).toHaveCount(0)
    await expect(popover(page).getByText('LoRA · 0 / 3')).toBeVisible()
  })

  test('une LoRA sans mot garde un tag à son nom', async ({ app, page }) => {
    await composerWithLoras(app)
    await openShortcuts(page)
    await option(page, 'Sans mot').click()
    await expect(loraTags(page)).toHaveText(['Sans mot'])
    await expect(loraTags(page).first()).toHaveAttribute('title', 'LoRA chargée sans mot déclencheur')
  })

  test('trois LoRA au maximum : les autres lignes sont désactivées', async ({ app, page }) => {
    await composerWithLoras(app)
    await openShortcuts(page)
    await option(page, 'Visage Alice').click()
    await option(page, 'Style Film').click()
    await option(page, 'Sans mot').click()
    await expect(popover(page).getByText('LoRA · 3 / 3')).toBeVisible()
    await expect(option(page, 'Quatrième')).toHaveAttribute('aria-disabled', 'true')
    await expect(option(page, 'quatre')).toHaveAttribute('aria-disabled', 'true')
    await expect(option(page, 'Quatrième')).toHaveAttribute('title', '3 LoRA maximum par génération')
    await option(page, 'Quatrième').click({ force: true })
    await expect(popover(page).getByText('LoRA · 3 / 3')).toBeVisible()
    await expect(loraTags(page)).toHaveText(['ohwx alice', 'filmgrain', 'Sans mot'])

    // Une place libérée : la quatrième redevient disponible.
    await option(page, 'Style Film').click()
    await expect(option(page, 'Quatrième')).toHaveAttribute('aria-disabled', 'false')
  })

  test('la croix d’un tag retire le mot, et la LoRA avec son dernier mot', async ({ app, page }) => {
    await composerWithLoras(app)
    await openShortcuts(page)
    await option(page, 'Visage Alice').click()
    await page.keyboard.press('Escape')
    const tag = loraTags(page).first()
    await tag.hover()
    await tag.getByRole('button', { name: 'Retirer ohwx alice' }).click()
    await expect(loraTags(page)).toHaveCount(0)
    await openShortcuts(page)
    await expect(popover(page).getByText('LoRA · 0 / 3')).toBeVisible()
  })

  test('la recherche filtre les LoRA et leurs mots', async ({ app, page }) => {
    await composerWithLoras(app)
    await openShortcuts(page)
    await popover(page).getByPlaceholder('Rechercher une LoRA ou un raccourci').fill('film')
    await expect(option(page, 'Style Film')).toBeVisible()
    await expect(option(page, 'Visage Alice')).toHaveCount(0)
  })
})

test.describe('Envoi avec LoRA', () => {
  test('loraIds, loraWords et prompt final « # Lora » avec les seuls mots choisis @core', async ({
    app,
    page,
  }) => {
    await composerWithLoras(app)
    await openShortcuts(page)
    await option(page, 'Visage Alice').click()
    await option(page, 'sourire').click()
    await option(page, 'sourire').click() // décoché : ne part pas
    await option(page, 'Style Film').click()
    await option(page, 'Sans mot').click()
    await page.keyboard.press('Escape')

    await app.prompt.fill('au café')
    const { body, generation } = await sendAndCapture(page, () => app.send())
    expect(body.loraIds).toEqual(['l1', 'l2', 'l3'])
    expect(body.loraWords).toEqual({ l1: ['ohwx alice'], l2: ['filmgrain'], l3: [] })
    expect(generation.finalPrompt).toBe('# Lora\nohwx alice, filmgrain\n\n# Prompt (important)\nau café')
    for (const w of ['sourire', 'motcache', 'quatre', 'fluxword'])
      expect(generation.finalPrompt).not.toContain(w)
    expect(generation.loras).toEqual([
      { id: 'l1', label: 'Visage Alice', triggerWords: ['ohwx alice'] },
      { id: 'l2', label: 'Style Film', triggerWords: ['filmgrain'] },
      { id: 'l3', label: 'Sans mot', triggerWords: [] },
    ])
    expect(generation.lorasApplied).toBe(3)
    // La bulle du fil garde la demande seule.
    await expect(page.getByTestId('request-bubble')).toHaveText('au café')
  })

  test('sans LoRA cochée, rien ne part : ni loraIds ni section « # Lora »', async ({ app, page }) => {
    await composerWithLoras(app)
    await app.prompt.fill('au parc')
    const { body, generation } = await sendAndCapture(page, () => app.send())
    expect(body.loraIds).toEqual([])
    expect(generation.finalPrompt).toBe('au parc')
    expect(generation.loras).toEqual([])
  })

  test('un mot déjà écrit dans la demande n’est pas répété', async ({ app, page }) => {
    await composerWithLoras(app)
    await openShortcuts(page)
    await option(page, 'Visage Alice').click()
    await page.keyboard.press('Escape')
    await app.prompt.fill('OHWX ALICE en forêt')
    const { generation } = await sendAndCapture(page, () => app.send())
    expect(generation.finalPrompt).toBe('OHWX ALICE en forêt')
  })

  test('un mot masqué envoyé quand même par l’API est ignoré', async ({ app, page }) => {
    const p = await app.createPersona({ name: 'Alice', loras: LORAS })
    const res = await page.request.post('/api/generations', {
      data: {
        family: Z_IMAGE,
        personaId: p.id,
        prompt: 'test',
        params: {},
        referenceAssetIds: [],
        loraIds: ['l1', 'l5'],
        loraWords: { l1: ['motcache', 'sourire', 'inconnu'], l5: ['fluxword'] },
      },
    })
    expect(res.status(), await res.text()).toBe(201)
    const { generation } = (await res.json()) as { generation: Generation }
    expect(generation.finalPrompt).toBe('# Lora\nsourire\n\n# Prompt (important)\ntest')
    // La LoRA d'un autre modèle n'est pas appliquée.
    expect(generation.loras.map((l) => l.id)).toEqual(['l1'])
  })

  test('« Tags · N » sur la demande du fil : LoRA puis raccourcis', async ({ app, page }) => {
    const preset = await page.request.post('/api/presets', {
      data: { label: 'Lumière douce', text: 'golden hour, peau lumineuse' },
    })
    expect(preset.ok(), await preset.text()).toBeTruthy()
    await composerWithLoras(app, [...LORAS.slice(0, 3), { ...LORAS[0], id: 'q1', family: QWEN_LORA }])
    await openShortcuts(page)
    await option(page, 'Visage Alice').click()
    await option(page, 'sourire').click()
    await option(page, 'Sans mot').click()
    await popover(page).getByRole('option', { name: /Lumière douce/ }).click()
    await page.keyboard.press('Escape')
    // Le raccourci a son tag neutre à côté des tags violets.
    await expect(page.getByRole('button', { name: 'Lumière douce' })).toBeVisible()

    await app.prompt.fill('en terrasse')
    const { body, generation } = await sendAndCapture(page, () => app.send())
    expect(body.contextIds).toHaveLength(1)
    expect(generation.finalPrompt).toContain('# Détails\nLumière douce : golden hour, peau lumineuse')

    const chip = page.getByText('Tags · 4')
    await expect(chip).toBeVisible()
    await chip.hover()
    const list = popover(page)
    await expect(list.locator('span')).toHaveText(['ohwx alice', 'sourire', 'Sans mot', 'Lumière douce'])
    await expect(list.getByText('ohwx alice')).toHaveAttribute('title', 'Visage Alice')
    await expect(list.getByText('Lumière douce')).toHaveAttribute('title', 'golden hour, peau lumineuse')

    // Toujours là après rechargement.
    await page.reload()
    await expect(page.getByText('Tags · 4')).toBeVisible()
  })

  test('sans LoRA ni raccourci, pas de pastille « Tags »', async ({ app, page }) => {
    const { thread } = await app.generate({ prompt: 'simple' })
    await app.gotoThread(thread.id)
    await expect(page.getByTestId('request-bubble')).toBeVisible()
    await expect(page.getByText(/^Tags ·/)).toHaveCount(0)
  })
})
