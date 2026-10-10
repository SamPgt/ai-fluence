/**
 * Relancer (même modèle ou un autre) et Upscale depuis le pied d'un résultat du fil.
 * Les boutons de confirmation restent sombres (variante outline), jamais colorés.
 */
import type { Page } from '@playwright/test'
import { expect, test } from './helpers'
import {
  QWEN,
  SEEDANCE_25,
  SEEDREAM,
  generateDone,
  getThread,
  nextCreated,
  uploadImage,
  waitThreadDone,
} from './support-thread'

/** Bouton neutre : fond sombre de l'app, ni couleur de marque ni fond clair. */
async function expectNeutral(button: ReturnType<Page['getByRole']>) {
  await expect(button).toHaveClass(/\bbg-background\b/)
  await expect(button).not.toHaveClass(/\bbg-brand\b|\bbg-primary\b/)
}

const relaunchButton = (page: Page) => page.getByRole('button', { name: 'Relancer', exact: true })
const relaunchWith = (page: Page) => page.getByRole('button', { name: /^Relancer avec/ })
const menu = (page: Page) => page.locator('[data-slot=popover-content]')

test.describe('Relancer', () => {
  test('ouvre la confirmation avec le prix, le bouton est sombre', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'a relancer' })
    await app.gotoThread(thread.id)
    await relaunchButton(page).click()
    const dialog = page.getByRole('dialog', { name: 'Relancer avec Seedream 5.0 Flash ?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Même prompt, mêmes références, nouveau seed.')
    await expect(dialog).toContainText('≈ 0,010 $ · 1 image')
    const confirm = dialog.getByRole('button', { name: 'Relancer', exact: true })
    await expect(confirm).toBeEnabled()
    await expectNeutral(confirm)
  })

  test('confirmer crée une génération identique dans le même fil @core', async ({ app, page }) => {
    const ref = await uploadImage(page)
    const { thread, generation } = await generateDone(page, {
      prompt: 'meme demande',
      params: { aspect_ratio: '3:4', seed: 12 },
      referenceAssetIds: [ref.id],
    })
    await app.gotoThread(thread.id)
    await relaunchButton(page).click()
    const dialog = page.getByRole('dialog', { name: /^Relancer avec/ })
    const created = nextCreated(page)
    await dialog.getByRole('button', { name: 'Relancer', exact: true }).click()
    const body = await (await created).json()
    expect(body.thread.id).toBe(thread.id)
    await expect(dialog).toHaveCount(0)

    const { generations } = await waitThreadDone(page, thread.id, 2)
    const again = generations[1]
    expect(again.id).not.toBe(generation.id)
    expect(again.family).toBe(SEEDREAM)
    expect(again.prompt).toBe('meme demande')
    expect(again.params.aspect_ratio).toBe('3:4')
    // Nouveau seed : celui de la première demande n'est pas repris.
    expect(again.params.seed).toBeUndefined()
    expect(again.references.map((r) => r.id)).toEqual([ref.id])
    await expect(page.getByTestId('request-bubble')).toHaveText(['meme demande', 'meme demande'])
  })

  test('Annuler ferme la confirmation sans rien créer', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'sans relance' })
    await app.gotoThread(thread.id)
    await relaunchButton(page).click()
    const dialog = page.getByRole('dialog', { name: /^Relancer avec/ })
    await dialog.getByRole('button', { name: 'Annuler' }).click()
    await expect(dialog).toHaveCount(0)
    expect((await getThread(page, thread.id)).generations).toHaveLength(1)
  })

  test('une série se relance en série, au prix total', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'serie relancee', count: 4 })
    await app.gotoThread(thread.id)
    await relaunchButton(page).click()
    const dialog = page.getByRole('dialog', { name: /^Relancer avec/ })
    await expect(dialog).toContainText('≈ 0,040 $')
    await dialog.getByRole('button', { name: 'Relancer', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const { generations } = await waitThreadDone(page, thread.id, 8)
    const batches = new Set(generations.map((g) => g.batchId))
    expect(batches.size).toBe(2)
    await expect(page.getByText('Série · 4 images')).toHaveCount(2)
  })

  test('une génération en échec peut être relancée', async ({ app, page }) => {
    const res = await page.request.post('/api/generations', {
      data: { family: SEEDREAM, prompt: 'raté FAIL_TEST', params: {}, referenceAssetIds: [] },
    })
    const { thread } = await res.json()
    await waitThreadDone(page, thread.id, 1)
    await app.gotoThread(thread.id)
    await relaunchButton(page).click()
    const dialog = page.getByRole('dialog', { name: /^Relancer avec/ })
    await dialog.getByRole('button', { name: 'Relancer', exact: true }).click()
    const { generations } = await waitThreadDone(page, thread.id, 2)
    expect(generations[1].prompt).toBe('raté FAIL_TEST')
  })
})

