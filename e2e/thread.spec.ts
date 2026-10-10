/**
 * Vue d'un fil : bulle de la demande, ligne d'historique sous la bulle (modèle,
 * réglages, série, tags), coût au-dessus du résultat, grille d'une série,
 * visionneuse, échec et attente d'une génération.
 */
import { expect, test } from './helpers'
import {
  QWEN,
  ZIMAGE_LORA,
  createGeneration,
  createPreset,
  generateDone,
  getThread,
  nextCreated,
  uploadImage,
  waitThreadDone,
} from './support-thread'

/** Visionneuse plein écran (dialogue « Aperçu »). */
const viewer = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: 'Aperçu' })

test.describe('Demande dans le fil', () => {
  test('la bulle ne contient que le texte, les références sont au-dessus @core', async ({ app, page }) => {
    const ref = await uploadImage(page)
    const { thread } = await generateDone(page, { prompt: 'bulle avec source', referenceAssetIds: [ref.id] })
    await app.gotoThread(thread.id)

    const bubble = page.getByTestId('request-bubble')
    await expect(bubble).toHaveCount(1)
    await expect(bubble).toHaveText('bulle avec source')
    await expect(bubble.locator('img')).toHaveCount(0)
    const refs = page.getByTestId('request-references')
    await expect(refs.locator('img')).toHaveCount(1)
    const [r, b] = [await refs.boundingBox(), await bubble.boundingBox()]
    expect(r!.y + r!.height).toBeLessThanOrEqual(b!.y)
  })

  test('sans référence, aucun bloc de références n’est affiché', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'sans source' })
    await app.gotoThread(thread.id)
    await expect(page.getByTestId('request-bubble')).toHaveText('sans source')
    await expect(page.getByTestId('request-references')).toHaveCount(0)
  })

  test('ligne d’historique : logo du fournisseur, nom du modèle et réglages, sans le seed', async ({
    app,
    page,
  }) => {
    const { thread } = await generateDone(page, {
      prompt: 'ligne historique',
      params: { aspect_ratio: '3:4', output_format: 'png', seed: 4242 },
    })
    await app.gotoThread(thread.id)
    const row = page.getByTestId('request-history')
    await expect(row).toBeVisible()
    await expect(row.locator('img[src="/providers/bytedance.svg"]')).toHaveCount(1)
    await expect(row).toContainText('Seedream 5.0 Flash')
    await expect(row.getByText('3:4', { exact: true })).toBeVisible()
    await expect(row.getByText('png', { exact: true })).toBeVisible()
    await expect(row).not.toContainText('4242')
    // Une seule image : pas de pastille de série.
    await expect(row.getByText(/^x\d+$/)).toHaveCount(0)
    await expect(row.getByRole('button', { name: 'Modifier la demande' })).toBeVisible()
  })

  test('durée d’une vidéo affichée en secondes dans les réglages', async ({ app, page }) => {
    const { thread } = await generateDone(page, {
      family: 'bytedance/seedance-2.5',
      prompt: 'video duree',
      params: { duration_seconds: 6 },
    })
    await app.gotoThread(thread.id)
    const row = page.getByTestId('request-history')
    await expect(row).toContainText('Seedance 2.5')
    await expect(row.getByText('6 s', { exact: true })).toBeVisible()
  })

  test('une série de 4 affiche la pastille x4 dans la ligne d’historique', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'serie pastille', count: 4 })
    await app.gotoThread(thread.id)
    // Les 4 générations forment un seul bloc.
    await expect(page.getByTestId('request-bubble')).toHaveCount(1)
    await expect(page.getByTestId('request-history').getByText('x4', { exact: true })).toBeVisible()
  })

  test('« Tags · N » liste au survol les raccourcis et les mots des LoRA utilisés', async ({
    app,
    page,
  }) => {
    const golden = await createPreset(page, 'Lumière dorée', 'golden hour lighting')
    const studio = await createPreset(page, 'Studio', 'studio portrait')
    const persona = await app.createPersona({
      name: 'Lina',
      loras: [
        {
          id: 'lora-lina',
          label: 'LoRA Lina',
          path: 'https://example.com/lina.safetensors',
          scale: 1,
          family: ZIMAGE_LORA,
          triggerWords: ['lina_woman', 'autre_mot'],
        },
      ],
    })
    const { thread } = await generateDone(page, {
      family: ZIMAGE_LORA,
      personaId: persona.id,
      prompt: 'avec des tags',
      contextIds: [golden.id, studio.id],
      loraIds: ['lora-lina'],
      loraWords: { 'lora-lina': ['lina_woman'] },
    })
    await app.gotoThread(thread.id)

    const chip = page.getByTestId('request-history').getByText('Tags · 3', { exact: true })
    await expect(chip).toBeVisible()
    await chip.hover()
    const popover = page.locator('[data-slot=popover-content]')
    await expect(popover).toBeVisible()
    await expect(popover.getByText('lina_woman', { exact: true })).toBeVisible()
    await expect(popover.getByText('Lumière dorée', { exact: true })).toBeVisible()
    await expect(popover.getByText('Studio', { exact: true })).toBeVisible()
    // Le mot non choisi n'est pas listé.
    await expect(popover.getByText('autre_mot')).toHaveCount(0)
  })

  test('sans raccourci ni LoRA, pas de pastille de tags', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'sans tags' })
    await app.gotoThread(thread.id)
    await expect(page.getByTestId('request-history')).toBeVisible()
    await expect(page.getByText(/^Tags · \d+$/)).toHaveCount(0)
  })
})

