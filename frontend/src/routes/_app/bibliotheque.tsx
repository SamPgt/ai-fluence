/**
 * Bibliothèque : les références rangées par persona, puis Général (ce qui n'appartient à
 * aucun persona). « Voir tout » ouvre la fiche, « Ajouter » crée un persona.
 */
import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import type { PromptPreset } from '@sublime/shared'
import { useQuery } from '@tanstack/react-query'
import { Layers, Plus, Search } from 'lucide-react'

import { personasQuery, presetsQuery, referencesQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { ShortcutDialog } from '@/components/settings/ShortcutsTab'
import { NewPersonaDialog } from '@/components/personas/NewPersonaDialog'
import { PersonaAvatar } from '@/components/personas/PersonaAvatar'
import { ReferencesGrid } from '@/components/personas/ReferencesSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const Route = createFileRoute('/_app/bibliotheque')({
  component: LibraryPage,
})

/** Cartes de 128 px, autant que la largeur le permet. */
const GRID = 'grid grid-cols-[repeat(auto-fill,7rem)] gap-2.5'

function LibraryPage() {
  const { data: personas = [] } = useQuery(personasQuery())
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  // Recherche par nom de persona (Général compris).
  const q = search.trim().toLocaleLowerCase('fr')
  const matches = (name: string) =>
    !q || name.toLocaleLowerCase('fr').includes(q)
  const shown = personas.filter((p) => matches(p.name))
  return (
    <>
      {/* Pas de barre d'en-tête ici : le titre de la page suffit. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">
          <div className="mb-6 flex items-center gap-3">
            <h1 className="flex-1 text-2xl font-semibold tracking-tight">
              Bibliothèque
            </h1>
            <div className="relative w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher"
                aria-label="Rechercher dans la bibliothèque"
                className="h-9 pl-9"
              />
            </div>
            <Button onClick={() => setCreating(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> Ajouter
            </Button>
          </div>
          {shown.map((p) => (
            <Section
              key={p.id}
              owner={{ id: p.id, name: p.name }}
              icon={
                <PersonaAvatar persona={p} size={32} className="rounded-lg" />
              }
              link={
                <Link
                  to="/personas/$personaId"
                  params={{ personaId: p.id }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Voir tout
                </Link>
              }
            />
          ))}
          {matches('Général') && <GeneralSection />}
          {q && shown.length === 0 && !matches('Général') && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Aucun persona ne correspond à « {search.trim()} ».
            </p>
          )}
        </div>
      </div>
      <NewPersonaDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

/** Un persona (ou Général) : titre, nombre de références, puis la grille avec la carte « + ». */
function Section({
  owner,
  icon,
  link,
  count,
  children,
}: {
  owner: { id: string; name: string }
  icon: React.ReactNode
  link: React.ReactNode
  /** Compteurs ajoutés après celui des références (ex. raccourcis de Général). */
  count?: string
  /** Contenu sous la grille des références. */
  children?: React.ReactNode
}) {
  const { data: refs = [] } = useQuery(referencesQuery(owner.id))
  return (
    <section
      data-testid="library-section"
      aria-label={owner.name}
      className="space-y-3 border-b border-border/40 py-7 first-of-type:pt-0 last:border-b-0"
    >
      <div className="flex items-center gap-3">
        {icon}
        <h2 className="text-lg font-medium">{owner.name}</h2>
        <span className="text-sm text-muted-foreground">
          {refs.length} référence{refs.length > 1 ? 's' : ''}
          {count && ` · ${count}`}
        </span>
        <span className="ml-auto">{link}</span>
      </div>
      <ReferencesGrid owner={owner} className={GRID} />
      {children}
    </section>
  )
}

/** Général : ses références, puis ses raccourcis (tous généraux), modifiables d'un clic. */
function GeneralSection() {
  const { data: shortcuts = [] } = useQuery(presetsQuery())
  const [editing, setEditing] = useState<PromptPreset | null>(null)
  const [open, setOpen] = useState(false)
  const edit = (s: PromptPreset | null) => {
    setEditing(s)
    setOpen(true)
  }
  return (
    <Section
      owner={{ id: 'general', name: 'Général' }}
      count={`${shortcuts.length} raccourci${shortcuts.length > 1 ? 's' : ''}`}
      icon={
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Layers className="h-4 w-4" />
        </span>
      }
      link={
        <Link
          to="/bibliotheque/general"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Voir tout
        </Link>
      }
    >
      <div aria-label="Raccourcis" className="flex flex-wrap gap-2 pt-2">
        {shortcuts.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => edit(s)}
            title={s.text}
            className={cn(
              'flex h-8 items-center rounded-lg border border-border/60 bg-white/[0.03] px-3 text-[13px] transition-colors hover:border-border hover:bg-white/[0.06]',
              !s.enabled &&
                'text-muted-foreground line-through decoration-muted-foreground/50',
            )}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => edit(null)}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border/70 px-3 text-[13px] text-muted-foreground hover:border-border hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Raccourci
        </button>
      </div>
      <ShortcutDialog open={open} shortcut={editing} onOpenChange={setOpen} />
    </Section>
  )
}
