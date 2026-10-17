/**
 * Champ de texte d'un nœud, avec mentions d'images et de listes : « @image2 » s'affiche en
 * bleu quand le nœud de génération relié reçoit bien une image 2, « @liste1 » en orange
 * quand il reçoit une liste 1 (en rouge sinon), et taper « @ » propose ce qu'il reçoit. Le texte coloré est dessiné sous un champ transparent,
 * aux mêmes dimensions (un champ de saisie ne peut pas colorer une partie de son texte).
 */
import { Fragment, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { useDraft } from './useDraft'

export interface MentionOption {
  /** Image (par défaut) ou liste (« @liste1 »). */
  kind?: 'image' | 'list'
  n: number
  label: string
  /** Image d'une entrée « À fournir » : connue seulement au lancement (affichée en jaune). */
  pending?: boolean
}

/** Couleur d'une mention : image présente (bleu), fournie au lancement (jaune), inexistante (rouge). */
const MENTION_CLASS = {
  known: 'text-sky-400',
  list: 'text-orange-400',
  pending: 'text-amber-300',
  unknown: 'text-red-400 underline decoration-dotted underline-offset-2',
} as const

const TOKEN = /(@(?:image|liste)\d+)/gi
/** « @ » puis le début d'une mention, juste avant le curseur. */
const TYPING = /@([a-z]{0,5}\d*)$/i

const word = (o: MentionOption) => `${o.kind === 'list' ? 'liste' : 'image'}${o.n}`

/** Mêmes dimensions de texte pour le champ et le texte coloré dessous. */
const TEXT = 'px-2.5 py-2 text-[13px] leading-snug whitespace-pre-wrap break-words border border-transparent'

export function MentionTextarea({
  value: stored,
  onChange: commit,
  options,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string
  onChange: (v: string) => void
  /** Images citables (null : le texte n'est relié à aucune génération). */
  options: MentionOption[] | null
  placeholder?: string
  ariaLabel: string
  className?: string
}) {
  // Texte propre au champ (cf. useDraft) : le curseur ne saute jamais.
  const draft = useDraft(stored, commit)
  const { value, onChange } = draft
  const ref = useRef<HTMLTextAreaElement>(null)
  const backdrop = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ start: number; query: string } | null>(null)
  const [active, setActive] = useState(0)
  // Curseur à poser juste après l'insertion d'une mention, avant toute autre frappe.
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  }, [value])

  const matches = menu
    ? (options ?? []).filter((o) => word(o).startsWith(menu.query.toLowerCase()))
    : []

  const detect = (text: string, caret: number) => {
    const m = TYPING.exec(text.slice(0, caret))
    if (m && options?.length) {
      setMenu({ start: caret - m[0].length, query: m[1] ?? '' })
      setActive(0)
    } else setMenu(null)
  }

  const insert = (o: MentionOption) => {
    const el = ref.current
    if (!el || !menu) return
    const caret = el.selectionStart
    const mention = `@${word(o)} `
    const next = value.slice(0, menu.start) + mention + value.slice(caret)
    pendingCaret.current = menu.start + mention.length
    onChange(next)
    setMenu(null)
  }

  const stateOf = (token: string): keyof typeof MENTION_CLASS => {
    const list = token.toLowerCase().startsWith('@liste')
    const n = Number(token.slice(list ? '@liste'.length : '@image'.length))
    const option = options?.find((o) => o.n === n && (o.kind === 'list') === list)
    return !option ? 'unknown' : list ? 'list' : option.pending ? 'pending' : 'known'
  }

  return (
    <div className={cn('relative rounded-lg border border-border/60 bg-background/60 focus-within:border-border', className)}>
      <div ref={backdrop} aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden text-foreground', TEXT)}>
        {value.split(TOKEN).map((part, i) =>
          i % 2 === 1 ? (
            <span
              key={i}
              data-testid="mention"
              data-known={stateOf(part) !== 'unknown' || undefined}
              data-state={stateOf(part)}
              className={MENTION_CLASS[stateOf(part)]}
            >
              {part}
            </span>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          ),
        )}
        {/* Dernière ligne vide : même hauteur que le champ. */}
        {'​'}
      </div>
      <textarea
        ref={ref}
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        rows={4}
        onChange={(e) => {
          onChange(e.target.value)
          detect(e.target.value, e.target.selectionStart)
        }}
        onScroll={(e) => {
          if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop
        }}
        onFocus={draft.onFocus}
        onBlur={() => {
          draft.onBlur()
          setTimeout(() => setMenu(null), 120)
        }}
        onKeyDown={(e) => {
          if (!menu || !matches.length) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            insert(matches[Math.min(active, matches.length - 1)])
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setMenu(null)
          }
        }}
        className={cn(
          'relative block field-sizing-content max-h-60 min-h-20 w-full resize-none bg-transparent text-transparent caret-foreground outline-none placeholder:text-muted-foreground/50 selection:bg-sky-400/30',
          TEXT,
          draft.focused && 'nowheel',
        )}
      />
      {menu && matches.length > 0 && (
        <div
          role="listbox"
          aria-label="Images et listes à citer"
          className="absolute top-full left-0 z-20 mt-1 w-full rounded-lg border border-border/60 bg-popover p-1 shadow-lg"
        >
          {matches.map((o, i) => (
            <button
              key={word(o)}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                insert(o)
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                i === active ? 'bg-accent' : 'hover:bg-accent/60',
              )}
            >
              <span className={o.kind === 'list' ? 'text-orange-400' : o.pending ? 'text-amber-300' : 'text-sky-400'}>
                @{word(o)}
              </span>
              <span className="truncate text-xs text-muted-foreground">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
