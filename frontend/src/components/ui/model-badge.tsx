import { BADGE_INFO, type ModelBadge as Badge } from '@ai-fluence/shared'

import { cn } from '@/lib/utils'

const CLASS: Record<Badge, string> = {
  LORA: 'badge-lora',
  REF: 'badge-ref',
  PERF: 'badge-perf',
}

/** Tag coloré qui dit pourquoi on propose le modèle (LORA / REF / PERF). */
export function ModelBadge({ badge, className }: { badge: Badge; className?: string }) {
  return (
    <span
      title={BADGE_INFO[badge].description}
      className={cn(
        'inline-flex h-[18px] items-center rounded px-1.5 text-[10px] font-semibold tracking-wide',
        CLASS[badge],
        className,
      )}
    >
      {BADGE_INFO[badge].label}
    </span>
  )
}
