/**
 * LoRA Civitai disponibles pour plusieurs modèles : une ligne par fichier en base
 * (la génération reste simple), regroupées à l'affichage grâce à `group.key`.
 */
import type {
  CivitaiLora,
  PersonaLora,
  PersonaLoraGroup,
} from '@ai-fluence/shared'

type Available = PersonaLoraGroup['available'][number]

/** Réglages communs à toutes les lignes d'un groupe. */
type Shared = Pick<
  PersonaLora,
  'label' | 'scale' | 'previewUrl' | 'sourceUrl' | 'group'
>

/** Lignes d'un modèle : un fichier, ou HIGH + LOW pour Wan 2.2. */
export function rowsFor(shared: Shared, a: Available): PersonaLora[] {
  return a.files.map((f) => ({
    ...shared,
    id: crypto.randomUUID(),
    label: (f.noise
      ? `${shared.label} · ${f.noise.toUpperCase()}`
      : shared.label
    ).slice(0, 60),
    path: f.url,
    family: a.family,
    ...(f.noise ? { noise: f.noise } : {}),
    triggerWords: a.triggerWords,
  }))
}

/** Import depuis la bibliothèque : tous les modèles disponibles, dans la limite de places. */
export function toPersonaLoras(
  item: CivitaiLora,
  remaining: number,
): PersonaLora[] {
  const group: PersonaLoraGroup = {
    key: `civitai:${item.modelId}`,
    available: item.variants.map((v) => ({
      family: v.family,
      files: v.files.map((f) => ({
        url: f.url,
        ...(f.noise ? { noise: f.noise } : {}),
      })),
      triggerWords: v.triggerWords,
    })),
  }
  const shared: Shared = {
    label: item.name.slice(0, 60),
    scale: 1,
    ...(item.previews[0] ? { previewUrl: item.previews[0].url } : {}),
    sourceUrl: item.pageUrl,
    group,
  }
  const rows: PersonaLora[] = []
  for (const a of group.available) {
    if (rows.length + a.files.length > remaining) break
    rows.push(...rowsFor(shared, a))
  }
  return rows
}

/** Nom affiché d'un groupe : sans le suffixe HIGH / LOW des lignes Wan. */
export const baseLabel = (l: PersonaLora) =>
  l.label.replace(/ · (HIGH|LOW)$/, '')

export type LoraUnit =
  | { kind: 'single'; lora: PersonaLora }
  | { kind: 'group'; key: string; rows: PersonaLora[]; group: PersonaLoraGroup }

/** Regroupe les lignes d'une même LoRA Civitai, dans l'ordre de la liste. */
export function toUnits(loras: PersonaLora[]): LoraUnit[] {
  const units: LoraUnit[] = []
  const byKey = new Map<string, Extract<LoraUnit, { kind: 'group' }>>()
  for (const l of loras) {
    if (!l.group) {
      units.push({ kind: 'single', lora: l })
      continue
    }
    const existing = byKey.get(l.group.key)
    if (existing) existing.rows.push(l)
    else {
      const unit = {
        kind: 'group' as const,
        key: l.group.key,
        rows: [l],
        group: l.group,
      }
      byKey.set(l.group.key, unit)
      units.push(unit)
    }
  }
  return units
}
