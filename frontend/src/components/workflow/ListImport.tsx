/**
 * Importer une liste toute faite dans un nœud Liste : coller un texte (une ligne par
 * élément), ou choisir une liste dans un pack de wildcards Civitai (recherche, pack, liste,
 * aperçu). La liste importée remplace la liste du nœud, ou s'ajoute à la suite.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Download, List as ListIcon, Loader2, Package, Search, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { LIST_LIMITS, splitList, type CivitaiWildcard, type ListEntry, type WildcardList } from '@sublime/shared'

import { civitaiApi, listsApi } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { CheckMark } from '@/components/ui/check-mark'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

/** Éléments activés d'office à l'import : au-delà, un tirage au hasard (le reste reste inactif). */
export const IMPORT_ACTIVE = 10

/** Éléments importés : tous actifs s'ils sont peu nombreux, sinon `IMPORT_ACTIVE` au hasard. */
export function importedEntries(lines: string[]): ListEntry[] {
  if (lines.length <= IMPORT_ACTIVE) return lines.map((text) => ({ text, active: true }))
  const picked = new Set<number>()
  while (picked.size < IMPORT_ACTIVE) picked.add(Math.floor(Math.random() * lines.length))
  return lines.map((text, i) => ({ text, active: picked.has(i) }))
}

type Source = 'civitai' | 'paste'

/** Lignes reformulées au plus en une fois (au-delà, un tirage au hasard). */
const REWRITE_MAX = 200

interface Picked {
  lines: string[]
  total: number
  name: string | null
  /** `tags` : écrite pour Stable Diffusion, une reformulation en phrases est proposée. */
  format?: 'tags' | 'text'
}

function sample(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines
  const picked = new Set<number>()
  while (picked.size < max) picked.add(Math.floor(Math.random() * lines.length))
  return lines.filter((_, i) => picked.has(i))
}

