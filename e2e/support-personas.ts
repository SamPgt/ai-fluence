/**
 * Aides propres aux tests des personas, des références et des LoRA.
 */
import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import type { Asset, Generation, Persona } from '@ai-fluence/shared'
import { FIXTURE_IMAGE } from './helpers'

export const PNG = readFileSync(FIXTURE_IMAGE)

/** Fichier image en mémoire, avec un nom distinct. */
export const pngFile = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG })

/** Attend que React ait pris la main sur la page (sinon une saisie est effacée). */
export async function hydrated(page: Page) {
  await page.waitForFunction(() =>
    [document, document.documentElement, document.body].some((n) =>
      Object.keys(n).some((k) => k.startsWith('__reactContainer')),
    ),
  )
}

/** Fiche d'un persona, onglet choisi, une fois la page prête. */
export async function gotoPersona(page: Page, id: string, tab?: 'general' | 'lora' | 'shortcuts') {
  await page.goto(`/personas/${id}${tab ? `?tab=${tab}` : ''}`)
  await hydrated(page)
  await expect(page.getByText(/^Paramétrage de /)).toBeVisible()
}

export async function listPersonas(page: Page): Promise<Persona[]> {
  return (await (await page.request.get('/api/personas')).json()).personas
}

export async function getPersona(page: Page, id: string): Promise<Persona> {
  const p = (await listPersonas(page)).find((x) => x.id === id)
  expect(p, `persona ${id}`).toBeTruthy()
  return p!
}

/** Ajoute une image à la bibliothèque de références d'un persona (via l'API). */
export async function uploadReference(page: Page, personaId: string, name = 'ref.png'): Promise<Asset> {
  const res = await page.request.post('/api/assets', {
    multipart: {
      file: pngFile(name),
      personaId,
      isReference: 'true',
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).asset
}

export async function listReferences(page: Page, personaId: string): Promise<Asset[]> {
  const res = await page.request.get(`/api/assets/references?personaId=${personaId}`)
  return (await res.json()).assets
}

/** Indicateur de sauvegarde automatique de la fiche persona revenu à « Enregistré ». */
export async function saved(page: Page) {
  await expect(page.getByText('Enregistré', { exact: true })).toBeVisible()
}

/** Ordre des personas dans la barre de gauche (noms). */
export async function railOrder(page: Page): Promise<string[]> {
  const links = page.locator('nav a[aria-label^="Paramétrer "]')
  const labels = await links.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  return labels.map((l) => l.replace(/^Paramétrer /, ''))
}

/** Bulle d'un persona dans la barre de gauche. */
export const bubble = (page: Page, name: string) => page.locator('nav').getByLabel(name, { exact: true })

/** Menu des modèles déroulants : popover ouvert. */
export const popover = (page: Page) => page.locator('[data-slot=popover-content]')

/**
 * Envoi depuis le composer : renvoie le corps de la requête et la génération
 * créée (réponse du POST /api/generations).
 */
export async function sendAndCapture(page: Page, send: () => Promise<void>) {
  const [request, response] = await Promise.all([
    page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/generations'),
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/generations',
    ),
    send(),
  ])
  expect(response.status(), await response.text()).toBe(201)
  const body = request.postDataJSON() as {
    referenceAssetIds: string[]
    loraIds?: string[]
    loraWords?: Record<string, string[]>
    personaId: string | null
    contextIds?: string[]
  }
  const { generation } = (await response.json()) as { generation: Generation }
  return { body, generation }
}

/** Glisser-déposer à la souris, par petits pas (dnd-kit attend un vrai mouvement). */
export async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x, from.y + 8, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 20 })
  await page.waitForTimeout(150)
  await page.mouse.up()
}

export const center = async (loc: import('@playwright/test').Locator) => {
  const b = await loc.boundingBox()
  expect(b).toBeTruthy()
  return { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 }
}
