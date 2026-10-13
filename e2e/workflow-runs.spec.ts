/**
 * Exécution d'un workflow depuis le canvas (faux SpicyAPI) : devis, lancement,
 * résultats dans les nœuds, historique et résultat actif, échec, galerie.
 */
import type { Page } from '@playwright/test'
import type { Workflow, WorkflowGraph } from '@ai-fluence/shared'
import { expect, test } from './helpers'

const node = (page: Page, type: string) => page.locator(`[data-testid="workflow-node"][data-node-type="${type}"]`)

const chain = (prompt: string): WorkflowGraph => ({
  nodes: [
    { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: prompt } },
    { id: 'img', type: 'image-gen', position: { x: 380, y: 0 }, data: { family: 'bytedance/seedream-5.0-flash', params: {} } },
    { id: 'vid', type: 'video-gen', position: { x: 760, y: 0 }, data: { family: 'bytedance/seedance-2.0-mini', params: {} } },
  ],
  edges: [
    { id: 'e1', source: 't', sourceHandle: 'text', target: 'img', targetHandle: 'prompt' },
    { id: 'e2', source: 't', sourceHandle: 'text', target: 'vid', targetHandle: 'prompt' },
    { id: 'e3', source: 'img', sourceHandle: 'image', target: 'vid', targetHandle: 'start' },
  ],
})

async function openWorkflow(page: Page, graph: WorkflowGraph): Promise<Workflow> {
  const w = (await (await page.request.post('/api/workflows', { data: { name: 'Exécution' } })).json()).workflow
  const res = await page.request.patch(`/api/workflows/${w.id}`, { data: { graph } })
  expect(res.ok(), await res.text()).toBeTruthy()
  await page.goto(`/workflows/${w.id}`)
  await expect(page.getByTestId('workflow-node')).toHaveCount(graph.nodes.length)
  return w
}

