/**
 * Dictée en direct (ElevenLabs Scribe v2 Realtime ou Deepgram Flux, au choix dans
 * Paramétrage) : le texte arrive au fil de la parole. Le serveur donne un jeton temporaire,
 * le navigateur se connecte directement au fournisseur avec le micro : la clé ne quitte jamais le serveur et l'audio n'est jamais
 * enregistré chez nous. En test (`fake`), la dictée est simulée, sans micro ni réseau.
 */
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { DictationProvider } from '@sublime/shared'
import { connectDictation, type DictationSession } from './dictation-providers'

import { dictationApi } from '@/lib/api'

export type DictationStatus = 'idle' | 'connecting' | 'listening'

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

  /** `keyterms` : mots-clés pour le fournisseur choisi (connu une fois le jeton reçu). */
  const start = async (
    keyterms?: (provider: DictationProvider) => string[],
  ) => {
    if (status !== 'idle') return
    const id = ++run.current
    reset()
    setStatus('connecting')
    try {
      const { provider, token, fake } = await dictationApi.token()
      if (id !== run.current) return
      if (fake) {
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
        provider,
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
        keyterms?.(provider),
      )
      if (id !== run.current) return session.close()
      connection.current = session
    } catch (e) {
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

  return { status, text, active: status !== 'idle', start, stop, cancel, reset }
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
