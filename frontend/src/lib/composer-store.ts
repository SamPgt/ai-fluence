/**
 * État du composer (modèle choisi, paramètres, pièces jointes, prompt).
 * Global pour que les actions d'un résultat (Éditer, Animer, Relancer avec…)
 * puissent pré-remplir le composer depuis n'importe où dans le fil.
 */
import { Store } from '@tanstack/react-store'
import type { Asset, GenerationTrait, VideoRefMode } from '@ai-fluence/shared'

export interface ComposerState {
  family: string | null
  /** Paramètres par famille, conservés quand on change de modèle et qu'on revient. */
  paramsByFamily: Record<string, Record<string, unknown>>
  prompt: string
  attachments: Asset[]
  /**
   * Image utilisée comme visage (modèles qui le permettent) : `auto` = la 2e image,
   * `none` = aucune, sinon l'id de l'image choisie.
   */
  faceChoice: 'auto' | 'none' | string
  refMode: VideoRefMode
  /** Série : nombre d'images générées avec la même demande (reste choisi après l'envoi). */
  count: number
  /** Traits choisis dans la bibliothèque (bulles), un par catégorie. Restent après l'envoi, comme les contextes. */
  traits: GenerationTrait[]
  /** Contextes activés (restent actifs après l'envoi). */
  contextIds: string[]
  /** Incrémenté pour demander le focus du champ texte. */
  focusTick: number
}

export const composerStore = new Store<ComposerState>({
  family: null,
  paramsByFamily: {},
  prompt: '',
  attachments: [],
  faceChoice: 'auto',
  refMode: 'start-frame',
  count: 1,
  traits: [],
  contextIds: [],
  focusTick: 0,
})

export const composer = {
  setFamily: (family: string) => composerStore.setState((s) => ({ ...s, family })),
  setPrompt: (prompt: string) => composerStore.setState((s) => ({ ...s, prompt })),
  setParam: (family: string, key: string, value: unknown) =>
    composerStore.setState((s) => ({
      ...s,
      paramsByFamily: { ...s.paramsByFamily, [family]: { ...s.paramsByFamily[family], [key]: value } },
    })),
  resetParams: (family: string) =>
    composerStore.setState((s) => ({ ...s, paramsByFamily: { ...s.paramsByFamily, [family]: {} } })),
  addAttachments: (assets: Asset[]) =>
    composerStore.setState((s) => ({
      ...s,
      attachments: [...s.attachments, ...assets.filter((a) => !s.attachments.some((x) => x.id === a.id))],
    })),
  removeAttachment: (id: string) =>
    composerStore.setState((s) => ({
      ...s,
      attachments: s.attachments.filter((a) => a.id !== id),
      faceChoice: s.faceChoice === id ? 'auto' : s.faceChoice,
    })),
  setFace: (faceChoice: ComposerState['faceChoice']) => composerStore.setState((s) => ({ ...s, faceChoice })),
  setRefMode: (refMode: VideoRefMode) => composerStore.setState((s) => ({ ...s, refMode })),
  setCount: (count: number) => composerStore.setState((s) => ({ ...s, count })),
  /** Ajoute un trait ; remplace celui de la même catégorie. */
  setTrait: (trait: GenerationTrait) =>
    composerStore.setState((s) => {
      const i = s.traits.findIndex((t) => t.categoryId === trait.categoryId)
      return { ...s, traits: i === -1 ? [...s.traits, trait] : s.traits.map((t, j) => (j === i ? trait : t)) }
    }),
  removeTrait: (optionId: string) => composerStore.setState((s) => ({ ...s, traits: s.traits.filter((t) => t.optionId !== optionId) })),
  toggleContext: (id: string) =>
    composerStore.setState((s) => ({
      ...s,
      contextIds: s.contextIds.includes(id) ? s.contextIds.filter((x) => x !== id) : [...s.contextIds, id],
    })),
  clearAfterSend: () => composerStore.setState((s) => ({ ...s, prompt: '', attachments: [], faceChoice: 'auto' })),
  /** Pré-remplit le composer (Relancer, Éditer, Animer). */
  load: (patch: Partial<Pick<ComposerState, 'family' | 'prompt' | 'attachments' | 'refMode' | 'contextIds' | 'count' | 'traits'>> & {
    params?: Record<string, unknown>
    /** Image « visage » de la demande rechargée (null : aucune). */
    faceId?: string | null
  }) =>
    composerStore.setState((s) => ({
      ...s,
      ...('family' in patch && patch.family ? { family: patch.family } : {}),
      ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
      ...(patch.attachments ? { attachments: patch.attachments, faceChoice: patch.faceId ?? (patch.faceId === null ? 'none' : 'auto') } : {}),
      ...(patch.refMode ? { refMode: patch.refMode } : {}),
      ...(patch.count ? { count: patch.count } : {}),
      ...(patch.traits ? { traits: patch.traits } : {}),
      ...(patch.contextIds ? { contextIds: patch.contextIds } : {}),
      ...(patch.params && (patch.family ?? s.family)
        ? { paramsByFamily: { ...s.paramsByFamily, [(patch.family ?? s.family)!]: patch.params } }
        : {}),
      focusTick: s.focusTick + 1,
    })),
}
