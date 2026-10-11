/**
 * Voix de référence (maquette) : section de la fiche persona, catalogue
 * ElevenLabs (simulé en test), icône de voix dans le menu des modèles et bouton
 * « Voix » du composer pour les modèles vidéo qui en acceptent.
 */
import type { Page } from '@playwright/test'
import { expect, test } from './helpers'

const WAN = 'alibaba/wan-3.0'

async function setElevenLabsKey(page: Page) {
  expect((await page.request.put('/api/settings/elevenlabs-key', { data: { apiKey: 'sk_test_0000000000abcd' } })).ok()).toBeTruthy()
}

async function waitHydrated(page: Page) {
  await page.waitForFunction(() =>
    [document, document.documentElement, document.body].some((n) => Object.keys(n).some((k) => k.startsWith('__reactContainer'))),
  )
}

test.afterEach(async ({ page }) => {
  await page.request.delete('/api/settings/elevenlabs-key')
})

test('fiche persona : contexte, photos, voix puis modèles par défaut @core', async ({ app, page }) => {
  const p = await app.createPersona({ name: 'Alice' })
  await page.goto(`/personas/${p.id}`)
  await waitHydrated(page)
  const wanted = ['Contexte du persona', 'Photos de références', 'Voix de référence', 'Modèles par défaut']
  await expect
    .poll(async () => {
      const titles = await page.locator('section h2').allTextContents()
      return titles.filter((t) => wanted.includes(t))
    })
    .toEqual(wanted)
})

test('sans clé ElevenLabs, la fenêtre des voix invite à l’ajouter', async ({ app, page }) => {
  const p = await app.createPersona({ name: 'Alice' })
  await page.goto(`/personas/${p.id}`)
  await waitHydrated(page)
  await page.getByRole('button', { name: 'Ajouter une voix' }).click()
  await expect(page.getByText('Ajoute ta clé ElevenLabs pour parcourir leurs voix.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ajouter la clé' })).toHaveAttribute('href', /tab=api-key/)
})

test('ajouter une voix du catalogue : elle apparaît sur la fiche et reste après rechargement @core', async ({ app, page }) => {
  await setElevenLabsKey(page)
  const p = await app.createPersona({ name: 'Alice' })
  await page.goto(`/personas/${p.id}`)
  await waitHydrated(page)
  await page.getByRole('button', { name: 'Ajouter une voix' }).click()
  await expect(page.getByTestId('library-voice')).toHaveCount(3)
  await page.getByRole('button', { name: 'Ajouter Sarah' }).click()
  await expect(page.getByRole('button', { name: 'Retirer Sarah' })).toContainText('Ajoutée')
  await page.getByRole('button', { name: 'Fermer' }).click()
  await expect(page.getByTestId('persona-voice')).toHaveText(/Sarah/)
  await expect
    .poll(async () => (await (await page.request.get('/api/personas')).json()).personas[0].voices.length)
    .toBe(1)
  await page.reload()
  await waitHydrated(page)
  await expect(page.getByTestId('persona-voice')).toHaveText(/Sarah/)
  await page.getByRole('button', { name: 'Retirer la voix Sarah' }).click()
  await expect(page.getByTestId('persona-voice')).toHaveCount(0)
})

test('menu des modèles : icône de voix sur les modèles vidéo qui acceptent une voix', async ({ app, page }) => {
  await app.gotoNew()
  await app.chooseMedia('Vidéo')
  await app.modelPicker.click()
  await page.getByPlaceholder('Rechercher un modèle').fill('Wan 3.0')
  const row = page.locator('[data-slot=popover-content]').getByText('Wan 3.0', { exact: true }).first()
  await expect(row.locator('xpath=ancestor::*[contains(@class,"group/row")][1]').locator('svg.lucide-audio-lines')).toHaveCount(1)
})

test('composer : bouton « Voix » pour un modèle vidéo à voix, absent en photo @core', async ({ app, page }) => {
  await app.createPersona({
    name: 'Alice',
    defaultVideoFamily: WAN,
    voices: [{ id: 'v1', voiceId: 'fake-sarah', name: 'Sarah', previewUrl: null, labels: {} }],
  })
  await app.gotoNew()
  await app.selectPersona('Alice')
  await expect(page.getByTestId('voice-picker')).toHaveCount(0)
  await app.chooseMedia('Vidéo')
  await expect(app.modelPicker).toContainText('Wan 3.0')
  const picker = page.getByTestId('voice-picker')
  await expect(picker).toHaveText(/Voix/)
  // Juste à droite du modèle.
  const [model, voice] = [await app.modelPicker.boundingBox(), await picker.boundingBox()]
  expect(voice!.x).toBeGreaterThan(model!.x + model!.width - 1)
  await picker.click()
  await page.locator('[data-slot=popover-content]').getByText('Sarah', { exact: true }).click()
  await expect(picker).toHaveText(/Sarah/)
  await expect(page.getByText(/Voix « Sarah » choisie/)).toBeVisible()
})

test('persona artistique : pas de section Voix sur la fiche ni de bouton « Voix » dans le composer @core', async ({ app, page }) => {
  const p = await app.createPersona({
    name: 'Royaume',
    defaultVideoFamily: WAN,
    voices: [{ id: 'v1', voiceId: 'fake-sarah', name: 'Sarah', previewUrl: null, labels: {} }],
  })
  await page.goto(`/personas/${p.id}`)
  await waitHydrated(page)
  const kinds = page.getByRole('radiogroup', { name: 'Type de persona' })
  await expect(kinds.getByRole('radio', { name: 'Influenceur' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('heading', { name: 'Voix de référence' })).toBeVisible()
  await kinds.getByRole('radio', { name: 'Artistique' }).click()
  await expect(page.getByRole('heading', { name: 'Voix de référence' })).toHaveCount(0)
  await expect
    .poll(async () => (await (await page.request.get('/api/personas')).json()).personas[0].kind)
    .toBe('artistic')
  // Gardé après rechargement.
  await page.reload()
  await waitHydrated(page)
  await expect(page.getByRole('radiogroup', { name: 'Type de persona' }).getByRole('radio', { name: 'Artistique' })).toHaveAttribute('aria-checked', 'true')
  // Composer : modèle vidéo à voix, mais pas de bouton « Voix ».
  await app.gotoNew()
  await app.selectPersona('Royaume')
  await app.chooseMedia('Vidéo')
  await expect(app.modelPicker).toContainText('Wan 3.0')
  await expect(page.getByTestId('voice-picker')).toHaveCount(0)
})
