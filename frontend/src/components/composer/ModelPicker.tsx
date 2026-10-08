import { useState } from 'react'
import { Check, ChevronDown, Film, ImageIcon } from 'lucide-react'
import type { CatalogFamily } from '@ai-fluence/shared'

import { cn } from '@/lib/utils'
import { formatUsd } from '@/lib/format'
import { ModelBadge } from '@/components/ui/model-badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** Les modèles locaux d'abord (sur le GPU, gratuits), puis les modèles cloud par type de média. */
const SECTIONS: { title: string; match: (f: CatalogFamily) => boolean }[] = [
  { title: 'Modèles locaux', match: (f) => f.provider === 'comfy' },
  { title: 'Modèles photo', match: (f) => f.provider !== 'comfy' && f.media === 'image' },
  { title: 'Modèles vidéo', match: (f) => f.provider !== 'comfy' && f.media === 'video' },
]

function startingPrice(f: CatalogFamily): string | null {
  const prices = Object.values(f.tasks)
    .map((t) => t?.startingPrice)
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
  if (!prices.length) return null
  const cheapest = prices.reduce((a, b) => (Number(a.price) <= Number(b.price) ? a : b))
  return `dès ${formatUsd(cheapest.price)}${cheapest.unit === 'per_second' ? '/s' : cheapest.unit === 'per_image' ? '/img' : ''}`
}

export function ModelPicker({
  families,
  value,
  onChange,
  lora,
}: {
  families: CatalogFamily[]
  value: string | null
  onChange: (id: string) => void
  /** LoRA du persona appliquée sur ce modèle (affichée sur le bouton). */
  lora?: { personaName: string; triggerWord: string } | null
}) {
  const [open, setOpen] = useState(false)
  const current = families.find((f) => f.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-3 text-xs font-medium transition-colors hover:bg-accent"
        >
          {current?.media === 'video' ? <Film className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
          <span className="max-w-[140px] truncate">{current?.label ?? 'Choisir un modèle'}</span>
          {lora && (
            <span
              title={`LoRA de ${lora.personaName} appliquée${lora.triggerWord ? ` (« ${lora.triggerWord} »)` : ''}`}
              className="flex items-center gap-1 rounded bg-violet-500/15 px-1.5 py-px text-[10px] font-semibold text-violet-300"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              LoRA
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[360px] p-1.5">
        {/* Marge à droite : la barre de défilement ne passe plus sur les badges. */}
        <div className="max-h-[60vh] overflow-y-auto pr-2.5">
          {SECTIONS.filter((section) => families.some(section.match)).map((section) => (
            <div key={section.title} className="pb-1">
              {/* Titre de section : gras, petit, blanc-gris */}
              <div className="px-2 pt-2 pb-1 text-[11px] font-bold tracking-wide text-zinc-300 uppercase">
                {section.title}
              </div>
              {families
                .filter(section.match)
                .map((f) => {
                  const price = startingPrice(f)
                  return (
                    <button
                      key={f.id}
                      type="button"
                      disabled={!f.available}
                      onClick={() => {
                        onChange(f.id)
                        setOpen(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        f.id === value ? 'bg-accent' : 'hover:bg-accent/60',
                        !f.available && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      <span className="w-4 shrink-0">{f.id === value && <Check className="h-3.5 w-3.5" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{f.label}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {f.available ? f.hint : (f.unavailableReason ?? 'Indisponible')}
                          {price && f.available ? ` · ${price}` : ''}
                        </span>
                      </span>
                      <span className="flex shrink-0 gap-1">
                        {f.badges.map((b) => (
                          <ModelBadge key={b} badge={b} />
                        ))}
                      </span>
                    </button>
                  )
                })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
