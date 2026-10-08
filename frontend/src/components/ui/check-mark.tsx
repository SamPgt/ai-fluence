import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Case à cocher visuelle de l'app : cochée, bordure plus claire, fond teinté
 * à 15 % et coche claire. `lora` : même chose en violet.
 */
export function CheckMark({
  checked,
  tone = 'default',
  className,
}: {
  checked: boolean
  tone?: 'default' | 'lora'
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
        !checked && 'border-muted-foreground/50',
        checked && tone === 'default' && 'border-foreground/60 bg-foreground/15 text-foreground',
        checked && tone === 'lora' && 'border-violet-400/60 bg-violet-400/15 text-violet-300',
        className,
      )}
    >
      {/* Couleur forcée : les menus (cmdk) grisent leurs icônes. */}
      {checked && <Check className="h-3 w-3" strokeWidth={3} style={{ color: 'inherit' }} />}
    </span>
  )
}
