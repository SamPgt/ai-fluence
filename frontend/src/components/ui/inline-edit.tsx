import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * Champ texte qui remplace un titre le temps de l'édition.
 * Entrée ou clic à côté : valide. Échap : annule.
 */
export function InlineEdit({
  value,
  onSubmit,
  onCancel,
  className,
  maxLength = 120,
}: {
  value: string
  onSubmit: (next: string) => void
  onCancel: () => void
  className?: string
  maxLength?: number
}) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const next = draft.trim()
    if (save && next && next !== value) onSubmit(next)
    else onCancel()
  }

  return (
    <input
      ref={ref}
      value={draft}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true)
        if (e.key === 'Escape') finish(false)
        e.stopPropagation()
      }}
      className={cn(
        'w-full min-w-0 rounded-md border border-ring/60 bg-background px-2 py-0.5 text-sm outline-none',
        className,
      )}
    />
  )
}
