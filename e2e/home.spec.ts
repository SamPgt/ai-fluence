/** Accueil : salutation, fils à reprendre, dernières générations, workflows à lancer. */
import { expect, test } from './helpers'

test('accueil : reprendre un fil, voir les dernières images, lancer un workflow @core @smoke', async ({ app, page }) => {
  const { thread } = await app.generate({ prompt: 'design nature', count: 3 })
  await app.generate({ prompt: 'variantes de la tour' })
  const w = (await (await page.request.post('/api/workflows', { data: { name: 'Sticker' } })).json()).workflow
  await page.request.patch(`/api/workflows/${w.id}`, {
    data: {
      graph: {
        nodes: [
          { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: 'x', exposed: true, label: 'Sujet' } },
          { id: 'g', type: 'image-gen', position: { x: 300, y: 0 }, data: { family: 'bytedance/seedream-5.0-flash', params: {} } },
        ],
        edges: [{ id: 'a', source: 't', sourceHandle: 'text', target: 'g', targetHandle: 'prompt' }],
      },
    },
  })

  await page.goto('/nouveau')
  await page.getByTestId('thread-panel').getByRole('link', { name: 'Accueil', exact: true }).click()
  await expect(page).toHaveURL(/:\d+\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^(Bonjour|Bonsoir) E2E$/)
  await expect(page.getByText('Fils cette semaine').locator('..')).toContainText('2')
  await expect(page.getByText('Générations', { exact: true }).locator('..')).toContainText('4')
  // Le fil le plus récent d'abord, avec ses images.
  const cards = page.getByTestId('home-thread')
  await expect(cards).toHaveCount(2)
  await expect(cards.first()).toContainText('variantes de la tour')
  // Le premier fil en mosaïque (une seule image ici, deux cases vides), les suivants avec leur dernière image.
  await expect(cards.first().locator('img')).toHaveCount(1)
  await expect(cards.nth(1).locator('img')).toHaveCount(1)
  await expect(page.getByRole('img', { name: 'design nature' })).toHaveCount(3)

  // ▶ : un fil vierge avec le formulaire du workflow.
  await page.getByTestId('home-workflow').click()
  await expect(page).toHaveURL(new RegExp(`/nouveau\\?workflow=${w.id}`))
  await expect(page.getByTestId('workflow-form')).toContainText('Sticker')

  await page.goto('/')
  await cards.nth(1).click()
  await expect(page).toHaveURL(new RegExp(`/t/${thread.id}`))
})

test('accueil d’un compte neuf : les premiers pas à la place des fils', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Premiers pas')).toBeVisible()
  await expect(page.getByTestId('home-thread')).toHaveCount(0)
  await page.getByRole('link', { name: 'Bibliothèque' }).last().click()
  await expect(page).toHaveURL(/\/bibliotheque$/)
})
