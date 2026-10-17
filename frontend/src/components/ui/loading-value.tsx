/**
 * Valeur calculée en arrière-plan (un prix, par exemple), avec son indicateur de chargement.
 * - `variant` : `spinner` (par défaut, le spinner habituel) ou `dots` (trois points discrets).
 * - `keepValue` : pendant un recalcul, la dernière valeur reste affichée, estompée, au lieu
 *   de l'indicateur ; celui-ci ne sert plus qu'au tout premier calcul.
 */
import { useRef } from 'react'
import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

export function LoadingValue({
  loading,
  value,
  variant = 'spinner',
  keepValue = false,
  className,
}: {
  loading: boolean
  /** Valeur à jour, ou `null` s'il n'y en a pas (encore). */
  value: React.ReactNode | null
  variant?: 'spinner' | 'dots'
  keepValue?: boolean
  className?: string
}) {
  // Dernière valeur connue : reprise, estompée, pendant le recalcul.
  const last = useRef<React.ReactNode | null>(null)
  if (value !== null && value !== undefined) last.current = value

  if (loading) {
    if (keepValue && last.current !== null)
      return (
        <span
          data-loading
          className={cn(
            'opacity-40 transition-opacity duration-300',
            className,
          )}
        >
          {last.current}
        </span>
      )
    return variant === 'dots' ? (
      <span
        role="status"
        aria-label="Calcul en cours"
        className={cn('inline-flex items-center gap-[3px]', className)}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-[3px] rounded-full bg-current opacity-20"
            style={{
              animation: 'loading-dot 1.2s ease-in-out infinite',
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </span>
    ) : (
      <Loader2
        className={cn('h-3 w-3 animate-spin text-muted-foreground', className)}
      />
    )
  }
  if (value === null || value === undefined) return null
  // Nouvelle valeur : courte apparition en fondu.
  return (
    <span
      key={String(value)}
      className={cn('animate-in fade-in duration-300', className)}
    >
      {value}
    </span>
  )
}
