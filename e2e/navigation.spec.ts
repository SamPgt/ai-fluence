/**
 * Navigation : liste des fils, panneau repliable, raccourcis clavier,
 * recherche, renommage, épinglage et galerie.
 */
import { sql } from './db'
import { expect, test } from './helpers'
import { hydrated, threadTitles } from './support-auth'

const panelWidth = (page: import('@playwright/test').Page) =>
  page.getByTestId('thread-panel').evaluate((el) => el.getBoundingClientRect().width)

test('la liste de gauche montre les fils, le plus récent en haut @core', async ({ app, page }) => {
  await app.generate({ prompt: 'premier fil' })
  await app.generate({ prompt: 'second fil' })
  await app.gotoNew()
  const panel = page.getByTestId('thread-panel')
  await expect(panel.getByText('Tous les fils')).toBeVisible()
  await expect(panel.getByText('Récents')).toBeVisible()
  await expect.poll(() => threadTitles(page)).toEqual(['second fil', 'premier fil'])
  await expect(panel.getByRole('link', { name: /premier fil/ })).toContainText('1 génération · 0,010 $')
  await expect(panel).toContainText('Crédit : 10,00 $')
})

test('sans fil, la liste l’annonce', async ({ app, page }) => {
  await app.gotoNew()
  await expect(page.getByTestId('thread-panel').getByText('Aucun fil pour l’instant.')).toBeVisible()
})

test('cliquer un fil l’ouvre et le marque actif', async ({ app, page }) => {
  const { thread } = await app.generate({ prompt: 'fil a ouvrir' })
  await app.gotoNew()
  await app.openThread(/fil a ouvrir/)
  await expect(page).toHaveURL(new RegExp(`/t/${thread.id}$`))
  await expect(page.getByTestId('thread-panel').getByRole('link', { name: /fil a ouvrir/ })).toHaveClass(/bg-accent /)
})

test('« Replier le panneau » replie puis rouvre la liste, et l’état survit au rechargement', async ({
  app,
  page,
}) => {
  await app.gotoNew()
  await expect.poll(() => panelWidth(page)).toBe(288)
  await page.getByRole('button', { name: 'Replier le panneau' }).click()
  await expect.poll(() => panelWidth(page)).toBe(0)
  await app.reload()
  await expect.poll(() => panelWidth(page)).toBe(0)
  await page.getByRole('button', { name: 'Replier le panneau' }).click()
  await expect.poll(() => panelWidth(page)).toBe(288)
})

test('⌘B / Ctrl+B replie et rouvre le panneau', async ({ app, page }) => {
  await app.gotoNew()
  await expect.poll(() => panelWidth(page)).toBe(288)
  await page.keyboard.press('ControlOrMeta+b')
  await expect.poll(() => panelWidth(page)).toBe(0)
  await page.keyboard.press('ControlOrMeta+b')
  await expect.poll(() => panelWidth(page)).toBe(288)
  // Les deux touches fonctionnent, quel que soit le système.
  await page.keyboard.press('Control+b')
  await expect.poll(() => panelWidth(page)).toBe(0)
})

test('le raccourci affiché sur « Nouveau fil » ouvre un nouveau fil', async ({ app, page }) => {
  const { thread } = await app.generate({ prompt: 'fil de depart' })
  await app.gotoThread(thread.id)
  const mac = await page.evaluate(() => {
    const p =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform
    return /mac|iphone|ipad/i.test(p)
  })
  const button = page.getByRole('button', { name: /Nouveau fil/ })
  await expect(button.locator('kbd')).toHaveText(mac ? '⌘L' : '⇧L')
  // Le focus hors d'un champ : Maj+L ne doit pas s'appliquer pendant la saisie.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(mac ? 'Meta+l' : 'Shift+L')
  await expect(page).toHaveURL(/\/$/)
  await app.ready()
})

