/**
 * Paramètres (/parametres) : onglets Compte, Raccourcis, Crédits, Stockage et
 * Clés API. Le compte e2e est partagé : chaque test le remet en état ensuite.
 */
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DATA_DIR } from './env'
import { resetData, sql } from './db'
import { expect, FIXTURE_IMAGE, test } from './helpers'
import { E2E_KEY, gotoSettings, hydrated, restoreSharedUser } from './support-auth'

const ME = "(SELECT id FROM users WHERE email = 'e2e@ai-fluence.test')"

// Données vides au départ, même pour les tests sans le fixture `app`.
test.beforeEach(() => resetData())

test.afterEach(async ({ page }) => {
  await restoreSharedUser(page.request)
})

test('les onglets sont Compte, Raccourcis, Crédits, Stockage et Clés API, rien d’autre @core', async ({ page }) => {
  await gotoSettings(page)
  await expect(page.getByRole('tab')).toHaveText(['Compte', 'Raccourcis', 'Crédits', 'Stockage', 'Clés API'])
  for (const absent of ['Modèles', 'Logo', 'Couleur']) {
    await expect(page.getByRole('tab', { name: absent })).toHaveCount(0)
  }
  // Compte est l'onglet par défaut, et l'onglet choisi passe dans l'URL.
  await expect(page.getByRole('tab', { name: 'Compte' })).toHaveAttribute('data-state', 'active')
  await page.getByRole('tab', { name: 'Stockage' }).click()
  await expect(page).toHaveURL(/tab=storage/)
  await expect(page.getByText('Dossier des médias')).toBeVisible()
})

