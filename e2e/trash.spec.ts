/**
 * Corbeille (/corbeille) : liste, restauration, suppression définitive (avec
 * le mot « confirmer ») et « Annuler » du toast après une mise à la corbeille.
 */
import { sql } from './db'
import { expect, test, type App } from './helpers'
import { hydrated } from './support-auth'

async function gotoTrash(app: App) {
  await app.page.goto('/corbeille')
  await hydrated(app.page)
  await expect(app.page.getByText(/Tout élément supprimé est conservé ici pendant 7 jours/)).toBeVisible()
}

const row = (app: App, title: string) => app.page.getByTestId('trash-row').filter({ hasText: title })

/** Un fil seul et un persona avec un fil, tous à la corbeille. */
async function seedTrash(app: App) {
  const loose = (await app.generate({ prompt: 'fil perdu' })).thread
  const persona = await app.createPersona({ name: 'Bérénice' })
  const owned = (await app.generate({ prompt: 'fil de berenice', personaId: persona.id })).thread
  await app.trashThread(loose.id)
  expect((await app.page.request.delete(`/api/personas/${persona.id}`)).ok()).toBeTruthy()
  return { loose, persona, owned }
}

test('la corbeille vide l’annonce, sans bouton pour la vider', async ({ app, page }) => {
  await gotoTrash(app)
  await expect(page.getByText('La corbeille est vide.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Vider la corbeille' })).toHaveCount(0)
})

test('la corbeille est accessible depuis le menu utilisateur', async ({ app, page }) => {
  await app.gotoNew()
  await page.getByRole('button', { name: 'Menu utilisateur' }).click()
  await page.getByRole('menuitem', { name: 'Corbeille' }).click()
  await expect(page).toHaveURL(/\/corbeille$/)
  await expect(page.getByText('La corbeille est vide.')).toBeVisible()
})

