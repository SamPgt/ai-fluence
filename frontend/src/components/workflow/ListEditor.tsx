/**
 * Éléments d'un nœud Liste : chacun a son texte et un état actif (envoyé) ou inactif.
 * Dans le nœud, les éléments actifs en lignes, modifiables au clavier. Dans la modale, toute
 * la liste : recherche, sélection et actions groupées, interrupteur actif, tirage Aléatoire.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Dices, Download, Pencil, Search, Shuffle, X } from 'lucide-react'
import {
  LIST_LIMITS,
  isListOutput,
  isPaidNode,
  shuffleActive,
  splitList,
  type ListEntry,
  type WorkflowGraph,
} from '@sublime/shared'

import { cn } from '@/lib/utils'
import { formatUsd } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { CheckMark } from '@/components/ui/check-mark'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useWorkflowRun } from './WorkflowRun'

/**
 * Éléments tels qu'enregistrés, lignes vides comprises (une ligne qu'on vient d'ajouter est
 * vide). Une liste enregistrée en texte devient des éléments tous actifs.
 */
export function rawEntries(items: unknown): ListEntry[] {
  if (typeof items === 'string') return splitList(items, LIST_LIMITS.entries).map((text) => ({ text, active: true }))
  if (!Array.isArray(items)) return []
  return items
    .filter((e): e is ListEntry => Boolean(e) && typeof e === 'object' && typeof (e as ListEntry).text === 'string')
    .map((e) => ({ text: e.text, active: e.active !== false }))
}

/** Lignes d'un texte collé (au moins deux), sinon null : le collage reste un collage normal. */
function pastedLines(e: React.ClipboardEvent): string[] | null {
  const lines = splitList(e.clipboardData.getData('text'), LIST_LIMITS.entries)
  return lines.length > 1 ? lines : null
}

/** « 3 éléments », ou « 12 actifs sur 200 » quand une partie est désactivée. */
export function countLabel(entries: ListEntry[]): string {
  const filled = entries.filter((e) => e.text.trim())
  const active = filled.filter((e) => e.active).length
  if (active === filled.length) return `${active} élément${active > 1 ? 's' : ''}`
  return `${active} actif${active > 1 ? 's' : ''} sur ${filled.length}`
}

/** Champ d'une ligne, sans cadre : le texte reste à sa place. */
const ROW_INPUT =
  'min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] leading-none outline-none placeholder:text-muted-foreground/50'

/**
 * Éléments actifs, en lignes, dans le nœud. Entrée crée la ligne suivante, Retour arrière
 * sur une ligne vide la retire, un texte de plusieurs lignes collé devient plusieurs éléments.
 */
