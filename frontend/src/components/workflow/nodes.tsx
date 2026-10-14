/**
 * Contenu de chaque type de nœud (réglages enregistrés dans `data`). Les champs
 * portent `nodrag` / `nowheel` (cf. NodeShell) : écrire ou défiler ne déplace pas le nœud.
 */
import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  useEdges,
  useNodes,
  useReactFlow,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ImagePlus,
  Minus,
  Plus,
  Loader2,
  SlidersHorizontal,
  TriangleAlert,
  Upload,
  X,
  TextCursorInput,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  WORKFLOW_NODES,
  WORKFLOW_TEXT_MODEL_DEFAULT,
  INPUT_MAX_IMAGES,
  imageSlots,
  imagesCarried,
  resolveTask,
  type Asset,
  type CatalogFamily,
  type MediaKind,
  type TaskKind,
  type WorkflowNodeType,
} from '@ai-fluence/shared'

import { assetsApi } from '@/lib/api'
import { catalogQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { ModelPicker } from '@/components/composer/ModelPicker'
import {
  ParamField,
  editableFields,
  labelOf,
} from '@/components/composer/ParamFields'
import { LibraryBrowser } from '@/components/composer/LibraryBrowser'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { NodeShell, graphOf } from './NodeShell'
import { MentionTextarea, type MentionOption } from './MentionTextarea'
import { useDraft } from './useDraft'
import { pickActive, useNodeResults, useWorkflowRun } from './WorkflowRun'
import { MediaViewer } from '@/components/thread/MediaViewer'
import { formatUsd } from '@/lib/format'

type Data = Record<string, unknown>

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const mediaUrl = (id: string) => `/api/media/${id}`

const FIELD =
  'w-full resize-none rounded-lg border border-border/60 bg-background/60 px-2.5 py-2 text-[13px] leading-snug outline-none placeholder:text-muted-foreground/50 focus:border-border'

/**
 * Pastille « À fournir au lancement » : le nœud devient un champ du formulaire du fil,
 * avec ce libellé ; son contenu actuel sert de valeur par défaut.
 */
function ExposedField({
  id,
  data,
  images,
}: {
  id: string
  data: Data
  images?: boolean
}) {
  const set = useNodeData(id)
  const exposed = data.exposed === true
  const label = useDraft(str(data.label), (v) => set({ label: v }))
  const max = Math.min(
    INPUT_MAX_IMAGES.max,
    Math.max(INPUT_MAX_IMAGES.min, Number(data.maxImages) || 1),
  )
  return (
    <div className="space-y-2 border-t border-border/40 pt-2.5">
      {/* Pastille à cocher : grise, puis bleue quand le nœud devient un champ du formulaire. */}
      <button
        type="button"
        role="switch"
        aria-checked={exposed}
        aria-label="À fournir au lancement"
        onClick={() => set({ exposed: !exposed })}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors',
          exposed
            ? 'border-sky-400/40 bg-sky-400/15 text-sky-300'
            : 'border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <TextCursorInput className="h-3.5 w-3.5" />À fournir au lancement
      </button>
      {exposed && (
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">
            Libellé dans le formulaire
          </span>
          <input
            aria-label="Libellé du champ"
            value={label.value}
            onChange={(e) => label.onChange(e.target.value)}
            onFocus={label.onFocus}
            onBlur={label.onBlur}
            placeholder="Photo du produit, Ce que dit le personnage…"
            className={cn(
              FIELD,
              'py-1.5',
              !label.value.trim() && 'border-amber-500/60',
            )}
          />
        </label>
      )}
      {/* Nombre d'images fourni au lancement (images seulement) : fixe le prix et les numéros @image. */}
      {exposed && images && (
        <div
          className="flex items-center text-[11px] text-muted-foreground"
          aria-label="Images max"
        >
          <span className="flex-1">Images max</span>
          <div className="flex items-center rounded-lg border border-border/60">
            <button
              type="button"
              aria-label="Une image de moins"
              disabled={max <= INPUT_MAX_IMAGES.min}
              onClick={() => set({ maxImages: max - 1 })}
              className="grid h-6 w-6 place-items-center rounded-l-lg hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span
              data-testid="max-images"
              className="w-5 text-center text-foreground tabular-nums"
            >
              {max}
            </span>
            <button
              type="button"
              aria-label="Une image de plus"
              disabled={max >= INPUT_MAX_IMAGES.max}
              onClick={() => set({ maxImages: max + 1 })}
              className="grid h-6 w-6 place-items-center rounded-r-lg hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Champ de texte d'un nœud : son propre texte (cf. useDraft), transmis au nœud à chaque frappe. */
function NodeTextarea({
  value,
  onChange,
  ariaLabel,
  placeholder,
  rows,
  className,
}: {
  value: string
  onChange: (v: string) => void
  ariaLabel: string
  placeholder: string
  rows: number
  className?: string
}) {
  const draft = useDraft(value, onChange)
  return (
    <textarea
      aria-label={ariaLabel}
      value={draft.value}
      onChange={(e) => draft.onChange(e.target.value)}
      onFocus={draft.onFocus}
      onBlur={draft.onBlur}
      placeholder={placeholder}
      rows={rows}
      className={cn(
        FIELD,
        'field-sizing-content',
        className,
        draft.focused && 'nowheel',
      )}
    />
  )
}

/** Réglages du nœud : écrire dans `data` (enregistré automatiquement). */
function useNodeData(id: string) {
  const { updateNodeData } = useReactFlow()
  return (patch: Data) => updateNodeData(id, patch)
}

// ── Entrées ──────────────────────────────────────────────────

/**
 * Images citables depuis ce texte : celles que reçoit le nœud de génération dont il est
 * le prompt (null si le texte n'est le prompt d'aucune génération).
 */
function useMentionOptions(id: string): MentionOption[] | null {
  const edges = useEdges()
  const nodes = useNodes()
  const target = edges.find(
    (e) => e.source === id && e.targetHandle === 'prompt',
  )
  if (!target) return null
  const graph = graphOf(nodes, edges)
  return imageSlots(graph, target.target).map((slot) => {
    const source = nodes.find((n) => n.id === slot.sourceId)
    const type = source?.type as WorkflowNodeType | undefined
    // Entrée « À fournir » : son libellé, l'image arrivera au lancement.
    const label = slot.pending
      ? `${str(source?.data.label) || 'Image source'} · fournie au lancement`
      : type === 'image-source'
        ? `Image source${imagesCarried(source as Parameters<typeof imagesCarried>[0]) > 1 ? ` · image ${slot.index + 1}` : ''}`
        : type
          ? WORKFLOW_NODES[type].label
          : 'Image'
    return { n: slot.n, label, pending: slot.pending }
  })
}

function TextNode({ id, data, selected }: NodeProps) {
  const set = useNodeData(id)
  const options = useMentionOptions(id)
  return (
    <NodeShell
      id={id}
      type="text"
      selected={selected}
      exposed={data.exposed === true}
    >
      <MentionTextarea
        ariaLabel="Texte du nœud"
        value={str(data.text)}
        onChange={(text) => set({ text })}
        options={options}
        placeholder="Écris un prompt ou une consigne…"
      />
      {options && options.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Tape @ pour citer une image (
          {options.length > 1 ? `1 à ${options.length}` : '1'}).
        </p>
      )}
      <ExposedField id={id} data={data} />
    </NodeShell>
  )
}

function ImageSourceNode({ id, data, selected }: NodeProps) {
  const set = useNodeData(id)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const assetIds = Array.isArray(data.assetIds)
    ? (data.assetIds as string[])
    : []
  // Lecture fraîche à chaque ajout : plusieurs imports peuvent se terminer à la suite.
  const { getNode } = useReactFlow()
  const current = () => {
    const ids = getNode(id)?.data.assetIds
    return Array.isArray(ids) ? (ids as string[]) : []
  }
  const add = (asset: Asset) => {
    const ids = current()
    if (!ids.includes(asset.id)) set({ assetIds: [...ids, asset.id] })
  }
  const toggle = (asset: Asset) => {
    const ids = current()
    set({
      assetIds: ids.includes(asset.id)
        ? ids.filter((x) => x !== asset.id)
        : [...ids, asset.id],
    })
  }
  const upload = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      setUploading((n) => n + 1)
      try {
        add((await assetsApi.upload(file)).asset)
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  return (
    <NodeShell
      id={id}
      type="image-source"
      selected={selected}
      exposed={data.exposed === true}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="hidden"
        data-testid="image-source-input"
        onChange={(e) => {
          void upload(e.target.files)
          e.target.value = ''
        }}
      />
      {assetIds.length === 1 && !uploading ? (
        <SourceThumb
          assetId={assetIds[0]}
          onRemove={() => set({ assetIds: [] })}
          large
        />
      ) : assetIds.length || uploading ? (
        <div className="grid grid-cols-3 gap-1.5">
          {assetIds.map((assetId, i) => (
            <SourceThumb
              key={assetId}
              assetId={assetId}
              number={i + 1}
              onRemove={() =>
                set({ assetIds: assetIds.filter((x) => x !== assetId) })
              }
            />
          ))}
          {Array.from({ length: uploading }).map((_, i) => (
            <div
              key={`up-${i}`}
              className="grid aspect-square place-items-center rounded-md border border-dashed border-border/60"
            >
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid h-28 place-items-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground">
          Aucune image
        </div>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border/60 py-1.5 text-xs hover:bg-accent/60"
        >
          <Upload className="h-3.5 w-3.5" /> Importer
        </button>
        <button
          type="button"
          onClick={() => setLibraryOpen(true)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border/60 py-1.5 text-xs hover:bg-accent/60"
        >
          <ImagePlus className="h-3.5 w-3.5" /> Assets
        </button>
      </div>
      <LibraryBrowser
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        personaId={null}
        onImport={add}
        personal={{ selectedIds: assetIds, onToggle: toggle }}
      />
      <ExposedField id={id} data={data} images />
    </NodeShell>
  )
}

/** Vignette d'une image du nœud Image source : numéro (s'il y en a plusieurs), croix pour la retirer. */
function SourceThumb({
  assetId,
  number,
  large,
  onRemove,
}: {
  assetId: string
  number?: number
  large?: boolean
  onRemove: () => void
}) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-md border border-border/40 bg-black/20',
        !large && 'aspect-square',
      )}
    >
      <img
        src={mediaUrl(assetId)}
        alt="Image source"
        draggable={false}
        className={
          large
            ? 'max-h-56 w-full object-contain'
            : 'h-full w-full object-cover'
        }
      />
      {number !== undefined && (
        <span className="absolute bottom-1 left-1 grid h-4 min-w-4 place-items-center rounded bg-black/70 px-1 text-[10px] font-medium text-white tabular-nums">
          {number}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Retirer l’image"
        className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ── Texte IA ─────────────────────────────────────────────────

/** « anthropic/claude-haiku-5.5/chat » → « Claude Haiku 5.5 ». */
function textModelLabel(id: string): string {
  const name = id.split('/')[1] ?? id
  return name
    .split('-')
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/^Gpt/, 'GPT')
    .replace(/^Glm/, 'GLM')
}

function TextModelSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  const { data: catalog } = useQuery(catalogQuery())
  const models = catalog?.textModels ?? [WORKFLOW_TEXT_MODEL_DEFAULT]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Modèle de texte"
          className="flex w-full items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1.5 text-left text-xs hover:bg-accent/60"
        >
          <span className="flex-1 truncate">{textModelLabel(value)}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-72 w-60 overflow-y-auto p-1"
      >
        {models.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <span className="flex-1 truncate">{textModelLabel(m)}</span>
            {m === WORKFLOW_TEXT_MODEL_DEFAULT && (
              <span className="text-[10px] text-muted-foreground">
                par défaut
              </span>
            )}
            {m === value && <Check className="h-3.5 w-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function DescribeNode({ id, data, selected }: NodeProps) {
  const set = useNodeData(id)
  return (
    <NodeShell id={id} type="describe" selected={selected}>
      <TextModelSelect
        value={str(data.model) || WORKFLOW_TEXT_MODEL_DEFAULT}
        onChange={(model) => set({ model })}
      />
      <NodeTextarea
        ariaLabel="Précision pour la description"
        value={str(data.instruction)}
        onChange={(instruction) => set({ instruction })}
        placeholder="Facultatif : sur quoi insister (style, lumière, tenue…)"
        rows={2}
        className="max-h-40 min-h-12"
      />
      <TextResults id={id} activeResultId={str(data.activeResultId)} />
    </NodeShell>
  )
}

function LlmNode({ id, data, selected }: NodeProps) {
  const set = useNodeData(id)
  return (
    <NodeShell id={id} type="llm" selected={selected}>
      <TextModelSelect
        value={str(data.model) || WORKFLOW_TEXT_MODEL_DEFAULT}
        onChange={(model) => set({ model })}
      />
      <NodeTextarea
        ariaLabel="Consigne"
        value={str(data.instruction)}
        onChange={(instruction) => set({ instruction })}
        placeholder="Consigne : reformule ce prompt pour un rendu photo réaliste…"
        rows={3}
        className="max-h-48 min-h-16"
      />
      <TextResults id={id} activeResultId={str(data.activeResultId)} />
    </NodeShell>
  )
}

// ── Génération ───────────────────────────────────────────────

/** Tâche déduite des entrées reliées (même règle que le composer). */
function useNodeTask(
  id: string,
  media: MediaKind,
  family: CatalogFamily | undefined,
) {
  const edges = useEdges()
  const into = (handle: string) =>
    edges.filter((e) => e.target === id && e.targetHandle === handle).length
  const references = into('references')
  const images = references + into('start') + into('end')
  if (!family) return null
  return resolveTask(
    media,
    Object.keys(family.tasks) as TaskKind[],
    { images, videos: 0 },
    media === 'video' && references > 0 ? 'reference' : 'start-frame',
  )
}

const TASK_LABELS: Partial<Record<TaskKind, string>> = {
  'text-to-image': 'Texte → image',
  'image-to-image': 'Image → image',
  'text-to-video': 'Texte → vidéo',
  'image-to-video': 'Image → vidéo',
  'reference-to-video': 'Références → vidéo',
}

function GenerateNode({
  id,
  data,
  selected,
  media,
}: NodeProps & { media: MediaKind }) {
  const set = useNodeData(id)
  const { data: catalog } = useQuery(catalogQuery())
  const families = catalog?.families ?? []
  const familyId = str(data.family) || null
  const family = families.find((f) => f.id === familyId)
  const params = (
    data.params && typeof data.params === 'object' ? data.params : {}
  ) as Data
  const task = useNodeTask(id, media, family)
  const schema = task?.ok
    ? family?.tasks[task.task]?.schema
    : Object.values(family?.tasks ?? {})[0]?.schema
  const fields = editableFields(schema)
  const changed = fields.filter(([k]) => params[k] !== undefined).length

  return (
    <NodeShell
      id={id}
      type={media === 'image' ? 'image-gen' : 'video-gen'}
      selected={selected}
    >
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1 rounded-lg border border-border/60 [&>button]:w-full [&>button]:justify-between">
          <ModelPicker
            families={families}
            media={media}
            value={familyId}
            // Paramètres propres à chaque modèle : on repart de zéro en changeant.
            onChange={(f) => set({ family: f, params: {} })}
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={!fields.length}
              aria-label="Réglages du modèle"
              title="Réglages du modèle"
              className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border/60 hover:bg-accent/60 disabled:opacity-30"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {changed > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-brand" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="max-h-[60vh] w-80 space-y-3 overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Réglages</span>
              <button
                type="button"
                onClick={() => set({ params: {} })}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Réinitialiser
              </button>
            </div>
            {fields.map(([key, prop]) => (
              <div
                key={key}
                className={
                  prop.type === 'boolean'
                    ? 'flex items-center justify-between gap-3'
                    : 'space-y-1.5'
                }
              >
                <span
                  className="text-xs text-muted-foreground"
                  title={prop.description}
                >
                  {labelOf(key)}
                </span>
                <ParamField
                  name={key}
                  prop={prop}
                  value={params[key]}
                  onChange={(v) => set({ params: { ...params, [key]: v } })}
                  compact
                />
              </div>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      <NodeResults id={id} activeResultId={str(data.activeResultId)} />
      {!familyId ? (
        <p className="text-[11px] text-muted-foreground">Choisis un modèle.</p>
      ) : task && !task.ok ? (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
          <TriangleAlert className="mt-px h-3 w-3 shrink-0" /> {task.reason}
        </p>
      ) : task?.ok ? (
        <p className="text-[11px] text-muted-foreground">
          {TASK_LABELS[task.task] ?? task.task}
        </p>
      ) : null}
    </NodeShell>
  )
}

/**
 * Résultats d'un nœud de génération : état de la dernière exécution, aperçu du
 * résultat actif (celui qui part aux nœuds suivants), puis l'historique en vignettes.
 */
function NodeResults({
  id,
  activeResultId,
}: {
  id: string
  activeResultId: string
}) {
  const set = useNodeData(id)
  const results = useNodeResults(id)
  const [viewing, setViewing] = useState(false)
  const latest = results[0]
  const done = results.filter(
    (r) => r.status === 'succeeded' && r.generation?.outputs.length,
  )
  const active = pickActive(results, activeResultId)
  const media = active?.generation?.outputs[0]

  return (
    <div className="space-y-2" data-testid="node-results">
      {latest &&
        (latest.status === 'pending' || latest.status === 'running') && (
          <p className="flex items-center gap-1.5 text-[11px] text-sky-300">
            <Loader2 className="h-3 w-3 animate-spin" />{' '}
            {latest.status === 'pending'
              ? 'En attente…'
              : 'Génération en cours…'}
          </p>
        )}
      {latest &&
        (latest.status === 'failed' || latest.status === 'skipped') && (
          <p
            role="alert"
            className="flex items-start gap-1.5 text-[11px] text-red-300"
          >
            <TriangleAlert className="mt-px h-3 w-3 shrink-0" />{' '}
            {latest.errorMessage ?? 'Échec.'}
          </p>
        )}
      {media && (
        <>
          <button
            type="button"
            onClick={() => setViewing(true)}
            aria-label="Voir le résultat en grand"
            className="block w-full overflow-hidden rounded-lg border border-border/40 bg-black/20"
          >
            {media.mediaType === 'video' ? (
              <video
                src={media.url}
                muted
                playsInline
                loop
                autoPlay
                className="max-h-64 w-full object-contain"
              />
            ) : (
              <img
                src={media.url}
                alt="Résultat"
                draggable={false}
                className="max-h-64 w-full object-contain"
              />
            )}
          </button>
          <MediaViewer
            asset={viewing ? media : null}
            onClose={() => setViewing(false)}
          />
        </>
      )}
      {done.length > 1 && (
        <div
          className="flex gap-1.5 overflow-x-auto pb-0.5"
          aria-label="Historique des résultats"
        >
          {done.slice(0, 12).map((r) => {
            const a = r.generation!.outputs[0]
            const on = r.id === active?.id
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                aria-label="Utiliser ce résultat"
                title="Utiliser ce résultat pour la suite"
                onClick={() => set({ activeResultId: r.id })}
                className={cn(
                  'h-11 w-11 shrink-0 overflow-hidden rounded-md border-2 transition',
                  on
                    ? 'border-sky-400'
                    : 'border-transparent opacity-60 hover:opacity-100',
                )}
              >
                {a.mediaType === 'video' ? (
                  <video
                    src={a.url}
                    muted
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <img
                    src={a.url}
                    alt=""
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                )}
              </button>
            )
          })}
        </div>
      )}
      {active?.cost && (
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {formatUsd(active.cost)}
        </p>
      )}
    </div>
  )
}

/**
 * Résultat d'un nœud de texte IA : état de la dernière exécution, texte actif (celui qui
 * part aux nœuds suivants, sélectionnable et copiable), puis les versions précédentes.
 */
function TextResults({
  id,
  activeResultId,
}: {
  id: string
  activeResultId: string
}) {
  const set = useNodeData(id)
  const results = useNodeResults(id)
  const latest = results[0]
  const done = results.filter((r) => r.status === 'succeeded' && r.text)
  const active = pickActive(results, activeResultId)
  const [textFocused, setTextFocused] = useState(false)
  return (
    <div className="space-y-2" data-testid="node-results">
      {latest &&
        (latest.status === 'pending' || latest.status === 'running') && (
          <p className="flex items-center gap-1.5 text-[11px] text-sky-300">
            <Loader2 className="h-3 w-3 animate-spin" />{' '}
            {latest.status === 'pending'
              ? 'En attente…'
              : 'Rédaction en cours…'}
          </p>
        )}
      {latest &&
        (latest.status === 'failed' || latest.status === 'skipped') && (
          <p
            role="alert"
            className="flex items-start gap-1.5 text-[11px] text-red-300"
          >
            <TriangleAlert className="mt-px h-3 w-3 shrink-0" />{' '}
            {latest.errorMessage ?? 'Échec.'}
          </p>
        )}
      {active?.text && (
        <div className="relative">
          <p
            data-testid="node-text-result"
            // Cliquer le texte lui donne la molette (pour le faire défiler) ; sinon elle déplace le canvas.
            tabIndex={0}
            onFocus={() => setTextFocused(true)}
            onBlur={() => setTextFocused(false)}
            className={cn(
              'max-h-44 overflow-y-auto rounded-lg border border-border/40 bg-black/20 px-2.5 py-2 text-[12px] leading-snug whitespace-pre-wrap outline-none select-text focus:border-border',
              textFocused && 'nowheel',
            )}
          >
            {active.text}
          </p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(active.text!)
              toast.success('Texte copié')
            }}
            aria-label="Copier le texte"
            title="Copier le texte"
            className="absolute top-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-md bg-card/80 text-muted-foreground hover:text-foreground"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      )}
      {done.length > 1 && (
        <div className="flex flex-wrap gap-1" aria-label="Versions du texte">
          {[...done].reverse().map((r, i) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={r.id === active?.id}
              aria-label={`Utiliser la version ${i + 1}`}
              onClick={() => set({ activeResultId: r.id })}
              className={cn(
                'h-6 min-w-6 rounded-md px-1.5 text-[11px] tabular-nums transition',
                r.id === active?.id
                  ? 'bg-sky-400 text-black'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              v{i + 1}
            </button>
          ))}
        </div>
      )}
      {active?.cost && (
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {formatUsd(active.cost)}
        </p>
      )}
    </div>
  )
}

// ── Sortie ───────────────────────────────────────────────────

/** Médias finaux reliés au nœud Résultat, dans l'ordre des liens (images puis vidéos). */
function useFinalMedia(id: string): Asset[] {
  const edges = useEdges()
  const nodes = useNodes()
  const { state } = useWorkflowRun()
  const media: Asset[] = []
  const asAsset = (assetId: string) =>
    ({ id: assetId, url: mediaUrl(assetId), mediaType: 'image' }) as Asset
  for (const port of ['images', 'videos']) {
    for (const e of edges.filter(
      (x) => x.target === id && x.targetHandle === port,
    )) {
      const source = nodes.find((n) => n.id === e.source)
      if (!source) continue
      if (source.type === 'image-source') {
        media.push(
          ...(Array.isArray(source.data.assetIds)
            ? (source.data.assetIds as string[])
            : []
          ).map(asAsset),
        )
      } else {
        const results =
          state?.results.filter((r) => r.nodeId === source.id) ?? []
        media.push(
          ...(pickActive(results, source.data.activeResultId)?.generation
            ?.outputs ?? []),
        )
      }
    }
  }
  return media
}

function OutputNode({ id, selected }: NodeProps) {
  const media = useFinalMedia(id)
  const [index, setIndex] = useState(0)
  const [viewing, setViewing] = useState<number | null>(null)
  const i = Math.min(index, Math.max(0, media.length - 1))
  const current = media[i]

  return (
    <NodeShell id={id} type="output" selected={selected} wide>
      {current ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setViewing(i)}
            aria-label="Voir le résultat final en grand"
            className="block w-full overflow-hidden rounded-xl border border-border/40 bg-black/20"
          >
            {current.mediaType === 'video' ? (
              <video
                src={current.url}
                muted
                playsInline
                loop
                autoPlay
                className="max-h-96 w-full object-contain"
              />
            ) : (
              <img
                src={current.url}
                alt="Résultat final"
                draggable={false}
                className="max-h-96 w-full object-contain"
              />
            )}
          </button>
          {media.length > 1 && (
            <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-muted-foreground tabular-nums">
              <button
                type="button"
                onClick={() => setIndex(Math.max(0, i - 1))}
                disabled={i === 0}
                aria-label="Résultat précédent"
                className="grid h-6 w-6 place-items-center rounded-md hover:bg-accent disabled:opacity-30"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              {i + 1} / {media.length}
              <button
                type="button"
                onClick={() => setIndex(Math.min(media.length - 1, i + 1))}
                disabled={i === media.length - 1}
                aria-label="Résultat suivant"
                className="grid h-6 w-6 place-items-center rounded-md hover:bg-accent disabled:opacity-30"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <MediaViewer
            asset={viewing !== null ? (media[viewing] ?? null) : null}
            onClose={() => setViewing(null)}
            onPrev={
              viewing !== null && viewing > 0
                ? () => setViewing(viewing - 1)
                : undefined
            }
            onNext={
              viewing !== null && viewing < media.length - 1
                ? () => setViewing(viewing + 1)
                : undefined
            }
          />
        </div>
      ) : (
        <div className="grid h-40 place-items-center rounded-xl border border-dashed border-border/60 px-6 text-center text-xs text-muted-foreground">
          Résultat final du workflow.
        </div>
      )}
    </NodeShell>
  )
}

const ImageGenNode = (props: NodeProps) => (
  <GenerateNode {...props} media="image" />
)
const VideoGenNode = (props: NodeProps) => (
  <GenerateNode {...props} media="video" />
)

export const nodeTypes: NodeTypes & Record<WorkflowNodeType, unknown> = {
  text: TextNode,
  'image-source': ImageSourceNode,
  describe: DescribeNode,
  llm: LlmNode,
  'image-gen': ImageGenNode,
  'video-gen': VideoGenNode,
  output: OutputNode,
}

/** Réglages d'un nœud tout juste ajouté. */
export function initialData(
  type: WorkflowNodeType,
  defaults: { image: string | null; video: string | null },
): Data {
  switch (type) {
    case 'describe':
    case 'llm':
      return { model: WORKFLOW_TEXT_MODEL_DEFAULT }
    case 'image-gen':
      return defaults.image
        ? { family: defaults.image, params: {} }
        : { params: {} }
    case 'video-gen':
      return defaults.video
        ? { family: defaults.video, params: {} }
        : { params: {} }
    default:
      return {}
  }
}
