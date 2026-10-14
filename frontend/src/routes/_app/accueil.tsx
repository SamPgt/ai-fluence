/**
 * Accueil : où en est-on, et où reprendre. Salutation et crédit, les derniers fils (avec
 * leurs images), les dernières générations et les workflows à lancer depuis un fil.
 * Pas de composer ici : « Nouveau fil » ouvre un fil vierge.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  ImageIcon,
  KeyRound,
  Library,
  Play,
  Workflow,
} from 'lucide-react'
import type { Thread, WorkflowSummary } from '@ai-fluence/shared'

import { assetsApi } from '@/lib/api'
import {
  balanceQuery,
  qk,
  settingsQuery,
  threadsQuery,
  workflowsQuery,
} from '@/lib/queries'
import { formatUsd, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { sessionQueryOptions } from '@/server/auth'
import { PageHeader } from '@/components/layout/PageHeader'

export const Route = createFileRoute('/_app/accueil')({
  component: HomePage,
})

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function HomePage() {
  const { data: user } = useQuery(sessionQueryOptions())
  const { data: settings } = useQuery(settingsQuery())
  const { data: balance } = useQuery(balanceQuery(Boolean(settings?.hasApiKey)))
  const { data: threads = [] } = useQuery(threadsQuery(null))
  const { data: workflows = [] } = useQuery(workflowsQuery())
  const gallery = useInfiniteQuery({
    queryKey: qk.gallery(null, 'image'),
    queryFn: ({ pageParam }) =>
      assetsApi.gallery({ media: 'image', before: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
  })
  const latest = gallery.data?.pages[0]?.items.slice(0, 8) ?? []

  const hour = new Date().getHours()
  const greeting = hour >= 5 && hour < 18 ? 'Bonjour' : 'Bonsoir'
  const firstName = user?.name.split(' ')[0] ?? ''
  const thisWeek = threads.filter(
    (t) => Date.now() - Date.parse(t.updatedAt) < WEEK_MS,
  ).length
  const recent = [...threads]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 3)
  const usable = workflows.filter((w) => w.usableInThread).slice(0, 4)
  const isNew = threads.length === 0

  return (
    <>
      <PageHeader>
        <span className="text-sm font-medium">Accueil</span>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-10 px-8 py-10 pb-20">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">
              {greeting}
              {firstName && ` ${firstName}`}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">
              {settings && !settings.hasApiKey
                ? 'Clé API manquante'
                : `${balance ? formatUsd(balance.available, 'balance') : '…'} de crédit`}
              {' · '}
              {thisWeek} fil{thisWeek > 1 ? 's' : ''} cette semaine
            </p>
          </header>

          {isNew ? (
            <FirstSteps hasApiKey={Boolean(settings?.hasApiKey)} />
          ) : (
            <section className="space-y-3">
              <SectionTitle title="Reprendre" />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {recent.map((t) => (
                  <ThreadCard key={t.id} thread={t} />
                ))}
              </div>
            </section>
          )}

          {(latest.length > 0 || usable.length > 0) && (
            <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
              <section className="space-y-3">
                <SectionTitle
                  title="Dernières générations"
                  link={{ to: '/galerie', label: 'Galerie' }}
                />
                {latest.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2">
                    {latest.map(({ asset, generation }) => (
                      <Link
                        key={asset.id}
                        to={generation?.threadId ? '/t/$threadId' : '/galerie'}
                        params={
                          generation?.threadId
                            ? { threadId: generation.threadId }
                            : undefined
                        }
                        search={
                          generation?.threadId
                            ? { g: generation.id }
                            : undefined
                        }
                        className="aspect-square overflow-hidden rounded-xl bg-muted"
                      >
                        <img
                          src={asset.url}
                          alt={generation?.prompt ?? 'Génération'}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform hover:scale-[1.03]"
                        />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Aucune image pour l’instant.
                  </p>
                )}
              </section>

              <section className="space-y-3">
                <SectionTitle
                  title="Tes workflows"
                  link={{ to: '/workflows', label: 'Tout voir' }}
                />
                {usable.length > 0 ? (
                  <div className="space-y-2">
                    {usable.map((w) => (
                      <WorkflowRow key={w.id} workflow={w} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Un workflow avec une entrée « À fournir au lancement » se
                    lance d’ici.
                  </p>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function SectionTitle({
  title,
  link,
}: {
  title: string
  link?: { to: '/galerie' | '/workflows'; label: string }
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[15px] font-medium">{title}</h2>
      {link && (
        <Link
          to={link.to}
          className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          {link.label} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  )
}

/** Un fil récent : une grande image et deux petites, puis son titre. */
function ThreadCard({ thread }: { thread: Thread }) {
  const [big, ...small] = thread.previewUrls
  const tile = 'min-h-0 overflow-hidden rounded-lg bg-white/[0.04]'
  const empty = (
    <span className="grid h-full w-full place-items-center text-muted-foreground/50">
      <ImageIcon className="h-5 w-5" />
    </span>
  )
  return (
    <Link
      to="/t/$threadId"
      params={{ threadId: thread.id }}
      data-testid="home-thread"
      className="group block rounded-2xl border border-border/50 bg-card/40 p-2 transition-colors hover:border-border hover:bg-card/70"
    >
      <div className="grid h-40 grid-cols-[2fr_1fr] grid-rows-1 gap-1.5">
        <div className={tile}>
          {big ? (
            <img src={big} alt="" className="h-full w-full object-cover" />
          ) : (
            empty
          )}
        </div>
        <div className="grid min-h-0 grid-rows-2 gap-1.5">
          {[0, 1].map((i) => (
            <div key={i} className={tile}>
              {small[i] ? (
                <img
                  src={small[i]}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                empty
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="px-2 pt-3 pb-1.5">
        <div className="truncate text-[14px] font-medium">{thread.title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {thread.generationCount} génération
          {thread.generationCount > 1 ? 's' : ''} · {timeAgo(thread.updatedAt)}
        </div>
      </div>
    </Link>
  )
}

/** Workflow utilisable dans un fil : ▶ ouvre un fil vierge avec son formulaire. */
function WorkflowRow({ workflow: w }: { workflow: WorkflowSummary }) {
  return (
    <Link
      to="/"
      search={{ workflow: w.id }}
      data-testid="home-workflow"
      className="group flex items-center gap-3 rounded-xl border border-border/50 bg-card/40 p-2.5 transition-colors hover:border-border hover:bg-card/70"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
        {w.coverUrl ? (
          <img src={w.coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Workflow className="h-4 w-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{w.name}</span>
        <span className="block text-xs text-muted-foreground">
          {w.inputCount} entrée{w.inputCount > 1 ? 's' : ''}
        </span>
      </span>
      <span
        aria-label={`Lancer ${w.name}`}
        className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-foreground transition-colors group-hover:bg-white/[0.12]"
      >
        <Play className="h-3.5 w-3.5 fill-current" />
      </span>
    </Link>
  )
}

/** Compte neuf : trois premiers pas à la place des fils. */
function FirstSteps({ hasApiKey }: { hasApiKey: boolean }) {
  const steps = [
    {
      done: hasApiKey,
      icon: KeyRound,
      title: 'Ajoute ta clé API',
      text: 'Pour générer des images et des vidéos.',
      link: (
        <Link to="/parametres" search={{ tab: 'api-key' }}>
          Paramétrage
        </Link>
      ),
    },
    {
      done: false,
      icon: Library,
      title: 'Crée un persona',
      text: 'Range ses photos de référence dans la Bibliothèque.',
      link: <Link to="/bibliotheque">Bibliothèque</Link>,
    },
    {
      done: false,
      icon: Workflow,
      title: 'Essaie un workflow',
      text: 'Enchaîne plusieurs étapes, puis lance-le depuis un fil.',
      link: <Link to="/workflows">Workflows</Link>,
    },
  ]
  return (
    <section className="space-y-3">
      <SectionTitle title="Premiers pas" />
      <div className="grid gap-4 sm:grid-cols-3">
        {steps.map(({ done, icon: Icon, title, text, link }) => (
          <div
            key={title}
            className={cn(
              'space-y-2 rounded-2xl border border-border/50 bg-card/40 p-4',
              done && 'opacity-50',
            )}
          >
            <Icon className="h-4 w-4 text-muted-foreground" />
            <div className="text-[14px] font-medium">{title}</div>
            <p className="text-xs text-muted-foreground">{text}</p>
            <div className="text-[13px] text-foreground/80 underline-offset-4 hover:underline">
              {link}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