test.describe('Modifier la demande (↺)', () => {
  test('remet prompt, références, réglages, modèle, raccourci et nombre d’images dans le composer @core', async ({
    app,
    page,
  }) => {
    const ctx = await createPreset(page, 'Ciné 35mm', 'cinematic shot, 35mm film')
    const ref = await uploadImage(page)
    const { thread } = await generateDone(page, {
      family: QWEN,
      prompt: 'la demande a reprendre',
      referenceAssetIds: [ref.id],
      params: { aspect_ratio: '3:4' },
      contextIds: [ctx.id],
      count: 4,
    })
    // Une autre demande ensuite, sur un autre modèle : le composer part de celle-ci.
    await generateDone(page, { threadId: thread.id, prompt: 'demande suivante' })
    await app.gotoThread(thread.id)
    await expect(app.modelPicker).toContainText('Seedream 5.0 Flash')
    await expect(app.attachments).toHaveCount(0)
    await expect(page.getByTestId('context-tag')).toHaveCount(0)

    const first = page.getByTestId('request-history').first()
    await first.getByRole('button', { name: 'Modifier la demande' }).click()

    await expect(app.prompt).toHaveValue('la demande a reprendre')
    await expect(app.modelPicker).toContainText('Qwen Image 3.0 Pro')
    await expect(app.attachments).toHaveCount(1)
    await expect(app.ratio).toContainText('3:4')
    await expect(app.count).toHaveAccessibleName("Nombre d'images x4")
    await expect(page.getByTestId('context-tag')).toHaveText(['Ciné 35mm'])
  })

  test('remet la LoRA et son mot déclencheur choisi', async ({ app, page }) => {
    const persona = await app.createPersona({
      name: 'Nora',
      loras: [
        {
          id: 'lora-nora',
          label: 'LoRA Nora',
          path: 'https://example.com/nora.safetensors',
          scale: 1,
          family: ZIMAGE_LORA,
          triggerWords: ['nora_face'],
        },
      ],
    })
    const { thread } = await generateDone(page, {
      family: ZIMAGE_LORA,
      personaId: persona.id,
      prompt: 'portrait de nora',
      loraIds: ['lora-nora'],
      loraWords: { 'lora-nora': ['nora_face'] },
    })
    await app.gotoThread(thread.id)
    // Composer vidé avant de reprendre la demande.
    await expect(page.getByTitle('LoRA active : nora_face')).toHaveCount(0)
    await page.getByRole('button', { name: 'Modifier la demande' }).click()
    await expect(app.prompt).toHaveValue('portrait de nora')
    await expect(app.modelPicker).toContainText('Z-Image Turbo LoRA')
    // Tag violet du mot choisi, et pastille « LoRA active » sur le modèle.
    await expect(page.getByTitle('LoRA Nora', { exact: true })).toContainText('nora_face')
    await expect(page.getByTitle('LoRA active : nora_face')).toBeAttached()
  })

  test('envoyer la demande reprise crée la même génération dans le fil', async ({ app, page }) => {
    const { thread } = await generateDone(page, {
      prompt: 'a renvoyer',
      params: { aspect_ratio: '16:9' },
    })
    await app.gotoThread(thread.id)
    await page.getByRole('button', { name: 'Modifier la demande' }).click()
    await expect(app.prompt).toHaveValue('a renvoyer')
    const created = nextCreated(page)
    await app.send()
    const { generation } = await (await created).json()
    expect(generation.threadId).toBe(thread.id)
    expect(generation.prompt).toBe('a renvoyer')
    expect(generation.params.aspect_ratio).toBe('16:9')
    await expect(page.getByTestId('request-bubble')).toHaveCount(2)
  })
})