test('▶ Lancer : devis, puis image et vidéo dans leurs nœuds, puis en galerie @core', async ({ app, page }) => {
  void app
  await openWorkflow(page, chain('une pomme rouge'))
  await page.getByRole('button', { name: 'Lancer le workflow' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lancer le workflow ?' })
  await expect(dialog).toContainText('2 étapes, dans l’ordre des liens')
  await expect(dialog).toContainText('≈ 0,02 $')
  await dialog.getByRole('button', { name: 'Lancer', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  await expect(node(page, 'image-gen')).toHaveAttribute('data-status', 'succeeded', { timeout: 15_000 })
  await expect(node(page, 'video-gen')).toHaveAttribute('data-status', 'succeeded', { timeout: 15_000 })
  await expect(node(page, 'image-gen').getByRole('img', { name: 'Résultat' })).toBeVisible()
  await expect(node(page, 'video-gen').getByRole('button', { name: 'Voir le résultat en grand' })).toBeVisible()
  await expect(page.getByText('Workflow terminé')).toBeVisible()

  await page.goto('/galerie')
  await expect(page.getByTestId('gallery-item')).toHaveCount(2)
  await expect(page.getByTestId('gallery-item').first()).toContainText('Workflow')
})

test('▶ d’un nœud : un nouveau résultat s’ajoute à l’historique ; une vignette choisit le résultat actif', async ({
  app,
  page,
}) => {
  void app
  const w = await openWorkflow(page, chain('un chat'))
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Lancer le nœud Générer une image' }).click()
    const dialog = page.getByRole('dialog', { name: 'Lancer ce nœud ?' })
    await expect(dialog).toContainText('1 étape, dans l’ordre des liens')
    await dialog.getByRole('button', { name: 'Lancer', exact: true }).click()
    await expect(page.getByText('Workflow terminé')).toBeVisible({ timeout: 15_000 })
    await page.getByText('Workflow terminé').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  }
  const history = node(page, 'image-gen').getByRole('button', { name: 'Utiliser ce résultat' })
  await expect(history).toHaveCount(2)
  await expect(history.first()).toHaveAttribute('aria-pressed', 'true')
  await history.last().click()
  await expect(history.last()).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(async () => {
      const graph = (await (await page.request.get(`/api/workflows/${w.id}`)).json()).workflow.graph as WorkflowGraph
      return typeof graph.nodes.find((n) => n.id === 'img')?.data.activeResultId
    })
    .toBe('string')
  // La vidéo n'a pas été lancée.
  await expect(node(page, 'video-gen')).not.toHaveAttribute('data-status')
})

test('une étape en échec : message dans le nœud, la suite ne part pas', async ({ app, page }) => {
  void app
  await openWorkflow(page, chain('raté FAIL_TEST'))
  await page.getByRole('button', { name: 'Lancer le workflow' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Lancer', exact: true }).click()
  await expect(node(page, 'image-gen')).toHaveAttribute('data-status', 'failed', { timeout: 15_000 })
  await expect(node(page, 'image-gen').getByRole('alert')).toBeVisible()
  await expect(node(page, 'video-gen')).toHaveAttribute('data-status', 'skipped')
  await expect(node(page, 'video-gen').getByRole('alert')).toContainText('Une étape précédente a échoué.')
  await expect(page.getByText(/terminée avec des erreurs/)).toBeVisible()
})

test('devis refusé : la raison s’affiche, rien ne part', async ({ app, page }) => {
  void app
  const graph = chain('sans modèle')
  graph.nodes[1].data = { params: {} }
  await openWorkflow(page, graph)
  await page.getByRole('button', { name: 'Lancer le workflow' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('« Générer une image » : Choisis un modèle.')
  await expect(dialog.getByRole('button', { name: 'Lancer', exact: true })).toBeDisabled()
})

test('nœud Résultat : affiche la sortie finale ; la notification de fin y mène @core', async ({ app, page }) => {
  void app
  const graph = chain('une plage')
  graph.nodes.push({ id: 'out', type: 'output', position: { x: 1140, y: 0 }, data: {} })
  graph.edges.push({ id: 'e4', source: 'img', sourceHandle: 'image', target: 'out', targetHandle: 'images' })
  graph.edges.push({ id: 'e5', source: 'vid', sourceHandle: 'video', target: 'out', targetHandle: 'videos' })
  await openWorkflow(page, graph)
  const output = node(page, 'output')
  await expect(output).toContainText('Résultat final du workflow.')

  await page.getByRole('button', { name: 'Lancer le workflow' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Lancer', exact: true }).click()
  await expect(page.getByText('Workflow terminé')).toBeVisible({ timeout: 15_000 })
  await expect(output.getByRole('button', { name: 'Voir le résultat final en grand' })).toBeVisible()
  // Image puis vidéo : deux résultats finaux, avec les flèches.
  await expect(output).toContainText('1 / 2')
  await output.getByRole('button', { name: 'Résultat suivant' }).click()
  await expect(output).toContainText('2 / 2')
  await page.getByRole('button', { name: 'Voir le résultat', exact: true }).click()
  await expect(output).toBeInViewport()
})

test('liens d’images numérotés quand plusieurs arrivent sur une même entrée (n → 1)', async ({ app, page }) => {
  void app
  const graph: WorkflowGraph = {
    nodes: [
      { id: 's1', type: 'image-source', position: { x: 0, y: 0 }, data: { assetIds: ['a1'] } },
      { id: 's2', type: 'image-source', position: { x: 0, y: 360 }, data: { assetIds: ['a2'] } },
      { id: 'img', type: 'image-gen', position: { x: 420, y: 0 }, data: { params: {} } },
      { id: 'vid', type: 'video-gen', position: { x: 840, y: 0 }, data: { params: {} } },
    ],
    edges: [
      { id: 'a', source: 's1', sourceHandle: 'image', target: 'img', targetHandle: 'references' },
      { id: 'b', source: 's2', sourceHandle: 'image', target: 'img', targetHandle: 'references' },
      // Un seul lien sur cette entrée : pas de numéro.
      { id: 'c', source: 's2', sourceHandle: 'image', target: 'vid', targetHandle: 'start' },
    ],
  }
  await openWorkflow(page, graph)
  await expect(page.getByTestId('edge-number')).toHaveText(['1', '2'])
  // Chaque numéro est au départ de son câble, près de l'image qu'il désigne.
  const badge = (await page.getByTestId('edge-number').first().boundingBox())!
  const source = (await node(page, 'image-source').first().getByTestId('handle-out-image').boundingBox())!
  expect(Math.abs(badge.y + badge.height / 2 - (source.y + source.height / 2))).toBeLessThan(4)
  expect(badge.x - source.x).toBeLessThan(40)
})

test('le nœud Résultat n’a pas de carte en dessous de la sienne', async ({ app, page }) => {
  void app
  await openWorkflow(page, { nodes: [{ id: 'out', type: 'output', position: { x: 0, y: 0 }, data: {} }], edges: [] })
  const wrapper = page.locator('.react-flow__node-output')
  await expect(wrapper).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(wrapper).toHaveCSS('border-top-width', '0px')
  expect((await wrapper.boundingBox())!.width).toBe((await node(page, 'output').boundingBox())!.width)
  // Sélectionné : seule la bordure arrondie du nœud change, pas de cadre carré autour.
  await node(page, 'output').getByText('Résultat', { exact: true }).click()
  await expect(wrapper).toHaveClass(/selected/)
  await expect(wrapper).toHaveCSS('box-shadow', 'none')
  await expect(wrapper).toHaveCSS('outline-style', 'none')
  await expect(wrapper).toHaveCSS('border-top-width', '0px')
})

test('mentions : « @ » propose les images reçues, @image2 en bleu, une image inconnue en rouge', async ({ app, page }) => {
  void app
  await openWorkflow(page, {
    nodes: [
      { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: '' } },
      { id: 's1', type: 'image-source', position: { x: 0, y: 260 }, data: { assetIds: ['a1'] } },
      { id: 's2', type: 'image-source', position: { x: 0, y: 620 }, data: { assetIds: ['a2'] } },
      { id: 'img', type: 'image-gen', position: { x: 420, y: 0 }, data: { params: {} } },
    ],
    edges: [
      { id: 'p', source: 't', sourceHandle: 'text', target: 'img', targetHandle: 'prompt' },
      { id: 'a', source: 's1', sourceHandle: 'image', target: 'img', targetHandle: 'references' },
      { id: 'b', source: 's2', sourceHandle: 'image', target: 'img', targetHandle: 'references' },
    ],
  })
  const text = node(page, 'text')
  await expect(text).toContainText('Tape @ pour citer une image (1 à 2).')
  const field = text.getByRole('textbox', { name: 'Texte du nœud' })
  await field.click()
  await page.keyboard.type('colle le logo @')
  const list = page.getByRole('listbox', { name: 'Images à citer' })
  await expect(list.getByRole('option')).toHaveText([/@image1\s*Image source/, /@image2\s*Image source/])
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue('colle le logo @image2 ')
  await expect(list).toHaveCount(0)
  await page.keyboard.type('sur @image5')
  const mentions = text.getByTestId('mention')
  await expect(mentions).toHaveText(['@image2', '@image5'])
  await expect(mentions.first()).toHaveAttribute('data-known', 'true')
  await expect(mentions.last()).not.toHaveAttribute('data-known')
  await expect(mentions.first()).toHaveCSS('font-weight', '400')
})

test('Texte IA puis Décrire : le texte produit s’affiche dans le nœud et nourrit la suite @core', async ({ app, page }) => {
  void app
  await openWorkflow(page, {
    nodes: [
      { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: 'une plage' } },
      { id: 'l', type: 'llm', position: { x: 380, y: 0 }, data: { instruction: 'ajoute un coucher de soleil' } },
      { id: 'img', type: 'image-gen', position: { x: 760, y: 0 }, data: { family: 'bytedance/seedream-5.0-flash', params: {} } },
      { id: 'd', type: 'describe', position: { x: 1140, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'a', source: 't', sourceHandle: 'text', target: 'l', targetHandle: 'text' },
      { id: 'b', source: 'l', sourceHandle: 'text', target: 'img', targetHandle: 'prompt' },
      { id: 'c', source: 'img', sourceHandle: 'image', target: 'd', targetHandle: 'images' },
    ],
  })
  await page.getByRole('button', { name: 'Lancer le workflow' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lancer le workflow ?' })
  await expect(dialog).toContainText('3 étapes')
  await dialog.getByRole('button', { name: 'Lancer', exact: true }).click()
  await expect(node(page, 'describe')).toHaveAttribute('data-status', 'succeeded', { timeout: 15_000 })
  await expect(node(page, 'llm').getByTestId('node-text-result')).toContainText('ajoute un coucher de soleil')
  await expect(node(page, 'describe').getByTestId('node-text-result')).toHaveText('Description simulée de 1 image.')
  await expect(node(page, 'image-gen')).toHaveAttribute('data-status', 'succeeded')
})

test('Stop : bulle à gauche de Lancer pendant l’exécution ; les étapes en attente ne partent pas', async ({ app, page }) => {
  void app
  await openWorkflow(page, chain('lente SLOW_TEST'))
  const stop = page.getByRole('button', { name: 'Arrêter l’exécution' })
  await expect(stop).toHaveCount(0)
  await page.getByRole('button', { name: 'Lancer le workflow' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Lancer', exact: true }).click()
  await expect(stop).toBeVisible()
  // À gauche du bouton Lancer.
  const [s, l] = [(await stop.boundingBox())!, (await page.getByRole('button', { name: 'Lancer le workflow' }).boundingBox())!]
  expect(s.x + s.width).toBeLessThanOrEqual(l.x)
  await stop.click()
  await expect(page.getByText(/Exécution arrêtée : les étapes en attente/)).toBeVisible()
  await expect(stop).toHaveCount(0)
  await expect(node(page, 'video-gen')).toHaveAttribute('data-status', 'skipped')
  await expect(node(page, 'video-gen').getByRole('alert')).toContainText('Exécution arrêtée.')
})

test('prix calculé en arrière-plan : la fenêtre de lancement l’a aussitôt, sans prix sur le bouton', async ({ app, page }) => {
  void app
  // Le devis part dès l'ouverture, sans clic.
  const quoted = page.waitForResponse((r) => r.url().includes('/quote') && r.ok())
  await openWorkflow(page, chain('une pomme'))
  await quoted
  const run = page.getByRole('button', { name: 'Lancer le workflow' })
  await expect(run).not.toContainText('$')
  // Écrire dans le texte ne relance pas le calcul.
  let quotes = 0
  page.on('request', (r) => {
    if (r.url().includes('/quote')) quotes++
  })
  await node(page, 'text').getByRole('textbox', { name: 'Texte du nœud' }).fill('une poire bien mûre')
  await page.waitForTimeout(1500)
  expect(quotes).toBe(0)
  // Au clic : le prix est déjà là, aucun calcul en attente.
  await run.click()
  await expect(page.getByRole('dialog')).toContainText('≈ 0,02 $', { timeout: 300 })
  expect(quotes).toBe(0)
})
