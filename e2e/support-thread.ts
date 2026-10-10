/**
 * Aides propres aux tests du fil, de la relance, de l'upscale et de la galerie :
 * données créées par l'API (cookies de la page), sans passer par le composer.
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type { Asset, Generation, PromptPreset, Thread } from '@ai-fluence/shared'
import { expect, FIXTURE_IMAGE } from './helpers'

export const SEEDREAM = 'bytedance/seedream-5.0-flash'
export const QWEN = 'alibaba/qwen-image-3.0-pro'
export const ZIMAGE_LORA = 'alibaba/z-image-turbo-lora'
export const SEEDANCE_25 = 'bytedance/seedance-2.5'

export type CreateBody = {
  family?: string
  prompt?: string
  threadId?: string | null
  personaId?: string | null
  params?: Record<string, unknown>
  referenceAssetIds?: string[]
  contextIds?: string[]
  loraIds?: string[]
  loraWords?: Record<string, string[]>
  count?: number
}

/** Crée une génération sans attendre son résultat. */
export async function createGeneration(
  page: Page,
  body: CreateBody = {},
): Promise<{ generation: Generation; thread: Thread }> {
  const res = await page.request.post('/api/generations', {
    data: {
      family: SEEDREAM,
      prompt: 'une pomme rouge',
      params: {},
      referenceAssetIds: [],
      ...body,
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  return res.json()
}

export async function getThread(page: Page, id: string): Promise<{ thread: Thread; generations: Generation[] }> {
  const res = await page.request.get(`/api/threads/${id}`)
  expect(res.ok(), await res.text()).toBeTruthy()
  return res.json()
}

/** Attend que toutes les générations du fil soient terminées (réussies ou en échec). */
export async function waitThreadDone(page: Page, id: string, expected?: number) {
  await expect
    .poll(
      async () => {
        const { generations } = await getThread(page, id)
        if (expected !== undefined && generations.length !== expected) return false
        return generations.every((g) => g.status === 'succeeded' || g.status === 'failed')
      },
      { timeout: 20_000 },
    )
    .toBe(true)
  return getThread(page, id)
}

/** Génération (série possible) attendue jusqu'au bout. */
export async function generateDone(page: Page, body: CreateBody = {}) {
  const created = await createGeneration(page, body)
  const before = body.threadId ? (await getThread(page, created.thread.id)).generations.length : undefined
  const done = await waitThreadDone(page, created.thread.id, before)
  const generation = done.generations.find((g) => g.id === created.generation.id)!
  return { thread: created.thread, generation, generations: done.generations }
}

/** Image envoyée comme fichier source (pour servir de référence). */
export async function uploadImage(page: Page, personaId?: string): Promise<Asset> {
  const res = await page.request.post('/api/assets', {
    multipart: {
      file: { name: 'source.png', mimeType: 'image/png', buffer: readFileSync(FIXTURE_IMAGE) },
      ...(personaId ? { personaId } : {}),
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).asset
}

/** Raccourci (contexte) disponible pour tous les personas. */
export async function createPreset(page: Page, label: string, text: string): Promise<PromptPreset> {
  const res = await page.request.post('/api/presets', { data: { label, text, media: 'all' } })
  expect(res.ok(), await res.text()).toBeTruthy()
  const body = await res.json()
  return body.preset ?? body
}

/** Les générations créées par la page (réponse du POST). */
export function nextCreated(page: Page, path = '/api/generations') {
  return page.waitForResponse((r) => new URL(r.url()).pathname === path && r.request().method() === 'POST')
}
