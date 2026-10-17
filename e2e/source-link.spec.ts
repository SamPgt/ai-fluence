/**
 * Lien « Voir la demande » de la visionneuse : on arrive sur la demande exacte
 * qui a produit le média, pas en bas du fil. Ouvrir un fil depuis la liste
 * arrive toujours en bas.
 */
import type { Page } from '@playwright/test'
import { expect, test, type App } from './helpers'

async function longThread(app: App) {
  const first = await app.generate({ prompt: 'demande 1' })
  for (let i = 2; i <= 10; i++) await app.generate({ prompt: `demande ${i}`, threadId: first.thread.id })
  return first.thread
}

const distanceToBottom = (page: Page) =>
  page.getByTestId('thread-scroll').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)

/** La bulle de la demande est visible dans la zone du fil. */
async function bubbleInView(page: Page, prompt: string) {
  const bubble = page.getByTestId('request-bubble').filter({ hasText: new RegExp(`^${prompt}$`) })
  const box = await bubble.boundingBox()
  const zone = await page.getByTestId('thread-scroll').boundingBox()
  return Boolean(box && zone && box.y >= zone.y && box.y + box.height <= zone.y + zone.height)
}

test('depuis la galerie, « Voir la demande » arrive sur la demande de l’image @core', async ({ app, page }) => {
  const thread = await longThread(app)
  await page.goto('/galerie')
  await expect(page.getByTestId('gallery-item')).toHaveCount(10)
  // La plus ancienne image (demande 1) est la dernière de la galerie.
  await page.getByTestId('gallery-item').last().locator('button').first().click()
  await page.getByRole('link', { name: 'Voir la demande' }).click()
  await expect(page).toHaveURL(new RegExp(`/t/${thread.id}\\?g=`))
  await expect.poll(() => bubbleInView(page, 'demande 1')).toBe(true)
  // Les images finissent de charger : on reste sur la demande.
  await page.waitForTimeout(800)
  expect(await bubbleInView(page, 'demande 1')).toBe(true)
  expect(await distanceToBottom(page)).toBeGreaterThan(100)
})

test('ouvrir le fil depuis la liste arrive toujours en bas', async ({ app, page }) => {
  const thread = await longThread(app)
  await app.gotoNew()
  await app.openThread('demande 1')
  await expect(page).toHaveURL(new RegExp(`/t/${thread.id}$`))
  await expect.poll(() => distanceToBottom(page)).toBeLessThan(2)
})

test('dans le fil, la visionneuse mène aussi à la demande de l’image', async ({ app, page }) => {
  const thread = await longThread(app)
  await app.gotoThread(thread.id)
  await page.locator('img[alt="demande 10"]').click({ position: { x: 5, y: 5 } })
  // Remonte jusqu'à l'image de la demande 2 avec la flèche gauche.
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft')
  await page.getByRole('link', { name: 'Voir la demande' }).click()
  await expect(page).toHaveURL(/\?g=/)
  await expect.poll(() => bubbleInView(page, 'demande 2')).toBe(true)
})

test('recherche (⌘K) : un prompt trouvé ouvre le fil sur cette demande, pas en bas @core', async ({ app, page }) => {
  const thread = await longThread(app)
  await app.gotoNew()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await page.getByPlaceholder(/Rechercher/).last().fill('demande 2')
  // « demande 2 » est le prompt d'une demande ancienne du fil.
  await page.getByRole('button', { name: /demande 2/ }).first().click()
  await expect(page).toHaveURL(new RegExp(`/t/${thread.id}\\?g=`))
  await expect.poll(() => bubbleInView(page, 'demande 2')).toBe(true)
  expect(await distanceToBottom(page)).toBeGreaterThan(100)
  // La demande commence en haut de la zone : ses images de référence seraient visibles.
  const id = new URL(page.url()).searchParams.get('g')!
  const top = await page.evaluate((g) => {
    const zone = document.querySelector('[data-testid="thread-scroll"]')!.getBoundingClientRect().top
    const node = document.querySelector(`[data-generation-ids~="${g}"]`)!.getBoundingClientRect().top
    return node - zone
  }, id)
  expect(top).toBeGreaterThanOrEqual(0)
  expect(top).toBeLessThan(40)
})
