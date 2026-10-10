/**
 * État du composer (modèle choisi, paramètres, pièces jointes, prompt).
 * Global pour que les actions d'un résultat (Éditer, Animer, Relancer avec…)
 * puissent pré-remplir le composer depuis n'importe où dans le fil.
 */
import { Store } from '@tanstack/react-store'
import {
  getFamily,
  type Asset,
  type GenerationTrait,
  type MediaKind,
  type TraitSlot,
  type VideoRefMode,
} from '@ai-fluence/shared'

/** Brouillon du composer : un par fil, plus un pour le nouveau fil. */
export interface Draft {
  family: string | null
  /** Dernier modèle choisi pour chaque type dans ce brouillon, repris par la bascule photo / vidéo. */
  familyByMedia: Partial<Record<MediaKind, string>>
  /** Paramètres par famille, conservés quand on change de modèle et qu'on revient. */
  paramsByFamily: Record<string, Record<string, unknown>>
  prompt: string
  attachments: Asset[]
  refMode: VideoRefMode
  /** Série : nombre d'images générées avec la même demande (reste choisi après l'envoi). */
  count: number
  /** Contextes activés (restent actifs après l'envoi). */
  contextIds: string[]
  /** LoRA du persona cochées, avec leurs mots déclencheurs choisis (aucune par défaut, 3 max). */
  loras: Record<string, string[]>
  /** Image à modifier, posée par « Éditer » : toujours en position 1. */
  editAssetId: string | null
  /**
   * Images posées par « Éditer » ou « Animer » : tant que rien n'est écrit et
   * qu'aucune image n'est ajoutée à la main, le brouillon compte comme vide
   * (un clic par erreur ne laisse rien au retour).
   */
  fromAction: boolean
  /**
   * Image utilisée comme visage (modèles locaux avec ReActor) : `auto` = la 2e image,
   * `none` = aucune, sinon l'id de l'image choisie.
   */
  faceChoice: 'auto' | 'none' | string
  /** Traits choisis dans la bibliothèque (bulles), un par catégorie. */
  traits: GenerationTrait[]
  /** Bulles 🎲 : une catégorie tirée au hasard pour chaque image (une catégorie = une bulle choisie OU 🎲). */
  slots: TraitSlot[]
  /** Lieu récurrent : sa fiche entre dans le prompt. */
  placeId: string | null
}

export interface ComposerState extends Draft {
  /** Brouillon affiché : id du fil, NEW_THREAD, ou null avant le premier affichage. */
  threadKey: string | null
  /** Brouillons des autres fils (celui affiché est à plat dans l'état). */
  drafts: Record<string, Draft>
  /** Le fil vient d'être créé par un envoi : son brouillon est déjà l'état courant. */
  keepOnEnter: boolean
  /** Incrémenté pour demander le focus du champ texte. */
  focusTick: number
}

const NEW_THREAD = 'new'
const STORAGE_KEY = 'aif-composer-drafts'

/** Point de départ générique : ce qu'on retrouve sur un composer vide. */
const BLANK: Draft = {
  family: null,
  familyByMedia: {},
  paramsByFamily: {},
  prompt: '',
  attachments: [],
  refMode: 'start-frame',
  count: 1,
  contextIds: [],
  loras: {},
  editAssetId: null,
  fromAction: false,
  faceChoice: 'auto',
  traits: [],
  slots: [],
  placeId: null,
}

/**
 * Vide = ni texte ni image. On repart alors du générique (dernier modèle du
 * fil, x1, aucun raccourci…) : ces réglages discrets ne valent qu'avec une
 * demande commencée.
 */
export function isEmptyDraft(d: Draft): boolean {
  // Des bulles (traits, 🎲, lieu) suffisent à faire une demande : elles comptent comme du contenu.
  const hasBubbles = d.traits.length > 0 || d.slots.length > 0 || Boolean(d.placeId)
  return !d.prompt.trim() && !hasBubbles && (d.attachments.length === 0 || d.fromAction)
}

function draftOf(s: ComposerState): Draft {
  const out = {} as Record<string, unknown>
  for (const k of Object.keys(BLANK)) out[k] = s[k as keyof Draft]
  return out as unknown as Draft
}

function readDrafts(): Record<string, Draft> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, Draft>) : {}
    // Champs ajoutés depuis : complétés par le générique.
    return Object.fromEntries(
      Object.entries(parsed).map(([k, d]) => [k, { ...BLANK, ...d }]),
    )
  } catch {
    return {}
  }
}

