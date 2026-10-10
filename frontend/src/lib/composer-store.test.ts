// @vitest-environment happy-dom
/**
 * Brouillons du composer : un par fil (plus un pour le nouveau fil), enregistrés
 * dans le navigateur ; un brouillon vide repart du générique.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset } from '@ai-fluence/shared'

const KEY = 'aif-composer-drafts'
const asset = (id: string) => ({ id, mediaType: 'image' }) as Asset

/** Module neuf à chaque test : état et lecture du stockage repartent de zéro. */
async function load() {
  vi.resetModules()
  return import('./composer-store')
}
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? '{}')
/** L'écriture est différée de 300 ms. */
const flush = () => vi.advanceTimersByTime(400)

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('isEmptyDraft', () => {
  it('vide = ni texte ni image ; une image posée par Éditer seule ne compte pas', async () => {
    const { isEmptyDraft, composerStore } = await load()
    const blank = composerStore.state
    expect(isEmptyDraft(blank)).toBe(true)
    expect(isEmptyDraft({ ...blank, prompt: '   ' })).toBe(true)
    expect(isEmptyDraft({ ...blank, count: 4, contextIds: ['c'] })).toBe(true)
    expect(isEmptyDraft({ ...blank, prompt: 'x' })).toBe(false)
    expect(isEmptyDraft({ ...blank, attachments: [asset('a')] })).toBe(false)
    expect(isEmptyDraft({ ...blank, attachments: [asset('a')], fromAction: true })).toBe(true)
  })
})

describe('brouillons par fil', () => {
  it('chaque fil retrouve son brouillon, réglages compris', async () => {
    const { composer, composerStore } = await load()
    composer.enterThread('A')
    composer.setPrompt('texte A')
    composer.setCount(4)
    composer.setParam('m', 'aspect_ratio', '16:9')
    composer.enterThread('B')
    expect(composerStore.state.prompt).toBe('')
    expect(composerStore.state.count).toBe(1)
    expect(composerStore.state.paramsByFamily).toEqual({})
    composer.setPrompt('texte B')
    composer.enterThread('A')
    expect(composerStore.state).toMatchObject({ prompt: 'texte A', count: 4 })
    expect(composerStore.state.paramsByFamily.m).toEqual({ aspect_ratio: '16:9' })
    composer.enterThread('B')
    expect(composerStore.state.prompt).toBe('texte B')
  })

  it('brouillon vide : retour au générique (modèle, x1, raccourcis, LoRA)', async () => {
    const { composer, composerStore } = await load()
    composer.enterThread('A')
    composer.setFamily('openai/gpt-image-2.5-sunburst')
    composer.setCount(4)
    composer.toggleContext('c1')
    composer.toggleLora('l1', ['w'])
    composer.enterThread('B')
    composer.enterThread('A')
    expect(composerStore.state).toMatchObject({ family: null, count: 1, contextIds: [], loras: {} })
  })

  it('même fil affiché à nouveau : brouillon vide remis à zéro, non vide gardé', async () => {
    const { composer, composerStore } = await load()
    composer.enterThread('A')
    composer.setCount(4)
    composer.enterThread('A')
    expect(composerStore.state.count).toBe(1)
    composer.setPrompt('x')
    composer.setCount(4)
    composer.enterThread('A')
    expect(composerStore.state.count).toBe(4)
  })

  it('nouveau fil : un seul brouillon, quel que soit le persona', async () => {
    const { composer, composerStore } = await load()
    composer.enterThread(null, 'p1')
    composer.setPrompt('commencé')
    composer.enterThread('A', 'p1')
    composer.enterThread(null, 'p2')
    expect(composerStore.state.prompt).toBe('commencé')
    expect(composerStore.state.personaId).toBeNull()
  })

  it('envoi depuis un nouveau fil : le fil créé garde les réglages', async () => {
    const { composer, composerStore } = await load()
    composer.enterThread(null)
    composer.setPrompt('demande')
    composer.setCount(4)
    composer.clearAfterSend()
    composer.adoptNewThread('T')
    composer.enterThread('T')
    expect(composerStore.state).toMatchObject({ threadKey: 'T', count: 4, prompt: '' })
    // Le brouillon du nouveau fil est vidé.
    composer.enterThread(null)
    expect(composerStore.state).toMatchObject({ prompt: '', count: 1 })
  })
})

