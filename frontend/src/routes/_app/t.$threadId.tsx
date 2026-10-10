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
  const bottomRef = useRef<HTMLDivElement>(null)
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

  // Défilement : tout en bas à l'ouverture du fil, et on y reste pendant que les
  // images se chargent (elles agrandissent la page). Si la personne remonte, on
  // la laisse ; une nouvelle génération ramène en bas, en douceur.
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const shownCount = useRef<{ threadId: string; count: number } | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !count) return
    const opened = shownCount.current?.threadId !== threadId
    const grew = !opened && count > shownCount.current!.count
    shownCount.current = { threadId, count }
    if (opened) {
      stick.current = true
      el.scrollTop = el.scrollHeight
    } else if (grew) {
      stick.current = true
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [count, threadId])
  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    const observer = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight
    })
    el.addEventListener('scroll', onScroll, { passive: true })
    observer.observe(content)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [])

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
        data-testid="thread-scroll"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div
          ref={contentRef}
          className="mx-auto max-w-[810px] space-y-8 px-4 py-6"
        >
          {isLoading && (
            <div className="flex justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <p className="py-20 text-center text-sm text-muted-foreground">
              {(error as Error).message}
            </p>
          )}
          {groups.map((group) => (
            <GenerationItem key={group[0].id} generations={group} />
          ))}
          <div ref={bottomRef} />
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
