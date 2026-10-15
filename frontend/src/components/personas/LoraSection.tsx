/** LoRA d'un persona ou de Général (même éditeur : fiche du persona, page Général). */
import { useState } from 'react'
import { ChevronDown, ExternalLink, Globe, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { MODEL_FAMILIES, getFamily, type PersonaLora } from '@sublime/shared'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CivitaiBrowser } from '@/components/lora/CivitaiBrowser'
import { CheckMark } from '@/components/ui/check-mark'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  baseLabel,
  rowsFor,
  toPersonaLoras,
  toUnits,
  type LoraUnit,
} from '@/lib/lora-groups'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const LORA_FAMILIES = MODEL_FAMILIES.filter((f) => f.badges.includes('LORA'))
/** Limite du backend (personas.route, settings.route). */
const MAX_LORAS = 12

export function Card({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-card/50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * LoRA d'un persona ou de Général : ajout par lien ou depuis la bibliothèque Civitai,
 * réglages par ligne. `onChange` reçoit la liste complète.
 */
export function LoraSection({
  loras,
  onChange,
  emptyText,
}: {
  loras: PersonaLora[]
  onChange: (loras: PersonaLora[]) => void
  emptyText: string
}) {
  const [libraryOpen, setLibraryOpen] = useState(false)
  const updateLora = (id: string, patch: Partial<PersonaLora>) =>
    onChange(loras.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  return (
    <>
      <Card
        title="LoRA"
        description="Choisis une LoRA dans la bibliothèque communautaire, ou colle un lien direct vers un .safetensors. Une LoRA ne fonctionne que sur le modèle pour lequel elle a été entraînée. 3 LoRA maximum par génération."
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Ajouter une LoRA par lien"
              title="Ajouter une LoRA par lien"
              disabled={loras.length >= MAX_LORAS}
              onClick={() =>
                onChange([
                  ...loras,
                  {
                    id: crypto.randomUUID(),
                    label: '',
                    path: '',
                    scale: 1,
                    family: LORA_FAMILIES[0].id,
                    triggerWords: [],
                  },
                ])
              }
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLibraryOpen(true)}
            >
              <Globe className="h-4 w-4" /> Bibliothèque
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {toUnits(loras).map((u) =>
            u.kind === 'single' ? (
              <LoraEditor
                key={u.lora.id}
                lora={u.lora}
                onChange={(patch) => updateLora(u.lora.id, patch)}
                onRemove={() =>
                  onChange(loras.filter((x) => x.id !== u.lora.id))
                }
              />
            ) : (
              <LoraGroupEditor
                key={u.key}
                unit={u}
                remaining={MAX_LORAS - loras.length}
                onChange={(rows) => onChange(replaceGroup(loras, u.key, rows))}
              />
            ),
          )}
          {loras.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {emptyText}
            </p>
          )}
        </div>
      </Card>
      <CivitaiBrowser
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        addedPaths={new Set(loras.map((l) => l.path))}
        remaining={MAX_LORAS - loras.length}
        onAdd={(item) => {
          // Tous les modèles disponibles par défaut ; on décoche ensuite dans la ligne.
          onChange([
            ...loras,
            ...toPersonaLoras(item, MAX_LORAS - loras.length),
          ])
          toast.success(`${item.name} ajoutée`)
        }}
        onRemove={(item) => {
          const urls = new Set(
            item.variants.flatMap((v) => v.files.map((f) => f.url)),
          )
          onChange(loras.filter((l) => !urls.has(l.path)))
        }}
      />
    </>
  )
}

function LoraEditor({
  lora: l,
  onChange,
  onRemove,
}: {
  lora: PersonaLora
  onChange: (patch: Partial<PersonaLora>) => void
  onRemove: () => void
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-border/60 p-3">
      {l.previewUrl && (
        <img
          src={l.previewUrl}
          alt=""
          draggable={false}
          className="h-[124px] w-[93px] shrink-0 rounded-md object-cover"
        />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex gap-2">
          <Input
            placeholder="Nom"
            value={l.label}
            onChange={(e) => onChange({ label: e.target.value })}
            className="w-40"
          />
          <Input
            placeholder="https://huggingface.co/…/resolve/main/lora.safetensors"
            value={l.path}
            onChange={(e) => onChange({ path: e.target.value })}
            className="flex-1 font-mono text-xs"
          />
          {l.sourceUrl && (
            <Button variant="ghost" size="icon" asChild>
              <a
                href={l.sourceUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Voir sur Civitai"
                title="Voir sur Civitai"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label="Retirer"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <TriggerWordsEditor
          words={l.triggerWords}
          hidden={l.hiddenWords ?? []}
          onChange={(triggerWords, hiddenWords) =>
            onChange({ triggerWords, hiddenWords })
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={l.family}
            onValueChange={(v) => onChange({ family: v })}
          >
            <SelectTrigger size="sm" className="w-[258px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LORA_FAMILIES.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label} · {f.media === 'video' ? 'vidéo' : 'photo'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Force
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={l.scale}
              onChange={(e) => onChange({ scale: Number(e.target.value) })}
              className="w-28 accent-brand"
            />
            <span className="w-8 tabular-nums">{l.scale.toFixed(2)}</span>
          </label>
          {l.family === 'alibaba/wan-2.2-lora' && (
            <Select
              value={l.noise ?? 'both'}
              onValueChange={(v) =>
                onChange({ noise: v as PersonaLora['noise'] })
              }
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Passes HIGH + LOW</SelectItem>
                <SelectItem value="high">HIGH noise</SelectItem>
                <SelectItem value="low">LOW noise</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Mots déclencheurs d'une LoRA : une case par mot. Un mot décoché reste connu
 * mais n'est jamais proposé dans le composer (ex. un mot NSFW).
 */
function TriggerWordsEditor({
  words,
  hidden,
  onChange,
}: {
  words: string[]
  hidden: string[]
  onChange: (words: string[], hidden: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const fresh = draft
      .split(',')
      .map((w) => w.trim())
      .filter((w) => w && !words.includes(w))
    if (fresh.length) onChange([...new Set([...words, ...fresh])], hidden)
    setDraft('')
  }

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-muted-foreground">
        Mots déclencheurs · décoche ceux à ne jamais proposer
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {words.map((w) => {
          const on = !hidden.includes(w)
          return (
            <span
              key={w}
              className={cn(
                'group/word flex h-7 items-center gap-1.5 rounded-[5px] border pr-1 pl-2 font-mono text-[12px] transition-colors',
                on
                  ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
                  : 'border-border/50 text-muted-foreground line-through',
              )}
            >
              <button
                type="button"
                onClick={() =>
                  onChange(
                    words,
                    on ? [...hidden, w] : hidden.filter((x) => x !== w),
                  )
                }
                aria-pressed={on}
                aria-label={on ? `Ne plus proposer ${w}` : `Proposer ${w}`}
                className="flex items-center gap-1.5"
              >
                <CheckMark checked={on} tone="lora" className="h-3.5 w-3.5" />
                {w}
              </button>
              <button
                type="button"
                onClick={() =>
                  onChange(
                    words.filter((x) => x !== w),
                    hidden.filter((x) => x !== w),
                  )
                }
                aria-label={`Supprimer ${w}`}
                className="grid h-4 w-4 place-items-center rounded-[3px] opacity-0 transition group-hover/word:opacity-100 hover:bg-accent focus-visible:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )
        })}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add()
            }
          }}
          onBlur={add}
          placeholder={
            words.length ? 'Ajouter…' : 'Ajouter un mot (ex. ohwx woman)'
          }
          aria-label="Ajouter un mot déclencheur"
          className="h-7 min-w-28 flex-1 rounded-[5px] bg-transparent px-1.5 text-[12px] outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  )
}

/** Remplace les lignes d'un groupe, à la place du groupe dans la liste. */
function replaceGroup(
  loras: PersonaLora[],
  key: string,
  rows: PersonaLora[],
): PersonaLora[] {
  const at = loras.findIndex((l) => l.group?.key === key)
  const rest = loras.filter((l) => l.group?.key !== key)
  return [...rest.slice(0, at), ...rows, ...rest.slice(at)]
}

const familyText = (id: string) => {
  const f = getFamily(id)
  return f ? `${f.label} · ${f.media === 'video' ? 'vidéo' : 'photo'}` : id
}

/**
 * LoRA Civitai disponible pour plusieurs modèles : une seule ligne, et un menu à
 * cases à cocher limité aux modèles pour lesquels elle existe (un fichier chacun).
 */
function LoraGroupEditor({
  unit,
  remaining,
  onChange,
}: {
  unit: Extract<LoraUnit, { kind: 'group' }>
  remaining: number
  onChange: (rows: PersonaLora[]) => void
}) {
  const first = unit.rows[0]
  const checked = new Set(unit.rows.map((r) => r.family))
  const words = [...new Set(unit.rows.flatMap((r) => r.triggerWords))]
  const hidden = [...new Set(unit.rows.flatMap((r) => r.hiddenWords ?? []))]
  const label = baseLabel(first)
  const shared = {
    label,
    scale: first.scale,
    previewUrl: first.previewUrl,
    sourceUrl: first.sourceUrl,
    group: unit.group,
  }

  // Réglage commun : appliqué à toutes les lignes du groupe.
  const patchAll = (patch: Partial<PersonaLora>) =>
    onChange(unit.rows.map((r) => ({ ...r, ...patch })))

  const toggle = (family: string) => {
    if (checked.has(family)) {
      if (checked.size === 1) return // au moins un modèle
      onChange(unit.rows.filter((r) => r.family !== family))
    } else {
      const a = unit.group.available.find((x) => x.family === family)
      if (a) onChange([...unit.rows, ...rowsFor(shared, a)])
    }
  }

  return (
    <div className="flex gap-3 rounded-lg border border-border/60 p-3">
      {first.previewUrl && (
        <img
          src={first.previewUrl}
          alt=""
          draggable={false}
          className="h-[124px] w-[93px] shrink-0 rounded-md object-cover"
        />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex gap-2">
          <Input
            placeholder="Nom"
            value={label}
            onChange={(e) =>
              onChange(
                unit.rows.map((r) => ({
                  ...r,
                  label: (r.noise
                    ? `${e.target.value} · ${r.noise.toUpperCase()}`
                    : e.target.value
                  ).slice(0, 60),
                })),
              )
            }
            className="flex-1"
          />
          {first.sourceUrl && (
            <Button variant="ghost" size="icon" asChild>
              <a
                href={first.sourceUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Voir sur Civitai"
                title="Voir sur Civitai"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange([])}
            aria-label="Retirer"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <TriggerWordsEditor
          words={words}
          hidden={hidden}
          onChange={(next, nextHidden) => {
            const added = next.filter((w) => !words.includes(w))
            // Chaque modèle garde ses propres mots ; un mot ajouté vaut pour tous.
            onChange(
              unit.rows.map((r) => {
                const own = [
                  ...r.triggerWords.filter((w) => next.includes(w)),
                  ...added,
                ]
                return {
                  ...r,
                  triggerWords: own,
                  hiddenWords: nextHidden.filter((w) => own.includes(w)),
                }
              }),
            )
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-8 w-[258px] items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors hover:bg-accent/50"
              >
                <span className="truncate">
                  {checked.size === 1
                    ? familyText([...checked][0])
                    : `${checked.size} modèles`}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[258px] p-1">
              {unit.group.available.map((a) => {
                const on = checked.has(a.family)
                const blocked =
                  (on && checked.size === 1) ||
                  (!on && a.files.length > remaining)
                return (
                  <button
                    key={a.family}
                    type="button"
                    disabled={blocked}
                    onClick={() => toggle(a.family)}
                    title={
                      on && checked.size === 1
                        ? 'Au moins un modèle'
                        : !on && blocked
                          ? 'Le persona a déjà 12 LoRA.'
                          : undefined
                    }
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <CheckMark checked={on} />
                    <span className="truncate">{familyText(a.family)}</span>
                  </button>
                )
              })}
            </PopoverContent>
          </Popover>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Force
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={first.scale}
              onChange={(e) => patchAll({ scale: Number(e.target.value) })}
              className="w-28 accent-brand"
            />
            <span className="w-8 tabular-nums">{first.scale.toFixed(2)}</span>
          </label>
        </div>
      </div>
    </div>
  )
}
