/**
 * Dictée en direct (Deepgram Flux, Cartesia Ink-2 ou ElevenLabs Scribe v2, au choix dans
 * Paramétrage) : le texte arrive au fil de la parole. Le serveur donne un jeton temporaire,
 * le navigateur se connecte directement au fournisseur avec le micro : la clé ne quitte jamais le serveur et l'audio n'est jamais
 * enregistré chez nous. En test (`fake`), la dictée est simulée, sans micro ni réseau.
 */
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { DictationProvider, DictationTokenResponse } from '@sublime/shared'
import {
  MIC_FIRST,
  connectDictation,
  openMicBuffer,
  type DictationSession,
  type MicBuffer,
} from './dictation-providers'

import { dictationApi } from '@/lib/api'

export type DictationStatus = 'idle' | 'connecting' | 'listening'

/** Durée de réutilisation d'un jeton préparé, sous sa durée de vie (30 s, 60 s, 15 min). */
const TOKEN_REUSE_MS: Record<DictationProvider, number> = {
  deepgram: 20_000,
  cartesia: 45_000,
  elevenlabs: 10 * 60_000,
}

/** Phrases de la dictée simulée (tests). */
const FAKE_WORDS = ['Bonjour', 'depuis', 'la', 'dictée']

export function useDictation() {
  const [status, setStatus] = useState<DictationStatus>('idle')
  // Segments validés par le modèle (pauses), puis le segment en cours.
  const [committed, setCommitted] = useState<string[]>([])
  const [partial, setPartial] = useState('')
  const connection = useRef<DictationSession | null>(null)
  const fakeTimer = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  )
  // Session en cours : une réponse qui arrive après l'arrêt est ignorée.
  const run = useRef(0)

  const text = [...committed, partial]
    .map((t) => t.trim())
    .filter(Boolean)
    .join(' ')

  const close = () => {
    run.current++
    clearInterval(fakeTimer.current)
    connection.current?.close()
    connection.current = null
    setStatus('idle')
  }

  const reset = () => {
    setCommitted([])
    setPartial('')
  }

  // Jeton préparé à l'avance (survol du micro, focus du composer) : au clic, il ne reste
  // que la connexion. Gardé moins longtemps que sa durée de vie chez le fournisseur.
  const ready = useRef<{ value: DictationTokenResponse; at: number } | null>(
    null,
  )
  const fetching = useRef<Promise<DictationTokenResponse> | null>(null)
  const fresh = () =>
    ready.current &&
    Date.now() - ready.current.at < TOKEN_REUSE_MS[ready.current.value.provider]
  /** Prépare un jeton s'il n'y en a pas de récent (gratuit). */
  const prefetch = () => {
    if (fresh() || fetching.current) return
    fetching.current = dictationApi
      .token()
      .then((value) => {
        ready.current = { value, at: Date.now() }
        return value
      })
      .finally(() => (fetching.current = null))
    fetching.current.catch(() => {})
  }
  /** Un jeton ne sert qu'une fois : le prêt est consommé, sinon on en demande un. */
  const takeToken = async (): Promise<DictationTokenResponse> => {
    if (fresh()) {
      const { value } = ready.current!
      ready.current = null
      return value
    }
    ready.current = null
    return (fetching.current ?? dictationApi.token()).then((v) => {
      ready.current = null
      return v
    })
  }

  /**
   * `provider` : celui de Paramétrage, pour ouvrir le micro sans attendre quand c'est sans
   * risque (MIC_FIRST). `keyterms` : mots-clés pour le fournisseur réellement utilisé.
   */
  const start = async (
    provider: DictationProvider,
    keyterms?: (provider: DictationProvider) => string[],
  ) => {
    if (status !== 'idle') return
    const id = ++run.current
    reset()
    setStatus('connecting')
    const tokenP = takeToken()
    let mic: MicBuffer | undefined
    try {
      // Deepgram, Cartesia : micro ouvert pendant la demande du jeton, « écoute » tout de
      // suite (l'audio attend la connexion, rien n'est perdu).
      if (MIC_FIRST.has(provider)) {
        mic = await openMicBuffer()
        if (id !== run.current) return mic.stop()
        setStatus('listening')
      }
      const { provider: actual, token, fake } = await tokenP
      if (id !== run.current) return mic?.stop()
      if (fake) {
        mic?.stop()
        // Simulation : un mot toutes les 120 ms, puis le segment est validé.
        let i = 0
        setStatus('listening')
        fakeTimer.current = setInterval(() => {
          i++
          if (i <= FAKE_WORDS.length)
            setPartial(FAKE_WORDS.slice(0, i).join(' '))
          else {
            setCommitted([FAKE_WORDS.join(' ')])
            setPartial('')
            clearInterval(fakeTimer.current)
          }
        }, 120)
        return
      }
      const session = await connectDictation(
        actual,
        token,
        {
          onReady: () => id === run.current && setStatus('listening'),
          onPartial: (t) => id === run.current && setPartial(t),
          onCommit: (t) => {
            if (id !== run.current) return
            setCommitted((c) => [...c, t])
            setPartial('')
          },
          onError: (message) => {
            if (id !== run.current) return
            toast.error(`Dictée interrompue${message ? ` : ${message}` : '.'}`)
            close()
          },
        },
        keyterms?.(actual),
        mic,
      )
      if (id !== run.current) return session.close()
      connection.current = session
    } catch (e) {
      mic?.stop()
      if (id !== run.current) return
      const err = e as Error
      toast.error(
        err.name === 'NotAllowedError'
          ? 'Micro refusé : autorise-le dans le navigateur pour dicter.'
          : err.message,
      )
      close()
    }
  }

  /** Arrête l'écoute et rend le texte dicté (segment en cours compris). */
  const stop = () => {
    const final = text
    close()
    return final
  }

  /** Arrête sans rien garder. */
  const cancel = () => {
    close()
    reset()
  }

  useEffect(() => () => close(), []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    status,
    text,
    active: status !== 'idle',
    start,
    stop,
    cancel,
    reset,
    prefetch,
  }
}

/** Petit son de validation (deux notes douces), sans fichier audio. */
export function playValidateSound() {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    ;[660, 990].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = now + i * 0.08
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.18)
    })
    setTimeout(() => ctx.close(), 500)
  } catch {
    // Pas d'audio (navigateur sans Web Audio) : la validation se fait sans son.
  }
}
