/**
 * Workflows : page liste (créer, ouvrir, corbeille), canvas (nom modifiable sur
 * place, cadrage enregistré automatiquement).
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type { Workflow } from '@sublime/shared'
import { expect, FIXTURE_IMAGE, test } from './helpers'

const cards = (page: Page) => page.getByTestId('workflow-card')
const nodes = (page: Page) => page.getByTestId('workflow-node')
const node = (page: Page, type: string) => page.locator(`[data-testid="workflow-node"][data-node-type="${type}"]`)
const edges = (page: Page) => page.locator('.react-flow__edge')
const saveStatus = (page: Page) => page.getByTestId('workflow-save-status')

async function createWorkflow(page: Page, name: string): Promise<Workflow> {
  const res = await page.request.post('/api/workflows', { data: { name } })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).workflow
}

async function getWorkflow(page: Page, id: string): Promise<Workflow> {
  return (await (await page.request.get(`/api/workflows/${id}`)).json()).workflow
}

test('le lien Workflows de la sidebar ouvre la liste @core', async ({ app, page }) => {
  void app
  await page.goto('/galerie')
  const link = page.getByTestId('thread-panel').getByRole('link', { name: 'Workflows' })
  await link.click()
  await expect(page).toHaveURL(/\/workflows$/)
  await expect(page.getByRole('main').getByText('Workflows', { exact: true })).toBeVisible()
  // La liste garde la sidebar, avec le lien Workflows actif.
  await expect(link).toHaveClass(/bg-accent /)
})

test('créer un workflow ouvre son canvas ; renommé, il apparaît dans la liste @core @smoke', async ({ app, page }) => {
  void app
  await page.goto('/workflows')
  await expect(cards(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Créer un workflow' }).click()
  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/)
  await expect(page.getByTestId('workflow-canvas')).toBeVisible()
  await expect(page.getByText('Ce workflow est vide.')).toBeVisible()
  // Pas de volet des fils : la palette des nœuds à la place.
  await expect(page.getByTestId('thread-panel')).toHaveCount(0)
  await expect(page.getByTestId('node-palette')).toBeVisible()
  // Même pied « Crédit » que le volet des fils.
  await expect(page.getByTestId('node-palette')).toContainText('Crédit : 10,00 $')

  const name = page.getByRole('textbox', { name: 'Nom du workflow' })
  await expect(name).toHaveValue('Workflow sans titre')
  await name.fill('Shooting plage')
  await name.press('Enter')
  await expect
    .poll(async () => (await getWorkflow(page, page.url().split('/workflows/')[1])).name)
    .toBe('Shooting plage')

  // La palette remplace la sidebar : « Retour » en haut ramène à la liste.
  await page.getByTestId('node-palette').getByRole('link', { name: 'Retour' }).click()
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page)).toContainText('Shooting plage')
  await expect(cards(page)).toContainText('0 nœud')
})

test('Modifier : titre et couverture importée, affichée en vedette dans la liste @core', async ({ app, page }) => {
  void app
  await createWorkflow(page, 'Sans couverture')
  await page.goto('/workflows')
  const card = cards(page).first()
  await expect(card.locator('img')).toHaveCount(0)
  await card.hover()
  await page.getByRole('button', { name: 'Modifier « Sans couverture »' }).click()
  const dialog = page.getByRole('dialog', { name: 'Modifier le workflow' })
  await dialog.getByRole('textbox', { name: 'Titre du workflow' }).fill('Macbook sticker')
  await dialog.locator('input[type=file]').setInputFiles(FIXTURE_IMAGE)
  await expect(dialog.getByRole('img', { name: 'Couverture' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(card).toContainText('Macbook sticker')
  await expect(card).toContainText('0 nœud')
  await expect(card.locator('img')).toHaveAttribute('src', /\/api\/media\//)
})

test('nom : Échap annule, un nom vide reprend l’ancien', async ({ app, page }) => {
  void app
  const w = await createWorkflow(page, 'Avant')
  await page.goto(`/workflows/${w.id}`)
  const name = page.getByRole('textbox', { name: 'Nom du workflow' })
  await name.fill('Abandonné')
  await name.press('Escape')
  await expect(name).toHaveValue('Avant')
  await name.fill('   ')
  await name.press('Enter')
  await expect(name).toHaveValue('Avant')
  expect((await getWorkflow(page, w.id)).name).toBe('Avant')
})

test('le cadrage du canvas est enregistré et retrouvé à la réouverture @core', async ({ app, page }) => {
  void app
  const w = await createWorkflow(page, 'Cadrage')
  await page.goto(`/workflows/${w.id}`)
  await expect(saveStatus(page)).toHaveText('Enregistré')
  // Aucune modification à l'ouverture : rien n'est renvoyé.
  expect((await getWorkflow(page, w.id)).updatedAt).toBe(w.updatedAt)

  await page.getByRole('button', { name: 'Zoom In' }).click()
  await expect.poll(async () => (await getWorkflow(page, w.id)).graph.viewport?.zoom).toBeGreaterThan(1)
  await expect(saveStatus(page)).toHaveText('Enregistré')
  const { viewport } = (await getWorkflow(page, w.id)).graph

  await page.reload()
  await expect(page.getByTestId('workflow-canvas')).toBeVisible()
  const transform = await page.locator('.react-flow__viewport').getAttribute('style')
  expect(transform).toContain(`scale(${viewport!.zoom})`)
})

test('graphe enregistré : les nœuds sont affichés à l’ouverture', async ({ app, page }) => {
  void app
  const w = await createWorkflow(page, 'Avec nœuds')
  const res = await page.request.patch(`/api/workflows/${w.id}`, {
    data: {
      graph: {
        nodes: [
          { id: 't', type: 'text', position: { x: 0, y: 0 }, data: {} },
          { id: 'img', type: 'image-gen', position: { x: 300, y: 0 }, data: {} },
        ],
        edges: [{ id: 'e', source: 't', sourceHandle: 'text', target: 'img', targetHandle: 'prompt' }],
      },
    },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  await page.goto(`/workflows/${w.id}`)
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expect(page.getByText('Ce workflow est vide.')).toHaveCount(0)
})

test('workflow introuvable : message et retour à la liste', async ({ app, page }) => {
  void app
  await page.goto('/workflows/00000000-0000-4000-8000-000000000000')
  await expect(page.getByText('Workflow introuvable.')).toBeVisible()
  await page.getByRole('link', { name: 'Retour aux workflows' }).click()
  await expect(page).toHaveURL(/\/workflows$/)
})

test('corbeille : mis à la corbeille depuis la liste, annulable, restaurable @core', async ({ app, page }) => {
  void app
  await createWorkflow(page, 'Garder')
  await createWorkflow(page, 'Jeter')
  await page.goto('/workflows')
  await expect(cards(page)).toHaveCount(2)

  await cards(page).filter({ hasText: 'Jeter' }).hover()
  await page.getByRole('button', { name: 'Mettre « Jeter » à la corbeille' }).click()
  await expect(cards(page)).toHaveCount(1)
  // Annuler depuis la notification.
  await page.getByRole('button', { name: 'Annuler' }).click()
  await expect(cards(page)).toHaveCount(2)

  await cards(page).filter({ hasText: 'Jeter' }).hover()
  await page.getByRole('button', { name: 'Mettre « Jeter » à la corbeille' }).click()
  await expect(cards(page)).toHaveCount(1)

  await page.goto('/corbeille')
  const row = page.getByTestId('trash-row').filter({ hasText: 'Jeter' })
  await expect(row).toContainText('0 nœud')
  await row.getByRole('button', { name: 'Restaurer' }).click()
  await expect(row).toHaveCount(0)
  await page.goto('/workflows')
  await expect(cards(page)).toHaveCount(2)
})

test.describe('nœuds', () => {
  async function open(page: Page, name = 'Nœuds') {
    const w = await createWorkflow(page, name)
    await page.goto(`/workflows/${w.id}`)
    await expect(page.getByTestId('workflow-canvas')).toBeVisible()
    return w
  }
  const savedGraph = async (page: Page, id: string) => (await getWorkflow(page, id)).graph

  /** Relie la sortie d'un nœud à l'entrée d'un autre, à la souris. */
  async function link(page: Page, from: { type: string; port: string }, to: { type: string; port: string }) {
    const a = node(page, from.type).getByTestId(`handle-out-${from.port}`)
    const b = node(page, to.type).getByTestId(`handle-in-${to.port}`)
    const [ab, bb] = [(await a.boundingBox())!, (await b.boundingBox())!]
    await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2)
    await page.mouse.down()
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 10 })
    await page.mouse.up()
  }

  test('la palette ajoute les nœuds (clic, clic droit), enregistrés automatiquement @core @smoke', async ({ app, page }) => {
    void app
    const w = await open(page)
    await page.getByRole('button', { name: 'Ajouter le nœud Texte', exact: true }).click()
    await expect(nodes(page)).toHaveCount(1)
    await expect(page.getByText('Ce workflow est vide.')).toHaveCount(0)
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)

    // Clic droit sur le canvas : menu des nœuds, posé à cet endroit.
    await page.getByTestId('workflow-canvas').click({ button: 'right', position: { x: 160, y: 140 } })
    await page.getByRole('menu', { name: 'Ajouter un nœud' }).getByRole('menuitem', { name: 'Générer une image' }).click()
    await expect(nodes(page)).toHaveCount(2)
    // Seul le nouveau nœud est sélectionné (le précédent ne serait pas déplacé avec lui).
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
    await expect(page.locator('.react-flow__node.selected')).toHaveAttribute('data-id', /^image-gen-/)
    // Modèle économique par défaut.
    await expect(node(page, 'image-gen')).toContainText('Seedream 5.0 Flash')

    await expect.poll(async () => (await savedGraph(page, w.id)).nodes.map((n) => n.type).sort()).toEqual([
      'image-gen',
      'text',
    ])
    await page.reload()
    await expect(nodes(page)).toHaveCount(2)
  })

  test('glisser un nœud depuis la palette le pose sur le canvas', async ({ app, page }) => {
    void app
    await open(page)
    await page.getByRole('button', { name: 'Ajouter le nœud Image source' }).dragTo(page.getByTestId('workflow-canvas'), {
      targetPosition: { x: 300, y: 200 },
    })
    await expect(node(page, 'image-source')).toHaveCount(1)
  })

  test('liens : texte → prompt accepté, texte → références refusé ; la tâche suit les entrées @core', async ({
    app,
    page,
  }) => {
    void app
    const w = await createWorkflow(page, 'Liens')
    await page.request.patch(`/api/workflows/${w.id}`, {
      data: {
        graph: {
          nodes: [
            { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: 'une pomme' } },
            { id: 's', type: 'image-source', position: { x: 0, y: 320 }, data: {} },
            { id: 'g', type: 'image-gen', position: { x: 420, y: 80 }, data: { family: 'bytedance/seedream-5.0-flash', params: {} } },
          ],
          edges: [],
        },
      },
    })
    await page.goto(`/workflows/${w.id}`)
    await expect(nodes(page)).toHaveCount(3)
    await expect(node(page, 'image-gen')).toContainText('Texte → image')

    await link(page, { type: 'text', port: 'text' }, { type: 'image-gen', port: 'references' })
    await expect(edges(page)).toHaveCount(0)

    await link(page, { type: 'text', port: 'text' }, { type: 'image-gen', port: 'prompt' })
    await expect(edges(page)).toHaveCount(1)

    await link(page, { type: 'image-source', port: 'image' }, { type: 'image-gen', port: 'references' })
    await expect(edges(page)).toHaveCount(2)
    await expect(node(page, 'image-gen')).toContainText('Image → image')

    await expect
      .poll(async () => (await savedGraph(page, w.id)).edges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}.${e.targetHandle}`).sort())
      .toEqual(['s.image>g.references', 't.text>g.prompt'])
  })

  test('réglages : le texte d’un nœud est enregistré ; un nœud se supprime avec ses liens', async ({ app, page }) => {
    void app
    const w = await createWorkflow(page, 'Réglages')
    await page.request.patch(`/api/workflows/${w.id}`, {
      data: {
        graph: {
          nodes: [
            { id: 't', type: 'text', position: { x: 0, y: 0 }, data: {} },
            { id: 'v', type: 'video-gen', position: { x: 420, y: 0 }, data: { family: 'bytedance/seedance-2.0-mini', params: {} } },
          ],
          edges: [{ id: 'e', source: 't', sourceHandle: 'text', target: 'v', targetHandle: 'prompt' }],
        },
      },
    })
    await page.goto(`/workflows/${w.id}`)
    await node(page, 'text').getByRole('textbox', { name: 'Texte du nœud' }).fill('un chat qui court')
    await expect.poll(async () => (await savedGraph(page, w.id)).nodes.find((n) => n.id === 't')?.data.text).toBe('un chat qui court')

    await page.getByRole('button', { name: 'Supprimer le nœud Texte' }).click()
    await expect(nodes(page)).toHaveCount(1)
    await expect.poll(async () => (await savedGraph(page, w.id)).edges).toEqual([])
    // Prompt obligatoire non relié : signalé par l'astérisque, mais le brouillon reste enregistrable.
    await expect(node(page, 'video-gen')).toContainText('Prompt *')
  })

  test('Image source : « Assets » propose les photos de chaque persona, à cocher, puis plusieurs images @core', async ({
    app,
    page,
  }) => {
    const upload = async (personaId: string) => {
      const res = await page.request.post('/api/assets', {
        multipart: {
          file: { name: 'ref.png', mimeType: 'image/png', buffer: readFileSync(FIXTURE_IMAGE) },
          personaId,
          isReference: 'true',
        },
      })
      expect(res.ok(), await res.text()).toBeTruthy()
      return (await res.json()).asset as { id: string }
    }
    const lea = await app.createPersona({ name: 'Léa' })
    const max = await app.createPersona({ name: 'Max' })
    const [l1, l2] = [await upload(lea.id), await upload(lea.id)]
    const m1 = await upload(max.id)

    const w = await open(page)
    // Plus de nœud Persona dans la palette.
    await expect(page.getByRole('button', { name: 'Ajouter le nœud Persona' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Ajouter le nœud Image source' }).click()
    await node(page, 'image-source').getByRole('button', { name: 'Assets' }).click()

    const dialog = page.getByRole('dialog')
    const sections = dialog.getByTestId('persona-assets')
    await expect(sections).toHaveCount(2)
    await expect(sections.first()).toContainText('Léa')
    await sections.filter({ hasText: 'Léa' }).getByRole('button', { name: 'Photo de Léa' }).nth(1).click()
    await sections.filter({ hasText: 'Max' }).getByRole('button', { name: 'Photo de Max' }).click()
    await expect(dialog).toContainText('2 images choisies')
    // Décocher puis recocher : l'ordre suit les clics.
    await sections.filter({ hasText: 'Léa' }).getByRole('button', { name: 'Photo de Léa' }).first().click()
    await page.keyboard.press('Escape')

    await expect(node(page, 'image-source').getByRole('img', { name: 'Image source' })).toHaveCount(3)
    await expect
      .poll(async () => (await savedGraph(page, w.id)).nodes[0]?.data.assetIds)
      // Photos d'un persona : les plus récentes d'abord (l2 puis l1).
      .toEqual([l1.id, m1.id, l2.id])
    // Retirer une image depuis le nœud.
    await node(page, 'image-source').getByRole('button', { name: 'Retirer l’image' }).first().click({ force: true })
    await expect.poll(async () => (await savedGraph(page, w.id)).nodes[0]?.data.assetIds).toEqual([m1.id, l2.id])
  })

  test('plus aucun nœud à l’écran : « Recentrer sur les nœuds » les ramène', async ({ app, page }) => {
    void app
    const w = await createWorkflow(page, 'Perdu')
    await page.request.patch(`/api/workflows/${w.id}`, {
      data: {
        graph: {
          nodes: [{ id: 't', type: 'text', position: { x: 0, y: 0 }, data: {} }],
          edges: [],
          // Cadrage très loin du nœud.
          viewport: { x: -5000, y: -5000, zoom: 1 },
        },
      },
    })
    await page.goto(`/workflows/${w.id}`)
    await expect(nodes(page)).toHaveCount(1)
    const recenter = page.getByRole('button', { name: 'Recentrer sur les nœuds' })
    await expect(recenter).toBeVisible()
    await expect(nodes(page)).not.toBeInViewport()
    await recenter.click()
    await expect(nodes(page)).toBeInViewport()
    await expect(recenter).toHaveCount(0)
  })

  test('nœuds visibles ou canvas vide : pas de bouton « Recentrer »', async ({ app, page }) => {
    void app
    await open(page)
    await expect(page.getByRole('button', { name: 'Recentrer sur les nœuds' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Ajouter le nœud Texte', exact: true }).click()
    await expect(nodes(page)).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Recentrer sur les nœuds' })).toHaveCount(0)
  })

  test('survol d’un câble : une croix en son milieu retire ce lien, et lui seul', async ({ app, page }) => {
    void app
    const w = await createWorkflow(page, 'Croix')
    await page.request.patch(`/api/workflows/${w.id}`, {
      data: {
        graph: {
          nodes: [
            { id: 't', type: 'text', position: { x: 0, y: 0 }, data: {} },
            { id: 's1', type: 'image-source', position: { x: 0, y: 300 }, data: {} },
            { id: 's2', type: 'image-source', position: { x: 0, y: 640 }, data: {} },
            { id: 'g', type: 'image-gen', position: { x: 480, y: 200 }, data: { params: {} } },
          ],
          edges: [
            { id: 'e', source: 't', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' },
            { id: 'r1', source: 's1', sourceHandle: 'image', target: 'g', targetHandle: 'references' },
            { id: 'r2', source: 's2', sourceHandle: 'image', target: 'g', targetHandle: 'references' },
          ],
        },
      },
    })
    await page.goto(`/workflows/${w.id}`)
    await expect(edges(page)).toHaveCount(3)
    // Croix invisible tant qu'on ne survole pas le câble.
    const cross = page.locator('[data-testid="edge-remove"]')
    await expect(cross.first()).toHaveCSS('opacity', '0')

    // Survol du milieu du câble de la référence 2.
    const path = page.locator('.react-flow__edge[data-id="r2"] .react-flow__edge-path')
    const mid = await path.evaluate((el: SVGPathElement) => {
      const p = el.getPointAtLength(el.getTotalLength() / 2)
      const m = el.getScreenCTM()!
      return { x: p.x * m.a + m.e, y: p.y * m.d + m.f }
    })
    await page.mouse.move(mid.x, mid.y)
    await expect.poll(async () => (await cross.evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity === '1').length))).toBe(1)
    await page.mouse.click(mid.x, mid.y)
    await expect(edges(page)).toHaveCount(2)
    await expect
      .poll(async () => (await savedGraph(page, w.id)).edges.map((e) => e.id).sort())
      .toEqual(['e', 'r1'])

    // Plus de croix sur les connecteurs : cliquer une entrée reliée ne retire rien.
    await node(page, 'image-gen').getByTestId('handle-in-prompt').click()
    await expect(edges(page)).toHaveCount(2)
  })

  test('Maj + clic étend la sélection du texte d’un nœud', async ({ app, page }) => {
    void app
    const w = await createWorkflow(page, 'Sélection')
    await page.request.patch(`/api/workflows/${w.id}`, {
      data: {
        graph: {
          nodes: [{ id: 't', type: 'text', position: { x: 100, y: 100 }, data: { text: 'un deux trois quatre cinq' } }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    })
    await page.goto(`/workflows/${w.id}`)
    const field = node(page, 'text').getByRole('textbox', { name: 'Texte du nœud' })
    const box = (await field.boundingBox())!
    // Clic au début du texte, puis Maj + clic plus loin sur la même ligne.
    await page.mouse.click(box.x + 12, box.y + 16)
    await page.keyboard.down('Shift')
    await page.mouse.click(box.x + 80, box.y + 16)
    await page.keyboard.up('Shift')
    const [start, end] = await field.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])
    expect(start).toBe(0)
    expect(end).toBeGreaterThan(5)
    // Pas de sélection de nœuds au lasso pendant la saisie.
    await expect(page.locator('.react-flow__selection')).toHaveCount(0)
  })
})

test.describe('saisie dans les nœuds', () => {
  /** Ouvre un workflow avec un nœud Texte et un nœud Texte IA déjà remplis, au zoom 1. */
  async function openWithTexts(page: Page) {
    const w = await createWorkflow(page, 'Saisie')
    await page.request.patch(`/api/workflows/${w.id}`, {
      data: {
        graph: {
          nodes: [
            { id: 't', type: 'text', position: { x: 60, y: 40 }, data: { text: 'debut fin' } },
            { id: 'l', type: 'llm', position: { x: 420, y: 40 }, data: { instruction: 'debut fin' } },
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    })
    await page.goto(`/workflows/${w.id}`)
    return w
  }

  for (const [label, type, name] of [
    ['Texte', 'text', 'Texte du nœud'],
    ['Texte IA', 'llm', 'Consigne'],
  ] as const) {
    test(`${label} : écrire vite au milieu du texte garde le curseur en place`, async ({ app, page }) => {
      void app
      const w = await openWithTexts(page)
      const field = node(page, type).getByRole('textbox', { name })
      await field.click()
      // Curseur juste après « debut ».
      await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(5, 5))
      await page.keyboard.type(' au milieu', { delay: 0 })
      await expect(field).toHaveValue('debut au milieu fin')
      await page.keyboard.type(' encore', { delay: 15 })
      await expect(field).toHaveValue('debut au milieu encore fin')
      await expect
        .poll(async () => {
          const graph = (await (await page.request.get(`/api/workflows/${w.id}`)).json()).workflow.graph
          return graph.nodes.find((n: { id: string }) => n.id === (type === 'text' ? 't' : 'l')).data[type === 'text' ? 'text' : 'instruction']
        })
        .toBe('debut au milieu encore fin')
    })
  }

  test('sous charge, dès l’ouverture : taper « @ » au milieu du texte ne renvoie pas le curseur à la fin', async ({
    app,
    page,
  }) => {
    void app
    const w = await createWorkflow(page, 'Curseur')
    await page.request.patch(`/api/workflows/${w.id}`, {
      data: {
        graph: {
          nodes: [
            { id: 't', type: 'text', position: { x: 60, y: 40 }, data: { text: 'debut fin' } },
            { id: 's1', type: 'image-source', position: { x: 60, y: 300 }, data: {} },
            { id: 'img', type: 'image-gen', position: { x: 420, y: 40 }, data: { params: {} } },
          ],
          edges: [
            { id: 'p', source: 't', sourceHandle: 'text', target: 'img', targetHandle: 'prompt' },
            { id: 'a', source: 's1', sourceHandle: 'image', target: 'img', targetHandle: 'references' },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    })
    // Processeur ralenti : c'est là que le bug apparaissait (la liste « @ » redessinait
    // le champ avant que React Flow ait pris le nouveau texte).
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
    await page.goto(`/workflows/${w.id}`)
    const field = node(page, 'text').getByRole('textbox', { name: 'Texte du nœud' })
    await field.click()
    await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(5, 5))
    await page.keyboard.type(' x@image1 milieu', { delay: 0 })
    await expect(field).toHaveValue('debut x@image1 milieu fin')
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  })

  test('navigation : deux doigts ou molette déplacent le canvas, pincer (⌘/Ctrl + molette) zoome', async ({ app, page }) => {
    void app
    const w = await createWorkflow(page, 'Navigation')
    await page.request.patch(`/api/workflows/${w.id}`, {
      data: { graph: { nodes: [{ id: 't', type: 'text', position: { x: 0, y: 0 }, data: {} }], edges: [], viewport: { x: 100, y: 100, zoom: 1 } } },
    })
    await page.goto(`/workflows/${w.id}`)
    await expect(nodes(page)).toHaveCount(1)
    const viewport = () =>
      page.locator('.react-flow__viewport').evaluate((el) => {
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
        return { x: Math.round(m.m41), y: Math.round(m.m42), zoom: Number(m.a.toFixed(3)) }
      })
    const canvas = (await page.getByTestId('workflow-canvas').boundingBox())!
    await page.mouse.move(canvas.x + canvas.width - 80, canvas.y + canvas.height - 80)

    // Défilement vertical puis horizontal : le canvas se déplace, sans zoom.
    await page.mouse.wheel(0, 120)
    await expect.poll(async () => (await viewport()).y).toBeLessThan(100)
    expect((await viewport()).zoom).toBe(1)
    await page.mouse.wheel(120, 0)
    await expect.poll(async () => (await viewport()).x).toBeLessThan(100)
    expect((await viewport()).zoom).toBe(1)

    // Pincement (molette avec Ctrl, ce qu'envoie le trackpad) : zoom.
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -200)
    await page.keyboard.up('Control')
    await expect.poll(async () => (await viewport()).zoom).toBeGreaterThan(1)
  })

  test('molette sur un champ : déplace le canvas tant que le champ n’est pas en édition', async ({ app, page }) => {
    void app
    const w = await createWorkflow(page, 'Molette')
    await page.request.patch(`/api/workflows/${w.id}`, {
      data: { graph: { nodes: [{ id: 't', type: 'text', position: { x: 100, y: 100 }, data: { text: 'un texte' } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } },
    })
    await page.goto(`/workflows/${w.id}`)
    const field = node(page, 'text').getByRole('textbox', { name: 'Texte du nœud' })
    const y = () =>
      page.locator('.react-flow__viewport').evaluate((el) => Math.round(new DOMMatrixReadOnly(getComputedStyle(el).transform).m42))
    const box = (await field.boundingBox())!
    await page.mouse.move(box.x + 20, box.y + 20)
    await page.mouse.wheel(0, 100)
    await expect.poll(y).toBeLessThan(0)
    // En édition, la molette reste au champ.
    await field.click()
    const before = await y()
    await page.mouse.wheel(0, 100)
    await page.waitForTimeout(300)
    expect(await y()).toBe(before)
  })
})
