/**
 * Listes dans un workflow (faux SpicyAPI) : nœud Liste, câble orange « ×N », génération
 * démultipliée avec sa grille de résultats, devis détaillé.
 */
import type { Page } from '@playwright/test'
import type { WorkflowGraph } from '@sublime/shared'
import { expect, test } from './helpers'

const node = (page: Page, type: string) => page.locator(`[data-testid="workflow-node"][data-node-type="${type}"]`)

const listGraph = (): WorkflowGraph => ({
  nodes: [
    { id: 'l', type: 'list', position: { x: 0, y: 0 }, data: { label: 'Tenues', items: 'robe rouge\njean bleu' } },
    { id: 'img', type: 'image-gen', position: { x: 380, y: 0 }, data: { family: 'bytedance/seedream-5.0-flash', params: {} } },
  ],
  edges: [{ id: 'e1', source: 'l', sourceHandle: 'items', target: 'img', targetHandle: 'lists' }],
})

async function openWorkflow(page: Page, graph: WorkflowGraph) {
  const w = (await (await page.request.post('/api/workflows', { data: { name: 'Listes' } })).json()).workflow
  const res = await page.request.patch(`/api/workflows/${w.id}`, { data: { graph } })
  expect(res.ok(), await res.text()).toBeTruthy()
  await page.goto(`/workflows/${w.id}`)
  await expect(page.getByTestId('workflow-node')).toHaveCount(graph.nodes.length)
  return w
}

