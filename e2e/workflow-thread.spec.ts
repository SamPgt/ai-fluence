/**
 * Workflows dans un fil : entrées « À fournir » dans l'éditeur, formulaire au-dessus du
 * composer, exécution affichée dans le fil.
 */
import type { Page } from '@playwright/test'
import type { Workflow, WorkflowGraph } from '@sublime/shared'
import { expect, FIXTURE_IMAGE, test } from './helpers'

const node = (page: Page, type: string) => page.locator(`[data-testid="workflow-node"][data-node-type="${type}"]`)

async function createWorkflow(page: Page, name: string, graph: WorkflowGraph): Promise<Workflow> {
  const w = (await (await page.request.post('/api/workflows', { data: { name } })).json()).workflow
  const res = await page.request.patch(`/api/workflows/${w.id}`, { data: { graph } })
  expect(res.ok(), await res.text()).toBeTruthy()
  return w
}

const usable = (): WorkflowGraph => ({
  nodes: [
    { id: 't', type: 'text', position: { x: 0, y: 200 }, data: { text: '', exposed: true, label: 'Sujet' } },
    { id: 's', type: 'image-source', position: { x: 0, y: 0 }, data: { assetIds: [], exposed: true, label: 'Photo du produit' } },
    { id: 'g', type: 'image-gen', position: { x: 420, y: 0 }, data: { family: 'bytedance/seedream-5.0-flash', params: {} } },
  ],
  edges: [
    { id: 'a', source: 't', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' },
    { id: 'b', source: 's', sourceHandle: 'image', target: 'g', targetHandle: 'references' },
  ],
})

test('éditeur : « À fournir au lancement » demande un libellé et marque le nœud « Entrée »', async ({ app, page }) => {
  void app
  const w = await createWorkflow(page, 'Entrées', {
    nodes: [{ id: 't', type: 'text', position: { x: 60, y: 40 }, data: { text: 'défaut' } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  })
  await page.goto(`/workflows/${w.id}`)
  const text = node(page, 'text')
  await expect(text).not.toContainText('Entrée')
  await text.getByRole('switch', { name: 'À fournir au lancement' }).click()
  await expect(text).toContainText('Entrée')
  const label = text.getByRole('textbox', { name: 'Libellé du champ' })
  await label.fill('Ce que dit le personnage')
  await expect
    .poll(async () => (await (await page.request.get(`/api/workflows/${w.id}`)).json()).workflow.graph.nodes[0].data)
    .toMatchObject({ exposed: true, label: 'Ce que dit le personnage', text: 'défaut' })
})

test('fil : l’icône Workflow ouvre le formulaire, Lancer affiche le résultat dans un nouveau fil @core @smoke', async ({
  app,
  page,
}) => {
  await createWorkflow(page, 'Sticker', usable())
  await app.gotoNew()
  await expect(page.getByRole('button', { name: 'Raccourci' })).toBeVisible()
  await page.getByRole('button', { name: 'Lancer un workflow' }).click()
  await page.locator('[data-slot=popover-content]').getByRole('button', { name: /Sticker/ }).click()

  const form = page.getByTestId('workflow-form')
  await expect(form).toContainText('Sticker')
  // Le formulaire prend la place des raccourcis.
  await expect(page.getByRole('button', { name: 'Raccourci' })).toHaveCount(0)
  await expect(form).toContainText('2 champs à remplir')
  await expect(form.getByRole('button', { name: 'Lancer' })).toBeDisabled()
  // Prix fixe : calculé une fois à l'ouverture, pas pendant la saisie.
  let quotes = 0
  page.on('request', (r) => {
    if (r.url().includes('/quote')) quotes++
  })
  await form.getByTestId('workflow-input-file-s').setInputFiles(FIXTURE_IMAGE)
  await expect(form.getByRole('img', { name: 'Photo du produit 1' })).toBeVisible()
  await expect(form).toContainText('output.png')
  await expect(form).toContainText('1 champ à remplir')
  // Une seule image au maximum : plus de zone d'ajout.
  await expect(form.getByText(/Glissez/)).toHaveCount(0)
  await form.getByRole('textbox', { name: 'Sujet' }).fill('un chat roux')
  await expect(form).toContainText('Prêt · ≈ 0,01 $')
  expect(quotes).toBe(0)
  await form.getByRole('button', { name: 'Lancer' }).click()

  await expect(page).toHaveURL(/\/t\//)
  const run = page.getByTestId('workflow-run')
  await expect(run).toContainText('Sticker')
  await expect(run).toContainText('un chat roux')
  await expect(run).toHaveAttribute('data-status', 'succeeded', { timeout: 15_000 })
  await expect(run.getByRole('img', { name: 'Résultat du workflow' })).toBeVisible()
  await expect(form).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Raccourci' })).toBeVisible()
  // Le résultat se supprime comme celui d'une génération (Annuler le remet).
  await run.getByRole('button', { name: 'Options du résultat' }).click()
  await page.getByRole('menuitem', { name: 'Supprimer le résultat' }).click()
  await expect(run.getByTestId('removed-result')).toHaveText('Contenu supprimé')
  await expect(run.getByRole('img', { name: 'Résultat du workflow' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Annuler' }).click()
  await expect(run.getByRole('img', { name: 'Résultat du workflow' })).toBeVisible()
})

test('fil : sans workflow utilisable, la liste explique comment en préparer un', async ({ app, page }) => {
  await createWorkflow(page, 'Sans entrée', { nodes: [{ id: 't', type: 'text', position: { x: 0, y: 0 }, data: {} }], edges: [] })
  await app.gotoNew()
  await page.getByRole('button', { name: 'Lancer un workflow' }).click()
  await expect(page.locator('[data-slot=popover-content]')).toContainText('Aucun workflow utilisable ici')
})

test('éditeur : @image d’une entrée « À fournir » en jaune (fournie au lancement), pas en rouge', async ({ app, page }) => {
  void app
  const w = await createWorkflow(page, 'Mentions', {
    nodes: [
      { id: 't', type: 'text', position: { x: 60, y: 40 }, data: { text: 'logo @image1 et @image2' } },
      { id: 's', type: 'image-source', position: { x: 60, y: 360 }, data: { assetIds: [], exposed: true, label: 'Logo d’origine' } },
      { id: 'g', type: 'image-gen', position: { x: 480, y: 40 }, data: { params: {} } },
    ],
    edges: [
      { id: 'a', source: 't', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' },
      { id: 'b', source: 's', sourceHandle: 'image', target: 'g', targetHandle: 'references' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  })
  await page.goto(`/workflows/${w.id}`)
  const mentions = node(page, 'text').getByTestId('mention')
  await expect(mentions).toHaveText(['@image1', '@image2'])
  await expect(mentions.first()).toHaveAttribute('data-state', 'pending')
  await expect(mentions.last()).toHaveAttribute('data-state', 'unknown')
  // La liste « @ » le précise.
  const field = node(page, 'text').getByRole('textbox', { name: 'Texte du nœud' })
  await field.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' @')
  await expect(page.getByRole('listbox', { name: 'Images et listes à citer' })).toContainText('Logo d’origine · fournie au lancement')
})

test('éditeur : « Max » règle le nombre d’images d’une entrée, le formulaire en accepte autant', async ({ app, page }) => {
  const w = await createWorkflow(page, 'Deux images', {
    nodes: [
      { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: 'colle', exposed: true, label: 'Consigne' } },
      { id: 's', type: 'image-source', position: { x: 0, y: 300 }, data: { assetIds: [], exposed: true, label: 'Logos' } },
      { id: 'g', type: 'image-gen', position: { x: 420, y: 0 }, data: { family: 'bytedance/seedream-5.0-flash', params: {} } },
    ],
    edges: [
      { id: 'a', source: 't', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' },
      { id: 'b', source: 's', sourceHandle: 'image', target: 'g', targetHandle: 'references' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  })
  await page.goto(`/workflows/${w.id}`)
  const source = node(page, 'image-source')
  await expect(source.getByTestId('max-images')).toHaveText('1')
  await source.getByRole('button', { name: 'Une image de plus' }).click()
  await expect(source.getByTestId('max-images')).toHaveText('2')
  await expect
    .poll(async () => (await (await page.request.get(`/api/workflows/${w.id}`)).json()).workflow.graph.nodes[1].data.maxImages)
    .toBe(2)

  await app.gotoNew()
  await page.getByRole('button', { name: 'Lancer un workflow' }).click()
  await page.locator('[data-slot=popover-content]').getByRole('button', { name: /Deux images/ }).click()
  const form = page.getByTestId('workflow-form')
  await expect(form).toContainText('jusqu’à 2 images')
  await expect(form.getByText('Glissez jusqu’à 2 images ici')).toBeVisible()
  await form.getByTestId('workflow-input-file-s').setInputFiles(FIXTURE_IMAGE)
  await expect(form.getByText('Glissez une image ici')).toBeVisible()
})
