/**
 * Outils communs aux tests du composer, du menu des modèles et du menu des raccourcis.
 */
import { readFileSync } from 'node:fs'
import { expect, type Locator, type Page } from '@playwright/test'
import type { PromptPreset } from '@ai-fluence/shared'
import { FIXTURE_IMAGE } from './helpers'

export { formatUsd } from '../frontend/src/lib/format'

export const PNG = readFileSync(FIXTURE_IMAGE)

/** Fichier prêt pour `setInputFiles`, avec un nom distinct à chaque appel. */
export const pngFile = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG })

export function fileInput(page: Page) {
  return page.locator('input[type=file]').first()
}

// ── Menu des modèles ────────────────────────────────────────────

export const modelMenu = (page: Page) => page.getByTestId('model-menu')
/** Sous-menu ouvert (celui qui se referme peut rester un instant dans la page). */
export const subMenu = (page: Page) => page.locator('[data-testid=model-submenu][data-state=open]')
/** Liste principale du menu (celle qui défile). */
export const modelList = (page: Page) => modelMenu(page).locator('.thin-scrollbar')

/** Noms des modèles listés dans un panneau, dans l'ordre d'affichage. */
export async function rowLabels(panel: Locator): Promise<string[]> {
  return panel
    .getByRole('menuitemradio')
    .evaluateAll((rows) => rows.map((r) => r.querySelector('span.truncate')?.textContent?.trim() ?? ''))
}

/** Lignes qui ouvrent un sous-menu (fournisseurs puis groupes), dans l'ordre. */
export async function subMenuLabels(page: Page): Promise<string[]> {
  return modelList(page)
    .locator(':scope > button')
    // Le libellé est le dernier nœud texte (avant lui : logo ou pastille « $ » / « L »).
    .evaluateAll((buttons) => buttons.map((b) => (b.firstElementChild?.lastChild?.textContent ?? '').trim()))
}

/** Ligne d'un fournisseur ou d'un groupe dans le menu principal. */
export const subMenuRow = (page: Page, label: string) =>
  modelList(page).locator(':scope > button').filter({ hasText: new RegExp(`^[$L]?${escape(label)}$`) })

/** Ligne d'un modèle (dans le menu ou un sous-menu). */
export const modelRow = (panel: Locator, label: string) =>
  panel.getByRole('menuitemradio').filter({
    has: panel.page().locator('span.truncate', { hasText: new RegExp(`^${escape(label)}$`) }),
  })

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function openModelMenu(page: Page) {
  await page.getByTestId('model-picker').click()
  await expect(modelMenu(page)).toBeVisible()
}

// ── Raccourcis (contexte supplémentaire) ────────────────────────

export async function createPreset(
  page: Page,
  data: Partial<PromptPreset> & { label: string; text: string },
): Promise<PromptPreset> {
  const res = await page.request.post('/api/presets', { data })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).preset
}

export const shortcutsButton = (page: Page) => page.getByRole('button', { name: 'Ajouter un raccourci' })
export const shortcutsMenu = (page: Page) =>
  page.locator('[data-slot=popover-content]').filter({ has: page.getByPlaceholder(/^Rechercher (une LoRA ou )?un raccourci$/) })
export const contextTags = (page: Page) => page.getByTestId('context-tag')

export async function openShortcuts(page: Page) {
  await shortcutsButton(page).click()
  await expect(shortcutsMenu(page)).toBeVisible()
}

/** Ligne d'un raccourci dans le menu. */
export const shortcutOption = (page: Page, label: string) =>
  shortcutsMenu(page).getByRole('option').filter({ hasText: label })
