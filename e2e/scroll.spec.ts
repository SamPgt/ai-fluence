/**
 * Ouverture d'un fil : tout en bas (dernière génération visible), y compris
 * une fois les images chargées ; une personne qui remonte n'est pas ramenée.
 */
import type { Page } from '@playwright/test'
import { expect, test, type App } from './helpers'

const distanceToBottom = (page: Page) =>
  page.getByTestId('thread-scroll').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)

async function longThread(app: App, n = 12) {
  const first = await app.generate({ prompt: 'fil long 1' })
  for (let i = 2; i <= n; i++) await app.generate({ prompt: `fil long ${i}`, threadId: first.thread.id })
  return first.thread
}

test('un fil long s’ouvre tout en bas, même après le chargement des images @core', async ({ app, page }) => {
  const thread = await longThread(app)
  await app.gotoThread(thread.id)
  await expect(page.getByText('fil long 12').first()).toBeVisible()
  await expect.poll(() => distanceToBottom(page)).toBeLessThan(2)
  // Les images finissent de se charger : on reste en bas.
  await page.waitForLoadState('load')
  await page.waitForTimeout(500)
  expect(await distanceToBottom(page)).toBeLessThan(2)
})

test('ouvrir un autre fil long depuis la liste arrive aussi tout en bas', async ({ app, page }) => {
  const a = await longThread(app, 8)
  await app.generate({ prompt: 'autre fil' })
  await app.gotoThread(a.id)
  await app.openThread('autre fil')
  await app.openThread('fil long 1')
  await expect.poll(() => distanceToBottom(page)).toBeLessThan(2)
})

test('une personne qui a remonté n’est pas ramenée en bas', async ({ app, page }) => {
  const thread = await longThread(app)
  await app.gotoThread(thread.id)
  await expect.poll(() => distanceToBottom(page)).toBeLessThan(2)
  // Vrai geste : la molette (un défilement causé par la page ne compte pas).
  const zone = page.getByTestId('thread-scroll')
  await zone.hover()
  await page.mouse.wheel(0, -20000)
  await expect.poll(() => zone.evaluate((el) => el.scrollTop)).toBe(0)
  await page.waitForTimeout(800)
  expect(await zone.evaluate((el) => el.scrollTop)).toBe(0)
})
