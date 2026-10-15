/**
 * Choix du modèle de dictée : même présentation que le menu des modèles photo et vidéo
 * (logo de la marque, nom, description), rangé en sections Rapide, Précis et Autre.
 */
import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { DICTATION_MODELS, type DictationProvider } from '@sublime/shared'

import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

const SECTIONS = [
  { id: 'fast', label: 'Rapide' },
  { id: 'accurate', label: 'Précis' },
  { id: 'other', label: 'Autre' },
] as const

function BrandLogo({ src, small = false }: { src: string; small?: boolean }) {
  const img = (
    <img
      src={src}
      alt=""
      draggable={false}
      className="size-3.5 rounded-[3px] object-contain"
    />
  )
  return small ? (
    <span className="flex size-3.5 shrink-0 items-center justify-center">
      {img}
    </span>
  ) : (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-white/[0.08]">
      {img}
    </span>
  )
}

export function DictationModelField({
  value,
  available,
  onChange,
}: {
  value: DictationProvider
  /** Fournisseurs configurés ; les autres restent visibles, grisés. */
  available: DictationProvider[]
  onChange: (id: DictationProvider) => void
}) {
  const [open, setOpen] = useState(false)
  const current =
    DICTATION_MODELS.find((m) => m.id === value) ?? DICTATION_MODELS[0]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Modèle de dictée"
          className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent/40"
        >
          <BrandLogo src={current.logo} small />
          <span className="min-w-0 flex-1 truncate text-left">
            {current.label}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-testid="dictation-menu"
        align="start"
        className="w-80 overflow-hidden rounded-2xl p-0 pb-1.5"
      >
        {SECTIONS.map((section) => {
          const models = DICTATION_MODELS.filter(
            (m) => m.section === section.id,
          )
          if (!models.length) return null
          return (
            <div key={section.id}>
              <div className="px-3.5 pt-3 pb-1.5 text-[12px] font-semibold text-muted-foreground select-none">
                {section.label}
              </div>
              <div className="flex flex-col gap-1">
                {models.map((m) => {
                  const usable = available.includes(m.id)
                  return (
                    <div
                      key={m.id}
                      role="menuitemradio"
                      aria-checked={m.id === value}
                      aria-disabled={!usable}
                      tabIndex={usable ? 0 : -1}
                      onClick={() => {
                        if (!usable) return
                        onChange(m.id)
                        setOpen(false)
                      }}
                      onKeyDown={(e) => {
                        if (usable && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault()
                          onChange(m.id)
                          setOpen(false)
                        }
                      }}
                      className={cn(
                        'mx-1 flex h-[53px] items-start gap-2 rounded-xl p-2 outline-none',
                        usable
                          ? 'cursor-pointer hover:bg-white/[0.05] focus-visible:bg-white/[0.05]'
                          : 'cursor-not-allowed opacity-45',
                      )}
                    >
                      <BrandLogo src={m.logo} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-foreground">
                          {m.label}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {usable ? m.hint : 'Clé à configurer sur le serveur'}
                        </div>
                      </div>
                      {m.id === value && (
                        <Check className="size-4 self-center text-foreground" />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
