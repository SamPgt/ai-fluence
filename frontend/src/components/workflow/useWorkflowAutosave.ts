/**
 * Enregistrement automatique du graphe d'un workflow, une demi-seconde après la
 * dernière modification. Un seul envoi à la fois : pendant un envoi, seule la
 * dernière version attend son tour. Page quittée : envoi immédiat (keepalive).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { WorkflowGraph } from '@ai-fluence/shared'

import { workflowsApi } from '@/lib/api'
import { qk } from '@/lib/queries'

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

const DELAY_MS = 500

/**
 * Le premier graphe reçu (celui affiché à l'ouverture) sert de référence : il n'est
 * pas renvoyé (la base réordonne les clés du JSON, une comparaison directe échouerait).
 */
export function useWorkflowAutosave(workflowId: string) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<SaveStatus>('saved')
  /** Dernière version enregistrée (JSON), pour ne rien renvoyer d'identique. */
  const saved = useRef<string | null>(null)
  const latest = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)

  const send = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (inFlight.current || latest.current === null) return
    const body = latest.current
    latest.current = null
    if (body === saved.current) {
      setStatus('saved')
      return
    }
    inFlight.current = true
    setStatus('saving')
    try {
      const { workflow } = await workflowsApi.update(workflowId, { graph: JSON.parse(body) })
      saved.current = body
      queryClient.setQueryData(qk.workflow(workflowId), workflow)
      queryClient.invalidateQueries({ queryKey: qk.workflows })
      setStatus(latest.current === null ? 'saved' : 'pending')
    } catch {
      // Version refusée ou réseau coupé : on la retentera à la prochaine modification.
      setStatus('error')
    } finally {
      inFlight.current = false
      if (latest.current !== null) void send()
    }
  }, [workflowId, queryClient])

  const schedule = useCallback(
    (graph: WorkflowGraph) => {
      const body = JSON.stringify(graph)
      if (saved.current === null) {
        saved.current = body
        return
      }
      if (body === saved.current && !inFlight.current) {
        latest.current = null
        if (timer.current) clearTimeout(timer.current)
        setStatus('saved')
        return
      }
      latest.current = body
      setStatus('pending')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void send(), DELAY_MS)
    },
    [send],
  )

  // Page quittée ou workflow fermé : la dernière version part tout de suite.
  useEffect(() => {
    const flush = () => {
      const body = latest.current
      if (body === null || body === saved.current) return
      latest.current = null
      void fetch(`/api/workflows/${workflowId}`, {
        method: 'PATCH',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: JSON.parse(body) }),
      }).then(() => queryClient.invalidateQueries({ queryKey: qk.workflow(workflowId) }))
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      if (timer.current) clearTimeout(timer.current)
      flush()
    }
  }, [workflowId, queryClient])

  return { status, schedule }
}