export function ListImportDialog({
  open,
  onClose,
  hasEntries,
  onImport,
}: {
  open: boolean
  onClose: () => void
  /** La liste du nœud a déjà des éléments : choix entre remplacer et ajouter. */
  hasEntries: boolean
  onImport: (lines: string[], mode: 'replace' | 'append', name: string | null) => void
}) {
  const [source, setSource] = useState<Source>('civitai')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [rewriteOn, setRewriteOn] = useState(true)

  useEffect(() => {
    if (!open) setPicked(null)
  }, [open])

  // Liste au format Stable Diffusion : reformulée en phrases par le modèle de texte (payant),
  // au plus 200 lignes tirées au hasard. Le prix s'affiche sur le bouton avant de payer.
  // Tirage fait une fois par liste choisie : le devis et la reformulation portent sur les mêmes lignes.
  const toRewrite = useMemo(() => (picked?.format === 'tags' ? sample(picked.lines, REWRITE_MAX) : null), [picked])
  const rewriting = Boolean(toRewrite && rewriteOn)
  const quote = useQuery({
    queryKey: ['list-rewrite-quote', toRewrite?.length, toRewrite?.[0]],
    queryFn: () => listsApi.rewriteQuote(toRewrite!),
    enabled: rewriting,
    staleTime: 10 * 60_000,
  })
  const rewrite = useMutation({ mutationFn: (items: string[]) => listsApi.rewrite(items) })

  const finish = async (mode: 'replace' | 'append') => {
    if (!picked?.lines.length) return
    let lines = picked.lines
    if (rewriting && toRewrite) {
      try {
        lines = (await rewrite.mutateAsync(toRewrite)).items
      } catch (e) {
        toast.error((e as Error).message)
        return
      }
    }
    onImport(lines.slice(0, LIST_LIMITS.entries), mode, picked.name)
    onClose()
  }
  const count = rewriting ? (toRewrite?.length ?? 0) : (picked?.lines.length ?? 0)
  const busy = rewrite.isPending
  const price = rewriting && quote.data ? ` · ≈ ${formatUsd(quote.data.estimatedCost)}` : ''

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-0 p-0 sm:max-w-[520px]" data-testid="list-import">
        <div className="space-y-3 px-4 pt-4 pb-3">
          <DialogTitle className="text-sm font-medium">Importer une liste</DialogTitle>
          <div className="flex gap-1.5" role="tablist">
            {(
              [
                ['civitai', 'Civitai'],
                ['paste', 'Coller'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={source === id}
                onClick={() => {
                  setSource(id)
                  setPicked(null)
                }}
                className={cn(
                  'rounded-lg border px-3 py-1 text-xs transition-colors',
                  source === id
                    ? 'border-transparent bg-foreground/10 text-foreground'
                    : 'border-border/60 text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-[340px] border-y border-border/60">
          {source === 'paste' ? <PasteSource onPick={setPicked} /> : <CivitaiSource open={open} onPick={setPicked} />}
        </div>

        {toRewrite && (
          <button
            type="button"
            role="checkbox"
            aria-checked={rewriteOn}
            onClick={() => setRewriteOn(!rewriteOn)}
            className="flex w-full items-start gap-2.5 border-b border-border/60 px-4 py-2.5 text-left"
          >
            <CheckMark checked={rewriteOn} className="mt-0.5" />
            <span className="text-xs text-muted-foreground">
              <span className="block text-[13px] text-foreground">Reformuler en phrases</span>
              Liste écrite pour Stable Diffusion (suites de tags) : chaque ligne devient une courte phrase en
              français, mieux comprise par nos modèles.
              {picked!.lines.length > REWRITE_MAX && ` ${REWRITE_MAX} lignes tirées au hasard.`}
            </span>
          </button>
        )}
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <span data-testid="list-import-count" className="text-xs text-muted-foreground tabular-nums">
            {count
              ? `${count} élément${count > 1 ? 's' : ''}${count > IMPORT_ACTIVE ? `, ${IMPORT_ACTIVE} activés au hasard` : ''}`
              : 'Aucune liste choisie'}
          </span>
          <div className="flex gap-2">
            {hasEntries && (
              <Button variant="ghost" size="sm" disabled={!count || busy} onClick={() => void finish('append')}>
                Ajouter à la suite
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!count || busy || (rewriting && !quote.data)}
              onClick={() => void finish('replace')}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : rewriting ? (
                <Sparkles className="h-3.5 w-3.5" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {busy
                ? 'Reformulation…'
                : rewriting
                  ? `${hasEntries ? 'Remplacer' : 'Importer'} et reformuler${price}`
                  : hasEntries
                    ? 'Remplacer la liste'
                    : 'Importer'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Texte collé : une ligne par élément (puces et numéros retirés). */
function PasteSource({ onPick }: { onPick: (p: { lines: string[]; total: number; name: null } | null) => void }) {
  const [text, setText] = useState('')
  return (
    <textarea
      autoFocus
      aria-label="Texte à importer"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const lines = [...new Set(splitList(e.target.value, LIST_LIMITS.entries))]
        onPick(lines.length ? { lines, total: lines.length, name: null } : null)
      }}
      placeholder={'Colle ta liste, une ligne par élément :\nforêt de bambous\nrue de Tokyo la nuit\ncafé parisien'}
      className="h-full w-full resize-none bg-transparent px-4 py-3 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
    />
  )
}

/** Archive la plus lourde acceptée par le serveur. */
const PACK_MAX_KB = 10_000

const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 })

/** Ligne d'un niveau de navigation : icône, nom, détail, et ce qui est à droite. */
function NavRow({
  icon: Icon,
  title,
  detail,
  aside,
  onClick,
  disabled,
  hint,
  testId,
}: {
  icon: typeof Package
  title: string
  detail?: string
  aside?: React.ReactNode
  onClick: () => void
  disabled?: boolean
  hint?: string
  testId?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className="flex w-full items-center gap-2.5 border-b border-border/30 px-4 py-2 text-left hover:bg-accent/50 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{title}</span>
        {detail && <span className="block truncate text-[11px] text-muted-foreground">{detail}</span>}
      </span>
      {aside}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}

/** « 32 éléments » en pastille, à droite d'une liste. */
const CountPill = ({ n }: { n: number }) => (
  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground tabular-nums">
    {n.toLocaleString('fr-FR')} élément{n > 1 ? 's' : ''}
  </span>
)

/**
 * Civitai, en trois niveaux bien distincts, avec un fil d'Ariane « Packs › pack › liste » :
 * les packs (une archive, icône de boîte), les listes d'un pack (icône de liste, nombre
 * d'éléments en pastille), puis l'aperçu d'une liste (lignes numérotées, rien à cliquer).
 * La recherche cherche des packs, ou filtre les listes du pack ouvert. Au retour, chaque
 * niveau retrouve sa position de défilement.
 */
function CivitaiSource({
  open,
  onPick,
}: {
  open: boolean
  onPick: (p: Picked | null) => void
}) {
  const status = useQuery({ queryKey: ['civitai-status'], queryFn: civitaiApi.status, staleTime: 5 * 60_000 })
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const [pack, setPack] = useState<CivitaiWildcard | null>(null)
  const [list, setList] = useState<WildcardList | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const scrolls = useRef({ packs: 0, lists: 0 })
  const level = list ? 'preview' : pack ? 'lists' : 'packs'

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 300)
    return () => clearTimeout(t)
  }, [input])
  // Chaque niveau retrouve sa position (l'aperçu repart du haut).
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = level === 'preview' ? 0 : scrolls.current[level]
  }, [level])

  const enabled = open && status.data?.enabled === true
  const search = useInfiniteQuery({
    queryKey: ['civitai-wildcards', query],
    queryFn: ({ pageParam }) => civitaiApi.wildcards({ query: query || undefined, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 5 * 60_000,
  })
  const lists = useQuery({
    queryKey: ['civitai-wildcard-lists', pack?.versionId],
    queryFn: () => civitaiApi.wildcardLists(pack!.versionId),
    enabled: Boolean(pack),
    staleTime: 60 * 60_000,
    retry: false,
  })

  const remember = () => {
    if (scroller.current && level !== 'preview') scrolls.current[level] = scroller.current.scrollTop
  }
  const single = (lists.data?.lists.length ?? 0) === 1
  const choose = (l: WildcardList) => {
    remember()
    setList(l)
    onPick({ lines: l.items, total: l.total, name: single ? pack!.name : `${pack!.name} · ${l.name}`, format: l.format })
  }
  const openPack = (w: CivitaiWildcard) => {
    remember()
    scrolls.current.lists = 0
    setFilter('')
    setPack(w)
  }
  const toPacks = () => {
    setPack(null)
    setList(null)
    onPick(null)
  }
  const toLists = () => {
    setList(null)
    onPick(null)
  }
  // Un pack d'une seule liste : elle est choisie d'office.
  useEffect(() => {
    if (pack && single && !list) choose(lists.data!.lists[0])
  }, [lists.data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (status.isLoading) return <Centered><Loader2 className="h-4 w-4 animate-spin" /></Centered>
  if (!status.data?.enabled) {
    return <Centered>Civitai n’est pas configuré sur ce serveur (clé CIVITAI_KEY).</Centered>
  }

  const items = search.data?.pages.flatMap((p) => p.items) ?? []
  const shownLists = (lists.data?.lists ?? []).filter((l) => l.name.toLowerCase().includes(filter.trim().toLowerCase()))
  const crumb = 'max-w-[45%] truncate rounded px-1 hover:bg-accent hover:text-foreground'

  return (
    <div className="flex h-full flex-col">
      {pack && (
        <nav
          aria-label="Chemin"
          data-testid="import-breadcrumb"
          className="flex shrink-0 items-center gap-1 border-b border-border/40 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground"
        >
          <button
            type="button"
            aria-label="Retour"
            onClick={list && !single ? toLists : toPacks}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={toPacks} className={crumb}>
            Packs
          </button>
          <ChevronRight className="h-3 w-3 shrink-0" />
          {list && !single ? (
            <>
              <button type="button" onClick={toLists} className={crumb}>
                {pack.name}
              </button>
              <ChevronRight className="h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate px-1 text-foreground">{list.name}</span>
            </>
          ) : (
            <span className="min-w-0 truncate px-1 text-foreground">{pack.name}</span>
          )}
        </nav>
      )}

      {level !== 'preview' && (
        <label className="mx-4 mt-2.5 mb-2 flex h-8 shrink-0 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {level === 'packs' ? (
            <input
              autoFocus
              aria-label="Rechercher des wildcards"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Chercher un pack : decor, outfit, hairstyle… (en anglais)"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60"
            />
          ) : (
            <input
              autoFocus
              aria-label="Filtrer les listes du pack"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filtrer les ${lists.data?.lists.length ?? ''} listes de ce pack`}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60"
            />
          )}
        </label>
      )}

      <div ref={scroller} className={cn('min-h-0 flex-1 overflow-y-auto', level !== 'preview' && 'border-t border-border/40')}>
        {level === 'preview' && list ? (
          <>
            <p className="px-4 pt-2.5 pb-1 text-[11px] text-muted-foreground">
              Aperçu ·{' '}
              {list.total > list.items.length
                ? `${list.items.length.toLocaleString('fr-FR')} éléments tirés sur ${list.total.toLocaleString('fr-FR')}`
                : `${list.total} élément${list.total > 1 ? 's' : ''}`}
            </p>
            <ol data-testid="list-import-preview" className="px-4 pb-2 text-[13px]">
              {list.items.slice(0, 200).map((item, i) => (
                <li key={i} className="flex gap-2.5 border-b border-border/20 py-1.5 last:border-0">
                  <span className="w-6 shrink-0 text-right text-[11px] leading-5 text-muted-foreground/60 tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-muted-foreground">{item}</span>
                </li>
              ))}
            </ol>
          </>
        ) : level === 'lists' ? (
          lists.isLoading ? (
            <Centered><Loader2 className="h-4 w-4 animate-spin" /> Ouverture du pack…</Centered>
          ) : lists.error ? (
            <Centered>{(lists.error as Error).message}</Centered>
          ) : !shownLists.length ? (
            <Centered>Aucune liste ne correspond.</Centered>
          ) : (
            shownLists.map((l, i) => (
              <NavRow key={`${i}-${l.name}`} testId="wildcard-list" icon={ListIcon} title={l.name} aside={<CountPill n={l.total} />} onClick={() => choose(l)} />
            ))
          )
        ) : search.isLoading ? (
          <Centered><Loader2 className="h-4 w-4 animate-spin" /></Centered>
        ) : search.error ? (
          <Centered>{(search.error as Error).message}</Centered>
        ) : !items.length ? (
          <Centered>Aucun pack trouvé.</Centered>
        ) : (
          <>
            {items.map((w) => (
              <NavRow
                key={w.versionId}
                testId="wildcard-pack"
                icon={Package}
                title={w.name}
                detail={[w.creator, `${compact.format(w.downloads)} téléchargements`, `${w.sizeKB} Ko`].filter(Boolean).join(' · ')}
                onClick={() => openPack(w)}
                disabled={w.sizeKB > PACK_MAX_KB}
                hint={w.sizeKB > PACK_MAX_KB ? 'Archive trop lourde (10 Mo au plus)' : undefined}
              />
            ))}
            {search.hasNextPage && (
              <button
                type="button"
                onClick={() => void search.fetchNextPage()}
                disabled={search.isFetchingNextPage}
                className="w-full py-2 text-xs text-muted-foreground hover:text-foreground"
              >
                {search.isFetchingNextPage ? 'Chargement…' : 'Plus de résultats'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">{children}</div>
  )
}