describe('Éditer / Animer', () => {
  it('Éditer repart de zéro avec l’image en position 1 et le modèle donné', async () => {
    const { composer, composerStore } = await load()
    composer.enterThread('A')
    composer.setPrompt('ancien')
    composer.addAttachments([asset('x')])
    composer.setCount(4)
    composer.startFromImage(asset('img'), 'openai/gpt-image-2.5-sunburst', 'edit')
    expect(composerStore.state).toMatchObject({
      prompt: '',
      count: 1,
      attachments: [{ id: 'img' }],
      editAssetId: 'img',
      fromAction: true,
      family: 'openai/gpt-image-2.5-sunburst',
    })
  })

  it('Animer : image de début, pas d’image à modifier', async () => {
    const { composer, composerStore } = await load()
    composer.enterThread('A')
    composer.startFromImage(asset('img'), 'bytedance/seedance-2.0-mini', 'animate')
    expect(composerStore.state).toMatchObject({ editAssetId: null, refMode: 'start-frame' })
  })

  it('faux clic : Éditer sans rien écrire ne laisse rien au retour', async () => {
    const { composer, composerStore } = await load()
    composer.enterThread('A')
    composer.startFromImage(asset('img'), undefined, 'edit')
    composer.enterThread('B')
    composer.enterThread('A')
    expect(composerStore.state.attachments).toEqual([])
  })

  it('une image jointe à la main ou du texte gardent le brouillon d’édition', async () => {
    const { composer, composerStore } = await load()
    composer.enterThread('A')
    composer.startFromImage(asset('img'), undefined, 'edit')
    composer.addAttachments([asset('ref')])
    expect(composerStore.state.fromAction).toBe(false)
    composer.enterThread('B')
    composer.enterThread('A')
    expect(composerStore.state.attachments.map((a) => a.id)).toEqual(['img', 'ref'])
    expect(composerStore.state.editAssetId).toBe('img')
  })

  it('retirer l’image à modifier retire la consigne', async () => {
    const { composer, composerStore } = await load()
    composer.enterThread('A')
    composer.startFromImage(asset('img'), undefined, 'edit')
    composer.removeAttachment('img')
    expect(composerStore.state.editAssetId).toBeNull()
  })

  it('Modifier la demande (load) n’est pas une édition', async () => {
    const { composer, composerStore } = await load()
    composer.enterThread('A')
    composer.startFromImage(asset('img'), undefined, 'edit')
    composer.load({ prompt: 'reprise', attachments: [asset('r')] })
    expect(composerStore.state).toMatchObject({ editAssetId: null, fromAction: false, prompt: 'reprise' })
  })
})

describe('enregistrement dans le navigateur', () => {
  it('écriture différée ; les brouillons vides ne sont jamais enregistrés', async () => {
    const { composer } = await load()
    composer.enterThread('A')
    composer.setCount(4)
    flush()
    expect(stored()).toEqual({})
    composer.setPrompt('texte')
    expect(stored()).toEqual({})
    flush()
    expect(stored().A.prompt).toBe('texte')
    composer.setPrompt('')
    flush()
    expect(stored()).toEqual({})
  })

  it('page quittée juste après une frappe : enregistré aussitôt', async () => {
    const { composer } = await load()
    composer.enterThread('A')
    composer.setPrompt('dernière frappe')
    window.dispatchEvent(new Event('pagehide'))
    expect(stored().A.prompt).toBe('dernière frappe')
  })

  it('rechargement : brouillon relu', async () => {
    localStorage.setItem(KEY, JSON.stringify({ A: { prompt: 'enregistré', count: 4 } }))
    const { composer, composerStore } = await load()
    composer.enterThread('A')
    // Champs manquants complétés par le générique.
    expect(composerStore.state).toMatchObject({ prompt: 'enregistré', count: 4, attachments: [], loras: {} })
  })

  it('stockage corrompu : ignoré, puis réécrit proprement', async () => {
    localStorage.setItem(KEY, '{pas du json')
    const { composer } = await load()
    composer.enterThread(null)
    composer.setPrompt('reprise')
    flush()
    expect(stored().new.prompt).toBe('reprise')
  })

  it('rien n’est écrit avant la première lecture (pas d’écrasement)', async () => {
    localStorage.setItem(KEY, JSON.stringify({ A: { prompt: 'à garder' } }))
    const { composer } = await load()
    composer.setPrompt('sans fil affiché')
    flush()
    expect(stored().A.prompt).toBe('à garder')
  })
})

describe('corbeille', () => {
  beforeEach(() => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        A: { prompt: 'a', personaId: 'p1' },
        B: { prompt: 'b', personaId: 'p1' },
        C: { prompt: 'c', personaId: null },
        new: { prompt: 'n', personaId: null },
      }),
    )
  })

  it('fil mis à la corbeille, même sans composer affiché : seul son brouillon part', async () => {
    const { composer } = await load()
    composer.dropDraft('A')
    flush()
    expect(Object.keys(stored()).sort()).toEqual(['B', 'C', 'new'])
  })

  it('fil affiché mis à la corbeille : brouillon effacé et non réenregistré', async () => {
    const { composer, composerStore } = await load()
    composer.enterThread('C')
    expect(composerStore.state.prompt).toBe('c')
    composer.dropDraft('C')
    expect(composerStore.state.prompt).toBe('')
    composer.enterThread(null)
    flush()
    expect(stored()).not.toHaveProperty('C')
  })

  it('persona mis à la corbeille : brouillons de ses fils seulement', async () => {
    const { composer } = await load()
    composer.dropPersonaDrafts('p1')
    flush()
    expect(Object.keys(stored()).sort()).toEqual(['C', 'new'])
  })

  it('persona du fil affiché mis à la corbeille : composer vidé', async () => {
    const { composer, composerStore } = await load()
    composer.enterThread('A', 'p1')
    composer.dropPersonaDrafts('p1')
    expect(composerStore.state.prompt).toBe('')
    flush()
    expect(stored()).not.toHaveProperty('A')
  })
})