test.describe('Relancer avec…', () => {
  test('ouvre le même menu que le composer : sections et recherche', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'menu relance' })
    await app.gotoThread(thread.id)
    await relaunchWith(page).click()
    await expect(menu(page)).toBeVisible()
    const search = menu(page).getByPlaceholder('Rechercher un modèle')
    await expect(search).toBeFocused()
    await expect(menu(page).getByText('Modèles épinglés')).toBeVisible()
    await expect(menu(page).getByText('Fournisseurs')).toBeVisible()
    await expect(menu(page).getByText('Groupes')).toBeVisible()
    await search.fill('modele inexistant')
    await expect(menu(page).getByText('Aucun modèle trouvé.')).toBeVisible()
    await search.fill('Qwen Image 3.0')
    await expect(menu(page).getByText('Qwen Image 3.0 Pro', { exact: true })).toBeVisible()
  })

  test('choisir un autre modèle crée la génération avec ce modèle @core', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'autre modele', params: { aspect_ratio: '1:1' } })
    await app.gotoThread(thread.id)
    await relaunchWith(page).click()
    await app.pickInModelMenu('Qwen Image 3.0 Pro')
    const dialog = page.getByRole('dialog', { name: 'Relancer avec Qwen Image 3.0 Pro ?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('≈ 0,010 $')
    const confirm = dialog.getByRole('button', { name: 'Relancer', exact: true })
    await expectNeutral(confirm)
    await confirm.click()
    await expect(dialog).toHaveCount(0)

    const { generations } = await waitThreadDone(page, thread.id, 2)
    expect(generations[1].family).toBe(QWEN)
    expect(generations[1].prompt).toBe('autre modele')
    expect(generations[1].threadId).toBe(thread.id)
    await expect(page.getByTestId('request-history').nth(1)).toContainText('Qwen Image 3.0 Pro')
  })

  test('dans un fil vidéo, le menu ne propose que des modèles vidéo', async ({ app, page }) => {
    const { thread } = await generateDone(page, { family: SEEDANCE_25, prompt: 'fil video' })
    await app.gotoThread(thread.id)
    await relaunchWith(page).click()
    const search = menu(page).getByPlaceholder('Rechercher un modèle')
    await search.fill('Seedream')
    await expect(menu(page).getByText('Aucun modèle trouvé.')).toBeVisible()
    await search.fill('Wan 3.0 Prime')
    await expect(menu(page).getByText('Wan 3.0 Prime', { exact: true })).toBeVisible()
    await menu(page).getByText('Wan 3.0 Prime', { exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Relancer avec Wan 3.0 Prime ?' })
    await dialog.getByRole('button', { name: 'Relancer', exact: true }).click()
    const { generations } = await waitThreadDone(page, thread.id, 2)
    expect(generations[1].family).toBe('alibaba/wan-3.0-prime')
  })
})