test.describe('Compte', () => {
  test('changer le nom le met à jour partout, même après rechargement @core', async ({ page }) => {
    await gotoSettings(page, 'account')
    const name = page.getByLabel('Nom', { exact: true })
    await expect(name).toHaveValue('E2E')
    const save = page.getByRole('button', { name: 'Enregistrer' })
    await expect(save).toBeDisabled()
    await name.fill('Marie Curie')
    await save.click()
    await expect(page.getByText('Compte mis à jour')).toBeVisible()
    await expect(save).toBeDisabled()

    // Initiales dans la barre et nom dans le menu utilisateur.
    const menu = page.getByRole('button', { name: 'Menu utilisateur' })
    await expect(menu).toHaveText('MC')
    await menu.click()
    await expect(page.getByRole('menu')).toContainText('Marie Curie')
    await page.keyboard.press('Escape')

    await page.reload()
    await hydrated(page)
    await expect(page.getByLabel('Nom', { exact: true })).toHaveValue('Marie Curie')
    expect(sql("SELECT name FROM users WHERE email = 'e2e@ai-fluence.test'")).toBe('Marie Curie')
  })

  test('un nom vide ne peut pas être enregistré', async ({ page }) => {
    await gotoSettings(page, 'account')
    await page.getByLabel('Nom', { exact: true }).fill('   ')
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
  })

  test('envoyer une photo de profil l’affiche, et Retirer l’enlève', async ({ page }) => {
    await gotoSettings(page, 'account')
    const avatar = page.getByRole('button', { name: 'Changer la photo de profil' })
    await expect(avatar.locator('img')).toHaveCount(0)
    await page.locator('input[type=file]').setInputFiles(FIXTURE_IMAGE)
    await expect(page.getByText('Compte mis à jour')).toBeVisible()
    await expect(avatar.locator('img')).toHaveAttribute('src', /\/api\/media\//)
    // L'image s'affiche réellement (chargée par le navigateur).
    await expect
      .poll(() => avatar.locator('img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true)
    await expect(page.getByRole('button', { name: 'Menu utilisateur' }).locator('img')).toBeVisible()

    await page.reload()
    await hydrated(page)
    await expect(avatar.locator('img')).toBeVisible()

    await page.getByRole('button', { name: 'Retirer' }).click()
    await expect(avatar.locator('img')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Menu utilisateur' })).toHaveText('E')
  })
})

test.describe('Raccourcis', () => {
  test('créer, modifier, masquer, réafficher puis supprimer un raccourci @core', async ({ page }) => {
    await gotoSettings(page, 'shortcuts')
    await expect(page.getByText('Aucun raccourci pour l’instant.')).toBeVisible()

    // Création : Photo seulement.
    await page.getByRole('button', { name: 'Nouveau', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Nouveau raccourci' })).toBeVisible()
    const add = dialog.getByRole('button', { name: 'Ajouter' })
    await expect(add).toBeDisabled()
    await dialog.getByLabel('Nom').fill('Lumière dorée')
    await dialog.getByLabel('Texte').fill('golden hour lighting')
    await dialog.getByText('Vidéo', { exact: true }).click()
    await dialog.getByText('Photo', { exact: true }).click()
    // Ni Photo ni Vidéo : refusé.
    await expect(dialog.getByText('Coche au moins Photo ou Vidéo.')).toBeVisible()
    await expect(add).toBeDisabled()
    await dialog.getByText('Photo', { exact: true }).click()
    await add.click()
    await expect(dialog).toBeHidden()

    const row = page.locator('div.rounded-lg', { hasText: 'Lumière dorée' })
    await expect(row).toContainText('golden hour lighting')
    await expect(row).toContainText('Photo')
    await expect(row).not.toContainText('Vidéo')
    expect(sql("SELECT label || '|' || media || '|' || enabled FROM prompt_presets")).toBe('Lumière dorée|image|true')

    // Modification : nom, texte et les deux médias.
    await row.getByRole('button', { name: 'Modifier' }).click()
    await expect(dialog.getByRole('heading', { name: 'Modifier le raccourci' })).toBeVisible()
    await expect(dialog.getByLabel('Nom')).toHaveValue('Lumière dorée')
    await dialog.getByLabel('Nom').fill('Lumière bleue')
    await dialog.getByLabel('Texte').fill('blue hour lighting')
    await dialog.getByText('Vidéo', { exact: true }).click()
    await dialog.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(dialog).toBeHidden()
    const edited = page.locator('div.rounded-lg', { hasText: 'Lumière bleue' })
    await expect(edited).toContainText('blue hour lighting')
    await expect(edited).toContainText('Photo · Vidéo')
    await expect(page.getByText('Lumière dorée')).toHaveCount(0)

    // Masquer puis réafficher (interrupteur).
    await edited.getByRole('switch', { name: 'Masquer du composer' }).click()
    await expect(edited.getByRole('switch', { name: 'Afficher dans le composer' })).toBeVisible()
    await expect.poll(() => sql('SELECT enabled FROM prompt_presets')).toBe('f')
    await page.reload()
    await hydrated(page)
    await expect(edited.getByRole('switch', { name: 'Afficher dans le composer' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await edited.getByRole('switch', { name: 'Afficher dans le composer' }).click()
    await expect(edited.getByRole('switch', { name: 'Masquer du composer' })).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => sql('SELECT enabled FROM prompt_presets')).toBe('t')

    // Suppression, avec confirmation.
    await edited.getByRole('button', { name: 'Supprimer' }).click()
    await expect(dialog.getByRole('heading', { name: 'Supprimer « Lumière bleue » ?' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Supprimer' }).click()
    await expect(page.getByText('Aucun raccourci pour l’instant.')).toBeVisible()
    expect(sql('SELECT count(*) FROM prompt_presets')).toBe('0')
  })

  test('annuler la suppression garde le raccourci', async ({ page }) => {
    const res = await page.request.post('/api/presets', {
      data: { label: 'Gardé', text: 'texte gardé', media: 'all', personaId: null },
    })
    expect(res.ok(), await res.text()).toBeTruthy()
    await gotoSettings(page, 'shortcuts')
    const row = page.locator('div.rounded-lg', { hasText: 'Gardé' })
    await row.getByRole('button', { name: 'Supprimer' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(row).toBeVisible()
    expect(sql('SELECT count(*) FROM prompt_presets')).toBe('1')
  })
})

test.describe('Crédits', () => {
  test('le solde (faux, 10 $) et les dépenses sont affichés', async ({ app, page }) => {
    await app.generate({ prompt: 'une pomme pour les crédits' })
    await gotoSettings(page, 'credits')
    const stat = (label: string) => page.locator('div.rounded-lg', { has: page.getByText(label, { exact: true }) })
    await expect(stat('Disponible')).toContainText('10,00 $')
    await expect(stat('En cours')).toContainText('0,00 $')
    await expect(stat('Dépensé les 30 derniers jours')).toContainText('0,00 $')
    await expect(stat('Dépensé les 30 derniers jours')).toContainText('0 appel(s) avec cette clé')
    await expect(stat('Dépense totale')).toContainText('0,010 $')
    await expect(stat('Dépense totale')).toContainText('1 génération réussie')
  })

  test('sans génération, la dépense totale est nulle', async ({ page }) => {
    await gotoSettings(page, 'credits')
    const total = page.locator('div.rounded-lg', { has: page.getByText('Dépense totale', { exact: true }) })
    await expect(total).toContainText('0,00 $')
    await expect(total).toContainText('0 génération réussie')
  })
})

test.describe('Stockage', () => {
  test('changer le dossier des médias, puis revenir au dossier par défaut @core', async ({ page }) => {
    const target = join(DATA_DIR, `medias-${Date.now()}`)
    await gotoSettings(page, 'storage')
    const input = page.locator('input.font-mono')
    const initial = await input.inputValue()
    expect(initial).not.toBe('')
    await expect(page.getByRole('button', { name: 'Revenir au dossier par défaut' })).toHaveCount(0)
    const save = page.getByRole('button', { name: 'Enregistrer' })
    await expect(save).toBeDisabled()

    await input.fill(target)
    await save.click()
    await expect(page.getByText('Dossier mis à jour')).toBeVisible()
    // Le dossier est créé sur le disque.
    await expect.poll(() => existsSync(target)).toBe(true)
    await expect(page.getByRole('button', { name: 'Revenir au dossier par défaut' })).toBeVisible()

    await page.reload()
    await hydrated(page)
    await expect(input).toHaveValue(target)

    await page.getByRole('button', { name: 'Revenir au dossier par défaut' }).click()
    await expect(input).toHaveValue(initial)
    await expect(page.getByRole('button', { name: 'Revenir au dossier par défaut' })).toHaveCount(0)
    expect(sql(`SELECT coalesce(media_dir, '') FROM user_settings WHERE user_id = ${ME}`)).toBe('')
  })

  // Ancien bug (corrigé) : le chemin était rendu absolu avant d'être vérifié, donc
  // un chemin relatif était accepté sans message.
  test('un chemin relatif est refusé avec un message', async ({ page }) => {
    await gotoSettings(page, 'storage')
    // Relatif au dossier du serveur (backend/) : reste dans le dossier de test.
    await page.locator('input.font-mono').fill(`../${basename(DATA_DIR)}/relatif`)
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Le dossier doit être un chemin absolu.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Revenir au dossier par défaut' })).toHaveCount(0)
  })

  test('« Ouvrir dans le Finder » répond sans erreur (le Finder ne s’ouvre pas en test)', async ({ page }) => {
    await gotoSettings(page, 'storage')
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    const response = page.waitForResponse((r) => r.url().includes('/api/settings/open-media-dir'))
    await page.getByRole('button', { name: 'Ouvrir dans le Finder' }).click()
    expect((await response).status()).toBe(200)
    await expect(page.getByText('Dossier des médias')).toBeVisible()
    expect(errors).toEqual([])
  })
})

test.describe('Clés API', () => {
  test('la clé enregistrée est affichée masquée', async ({ page }) => {
    await gotoSettings(page, 'api-key')
    await expect(page.getByText('sk-spicy-••••0000')).toBeVisible()
    await expect(page.getByText(E2E_KEY)).toHaveCount(0)
    await expect(page.locator('input[aria-label="Clé SpicyAPI"]')).toHaveCount(0)
  })

  test('supprimer la clé bloque le composer, la remettre le débloque @core', async ({ app, page }) => {
    await gotoSettings(page, 'api-key')
    await page.getByRole('button', { name: 'Supprimer' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Supprimer la clé SpicyAPI ?' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Supprimer' }).click()
    await expect(page.getByText('Clé supprimée')).toBeVisible()
    await expect(page.locator('input[aria-label="Clé SpicyAPI"]')).toBeVisible()
    await expect(page.getByRole('link', { name: /Créer une clé dans la console SpicyAPI/ })).toBeVisible()

    // Composer sans clé : bandeau d'avertissement, crédit remplacé, envoi impossible.
    await page.goto('/')
    await hydrated(page)
    await expect(page.getByRole('link', { name: /Ajoute ta clé API SpicyAPI pour commencer à générer/ })).toBeVisible()
    await expect(page.getByTestId('thread-panel').getByText('Clé API manquante')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Générer/ })).toBeDisabled()

    // Le bandeau mène aux clés API : on remet une clé.
    await page.getByRole('link', { name: /Ajoute ta clé API SpicyAPI/ }).click()
    await expect(page).toHaveURL(/tab=api-key/)
    await hydrated(page)
    const field = page.locator('input[aria-label="Clé SpicyAPI"]')
    await field.fill('sk-spicy-e2e-1111111111')
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Clé vérifiée et enregistrée')).toBeVisible()
    await expect(page.getByText('sk-spicy-••••1111')).toBeVisible()

    await app.gotoNew()
    await expect(page.getByRole('link', { name: /Ajoute ta clé API SpicyAPI/ })).toHaveCount(0)
    await expect(page.getByTestId('thread-panel')).toContainText('10,00 $')
  })

  test('remplacer la clé : supprimer puis enregistrer la nouvelle', async ({ page }) => {
    await gotoSettings(page, 'api-key')
    await expect(page.getByText('sk-spicy-••••0000')).toBeVisible()
    await page.getByRole('button', { name: 'Supprimer' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click()
    await page.locator('input[aria-label="Clé SpicyAPI"]').fill('sk-spicy-remplacee-9876')
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('sk-spicy-••••9876')).toBeVisible()
    await page.reload()
    await hydrated(page)
    await expect(page.getByText('sk-spicy-••••9876')).toBeVisible()
    expect(sql(`SELECT spicy_api_key_hint FROM user_settings WHERE user_id = ${ME}`)).toBe('sk-spicy-••••9876')
  })

  test('une clé trop courte est refusée', async ({ page }) => {
    await gotoSettings(page, 'api-key')
    await page.getByRole('button', { name: 'Supprimer' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click()
    await expect(page.locator('input[aria-label="Clé SpicyAPI"]')).toBeVisible()
    const save = page.getByRole('button', { name: 'Enregistrer' })
    await expect(save).toBeDisabled()
    await page.locator('input[aria-label="Clé SpicyAPI"]').fill('court')
    await save.click()
    await expect(page.locator('input[aria-label="Clé SpicyAPI"]')).toBeVisible()
    expect(sql(`SELECT coalesce(spicy_api_key_hint, '') FROM user_settings WHERE user_id = ${ME}`)).toBe('')
  })
})
