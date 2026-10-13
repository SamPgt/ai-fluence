/**
 * Visionneuse d'un fil : une seule pour tout le fil, qui passe d'un média à
 * l'autre (flèches) dans l'ordre d'affichage : références de chaque demande,
 * puis ses résultats.
 */
import { createContext, useContext, useMemo, useState } from 'react'
import type { Asset, Generation } from '@ai-fluence/shared'

import { MediaViewer } from './MediaViewer'

/** Clé d'un média à sa place dans le fil (une même image peut revenir plusieurs fois). */
export const refKey = (requestId: string, assetId: string) =>
  `${requestId}:ref:${assetId}`
export const outputKey = (generationId: string, assetId: string) =>
  `${generationId}:out:${assetId}`

const ThreadMediaContext = createContext<((key: string) => void) | null>(null)

/** Ouvre la visionneuse du fil sur ce média (null hors d'un fil). */
export function useThreadMedia() {
  return useContext(ThreadMediaContext)
}

export function ThreadMediaProvider({
  groups,
  children,
}: {
  /** Demandes du fil, dans l'ordre (une série = plusieurs générations). */
  groups: Generation[][]
  children: React.ReactNode
}) {
  const entries = useMemo(() => {
    const out: {
      key: string
      asset: Asset
      generationId: string
      threadId: string
    }[] = []
    for (const group of groups) {
      const request = group[0]
      for (const r of request.references)
        out.push({
          key: refKey(request.id, r.id),
          asset: r,
          generationId: request.id,
          // Visionneuse d'un fil : ses générations ont toujours un fil.
          threadId: request.threadId!,
        })
      for (const g of group)
        for (const a of g.outputs)
          out.push({
            key: outputKey(g.id, a.id),
            asset: a,
            generationId: g.id,
            threadId: g.threadId!,
          })
    }
    return out
  }, [groups])
  const [current, setCurrent] = useState<string | null>(null)
  const index = current ? entries.findIndex((e) => e.key === current) : -1

  return (
    <ThreadMediaContext.Provider value={setCurrent}>
      {children}
      <MediaViewer
        asset={index >= 0 ? entries[index].asset : null}
        onClose={() => setCurrent(null)}
        source={index >= 0 ? entries[index] : null}
        onPrev={
          index > 0 ? () => setCurrent(entries[index - 1].key) : undefined
        }
        onNext={
          index >= 0 && index < entries.length - 1
            ? () => setCurrent(entries[index + 1].key)
            : undefined
        }
      />
    </ThreadMediaContext.Provider>
  )
}