export function ListRows({
  entries,
  onChange,
  onOpen,
  onImport,
}: {
  entries: ListEntry[]
  onChange: (entries: ListEntry[]) => void
  /** Ouvre la modale (toute la liste). */
  onOpen: () => void
  /** Ouvre l'import d'une liste toute faite. */
  onImport: () => void
}) {
  const shown = entries.flatMap((e, i) => (e.active ? [i] : []))
  const inputs = useRef(new Map<number, HTMLInputElement>())
  const [focusAt, setFocusAt] = useState<number | null>(null)
  const [adding, setAdding] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)

  // La ligne à atteindre n'existe qu'une fois le nœud mis à jour (rendu suivant).
  useEffect(() => {
    if (focusAt === null) return
    const input = inputs.current.get(focusAt)
    if (!input) return
    input.focus()
    setFocusAt(null)
  }, [focusAt, entries])
  // La molette fait défiler la liste quand elle déborde, sinon elle déplace le canvas.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [entries])

  const update = (i: number, patch: Partial<ListEntry>) => onChange(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  const insertAt = (i: number, items: ListEntry[]) => onChange([...entries.slice(0, i), ...items, ...entries.slice(i)])
  const remove = (i: number) => onChange(entries.filter((_, j) => j !== i))
  const active = shown.length

  return (
    <div className="space-y-1.5">
      <div
        ref={scroller}
        data-testid="list-rows"
        className={cn('max-h-[280px] overflow-y-auto rounded-lg border border-border/60 bg-background/60', overflows && 'nowheel')}
      >
        {shown.map((i, n) => (
          <div key={i} data-testid="list-row" className="group flex h-[30px] items-center gap-2 border-b border-border/40 px-2.5">
            <span className="w-4 shrink-0 text-right text-[10px] text-muted-foreground/60 tabular-nums">{n + 1}</span>
            <input
              ref={(el) => {
                if (el) inputs.current.set(i, el)
                else inputs.current.delete(i)
              }}
              aria-label={`Élément ${n + 1}`}
              value={entries[i].text}
              onChange={(e) => update(i, { text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  insertAt(i + 1, [{ text: '', active: true }])
                  setFocusAt(i + 1)
                } else if (e.key === 'Backspace' && !entries[i].text) {
                  e.preventDefault()
                  remove(i)
                  const prev = shown[n - 1]
                  if (prev !== undefined) setFocusAt(prev)
                }
              }}
              onPaste={(e) => {
                const lines = pastedLines(e)
                if (!lines) return
                e.preventDefault()
                const items = lines.map((text) => ({ text, active: true }))
                // Ligne vide : le collage la remplace ; sinon il s'insère après.
                if (!entries[i].text) onChange([...entries.slice(0, i), ...items, ...entries.slice(i + 1)])
                else insertAt(i + 1, items)
              }}
              // Une ligne laissée vide disparaît.
              onBlur={() => !entries[i].text.trim() && remove(i)}
              className={ROW_INPUT}
            />
            <button
              type="button"
              aria-label={`Retirer « ${entries[i].text} »`}
              onClick={() => remove(i)}
              className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <div className="flex h-[30px] items-center gap-2 px-2.5">
          <span className="w-4 shrink-0 text-right text-[12px] text-muted-foreground/60">+</span>
          <input
            aria-label="Ajouter un élément"
            value={adding}
            placeholder="Ajouter un élément"
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !adding.trim()) return
              e.preventDefault()
              onChange([...entries, { text: adding.trim(), active: true }])
              setAdding('')
            }}
            onPaste={(e) => {
              const lines = pastedLines(e)
              if (!lines) return
              e.preventDefault()
              onChange([...entries, ...lines.map((text) => ({ text, active: true }))])
            }}
            onBlur={() => {
              if (!adding.trim()) return
              onChange([...entries, { text: adding.trim(), active: true }])
              setAdding('')
            }}
            className={ROW_INPUT}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
        <span data-testid="list-count" className={cn(active > LIST_LIMITS.max && 'text-amber-300')}>
          {countLabel(entries)}
          {active > LIST_LIMITS.max && ` (${LIST_LIMITS.max} actifs au plus)`}
        </span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onImport}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
          >
            <Download className="h-3 w-3" /> Importer
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3 w-3" /> Modifier
          </button>
        </span>
      </div>
    </div>
  )
}

/** Même liste, dans un autre ordre : avec plusieurs listes, d'autres combinaisons rang par rang. */
function shuffled<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Comparaison sans accents ni casse (« Forêt » trouve « foret »). */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/**
 * Nœuds démultipliés par cette liste : ceux qu'elle atteint en suivant les câbles orange
 * (une génération, puis la vidéo faite de chaque image…).
 */
function fannedNodes(graph: WorkflowGraph, listId: string): string[] {
  const out: string[] = []
  const queue = [listId]
  while (queue.length) {
    const id = queue.shift()!
    for (const e of graph.edges.filter((x) => x.source === id)) {
      const target = graph.nodes.find((n) => n.id === e.target)
      if (!target || !isPaidNode(target) || out.includes(target.id) || !isListOutput(graph, target.id)) continue
      out.push(target.id)
      queue.push(target.id)
    }
  }
  return out
}

/**
 * Modale d'une liste : toute la liste (actifs et inactifs). La case de gauche sélectionne
 * (Maj + clic : une plage), la barre groupée active, désactive ou supprime la sélection ;
 * l'interrupteur de droite dit si l'élément est envoyé. « Aléatoire » garde le même nombre
 * d'actifs, tirés au hasard. Chaque changement s'applique tout de suite au nœud.
 */