/** Nouveau modèle courant, mémorisé pour son type. */
function withFamily(s: Draft, family: string): Partial<Draft> {
  const media = getFamily(family)?.media
  return {
    family,
    familyByMedia: media
      ? { ...s.familyByMedia, [media]: family }
      : s.familyByMedia,
  }
}

export const composerStore = new Store<ComposerState>({
  ...BLANK,
  threadKey: null,
  drafts: {},
  keepOnEnter: false,
  focusTick: 0,
})

// Brouillons enregistrés dans le navigateur (survivent au rechargement).
// Un brouillon vide n'est pas gardé : on repartira du générique.
let persistTimer: ReturnType<typeof setTimeout> | undefined
composerStore.subscribe(() => {
  if (typeof window === 'undefined') return
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    const s = composerStore.state
    if (!s.threadKey) return
    const drafts = { ...s.drafts }
    if (isEmptyDraft(s)) delete drafts[s.threadKey]
    else drafts[s.threadKey] = draftOf(s)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts))
    } catch {
      // Stockage indisponible (navigation privée…) : brouillons en mémoire seulement.
    }
  }, 300)
})

export const composer = {
  setFamily: (family: string) =>
    composerStore.setState((s) => ({ ...s, ...withFamily(s, family) })),
  /**
   * Affiche le brouillon d'un fil (null = nouveau fil). Brouillon vide ou
   * absent : on repart du générique, le composer applique sa cascade de modèle.
   */
  enterThread: (threadId: string | null) =>
    composerStore.setState((s) => {
      const key = threadId ?? NEW_THREAD
      if (s.keepOnEnter && s.threadKey === key)
        return { ...s, keepOnEnter: false }
      // Premier affichage : on lit les brouillons enregistrés.
      const drafts = s.threadKey ? { ...s.drafts } : readDrafts()
      if (s.threadKey) {
        if (isEmptyDraft(s)) delete drafts[s.threadKey]
        else drafts[s.threadKey] = draftOf(s)
      }
      const saved = drafts[key]
      return {
        ...s,
        ...(saved && !isEmptyDraft(saved) ? saved : BLANK),
        threadKey: key,
        drafts,
        keepOnEnter: false,
      }
    }),
  /** Envoi depuis un nouveau fil : le fil créé reprend l'état tel quel. */
  adoptNewThread: (threadId: string) =>
    composerStore.setState((s) => {
      const drafts = { ...s.drafts }
      delete drafts[NEW_THREAD]
      return { ...s, threadKey: threadId, drafts, keepOnEnter: true }
    }),
  /** Fil mis à la corbeille : son brouillon part avec lui. */
  dropDraft: (threadId: string) =>
    composerStore.setState((s) => {
      const drafts = { ...s.drafts }
      delete drafts[threadId]
      return s.threadKey === threadId
        ? { ...s, ...BLANK, drafts }
        : { ...s, drafts }
    }),
  /**
   * « Éditer » / « Animer » : nouvelle intention, le brouillon repart de zéro
   * avec seulement cette image (en position 1) et le modèle choisi.
   */
  startFromImage: (
    asset: Asset,
    family: string | undefined,
    mode: 'edit' | 'animate',
  ) =>
    composerStore.setState((s) => ({
      ...s,
      ...BLANK,
      ...(family ? withFamily(BLANK, family) : {}),
      attachments: [asset],
      editAssetId: mode === 'edit' ? asset.id : null,
      refMode: 'start-frame',
      fromAction: true,
      focusTick: s.focusTick + 1,
    })),
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
      // Image ajoutée à la main : le brouillon compte désormais.
      fromAction: false,
    })),
  removeAttachment: (id: string) =>
    composerStore.setState((s) => ({
      ...s,
      attachments: s.attachments.filter((a) => a.id !== id),
      editAssetId: s.editAssetId === id ? null : s.editAssetId,
      faceChoice: s.faceChoice === id ? 'auto' : s.faceChoice,
    })),
  setFace: (faceChoice: Draft['faceChoice']) => composerStore.setState((s) => ({ ...s, faceChoice })),
  /** Ajoute un trait ; remplace celui de la même catégorie (choisi ou 🎲). */
  setTrait: (trait: GenerationTrait) =>
    composerStore.setState((s) => {
      const i = s.traits.findIndex((t) => t.categoryId === trait.categoryId)
      return {
        ...s,
        traits: i === -1 ? [...s.traits, trait] : s.traits.map((t, j) => (j === i ? trait : t)),
        slots: s.slots.filter((x) => x.categoryId !== trait.categoryId),
      }
    }),
  removeTrait: (optionId: string) => composerStore.setState((s) => ({ ...s, traits: s.traits.filter((t) => t.optionId !== optionId) })),
  /** Passe une catégorie en 🎲 (remplace la bulle choisie de cette catégorie). */
  setSlot: (slot: TraitSlot) =>
    composerStore.setState((s) => {
      const i = s.slots.findIndex((x) => x.categoryId === slot.categoryId)
      return {
        ...s,
        slots: i === -1 ? [...s.slots, slot] : s.slots.map((x, j) => (j === i ? slot : x)),
        traits: s.traits.filter((t) => t.categoryId !== slot.categoryId),
      }
    }),
  removeSlot: (categoryId: string) => composerStore.setState((s) => ({ ...s, slots: s.slots.filter((x) => x.categoryId !== categoryId) })),
  setPlace: (placeId: string | null) => composerStore.setState((s) => ({ ...s, placeId })),
  /** Charge une scène : remplace les bulles hors personnage (tenue, action, lieu, photo), garde l'identité du persona. */
  loadScene: (scene: { traits: GenerationTrait[]; slots: TraitSlot[]; placeId: string | null; prompt: string }) =>
    composerStore.setState((s) => ({
      ...s,
      traits: [...s.traits.filter((t) => t.zone === 'character'), ...scene.traits.filter((t) => t.zone !== 'character')],
      slots: [...s.slots.filter((x) => x.zone === 'character'), ...scene.slots.filter((x) => x.zone !== 'character')],
      placeId: scene.placeId,
      prompt: scene.prompt || s.prompt,
      focusTick: s.focusTick + 1,
    })),
  setCount: (count: number) => composerStore.setState((s) => ({ ...s, count })),
  setRefMode: (refMode: VideoRefMode) =>
    composerStore.setState((s) => ({ ...s, refMode })),
  toggleContext: (id: string) =>
    composerStore.setState((s) => ({
      ...s,
      contextIds: s.contextIds.includes(id)
        ? s.contextIds.filter((x) => x !== id)
        : [...s.contextIds, id],
    })),
  /** Coche ou décoche une LoRA. À l'ajout, `words` = mots pré-sélectionnés. */
  toggleLora: (id: string, words: string[] = []) =>
    composerStore.setState((s) => {
      const loras = { ...s.loras }
      if (id in loras) delete loras[id]
      else loras[id] = words
      return { ...s, loras }
    }),
  /** Choisit ou retire un mot déclencheur ; choisir un mot coche la LoRA. */
  toggleLoraWord: (id: string, word: string, unloadWhenEmpty = false) =>
    composerStore.setState((s) => {
      const current = s.loras[id] ?? []
      const words = current.includes(word)
        ? current.filter((w) => w !== word)
        : [...current, word]
      const loras = { ...s.loras, [id]: words }
      if (unloadWhenEmpty && words.length === 0) delete loras[id]
      return { ...s, loras }
    }),
  clearAfterSend: () =>
    composerStore.setState((s) => ({
      ...s,
      prompt: '',
      attachments: [],
      editAssetId: null,
      fromAction: false,
      faceChoice: 'auto',
    })),
  /** Pré-remplit le composer (Modifier la demande, Relancer avec…). */
  load: (
    patch: Partial<
      Pick<
        Draft,
        | 'family'
        | 'prompt'
        | 'attachments'
        | 'refMode'
        | 'contextIds'
        | 'loras'
        | 'count'
        | 'traits'
        | 'slots'
      >
    > & {
      params?: Record<string, unknown>
      /** Image « visage » de la demande rechargée (null : aucune). */
      faceId?: string | null
    },
  ) =>
    composerStore.setState((s) => ({
      ...s,
      ...('family' in patch && patch.family ? withFamily(s, patch.family) : {}),
      ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
      ...(patch.attachments
        ? {
            attachments: patch.attachments,
            editAssetId: null,
            fromAction: false,
            faceChoice: patch.faceId ?? (patch.faceId === null ? 'none' : 'auto'),
          }
        : {}),
      ...(patch.traits ? { traits: patch.traits } : {}),
      ...(patch.slots ? { slots: patch.slots } : {}),
      ...(patch.refMode ? { refMode: patch.refMode } : {}),
      ...(patch.contextIds ? { contextIds: patch.contextIds } : {}),
      ...(patch.loras ? { loras: patch.loras } : {}),
      ...(patch.count ? { count: patch.count } : {}),
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
