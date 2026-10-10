import { useEffect, useMemo, useRef, useState } from 'react'
import type { Generation } from '@ai-fluence/shared'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'

import { personasQuery, threadQuery } from '@/lib/queries'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { PersonaAvatar } from '@/components/personas/PersonaAvatar'
import { Composer } from '@/components/composer/Composer'
import { GenerationItem } from '@/components/thread/GenerationItem'
import { useRenameThread } from '@/components/thread/useRenameThread'
import { InlineEdit } from '@/components/ui/inline-edit'

export const Route = createFileRoute('/_app/t/$threadId')({
  component: ThreadPage,
})

function ThreadPage() {
  const { threadId } = Route.useParams()
  const { data, isLoading, error } = useQuery(threadQuery(threadId))
  const [editingTitle, setEditingTitle] = useState(false)
  const rename = useRenameThread()
  useEffect(() => setEditingTitle(false), [threadId])
  const { data: personas = [] } = useQuery(personasQuery())
  const persona = personas.find((p) => p.id === data?.thread.personaId) ?? null
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  /** Collé en bas : vrai à l'ouverture, faux dès que l'utilisateur remonte dans le fil. */
  const stickRef = useRef(true)
  const count = data?.generations.length ?? 0

  // Une série (demande ×N) s'affiche en un seul bloc : ses générations sont regroupées.
  const groups = useMemo(() => {
    const out: Generation[][] = []
    for (const g of data?.generations ?? []) {
      const last = out.at(-1)
      if (g.batchId && last?.[0].batchId === g.batchId) last.push(g)
      else out.push([g])
    }
    return out
  }, [data?.generations])

  // Reste en bas du fil pendant que son contenu grandit (images qui se chargent après l'ouverture,
  // nouvelle génération), sauf si l'utilisateur est remonté lire plus haut.
  useEffect(() => {
    stickRef.current = true
  }, [threadId])
  useEffect(() => {
    stickRef.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count, threadId])
  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    const follow = () => {
      if (stickRef.current) el.scrollTop = el.scrollHeight
    }
    const observer = new ResizeObserver(follow)
    observer.observe(content)
    // Le cadre aussi : il rapetisse quand le composer apparaît sous le fil.
    observer.observe(el)
    // Chaque image chargée (l'évènement ne remonte pas : on l'écoute en capture).
    content.addEventListener('load', follow, true)
    return () => {
      observer.disconnect()
      content.removeEventListener('load', follow, true)
    }
  }, [threadId])

  return (
    <>
      <PageHeader
        right={
          data && (
            <span className="text-xs text-muted-foreground tabular-nums">
              Total du fil :{' '}
              <span className="text-foreground">
                {formatUsd(data.thread.totalCost)}
              </span>
            </span>
          )
        }
      >
        {persona && (
          <Link
            to="/personas/$personaId"
            params={{ personaId: persona.id }}
            className="flex items-center gap-2"
          >
            <PersonaAvatar persona={persona} size={24} className="rounded-md" />
          </Link>
        )}
        {/* Clic sur le titre : renommer le fil. Le conteneur porte padding, police et hauteur de ligne,
            pour que le texte ne bouge pas d'un pixel entre l'affichage et l'édition. */}
        <div
          className={cn(
            'min-w-0 rounded-md px-1.5 py-0.5 text-sm leading-5 font-medium transition-colors',
            editingTitle ? 'w-full max-w-xl bg-accent' : 'hover:bg-accent',
          )}
        >
          {editingTitle && data ? (
            <InlineEdit
              value={data.thread.title}
              onSubmit={(title) => {
                setEditingTitle(false)
                rename.mutate({ id: threadId, title })
              }}
              onCancel={() => setEditingTitle(false)}
              className="block h-5 leading-5 font-medium"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              title="Renommer le fil"
              className="block w-full truncate text-left"
            >
              {data?.thread.title ?? ''}
            </button>
          )}
        </div>
      </PageHeader>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        // Seul un geste de l'utilisateur décroche du bas ; revenir en bas raccroche.
        onWheel={(e) => {
          if (e.deltaY < 0) stickRef.current = false
        }}
        onTouchMove={() => {
          stickRef.current = false
        }}
        onPointerDown={(e) => {
          // Clic sur la barre de défilement (le cadre lui-même, pas son contenu).
          if (e.target === e.currentTarget) stickRef.current = false
        }}
        onKeyDown={(e) => {
          if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) stickRef.current = false
        }}
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) stickRef.current = true
        }}
      >
        <div ref={contentRef} className="mx-auto max-w-4xl space-y-8 px-4 py-6">
          {isLoading && (
            <div className="flex justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && <p className="py-20 text-center text-sm text-muted-foreground">{(error as Error).message}</p>}
          {groups.map((group) => (
            <GenerationItem key={group[0].id} generations={group} />
          ))}
        </div>
      </div>

      {/* Monté une fois le fil chargé : le persona et le modèle par défaut en dépendent. */}
      {data && (
        <Composer
          threadId={threadId}
          personaId={data.thread.personaId}
          suggestedFamily={data.generations.at(-1)?.family ?? null}
        />
      )}
    </>
  )
}
