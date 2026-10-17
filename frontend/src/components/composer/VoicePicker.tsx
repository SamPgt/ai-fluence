/**
 * Bouton « Voix » du composer (modèles vidéo qui acceptent une voix de
 * référence) : choix d'une voix du persona, avec écoute de l'extrait.
 */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AudioLines, Check, ChevronDown } from 'lucide-react'
import type { Persona } from '@sublime/shared'

import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Flag,
  Tags,
  VoiceOrb,
  countryName,
  countryOf,
  stopVoicePreview,
} from '@/components/personas/VoiceLibrary'

export function VoicePicker({
  persona,
  value,
  onChange,
}: {
  persona: Persona
  /** Voix du persona choisie (son `id`). */
  value: string | null
  onChange: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const current = persona.voices.find((v) => v.id === value) ?? null
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) stopVoicePreview()
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="voice-picker"
          className="flex h-8 max-w-44 items-center gap-1.5 rounded-full px-3 text-[13px] text-foreground/80 shadow-[inset_0_0_0_1px_var(--color-border)] transition-colors hover:bg-accent/60"
          title="Voix de référence du persona"
        >
          <AudioLines className="size-3.5 shrink-0" />
          <span className="truncate">{current?.name ?? 'Voix'}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-[420px] overflow-hidden rounded-2xl p-0"
      >
        <div className="flex h-11 items-center border-b border-border/60 px-4 text-[12px] font-semibold text-muted-foreground">
          Voix de {persona.name}
        </div>
        {persona.voices.length ? (
          <div className="thin-scrollbar flex max-h-80 flex-col gap-1 overflow-y-auto p-1 pr-1">
            {persona.voices.map((v, i) => {
              const selected = v.id === value
              return (
                <div
                  key={v.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    onChange(selected ? null : v.id)
                    setOpen(false)
                    stopVoicePreview()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onChange(selected ? null : v.id)
                  }}
                  className={cn(
                    'group/voice flex cursor-pointer items-center gap-2 rounded-xl p-2 text-[13px] outline-none hover:bg-white/[0.05] focus-visible:bg-white/[0.05]',
                  )}
                >
                  <VoiceOrb
                    index={i}
                    url={v.previewUrl}
                    name={v.name}
                    size="sm"
                  />
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="shrink-0 truncate">{v.name}</span>
                    <Tags labels={v.labels} max={2} />
                  </span>
                  {(() => {
                    const code = countryOf(v.labels)
                    return code ? (
                      <span title={countryName(code)} className="shrink-0">
                        <Flag code={code} />
                      </span>
                    ) : null
                  })()}
                  {selected && <Check className="size-4 shrink-0" />}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="px-4 py-5 text-[12px] text-muted-foreground">
            Ce persona n’a pas encore de voix.
          </p>
        )}
        <div className="flex h-10 items-center border-t border-border/60 px-4 text-[12px] text-muted-foreground">
          <Link
            to="/personas/$personaId"
            params={{ personaId: persona.id }}
            onClick={() => setOpen(false)}
            className="hover:text-foreground"
          >
            Gérer les voix
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