test('le bouton « Nouveau fil » ramène au composer vide', async ({ app, page }) => {
  const { thread } = await app.generate({ prompt: 'fil courant' })
  await app.gotoThread(thread.id)
  await page.getByRole('button', { name: /Nouveau fil/ }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Que veux-tu créer ?' })).toBeVisible()
})

test('la recherche (⌘K) trouve un fil par son titre et l’ouvre @core', async ({ app, page }) => {
  const target = (await app.generate({ prompt: 'un chat orange sur un toit' })).thread
  await app.generate({ prompt: 'une voiture bleue' })
  await app.gotoNew()

  await page.keyboard.press('ControlOrMeta+k')
  const input = page.getByPlaceholder('Rechercher dans les fils et les prompts…')
  await expect(input).toBeVisible()
  await expect(page.getByText('Tape pour chercher…')).toBeVisible()
  await input.fill('chat orange')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('1 résultat')).toBeVisible()
  await expect(dialog).not.toContainText('une voiture bleue')
  await dialog.getByRole('button', { name: /un chat orange sur un toit/ }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/t/${target.id}$`))
})

test('le bouton « Rechercher… » ouvre la recherche, qui annonce l’absence de résultat', async ({ app, page }) => {
  await app.generate({ prompt: 'une pomme' })
  await app.gotoNew()
  await page.getByRole('button', { name: /Rechercher…/ }).click()
  const input = page.getByPlaceholder('Rechercher dans les fils et les prompts…')
  await input.fill('zzzintrouvable')
  await expect(page.getByText('Aucun résultat pour « zzzintrouvable »')).toBeVisible()
  // ⌘K referme la recherche.
  await page.keyboard.press('ControlOrMeta+k')
  await expect(input).toBeHidden()
})

test('double-clic sur un titre : renommage en place, Entrée enregistre @core', async ({ app, page }) => {
  const { thread } = await app.generate({ prompt: 'ancien titre' })
  await app.gotoNew()
  const panel = page.getByTestId('thread-panel')
  await panel.getByText('ancien titre', { exact: true }).dblclick()
  const field = panel.locator('input')
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('ancien titre')
  await field.fill('nouveau titre')
  await field.press('Enter')
  await expect(field).toHaveCount(0)
  await expect(panel.getByRole('link', { name: /nouveau titre/ })).toBeVisible()
  await expect.poll(() => sql(`SELECT title FROM threads WHERE id = '${thread.id}'`)).toBe('nouveau titre')
  await app.reload()
  await expect(panel.getByRole('link', { name: /nouveau titre/ })).toBeVisible()
  await expect(panel.getByText('ancien titre')).toHaveCount(0)
})

test('Échap annule le renommage', async ({ app, page }) => {
  const { thread } = await app.generate({ prompt: 'titre garde' })
  await app.gotoNew()
  const panel = page.getByTestId('thread-panel')
  await panel.getByText('titre garde', { exact: true }).dblclick()
  const field = panel.locator('input')
  await field.fill('titre abandonne')
  await field.press('Escape')
  await expect(field).toHaveCount(0)
  await expect(panel.getByRole('link', { name: /titre garde/ })).toBeVisible()
  expect(sql(`SELECT title FROM threads WHERE id = '${thread.id}'`)).toBe('titre garde')
})

test('épingler un fil le remonte dans « Épinglés », désépingler le remet à sa place @core', async ({ app, page }) => {
  await app.generate({ prompt: 'fil ancien' })
  await app.generate({ prompt: 'fil recent' })
  await app.gotoNew()
  const panel = page.getByTestId('thread-panel')
  await expect.poll(() => threadTitles(page)).toEqual(['fil recent', 'fil ancien'])
  await expect(panel.getByText('Épinglés')).toHaveCount(0)

  await panel.getByRole('link', { name: /fil ancien/ }).hover()
  await panel.getByRole('button', { name: 'Épingler', exact: true }).click()
  await expect(panel.getByText('Épinglés')).toBeVisible()
  await expect.poll(() => threadTitles(page)).toEqual(['fil ancien', 'fil recent'])
  // Persisté : toujours épinglé après rechargement.
  await app.reload()
  await expect(panel.getByText('Épinglés')).toBeVisible()
  await expect.poll(() => threadTitles(page)).toEqual(['fil ancien', 'fil recent'])

  await panel.getByRole('link', { name: /fil ancien/ }).hover()
  await panel.getByRole('button', { name: 'Désépingler' }).click()
  await expect(panel.getByText('Épinglés')).toHaveCount(0)
  await expect.poll(() => threadTitles(page)).toEqual(['fil recent', 'fil ancien'])
})

test('la galerie est accessible depuis la barre et montre les images générées', async ({ app, page }) => {
  await app.generate({ prompt: 'image pour la galerie' })
  await app.gotoNew()
  await page.getByRole('navigation').getByRole('link', { name: 'Galerie', exact: true }).click()
  await expect(page).toHaveURL(/\/galerie$/)
  await hydrated(page)
  await expect(page.locator('main img[src*="/api/media/"]').first()).toBeVisible()
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Galerie', exact: true })).toHaveClass(/bg-accent/)
})

test('le menu utilisateur mène au paramétrage', async ({ app, page }) => {
  await app.gotoNew()
  await page.getByRole('button', { name: 'Menu utilisateur' }).click()
  await page.getByRole('menuitem', { name: 'Paramétrage' }).click()
  await expect(page).toHaveURL(/\/parametres\?tab=account/)
  await expect(page.getByRole('tab', { name: 'Compte' })).toHaveAttribute('data-state', 'active')
})

test('le lien du crédit mène à l’onglet Crédits', async ({ app, page }) => {
  await app.gotoNew()
  await page.getByTestId('thread-panel').getByRole('link', { name: /Crédit/ }).click()
  await expect(page).toHaveURL(/\/parametres\?tab=credits/)
  await expect(page.getByText('Crédits et consommation')).toBeVisible()
})