export function ListEditorDialog({
  open,
  onClose,
  name,
  onRename,
  entries,
  onChange,
  listId,
  getGraph,
  onImport,
}: {
  open: boolean
  onClose: () => void
  /** Nom facultatif (rempli par un import) : affiché sous le nœud. */
  name: string
  onRename: (name: string) => void
  entries: ListEntry[]
  onChange: (entries: ListEntry[]) => void
  listId: string
  getGraph: () => WorkflowGraph
  onImport: () => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const last = useRef<number | null>(null)
  const [adding, setAdding] = useState('')
  const { quoteNodes } = useWorkflowRun()

  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelected(new Set())
    }
  }, [open])

  const visible = useMemo(() => {
    const q = fold(query.trim())
    return entries.flatMap((e, i) => (!q || fold(e.text).includes(q) ? [i] : []))
  }, [entries, query])
  const allSelected = visible.length > 0 && visible.every((i) => selected.has(i))
  const someSelected = visible.some((i) => selected.has(i))
  const active = entries.filter((e) => e.active && e.text.trim()).length
  const total = entries.filter((e) => e.text.trim()).length

  // Coût : celui d'une passe de chaque nœud démultiplié, fois le nombre d'actifs.
  const fanned = open ? fannedNodes(getGraph(), listId) : []
  const passes = fanned.flatMap((id) => quoteNodes.filter((n) => n.nodeId === id && n.count > 0))
  const perItem = passes.reduce((s, n) => s + Number(n.estimatedCost) / n.count, 0)
  const generations = active * fanned.length

  const toggle = (i: number, shift: boolean) => {
    const next = new Set(selected)
    const on = !selected.has(i)
    const from = last.current !== null && shift ? visible.indexOf(last.current) : -1
    const to = visible.indexOf(i)
    const range = from >= 0 ? visible.slice(Math.min(from, to), Math.max(from, to) + 1) : [i]
    for (const j of range) {
      if (on) next.add(j)
      else next.delete(j)
    }
    last.current = i
    setSelected(next)
  }
  const bulk = (patch: Partial<ListEntry> | 'delete') => {
    if (patch === 'delete') onChange(entries.filter((_, i) => !selected.has(i)))
    else onChange(entries.map((e, i) => (selected.has(i) ? { ...e, ...patch } : e)))
    setSelected(new Set())
  }
  const add = (lines: string[]) => onChange([...entries, ...lines.map((text) => ({ text, active: true }))])
  const drawReason = !active ? 'Active au moins un élément' : active === total ? 'Tous les éléments sont actifs' : null

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-0 p-0 sm:max-w-[560px]" showCloseButton={false} data-testid="list-editor">
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <DialogTitle className="sr-only">Liste</DialogTitle>
          <input
            aria-label="Nom de la liste"
            defaultValue={name}
            key={name}
            placeholder="Liste sans nom"
            maxLength={60}
            onBlur={(e) => e.target.value.trim() !== name && onRename(e.target.value.trim())}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="min-w-0 flex-1 rounded px-1 -mx-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground hover:bg-accent/40 focus:bg-accent/40"
          />
          <span data-testid="list-editor-count" className="text-xs text-muted-foreground tabular-nums">
            {countLabel(entries)}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-2 px-4 py-2.5">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              aria-label="Rechercher dans la liste"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60"
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={Boolean(drawReason)}
            title={drawReason ?? 'Tirer au hasard autant d’éléments actifs'}
            onClick={() => onChange(shuffleActive(entries))}
          >
            <Dices className="h-3.5 w-3.5" /> Aléatoire
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={total < 2}
            title="Changer l’ordre des éléments (avec plusieurs listes : d’autres combinaisons)"
            onClick={() => {
              onChange(shuffled(entries))
              setSelected(new Set())
            }}
          >
            <Shuffle className="h-3.5 w-3.5" /> Mélanger
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onImport}>
            <Download className="h-3.5 w-3.5" /> Importer
          </Button>
        </div>

        <div className="flex h-[34px] items-center gap-2.5 border-y border-border/60 bg-muted/20 px-4 text-xs text-muted-foreground">
          <button
            type="button"
            role="checkbox"
            aria-checked={allSelected ? true : someSelected ? 'mixed' : false}
            aria-label="Tout sélectionner"
            onClick={() => {
              const next = new Set(selected)
              for (const i of visible) {
                if (allSelected) next.delete(i)
                else next.add(i)
              }
              setSelected(next)
            }}
          >
            <CheckMark checked={allSelected} className={cn(someSelected && !allSelected && 'border-foreground/60 bg-foreground/15')} />
          </button>
          {selected.size > 0 ? (
            // Sélection en cours : la ligne d'en-tête devient la barre d'actions groupées
            // (même hauteur : la modale ne bouge pas).
            <div data-testid="list-bulk" className="flex flex-1 items-center gap-1.5 text-[13px] text-foreground">
              <span className="flex-1 font-medium tabular-nums">
                {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
              </span>
              <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => bulk({ active: true })}>
                Activer
              </Button>
              <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => bulk({ active: false })}>
                Désactiver
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 border-red-500/40 px-2 text-xs text-red-300 hover:bg-red-500/10 hover:text-red-200"
                onClick={() => bulk('delete')}
              >
                Supprimer
              </Button>
              <button
                type="button"
                aria-label="Annuler la sélection"
                onClick={() => setSelected(new Set())}
                className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <span className="flex-1 tabular-nums">
                {visible.length} {query.trim() ? `résultat${visible.length > 1 ? 's' : ''}` : `élément${visible.length > 1 ? 's' : ''}`}
              </span>
              <span>Actif</span>
            </>
          )}
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {visible.map((i) => {
            const e = entries[i]
            return (
              <div
                key={i}
                data-testid="list-editor-row"
                data-active={e.active}
                className={cn('flex h-[30px] items-center gap-2.5 border-b border-border/40 px-4', selected.has(i) && 'bg-accent/40')}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selected.has(i)}
                  aria-label={`Sélectionner « ${e.text} »`}
                  onClick={(ev) => toggle(i, ev.shiftKey)}
                >
                  <CheckMark checked={selected.has(i)} />
                </button>
                <input
                  aria-label={`Texte de « ${e.text} »`}
                  value={e.text}
                  onChange={(ev) => onChange(entries.map((x, j) => (j === i ? { ...x, text: ev.target.value } : x)))}
                  className={cn(ROW_INPUT, !e.active && 'text-muted-foreground')}
                />
                <Switch
                  checked={e.active}
                  aria-label={`Activer « ${e.text} »`}
                  onCheckedChange={(on) => onChange(entries.map((x, j) => (j === i ? { ...x, active: on } : x)))}
                  className="data-[state=checked]:bg-orange-500/80"
                />
              </div>
            )
          })}
          {!query.trim() && (
            <div className="flex h-[30px] items-center gap-2.5 px-4">
              <span className="w-4 text-center text-[13px] text-muted-foreground/60">+</span>
              <input
                aria-label="Ajouter un élément à la liste"
                value={adding}
                placeholder="Ajouter un élément"
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !adding.trim()) return
                  e.preventDefault()
                  add([adding.trim()])
                  setAdding('')
                }}
                onPaste={(e) => {
                  const lines = pastedLines(e)
                  if (!lines) return
                  e.preventDefault()
                  add(lines)
                }}
                className={ROW_INPUT}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5">
          <span data-testid="list-editor-cost" className="text-xs text-muted-foreground tabular-nums">
            {fanned.length
              ? `${generations} génération${generations > 1 ? 's' : ''}${passes.length ? ` ≈ ${formatUsd(perItem * active)}` : ''}`
              : `${active} élément${active > 1 ? 's' : ''} envoyé${active > 1 ? 's' : ''}`}
            {active > LIST_LIMITS.max && <span className="text-amber-300"> · {LIST_LIMITS.max} actifs au plus</span>}
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            Terminé
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