test.describe('Résultat', () => {
  test('coût réel au-dessus d’une image seule', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'cout simple' })
    await app.gotoThread(thread.id)
    const cost = page.getByTestId('result-cost')
    await expect(cost).toHaveText('0,010 $')
    await expect(cost).not.toContainText('Série')
    await expect(page.locator(`img[alt="cout simple"]`)).toHaveCount(1)
  })

  test('série de 4 : coût total, « Série · 4 images » et une grille de 4 résultats @core', async ({
    app,
    page,
  }) => {
    const { thread } = await generateDone(page, { prompt: 'serie grille', count: 4 })
    await app.gotoThread(thread.id)
    const cost = page.getByTestId('result-cost')
    await expect(cost).toContainText('0,040 $')
    await expect(cost).toContainText('Série · 4 images')
    await expect(page.locator('img[alt="serie grille"]')).toHaveCount(4)
    for (const n of [1, 2, 3, 4]) await expect(page.getByText(`#${n}`, { exact: true })).toBeVisible()
    // Pas d'upscale sur une série.
    await expect(page.getByRole('button', { name: 'Upscale', exact: true })).toHaveCount(0)
  })

  test('total du fil dans l’en-tête', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'total un' })
    await generateDone(page, { threadId: thread.id, prompt: 'total deux' })
    await app.gotoThread(thread.id)
    await expect(page.getByText(/Total du fil :/)).toContainText('0,020 $')
  })

  test('clic sur un résultat : la visionneuse s’ouvre, Échap la ferme @core', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'a regarder' })
    await app.gotoThread(thread.id)
    // Petite image (64 px) : clic en bas à gauche, loin des actions du survol et des coins arrondis.
    const img = page.locator('img[alt="a regarder"]')
    const box = (await img.boundingBox())!
    await img.click({ position: { x: 20, y: box.height - 8 } })
    await expect(viewer(page)).toBeVisible()
    await expect(viewer(page).locator('img')).toHaveCount(1)
    await expect(viewer(page).getByRole('link', { name: 'Télécharger' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
  })

  test('clic sur une image d’une série : la visionneuse s’ouvre', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'serie a voir', count: 4 })
    await app.gotoThread(thread.id)
    await page.locator('img[alt="serie a voir"]').nth(2).click()
    await expect(viewer(page)).toBeVisible()
    await viewer(page).getByRole('button', { name: 'Fermer' }).click()
    await expect(viewer(page)).toHaveCount(0)
  })

  test('clic sur une référence : la visionneuse s’ouvre, Échap la ferme', async ({ app, page }) => {
    const ref = await uploadImage(page)
    const { thread } = await generateDone(page, { prompt: 'ref a voir', referenceAssetIds: [ref.id] })
    await app.gotoThread(thread.id)
    await page.getByTestId('request-references').getByRole('button').first().click()
    await expect(viewer(page)).toBeVisible()
    await expect(viewer(page).locator('img')).toHaveAttribute('src', new RegExp(ref.id))
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
  })

  test('génération en échec : le message d’erreur, aucun résultat ni upscale', async ({ app, page }) => {
    const { thread } = await createGeneration(page, { prompt: 'echec FAIL_TEST' })
    const { generations } = await waitThreadDone(page, thread.id)
    expect(generations[0].status).toBe('failed')
    await app.gotoThread(thread.id)
    await expect(page.getByText('Échec simulé.')).toBeVisible()
    await expect(page.locator('img[alt="echec FAIL_TEST"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Upscale', exact: true })).toHaveCount(0)
    // On peut toujours relancer ou reprendre la demande.
    await expect(page.getByRole('button', { name: 'Relancer', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Modifier la demande' }).last().click()
    await expect(app.prompt).toHaveValue('echec FAIL_TEST')
  })

  test('en attente puis réussie : l’indicateur laisse place au résultat', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'en attente' })
    // Les deux premières lectures du fil montrent la génération en cours.
    let served = 0
    await page.route(`**/api/threads/${thread.id}`, async (route) => {
      if (route.request().method() !== 'GET' || served >= 2) return route.fallback()
      served++
      const res = await route.fetch()
      const body = await res.json()
      body.generations = body.generations.map((g: Record<string, unknown>) => ({
        ...g,
        status: 'running',
        outputs: [],
        cost: null,
      }))
      await route.fulfill({ response: res, json: body })
    })
    await app.gotoThread(thread.id)
    await expect(page.getByText('Génération en cours…')).toBeVisible()
    await expect(page.getByText(/≈ 0,010 \$/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Relancer', exact: true })).toHaveCount(0)
    // Rafraîchissement automatique : le résultat apparaît.
    await expect(page.locator('img[alt="en attente"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Génération en cours…')).toHaveCount(0)
    await expect(page.getByTestId('result-cost')).toHaveText('0,010 $')
  })

  test('envoyée depuis le composer, la génération apparaît dans le fil', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'premiere' })
    await app.gotoThread(thread.id)
    await app.prompt.fill('depuis le composer')
    await app.send()
    await expect(page.getByTestId('request-bubble').filter({ hasText: 'depuis le composer' })).toBeVisible()
    await expect(page.locator('img[alt="depuis le composer"]')).toBeVisible({ timeout: 15_000 })
    const { generations } = await getThread(page, thread.id)
    expect(generations).toHaveLength(2)
  })
})
