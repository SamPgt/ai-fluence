/**
 * Workflow lancé depuis un fil : un formulaire fixé au-dessus du composer, un champ par
 * entrée « À fournir » (texte, ou images jusqu'au maximum réglé dans le workflow), puis
 * Lancer. Le prix ne dépend pas de la saisie : il est calculé une fois, à l'ouverture.
 * Le résultat s'affiche dans le fil (créé au besoin). Le workflow enregistré ne change pas.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Image as ImageIcon, ImagePlus, Loader2, Play, Upload, Workflow as WorkflowIcon, X } from 'lucide-react'
import { toast } from 'sonner'
import { workflowInputs, type Asset, type WorkflowInput, type WorkflowInputValue } from '@ai-fluence/shared'

import { assetsApi, workflowsApi } from '@/lib/api'
import { qk, workflowQuery, workflowsQuery } from '@/lib/queries'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { LibraryBrowser } from './LibraryBrowser'

/** Image choisie dans le formulaire : son nom quand on le connaît (fichier importé). */
interface PickedImage {
  asset: Pick<Asset, 'id' | 'url' | 'width' | 'height'>
  name: string
}

export function WorkflowForm({
  workflowId,
  threadId,
  onClose,
}: {
  workflowId: string
  /** Fil où afficher l'exécution (absent : un nouveau fil est créé). */
  threadId?: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: workflow } = useQuery(workflowQuery(workflowId))
  const inputs = workflow ? workflowInputs(workflow.graph) : []
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [images, setImages] = useState<Record<string, PickedImage[]>>({})
  useEffect(() => {
    setTexts({})
    setImages({})
  }, [workflowId])

  // Prix fixe (nombre d'images au maximum, textes types) : calculé une fois, gardé en cache.
  const quote = useQuery({
    queryKey: ['workflow-form-quote', workflowId, workflow?.updatedAt],
    queryFn: () => workflowsApi.quote(workflowId, { template: true }),
    enabled: Boolean(workflow),
    retry: false,
    staleTime: 10 * 60_000,
  })

  const values = (): Record<string, WorkflowInputValue> =>
    Object.fromEntries(
      inputs.map((i) =>
        i.kind === 'text'
          ? [i.nodeId, { text: texts[i.nodeId] ?? '' }]
          : [i.nodeId, { assetIds: (images[i.nodeId] ?? []).map((p) => p.asset.id) }],
      ),
    )
  const run = useMutation({
    mutationFn: () =>
      workflowsApi.run(workflowId, {
        inputs: values(),
        thread: { id: threadId ?? null },
        expectedCost: quote.data?.estimatedCost,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: qk.threadsAll })
      if (res.threadId) queryClient.invalidateQueries({ queryKey: qk.thread(res.threadId) })
      onClose()
      if (!threadId && res.threadId) navigate({ to: '/t/$threadId', params: { threadId: res.threadId } })
    },
    onError: (e) => toast.error(e.message),
  })

  const missing = inputs.filter((i) =>
    i.kind === 'text' ? !texts[i.nodeId]?.trim() : !(images[i.nodeId] ?? []).length,
  ).length
  const ready = Boolean(workflow) && missing === 0

  return (
    <div
      data-testid="workflow-form"
      className="mb-2 overflow-hidden rounded-3xl border border-border/60 bg-muted/50 shadow-[0_2px_8px_rgba(0,0,0,0.2)]"
    >
      <div className="flex items-center gap-2.5 border-b border-border/50 px-4 py-3">
        <span
          title="Workflow"
          className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
          {workflow?.coverUrl ? (
            <img src={workflow.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <WorkflowIcon className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
          {workflow?.name ?? '…'}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer le workflow"
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-[45vh] space-y-4 overflow-y-auto px-4 py-4">
        {!workflow && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {inputs.map((input) =>
          input.kind === 'text' ? (
            <label key={input.nodeId} className="block space-y-2">
              <span className="block text-[13px] text-foreground/80">{input.label}</span>
              <textarea
                aria-label={input.label}
                value={texts[input.nodeId] ?? ''}
                onChange={(e) => setTexts((prev) => ({ ...prev, [input.nodeId]: e.target.value }))}
                // La valeur du nœud dans le workflow sert d'exemple.
                placeholder={input.defaultText.trim() ? `Ex. : ${input.defaultText.trim()}` : 'Écris ici…'}
                rows={2}
                className="field-sizing-content max-h-40 min-h-16 w-full resize-none rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-[14px] leading-snug outline-none placeholder:text-muted-foreground/60 focus:border-border"
              />
            </label>
          ) : (
            <ImageInput
              key={input.nodeId}
              input={input}
              picked={images[input.nodeId] ?? []}
              onChange={(list) => setImages((prev) => ({ ...prev, [input.nodeId]: list }))}
            />
          ),
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border/50 px-4 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground tabular-nums">
          {!ready ? (
            missing > 1 ? (
              `${missing} champs à remplir`
            ) : (
              '1 champ à remplir'
            )
          ) : (
            <>
              Prêt
              {quote.data && <> · ≈ {formatUsd(quote.data.estimatedCost)}</>}
            </>
          )}
          {quote.error && <span className="ml-2 text-red-300">{(quote.error as Error).message}</span>}
        </span>
        <button
          type="button"
          onClick={() => run.mutate()}
          disabled={!ready || run.isPending || Boolean(quote.error)}
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors',
            ready && !quote.error
              ? 'bg-foreground text-background hover:bg-foreground/90'
              : 'bg-white/[0.06] text-muted-foreground',
          )}
        >
          {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
          Lancer
        </button>
      </div>
    </div>
  )
}

/**
 * Champ image : une zone pointillée (glisser, Importer, Assets), puis une carte par image
 * choisie (vignette numérotée, nom, dimensions). Jusqu'au maximum réglé dans le workflow.
 */
function ImageInput({
  input,
  picked,
  onChange,
}: {
  input: WorkflowInput
  picked: PickedImage[]
  onChange: (list: PickedImage[]) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  // Dernière liste connue : plusieurs imports peuvent se terminer à la suite.
  const current = useRef(picked)
  current.current = picked
  const room = input.maxImages - picked.length - uploading

  const add = (item: PickedImage) => {
    if (current.current.some((p) => p.asset.id === item.asset.id)) return
    if (current.current.length >= input.maxImages) return
    onChange([...current.current, item])
  }
  const toggle = (asset: Asset) =>
    current.current.some((p) => p.asset.id === asset.id)
      ? onChange(current.current.filter((p) => p.asset.id !== asset.id))
      : add({ asset, name: 'Image des assets' })
  const upload = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'))
    for (const file of list.slice(0, Math.max(0, room))) {
      setUploading((n) => n + 1)
      try {
        add({ asset: (await assetsApi.upload(file)).asset, name: file.name })
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  return (
    <div className="space-y-2" role="group" aria-label={input.label}>
      <span className="block text-[13px] text-foreground/80">
        {input.label}
        {input.maxImages > 1 && <span className="ml-1.5 text-muted-foreground">(jusqu’à {input.maxImages} images)</span>}
      </span>
      {picked.map((p, i) => (
        <div key={p.asset.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/60 p-2 pr-3">
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg">
            <img src={p.asset.url} alt={`${input.label} ${i + 1}`} className="h-full w-full object-cover" />
            <span className="absolute bottom-0.5 left-0.5 grid h-3.5 min-w-3.5 place-items-center rounded bg-black/70 px-0.5 text-[9px] font-medium text-white tabular-nums">
              {i + 1}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px]">{p.name}</div>
            {p.asset.width && p.asset.height && (
              <div className="text-[12px] text-muted-foreground tabular-nums">
                {p.asset.width} × {p.asset.height}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onChange(picked.filter((x) => x.asset.id !== p.asset.id))}
            aria-label="Retirer l’image"
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      {Array.from({ length: uploading }).map((_, i) => (
        <div key={`up-${i}`} className="flex h-[62px] items-center gap-3 rounded-xl border border-border/60 bg-background/60 p-2">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-muted">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
          <span className="text-[13px] text-muted-foreground">Import…</span>
        </div>
      ))}
      {room > 0 && (
        <div
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void upload(e.dataTransfer.files)
          }}
          className={cn(
            'flex items-center gap-3 rounded-xl border border-dashed p-2',
            dragging ? 'border-sky-400/70 bg-sky-400/5' : 'border-border/70',
          )}
        >
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <ImageIcon className="h-4 w-4" />
          </div>
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
            {room > 1 ? `Glissez jusqu’à ${room} images ici` : 'Glissez une image ici'}
          </span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-[13px] hover:bg-accent/60"
          >
            <Upload className="h-3.5 w-3.5" /> Importer
          </button>
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-[13px] hover:bg-accent/60"
          >
            <ImagePlus className="h-3.5 w-3.5" /> Assets
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple={input.maxImages > 1}
        className="hidden"
        data-testid={`workflow-input-file-${input.nodeId}`}
        onChange={(e) => {
          void upload(e.target.files)
          e.target.value = ''
        }}
      />
      <LibraryBrowser
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        personaId={null}
        onImport={(asset) => add({ asset, name: 'Image importée' })}
        personal={{ selectedIds: picked.map((p) => p.asset.id), onToggle: toggle }}
      />
    </div>
  )
}

/**
 * Icône Workflow du composer : la liste des workflows utilisables depuis un fil (au moins
 * une entrée « À fournir », chacune avec un libellé). Un clic ouvre son formulaire.
 */
export function WorkflowPickerButton({ onPick, active }: { onPick: (workflowId: string) => void; active: boolean }) {
  const [open, setOpen] = useState(false)
  const { data: workflows = [] } = useQuery({ ...workflowsQuery(), enabled: open })
  const usable = workflows.filter((w) => w.usableInThread)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Lancer un workflow"
          title="Lancer un workflow"
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-xl text-foreground/80 transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent/60',
            active && 'bg-accent/60 text-foreground',
          )}
        >
          <WorkflowIcon className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 p-1">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Workflows</div>
        {usable.length === 0 ? (
          <p className="px-2 pb-2 text-xs text-muted-foreground">
            Aucun workflow utilisable ici : dans un workflow, active « À fournir au lancement » sur un nœud Texte ou
            Image source, avec un libellé.
          </p>
        ) : (
          usable.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => {
                onPick(w.id)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
            >
              <span className="grid h-9 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground">
                {w.coverUrl ? <img src={w.coverUrl} alt="" className="h-full w-full object-cover" /> : <WorkflowIcon className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px]">{w.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {w.inputCount > 1 ? `${w.inputCount} champs à remplir` : '1 champ à remplir'}
                </span>
              </span>
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  )
}