test.describe('Upscale', () => {
  const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'Upscale de l’image' })

  test('liste les paliers avec leurs détails et le prix, 4k par défaut', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'a agrandir' })
    await app.gotoThread(thread.id)
    await page.getByRole('button', { name: 'Upscale', exact: true }).click()
    const dialog = dialogOf(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Résolution de sortie')).toBeVisible()
    for (const [tier, hint] of [
      ['2k', '≈ 4 Mpx'],
      ['4k', '≈ 17 Mpx'],
      ['8k', '≈ 67 Mpx'],
    ]) {
      await expect(dialog.getByRole('button', { name: `${tier} ${hint}` })).toBeVisible()
    }
    await expect(dialog.getByRole('button', { name: /^4k/ })).toHaveClass(/border-brand/)
    await expect(dialog).toContainText('≈ 0,010 $')
    const confirm = dialog.getByRole('button', { name: 'Upscaler' })
    await expect(confirm).toBeEnabled()
    await expectNeutral(confirm)
  })

  test('changer de palier redemande le prix pour ce palier', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'palier 8k' })
    await app.gotoThread(thread.id)
    await page.getByRole('button', { name: 'Upscale', exact: true }).click()
    const dialog = dialogOf(page)
    await expect(dialog).toContainText('≈ 0,010 $')
    const quote = page.waitForRequest(
      (r) => new URL(r.url()).pathname === '/api/generations/upscale/quote' && r.postDataJSON()?.resolution === '8k',
    )
    await dialog.getByRole('button', { name: /^8k/ }).click()
    await quote
    await expect(dialog.getByRole('button', { name: /^8k/ })).toHaveClass(/border-brand/)
    await expect(dialog.getByRole('button', { name: /^4k/ })).not.toHaveClass(/border-brand/)
  })

  test('confirmer crée un upscale sans prompt dans le même fil @core', async ({ app, page }) => {
    const { thread, generation } = await generateDone(page, { prompt: 'source upscale' })
    await app.gotoThread(thread.id)
    await page.getByRole('button', { name: 'Upscale', exact: true }).click()
    const dialog = dialogOf(page)
    await dialog.getByRole('button', { name: /^2k/ }).click()
    const created = nextCreated(page, '/api/generations/upscale')
    await dialog.getByRole('button', { name: 'Upscaler' }).click()
    const body = await (await created).json()
    expect(body.generation.threadId).toBe(thread.id)
    await expect(dialog).toHaveCount(0)

    const { generations } = await waitThreadDone(page, thread.id, 2)
    const up = generations[1]
    expect(up.task).toBe('upscale')
    expect(up.prompt).toBe('')
    expect(up.params.resolution).toBe('2k')
    expect(up.references.map((r) => r.id)).toEqual([generation.outputs[0].id])

    // Dans le fil : pas de seconde bulle, l'upscaler dans l'historique, sans reprise ni relance.
    await expect(page.getByTestId('request-bubble')).toHaveCount(1)
    const rows = page.getByTestId('request-history')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(1)).toContainText('Upscaler image')
    await expect(rows.nth(1).getByRole('button', { name: 'Modifier la demande' })).toHaveCount(0)
    await expect(relaunchButton(page)).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Upscale', exact: true })).toHaveCount(1)
  })

  test('Annuler ferme la fenêtre sans rien créer', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'upscale annule' })
    await app.gotoThread(thread.id)
    await page.getByRole('button', { name: 'Upscale', exact: true }).click()
    await dialogOf(page).getByRole('button', { name: 'Annuler' }).click()
    await expect(dialogOf(page)).toHaveCount(0)
    expect((await getThread(page, thread.id)).generations).toHaveLength(1)
  })

  test('pas d’upscale sur une série', async ({ app, page }) => {
    const { thread } = await generateDone(page, { prompt: 'serie sans upscale', count: 4 })
    await app.gotoThread(thread.id)
    await expect(relaunchButton(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upscale', exact: true })).toHaveCount(0)
  })
})