test('liste : câble orange ×N, une image par élément dans une grille, devis détaillé @smoke @core', async ({ app, page }) => {
  void app
  await openWorkflow(page, listGraph())
  const list = node(page, 'list')
  const gen = node(page, 'image-gen')
  await expect(list.getByTestId('node-caption')).toHaveText('Tenues')
  await expect(list.getByTestId('list-row')).toHaveCount(2)
  await expect(list.getByTestId('list-count')).toHaveText('2 éléments')
  await expect(page.getByTestId('edge-count')).toHaveText('×2')
  await expect(gen.getByTestId('node-fanout')).toHaveText('×2')
  await expect(gen.getByTestId('port-label-image')).toHaveText('Images ×2')
  // Zone réservée : deux emplacements vides avant toute exécution.
  await expect(gen.getByTestId('lot-item')).toHaveCount(2)

  // Un élément de plus : le câble et la grille suivent.
  const add = list.getByRole('textbox', { name: 'Ajouter un élément' })
  await add.fill('short blanc')
  await add.press('Enter')
  await expect(page.getByTestId('edge-count')).toHaveText('×3')
  await expect(gen.getByTestId('lot-item')).toHaveCount(3)

  await page.getByRole('button', { name: 'Lancer le workflow' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lancer le workflow ?' })
  await expect(dialog.getByTestId('quote-fanout')).toContainText(/Générer une image\s*3 ×/)
  await dialog.getByRole('button', { name: 'Lancer', exact: true }).click()

  await expect(gen).toHaveAttribute('data-status', 'succeeded', { timeout: 15_000 })
  const items = gen.getByTestId('lot-item')
  await expect(items).toHaveCount(3)
  await expect(gen.getByRole('img', { name: 'robe rouge' })).toBeVisible()
  await expect(gen.getByRole('img', { name: 'short blanc' })).toBeVisible()
  await gen.getByRole('button', { name: 'Voir « jean bleu » en grand' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  // Hors d'un fil : la visionneuse ajoute le résultat aux références.
  await page.getByRole('dialog').getByRole('button', { name: 'Ajouter aux références' }).click()
  await page.getByRole('menuitem', { name: 'Général' }).click()
  await expect(page.getByText('Ajoutée aux références : Général')).toBeVisible()
})

/** Tire un lien d'une sortie vers une entrée (glisser à la souris). */
async function link(page: Page, from: { id: string; port: string }, to: { id: string; port: string }) {
  const a = (await page.locator(`.react-flow__node[data-id="${from.id}"]`).getByTestId(`handle-out-${from.port}`).boundingBox())!
  const b = (await page.locator(`.react-flow__node[data-id="${to.id}"]`).getByTestId(`handle-in-${to.port}`).boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 })
  await page.mouse.up()
}

test('entrée Listes : deux listes avancent ensemble, le prompt les cite avec @liste ; un texte y est refusé', async ({ app, page }) => {
  void app
  const graph = listGraph()
  graph.nodes.push(
    { id: 'l2', type: 'list', position: { x: 0, y: 360 }, data: { label: 'Objets', items: 'chapeau\nparapluie\nsac\nlunettes' } },
    { id: 't', type: 'text', position: { x: 0, y: 700 }, data: { text: '' } },
  )
  graph.edges.push({ id: 'e3', source: 't', sourceHandle: 'text', target: 'img', targetHandle: 'prompt' })
  await openWorkflow(page, graph)
  const gen = node(page, 'image-gen')

  // Un texte sur l'entrée Listes : refusé.
  await link(page, { id: 't', port: 'text' }, { id: 'img', port: 'lists' })
  await expect(page.locator('.react-flow__edge')).toHaveCount(2)
  // Une seconde liste : acceptée, numérotée ; la plus longue fixe le nombre de générations.
  await link(page, { id: 'l2', port: 'items' }, { id: 'img', port: 'lists' })
  await expect(page.getByTestId('edge-count')).toHaveText(['1 ·×2', '2 ·×4'])
  await expect(gen.getByTestId('node-fanout')).toHaveText('×4')
  await expect(gen.getByTestId('node-fanout')).toHaveAttribute('title', /Tenues \(2\) reprend au début/)

  // « @ » propose les listes ; @liste2 en orange.
  const text = page.getByRole('textbox', { name: 'Texte du nœud' })
  await text.click()
  await page.keyboard.type('Elle devant @liste1 avec un @')
  await page.getByRole('option', { name: /@liste2\s*Objets/ }).click()
  await expect(page.getByTestId('mention')).toHaveCount(2)
  await expect(page.getByTestId('mention').nth(1)).toHaveAttribute('data-state', 'list')

  await page.getByRole('button', { name: 'Lancer le workflow' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Lancer', exact: true }).click()
  await expect(gen).toHaveAttribute('data-status', 'succeeded', { timeout: 15_000 })
  await expect(gen.getByRole('img', { name: 'jean bleu · parapluie' })).toBeVisible()
  await expect(gen.getByRole('img', { name: 'robe rouge · sac' })).toBeVisible()
})

test('liste : lignes dans le nœud, modale (nom, sélection groupée, actif, Aléatoire)', async ({ app, page }) => {
  void app
  await openWorkflow(page, listGraph())
  const list = node(page, 'list')

  // Entrée crée la ligne suivante ; Retour arrière sur une ligne vide la retire.
  const second = list.getByRole('textbox', { name: 'Élément 2' })
  await second.press('End')
  await second.press('Enter')
  await expect(list.getByTestId('list-row')).toHaveCount(3)
  await page.keyboard.type('plage')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Backspace')
  await expect(list.getByTestId('list-row')).toHaveCount(3)
  await expect(page.getByTestId('edge-count')).toHaveText('×3')

  // Modale : toute la liste, sélection groupée.
  await list.getByRole('button', { name: 'Modifier' }).click()
  const dialog = page.getByTestId('list-editor')
  await expect(dialog.getByTestId('list-editor-row')).toHaveCount(3)
  // Nom facultatif, dans la modale : affiché sous le nœud.
  await dialog.getByRole('textbox', { name: 'Nom de la liste' }).fill('Décors')
  await dialog.getByRole('textbox', { name: 'Nom de la liste' }).press('Enter')
  await expect(list.getByTestId('node-caption')).toHaveText('Décors')
  await dialog.getByRole('checkbox', { name: 'Sélectionner « robe rouge »' }).click()
  await dialog.getByRole('checkbox', { name: 'Sélectionner « jean bleu »' }).click()
  await dialog.getByTestId('list-bulk').getByRole('button', { name: 'Désactiver' }).click()
  await expect(dialog.getByTestId('list-editor-count')).toHaveText('1 actif sur 3')
  await expect(page.getByTestId('edge-count')).toHaveText('×1')
  // Interrupteur d'un élément.
  await dialog.getByRole('switch', { name: 'Activer « jean bleu »' }).click()
  await expect(dialog.getByTestId('list-editor-count')).toHaveText('2 actifs sur 3')
  // Aléatoire : toujours deux actifs.
  await dialog.getByRole('button', { name: 'Aléatoire' }).click()
  await expect(dialog.locator('[data-testid="list-editor-row"][data-active="true"]')).toHaveCount(2)
  // Recherche.
  await dialog.getByRole('textbox', { name: 'Rechercher dans la liste' }).fill('PLAGE')
  await expect(dialog.getByTestId('list-editor-row')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Terminé' }).click()

  // Le nœud ne montre que les actifs ; c'est enregistré.
  await expect(list.getByTestId('list-row')).toHaveCount(2)
  await expect(list.getByTestId('list-count')).toHaveText('2 actifs sur 3')
  await expect
    .poll(async () => {
      const res = await page.request.get(page.url().replace(/.*\/workflows\//, '/api/workflows/'))
      const graph = (await res.json()).workflow.graph as WorkflowGraph
      const data = graph.nodes.find((n) => n.id === 'l')?.data ?? {}
      // Avant l'enregistrement automatique, la liste est encore en texte.
      const items = Array.isArray(data.items) ? (data.items as { active: boolean }[]) : []
      return [data.label, items.filter((i) => i.active).length]
    }, { timeout: 10_000 })
    .toEqual(['Décors', 2])
})

test('liste : importer en collant un texte (remplacer, ajouter à la suite) ; Civitai sans clé', async ({ app, page }) => {
  void app
  await openWorkflow(page, listGraph())
  const list = node(page, 'list')
  await list.getByRole('button', { name: 'Importer' }).click()
  const dialog = page.getByTestId('list-import')
  // Sans clé Civitai (mode test) : un message, aucun appel.
  await expect(dialog).toContainText('Civitai n’est pas configuré')

  await dialog.getByRole('tab', { name: 'Coller' }).click()
  await dialog.getByRole('textbox', { name: 'Texte à importer' }).fill('- plage\n- forêt\n\n3. ville')
  await expect(dialog.getByTestId('list-import-count')).toHaveText('3 éléments')
  await dialog.getByRole('button', { name: 'Remplacer la liste' }).click()
  // Après l'import, la modale montre la liste.
  const editor = page.getByTestId('list-editor')
  await expect(editor.getByTestId('list-editor-row')).toHaveCount(3)
  await expect(editor.getByTestId('list-editor-count')).toHaveText('3 éléments')

  // Ajouter à la suite, depuis la modale : au-delà de 10, 10 activés au hasard.
  await editor.getByRole('button', { name: 'Importer' }).click()
  await dialog.getByRole('tab', { name: 'Coller' }).click()
  await dialog
    .getByRole('textbox', { name: 'Texte à importer' })
    .fill(Array.from({ length: 12 }, (_, i) => `décor ${i + 1}`).join('\n'))
  await expect(dialog.getByTestId('list-import-count')).toHaveText('12 éléments, 10 activés au hasard')
  await dialog.getByRole('button', { name: 'Ajouter à la suite' }).click()
  await expect(editor.getByTestId('list-editor-count')).toHaveText('13 actifs sur 15')
  await editor.getByRole('button', { name: 'Terminé' }).click()
  await expect(page.getByTestId('edge-count')).toHaveText('×13')
})
