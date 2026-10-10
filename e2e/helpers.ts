import { resolve } from 'node:path'
import { expect, test as base, type Page } from '@playwright/test'
import type { Generation, Persona, Thread } from '@ai-fluence/shared'
import { resetData } from './db'

export const DRAFTS_KEY = 'aif-composer-drafts'
export const FIXTURE_IMAGE = resolve(__dirname, '../backend/src/test/fixtures/output.png')

/** Chaque test part de données vides (le compte connecté reste). */
export const test = base.extend<{ app: App }>({
  app: async ({ page }, use) => {
    resetData()
    await use(new App(page))
  },
})
export { expect }

type GenerateBody = {
  family?: string
  prompt?: string
  threadId?: string | null
  personaId?: string | null
  params?: Record<string, unknown>
  referenceAssetIds?: string[]
}

export class App {
  constructor(readonly page: Page) {}

  // ── Données via l'API (cookies de la page) ───────────────────

  async createPersona(data: Partial<Persona> & { name: string }): Promise<Persona> {
    const res = await this.page.request.post('/api/personas', { data })
    expect(res.ok(), await res.text()).toBeTruthy()
    return (await res.json()).persona
  }

  /** Génération (faux SpicyAPI : réussie aussitôt), attendue jusqu'au résultat. */
  async generate(body: GenerateBody = {}): Promise<{ generation: Generation; thread: Thread }> {
    const res = await this.page.request.post('/api/generations', {
      data: {
        family: 'bytedance/seedream-5.0-flash',
        prompt: 'une pomme rouge',
        params: {},
        referenceAssetIds: [],
        ...body,
      },
    })
    expect(res.status(), await res.text()).toBe(201)
    const { generation, thread } = await res.json()
    await expect
      .poll(async () => (await this.getGeneration(generation.id)).status, { timeout: 15_000 })
      .toBe('succeeded')
    return { generation: await this.getGeneration(generation.id), thread }
  }

  async getGeneration(id: string): Promise<Generation> {
    const res = await this.page.request.get(`/api/generations/${id}`)
    return (await res.json()).generation
  }

  async trashThread(id: string) {
    expect((await this.page.request.delete(`/api/threads/${id}`)).ok()).toBeTruthy()
  }

  /** Sélectionne un persona dans la barre de gauche. */
  async selectPersona(name: string) {
    await this.page.getByLabel(name, { exact: true }).click()
  }

  // ── Composer ─────────────────────────────────────────────────

  get prompt() {
    return this.page.getByPlaceholder(/Décris/)
  }
  get modelPicker() {
    return this.page.getByTestId('model-picker')
  }
  get count() {
    return this.page.getByRole('button', { name: /^Nombre d'images/ })
  }
  get ratio() {
    return this.page.getByRole('button', { name: 'Proportions' })
  }
  get attachments() {
    return this.page.getByTestId('attachment')
  }
  get tags() {
    return this.page.getByTestId('attachment-tag')
  }

  /**
   * Page prête : React a pris la main (sinon une saisie faite trop tôt est
   * effacée) et le catalogue est chargé, donc un modèle est affiché.
   */
  async ready() {
    // Hydratation terminée : React a posé sa racine sur le document.
    await this.page.waitForFunction(() =>
      [document, document.documentElement, document.body].some((n) =>
        Object.keys(n).some((k) => k.startsWith('__reactContainer')),
      ),
    )
    await expect(this.modelPicker).toBeVisible()
    await expect(this.modelPicker).not.toContainText(/Choisir/)
    await expect(this.modelPicker).toContainText(/\w/)
  }

  async gotoNew() {
    await this.page.goto('/')
    await this.ready()
  }

  async gotoThread(id: string) {
    await this.page.goto(`/t/${id}`)
    await this.ready()
  }

  /** Navigation interne (sans recharger la page), par la liste des fils. */
  async openThread(title: RegExp | string) {
    await this.page.getByRole('link', { name: title }).first().click()
    await this.ready()
  }

  async chooseRatio(value: string) {
    await this.ratio.click()
    await this.page.getByRole('button', { name: value, exact: true }).click()
  }

  /** Menu des modèles (composer ou fiche persona) : recherche puis clic sur la ligne. */
  async pickInModelMenu(label: string) {
    await this.page.getByPlaceholder('Rechercher un modèle').fill(label)
    await this.page
      .locator('[data-slot=popover-content]')
      .getByText(label, { exact: true })
      .first()
      .click()
  }

  async chooseModel(label: string) {
    await this.modelPicker.click()
    await this.pickInModelMenu(label)
    await expect(this.modelPicker).toContainText(label)
  }

  async chooseMedia(media: 'Photo' | 'Vidéo') {
    await this.page.getByRole('radio', { name: media }).click()
  }

  /** Action au survol d'un résultat du fil (Éditer, Animer…). */
  async resultAction(title: 'Éditer (image → image)' | 'Animer (image → vidéo)') {
    // Bouton visible au survol seulement : clic déclenché sur le bouton lui-même.
    const button = this.page.getByTitle(title).first()
    await expect(button).toBeAttached()
    await button.evaluate((el: HTMLElement) => el.click())
  }

  /** Corbeille depuis la liste des fils, avec confirmation. */
  async trashFromList(title: string) {
    const link = this.page.getByRole('link', { name: title }).first()
    await link.hover()
    await link
      .locator('xpath=ancestor::*[.//button[@aria-label="Supprimer le fil"]][1]')
      .getByRole('button', { name: 'Supprimer le fil' })
      .click()
    await this.page.getByRole('button', { name: 'Mettre à la corbeille' }).click()
  }

  async attachFile() {
    await this.page.locator('input[type=file]').first().setInputFiles(FIXTURE_IMAGE)
  }

  async send() {
    // Le bouton porte le prix une fois le devis reçu.
    await this.page.getByRole('button', { name: /^Générer pour/ }).click()
  }

  // ── Brouillons enregistrés (localStorage) ────────────────────

  /** Attend l'écriture différée des brouillons (300 ms). */
  async drafts(): Promise<Record<string, { prompt: string; personaId: string | null; count: number }>> {
    await this.page.waitForTimeout(500)
    return this.page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), DRAFTS_KEY)
  }

  /** Rechargement complet : seuls les brouillons enregistrés survivent. */
  async reload() {
    await this.page.waitForTimeout(500)
    await this.page.reload()
    await this.ready()
  }
}