test('un fil et un persona (avec ses fils) à la corbeille sont listés', async ({ app, page }) => {
  await seedTrash(app)
  await gotoTrash(app)
  await expect(page.getByRole('heading', { name: 'Personas' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Fils' })).toBeVisible()
  await expect(row(app, 'Bérénice')).toContainText('1 fil · Supprimé définitivement dans 7 jours')
  await expect(row(app, 'fil perdu')).toContainText('Supprimé définitivement dans 7 jours')
  // Le fil parti avec son persona est rangé sous le persona, pas dans « Fils ».
  await expect(row(app, 'fil de berenice')).toHaveCount(0)
  await expect(page.getByTestId('trash-row')).toHaveCount(2)
  // Rien de tout ça dans la liste des fils ni dans la barre des personas.
  await expect(page.getByTestId('thread-panel').getByText('Aucun fil pour l’instant.')).toBeVisible()
  await expect(page.getByLabel('Bérénice', { exact: true })).toHaveCount(0)
})

test('restaurer un fil le remet dans la liste des fils @core', async ({ app, page }) => {
  const { loose } = await seedTrash(app)
  await gotoTrash(app)
  await row(app, 'fil perdu').getByRole('button', { name: 'Restaurer' }).click()
  await expect(page.getByText('fil perdu restauré')).toBeVisible()
  await expect(row(app, 'fil perdu')).toHaveCount(0)
  await expect(row(app, 'Bérénice')).toBeVisible()
  const link = page.getByTestId('thread-panel').getByRole('link', { name: /fil perdu/ })
  await expect(link).toBeVisible()
  await link.click()
  await expect(page).toHaveURL(new RegExp(`/t/${loose.id}`))
  expect(sql(`SELECT deleted_at IS NULL FROM threads WHERE id = '${loose.id}'`)).toBe('t')
})

test('restaurer un persona fait revenir ses fils @core', async ({ app, page }) => {
  const { persona, owned } = await seedTrash(app)
  await gotoTrash(app)
  await row(app, 'Bérénice').getByRole('button', { name: 'Restaurer' }).click()
  await expect(page.getByText('Bérénice restauré')).toBeVisible()
  await expect(row(app, 'Bérénice')).toHaveCount(0)

  // Le persona revient dans la barre, avec son fil.
  await app.selectPersona('Bérénice')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('thread-panel').getByRole('link', { name: /fil de berenice/ })).toBeVisible()
  expect(sql(`SELECT deleted_at IS NULL FROM personas WHERE id = '${persona.id}'`)).toBe('t')
  expect(sql(`SELECT deleted_at IS NULL FROM threads WHERE id = '${owned.id}'`)).toBe('t')
})

test('la suppression définitive demande d’écrire « confirmer » et retire l’élément @core', async ({ app, page }) => {
  const { loose } = await seedTrash(app)
  await gotoTrash(app)
  await row(app, 'fil perdu').getByRole('button', { name: 'Supprimer définitivement' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Supprimer définitivement « fil perdu » ?' })).toBeVisible()
  const confirm = dialog.getByRole('button', { name: 'Supprimer définitivement' })
  const word = dialog.getByLabel('Écris confirmer')
  await expect(word).toBeFocused()
  await expect(confirm).toBeDisabled()
  await word.fill('confirm')
  await expect(confirm).toBeDisabled()
  // Entrée sans le bon mot : rien ne part.
  await word.press('Enter')
  await expect(dialog).toBeVisible()
  await word.fill('confirmer')
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(dialog).toBeHidden()
  await expect(row(app, 'fil perdu')).toHaveCount(0)
  await expect(row(app, 'Bérénice')).toBeVisible()
  expect(sql(`SELECT count(*) FROM threads WHERE id = '${loose.id}'`)).toBe('0')
})

test('le mot de confirmation ignore la casse et Entrée valide', async ({ app, page }) => {
  const { persona, owned } = await seedTrash(app)
  await gotoTrash(app)
  await row(app, 'Bérénice').getByRole('button', { name: 'Supprimer définitivement' }).click()
  const word = page.getByRole('dialog').getByLabel('Écris confirmer')
  await word.fill('  CONFIRMER ')
  await word.press('Enter')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(row(app, 'Bérénice')).toHaveCount(0)
  // Le persona part avec ses fils.
  expect(sql(`SELECT count(*) FROM personas WHERE id = '${persona.id}'`)).toBe('0')
  expect(sql(`SELECT count(*) FROM threads WHERE id = '${owned.id}'`)).toBe('0')
})

test('annuler la suppression définitive garde l’élément et vide le champ', async ({ app, page }) => {
  await seedTrash(app)
  await gotoTrash(app)
  const button = row(app, 'fil perdu').getByRole('button', { name: 'Supprimer définitivement' })
  await button.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Écris confirmer').fill('confirmer')
  await dialog.getByRole('button', { name: 'Annuler' }).click()
  await expect(dialog).toBeHidden()
  await expect(row(app, 'fil perdu')).toBeVisible()
  // À la réouverture, le champ repart vide.
  await button.click()
  await expect(dialog.getByLabel('Écris confirmer')).toHaveValue('')
  await expect(dialog.getByRole('button', { name: 'Supprimer définitivement' })).toBeDisabled()
})

test('« Vider la corbeille » supprime tout, après « confirmer »', async ({ app, page }) => {
  const { loose, persona, owned } = await seedTrash(app)
  const kept = (await app.generate({ prompt: 'fil garde' })).thread
  await gotoTrash(app)
  await page.getByRole('button', { name: 'Vider la corbeille' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Vider la corbeille ?' })).toBeVisible()
  const confirm = dialog.getByRole('button', { name: 'Vider la corbeille' })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel('Écris confirmer').fill('confirmer')
  await confirm.click()
  await expect(page.getByText('Corbeille vidée')).toBeVisible()
  await expect(page.getByText('La corbeille est vide.')).toBeVisible()
  await expect(page.getByTestId('trash-row')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Vider la corbeille' })).toHaveCount(0)
  expect(sql(`SELECT count(*) FROM threads WHERE id IN ('${loose.id}', '${owned.id}')`)).toBe('0')
  expect(sql(`SELECT count(*) FROM personas WHERE id = '${persona.id}'`)).toBe('0')
  // Ce qui n'était pas à la corbeille reste.
  expect(sql(`SELECT count(*) FROM threads WHERE id = '${kept.id}'`)).toBe('1')
})

test('« Annuler » du toast restaure le fil mis à la corbeille depuis la liste', async ({ app, page }) => {
  const { thread } = await app.generate({ prompt: 'fil a sauver' })
  await app.gotoNew()
  await app.trashFromList('fil a sauver')
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Fil mis à la corbeille' })
  await expect(toast).toBeVisible()
  await expect(page.getByTestId('thread-panel').getByRole('link', { name: /fil a sauver/ })).toHaveCount(0)
  await toast.getByRole('button', { name: 'Annuler' }).click()
  await expect(page.getByTestId('thread-panel').getByRole('link', { name: /fil a sauver/ })).toBeVisible()
  expect(sql(`SELECT deleted_at IS NULL FROM threads WHERE id = '${thread.id}'`)).toBe('t')
  await gotoTrash(app)
  await expect(page.getByText('La corbeille est vide.')).toBeVisible()
})

test('un fil mis à la corbeille depuis la liste apparaît dans la corbeille', async ({ app, page }) => {
  await app.generate({ prompt: 'fil jete' })
  await app.gotoNew()
  await app.trashFromList('fil jete')
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Fil mis à la corbeille' })).toBeVisible()
  await gotoTrash(app)
  await expect(row(app, 'fil jete')).toBeVisible()
})
