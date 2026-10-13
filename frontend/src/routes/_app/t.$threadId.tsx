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
import { ThreadMediaProvider } from '@/components/thread/ThreadMedia'
import { GenerationItem } from '@/components/thread/GenerationItem'
import { useRenameThread } from '@/components/thread/useRenameThread'
import { InlineEdit } from '@/components/ui/inline-edit'

export const Route = createFileRoute('/_app/t/$threadId')({
  // `g` : id d'une génération, pour arriver sur la demande qui l'a produite.
  validateSearch: (search: Record<string, unknown>): { g?: string } =>
    typeof search.g === 'string' && search.g ? { g: search.g } : {},
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
  // Arrivée depuis un média (?g=<id>) : on s'arrête sur la demande qui l'a
  // produit, et on la garde en vue pendant le chargement des images au-dessus.
  const { g: target } = Route.useSearch()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const pinned = useRef<string | null>(null)
  const shownCount = useRef<{ threadId: string; count: number } | null>(null)
  const targetNode = (id: string) =>
    scrollRef.current?.querySelector<HTMLElement>(
      `[data-generation-ids~="${CSS.escape(id)}"]`,
    ) ?? null
  const goToTarget = (id: string) => {
    const node = targetNode(id)
    if (!node) return false
    // Demande alignée en haut (avec une petite marge) : ses images de
    // référence, sa bulle et le début de son résultat restent visibles.
    const el = scrollRef.current!
    el.scrollTop +=
      node.getBoundingClientRect().top - el.getBoundingClientRect().top - 16
    return true
  }
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !count) return
    const opened = shownCount.current?.threadId !== threadId
    const grew = !opened && count > shownCount.current!.count
    shownCount.current = { threadId, count }
    if (opened) {
      if (target && goToTarget(target)) {
        stick.current = false
        pinned.current = target
        return
      }
      stick.current = true
      el.scrollTop = el.scrollHeight
    } else if (grew) {
      pinned.current = null
      stick.current = true
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [count, threadId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Même fil, nouveau repère (lien depuis la visionneuse du fil).
  useEffect(() => {
    if (!target || !count || shownCount.current?.threadId !== threadId) return
    if (goToTarget(target)) {
      stick.current = false
      pinned.current = target
    }
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    // Seul un geste de la personne (molette, doigt, clavier, barre de défilement)
    // décide de suivre le bas ou non : un défilement causé par la page elle-même
    // (composer qui grandit, image chargée) ne la décroche pas du bas.
    let userScrollUntil = 0
    const markUser = () => {
      userScrollUntil = Date.now() + 1000
    }
    const onScroll = () => {
      if (Date.now() > userScrollUntil) return
      if (!pinned.current)
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    // Geste de la personne : on ne la retient plus sur la demande visée.
    const release = () => {
      markUser()
      pinned.current = null
    }
    const observer = new ResizeObserver(() => {
      if (pinned.current) goToTarget(pinned.current)
      else if (stick.current) el.scrollTop = el.scrollHeight
    })
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', release, { passive: true })
    el.addEventListener('touchstart', release, { passive: true })
    el.addEventListener('keydown', release)
    el.addEventListener('pointerdown', release)
    // Le contenu qui grandit (images) et la zone qui rétrécit (composer qui s'agrandit).
    observer.observe(content)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', release)
      el.removeEventListener('touchstart', release)
      el.removeEventListener('keydown', release)
      el.removeEventListener('pointerdown', release)
      observer.disconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
          className="mx-auto max-w-[855px] space-y-8 px-4 py-6"
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
          <ThreadMediaProvider groups={groups}>
            {groups.map((group) => (
              <GenerationItem key={group[0].id} generations={group} />
            ))}
          </ThreadMediaProvider>
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
