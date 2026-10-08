/**
 * État du composer (modèle choisi, paramètres, pièces jointes, prompt).
 * Global pour que les actions d'un résultat (Éditer, Animer, Relancer avec…)
 * puissent pré-remplir le composer depuis n'importe où dans le fil.
 */
import { Store } from '@tanstack/react-store'
import type { Asset, VideoRefMode } from '@ai-fluence/shared'

export interface ComposerState {
  family: string | null
  /** Paramètres par famille, conservés quand on change de modèle et qu'on revient. */
  paramsByFamily: Record<string, Record<string, unknown>>
  prompt: string
  attachments: Asset[]
  refMode: VideoRefMode
  /** Contextes activés (restent actifs après l'envoi). */
  contextIds: string[]
  /** LoRA du persona cochées (aucune par défaut, 3 max envoyées). */
  loraIds: string[]
  /** Incrémenté pour demander le focus du champ texte. */
  focusTick: number
}

export const composerStore = new Store<ComposerState>({
  family: null,
  paramsByFamily: {},
  prompt: '',
  attachments: [],
  refMode: 'start-frame',
  contextIds: [],
  loraIds: [],
  focusTick: 0,
})

export const composer = {
  setFamily: (family: string) =>
    composerStore.setState((s) => ({ ...s, family })),
  setPrompt: (prompt: string) =>
    composerStore.setState((s) => ({ ...s, prompt })),
  setParam: (family: string, key: string, value: unknown) =>
    composerStore.setState((s) => ({
      ...s,
      paramsByFamily: {
        ...s.paramsByFamily,
        [family]: { ...s.paramsByFamily[family], [key]: value },
      },
    })),
  resetParams: (family: string) =>
    composerStore.setState((s) => ({
      ...s,
      paramsByFamily: { ...s.paramsByFamily, [family]: {} },
    })),
  addAttachments: (assets: Asset[]) =>
    composerStore.setState((s) => ({
      ...s,
      attachments: [
        ...s.attachments,
        ...assets.filter((a) => !s.attachments.some((x) => x.id === a.id)),
      ],
    })),
  removeAttachment: (id: string) =>
    composerStore.setState((s) => ({
      ...s,
      attachments: s.attachments.filter((a) => a.id !== id),
    })),
  setRefMode: (refMode: VideoRefMode) =>
    composerStore.setState((s) => ({ ...s, refMode })),
  toggleContext: (id: string) =>
    composerStore.setState((s) => ({
      ...s,
      contextIds: s.contextIds.includes(id)
        ? s.contextIds.filter((x) => x !== id)
        : [...s.contextIds, id],
    })),
  toggleLora: (id: string) =>
    composerStore.setState((s) => ({
      ...s,
      loraIds: s.loraIds.includes(id)
        ? s.loraIds.filter((x) => x !== id)
        : [...s.loraIds, id],
    })),
  clearAfterSend: () =>
    composerStore.setState((s) => ({ ...s, prompt: '', attachments: [] })),
  /** Pré-remplit le composer (Relancer, Éditer, Animer). */
  load: (
    patch: Partial<
      Pick<
        ComposerState,
        | 'family'
        | 'prompt'
        | 'attachments'
        | 'refMode'
        | 'contextIds'
        | 'loraIds'
      >
    > & {
      params?: Record<string, unknown>
    },
  ) =>
    composerStore.setState((s) => ({
      ...s,
      ...('family' in patch && patch.family ? { family: patch.family } : {}),
      ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
      ...(patch.attachments ? { attachments: patch.attachments } : {}),
      ...(patch.refMode ? { refMode: patch.refMode } : {}),
      ...(patch.contextIds ? { contextIds: patch.contextIds } : {}),
      ...(patch.loraIds ? { loraIds: patch.loraIds } : {}),
      ...(patch.params && (patch.family ?? s.family)
        ? {
            paramsByFamily: {
              ...s.paramsByFamily,
              [(patch.family ?? s.family)!]: patch.params,
            },
          }
        : {}),
      focusTick: s.focusTick + 1,
    })),
}
