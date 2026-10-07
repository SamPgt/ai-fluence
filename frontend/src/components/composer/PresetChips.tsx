import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import type { MediaKind } from '@ai-fluence/shared'

import { presetsQuery } from '@/lib/queries'

/** Raccourcis de prompt : un clic ajoute leur texte au prompt. */
export function PresetChips({ media, onPick }: { media: MediaKind; onPick: (text: string) => void }) {
  const { data: presets = [] } = useQuery(presetsQuery())
  const visible = presets.filter((p) => p.enabled && (p.media === 'all' || p.media === media))
  if (!visible.length) return null

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-2">
      {visible.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPick(p.text)}
          title={p.text}
          className="shrink-0 rounded-full border border-border/50 bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          {p.label}
        </button>
      ))}
      <Link
        to="/parametres"
        search={{ tab: 'shortcuts' }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Gérer les raccourcis"
      >
        <Plus className="h-3 w-3" />
      </Link>
    </div>
  )
}
