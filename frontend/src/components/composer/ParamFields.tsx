/**
 * Champs de paramètres générés depuis le schéma JSON live du modèle.
 * Ajouter un modèle ne demande aucun code ici.
 */
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import {
  COMPOSER_FIELDS,
  appDefault,
  type InputSchema,
  type JsonSchemaProp,
} from '@ai-fluence/shared'

import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const LABELS: Record<string, string> = {
  aspect_ratio: 'Proportions',
  resolution: 'Résolution',
  duration_seconds: 'Durée',
  output_format: 'Fichier',
  seed: 'Seed',
  generate_audio: "Générer l'audio",
  quality: 'Qualité',
  negative_prompt: 'Prompt négatif',
  enable_prompt_expansion: 'Extension auto du prompt',
  enable_thinking: 'Réflexion du modèle',
  guidance_scale: 'Guidance',
  steps: 'Étapes',
  strength: "Force de l'édition",
  background: 'Fond',
  input_fidelity: "Fidélité à l'image",
  shot_type: 'Type de plan',
  watermark: 'Filigrane',
  enable_web_search: 'Recherche web',
  return_last_frame: 'Renvoyer la dernière image',
  preset: 'Variante du modèle',
  prompt_optimization_mode: 'Optimisation du prompt',
  output_quality: 'Compression',
  official_fallback: 'Relance au prix officiel si échec',
}

/** Paramètres affichés directement dans la barre du composer (le reste est dans le popover). */
export const QUICK_FIELDS = ['aspect_ratio', 'resolution', 'duration_seconds']

export function labelOf(key: string): string {
  return (
    LABELS[key] ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  )
}

export function formatOption(key: string, v: unknown): string {
  if (key === 'duration_seconds') return v === -1 ? 'Auto' : `${v} s`
  return String(v)
}

export function editableFields(
  schema: InputSchema | undefined,
): [string, JsonSchemaProp][] {
  return Object.entries(schema?.properties ?? {}).filter(
    ([key, prop]) =>
      !COMPOSER_FIELDS.has(key) &&
      prop.type !== 'array' &&
      prop.type !== 'object',
  )
}

interface FieldProps {
  name: string
  prop: JsonSchemaProp
  value: unknown
  onChange: (v: unknown) => void
  compact?: boolean
}

/**
 * Entier à petite plage (ex. durée 3 à 10 s) : proposé en menu déroulant,
 * comme les autres réglages, plutôt qu'en champ numérique à flèches.
 */
function asChoices(prop: JsonSchemaProp): JsonSchemaProp {
  if (prop.enum || prop.type !== 'integer') return prop
  const { minimum: min, maximum: max } = prop
  if (min === undefined || max === undefined || max - min > 30) return prop
  return {
    ...prop,
    enum: Array.from({ length: max - min + 1 }, (_, i) => min + i),
  }
}

export function ParamField({
  name,
  prop: raw,
  value,
  onChange,
  compact,
}: FieldProps) {
  const prop = asChoices(raw)
  const current = value ?? appDefault(name, prop)

  if (prop.enum) {
    return (
      <Select
        value={current === undefined ? undefined : String(current)}
        onValueChange={(v) => {
          const match = prop.enum!.find((o) => String(o) === v)
          onChange(match)
        }}
      >
        <SelectTrigger
          size="sm"
          className={cn(
            compact &&
              'h-8 rounded-full border-border/60 bg-background/40 px-3 text-xs text-foreground hover:bg-accent dark:bg-background/40 dark:hover:bg-accent',
          )}
        >
          <SelectValue placeholder={labelOf(name)} />
        </SelectTrigger>
        <SelectContent className="max-h-[250px]">
          <SelectGroup>
            {/* Dans la barre, le bouton n'affiche que la valeur : le titre dit de quoi il s'agit. */}
            {compact && <SelectLabel>{labelOf(name)}</SelectLabel>}
            {prop.enum.map((o) => (
              <SelectItem key={String(o)} value={String(o)}>
                {formatOption(name, o)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    )
  }

  if (prop.type === 'boolean') {
    return (
      <Switch checked={current === true} onCheckedChange={(v) => onChange(v)} />
    )
  }

  if (prop.type === 'integer' || prop.type === 'number') {
    return (
      <Input
        type="number"
        className={cn('h-8', compact && 'w-20 rounded-full text-xs')}
        min={prop.minimum}
        max={prop.maximum}
        step={prop.type === 'integer' ? 1 : 0.05}
        placeholder={
          prop.default !== undefined
            ? String(prop.default)
            : name === 'seed'
              ? 'aléatoire'
              : ''
        }
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) =>
          onChange(e.target.value === '' ? undefined : Number(e.target.value))
        }
      />
    )
  }

  if (name === 'negative_prompt') {
    return (
      <Textarea
        rows={2}
        className="min-h-12 text-xs"
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    )
  }

  return (
    <Input
      className="h-8"
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  )
}

/** Popover « Paramètres » avec tous les champs non rapides. */
export function ParamsPopover({
  schema,
  values,
  onChange,
  onReset,
}: {
  schema: InputSchema | undefined
  values: Record<string, unknown>
  onChange: (key: string, v: unknown) => void
  onReset: () => void
}) {
  const fields = editableFields(schema).filter(
    ([k]) => !QUICK_FIELDS.includes(k),
  )
  // Point « modifié » : seulement les réglages du popover qui diffèrent de leur valeur par défaut.
  const changed = fields.filter(
    ([k, prop]) => values[k] !== undefined && values[k] !== appDefault(k, prop),
  ).length

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!fields.length}
          className="relative flex h-8 w-8 items-center justify-center rounded-xl text-foreground/80 transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 data-[state=open]:bg-accent/60"
          aria-label="Paramètres du modèle"
          title="Paramètres du modèle"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {changed > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-brand"
              title={`${changed} réglage(s) modifié(s)`}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Paramètres</span>
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Réinitialiser
          </button>
        </div>
        <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
          {fields.map(([key, prop]) => (
            <div
              key={key}
              className={cn(
                prop.type === 'boolean'
                  ? 'flex items-center justify-between gap-3'
                  : 'space-y-1.5',
              )}
            >
              <Label
                className="text-xs text-muted-foreground"
                title={prop.description}
              >
                {labelOf(key)}
                {prop.minimum !== undefined &&
                  prop.maximum !== undefined &&
                  !prop.enum && (
                    <span className="text-muted-foreground/60">
                      ({prop.minimum}–{prop.maximum})
                    </span>
                  )}
              </Label>
              <ParamField
                name={key}
                prop={prop}
                value={values[key]}
                onChange={(v) => onChange(key, v)}
              />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
