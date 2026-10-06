import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ImageIcon, Pin, Trash2 } from 'lucide-react'
import type { Thread } from '@ai-fluence/shared'

import { cn } from '@/lib/utils'
import { formatUsd } from '@/lib/format'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { InlineEdit } from '@/components/ui/inline-edit'
import { useRenameThread } from '@/components/thread/useRenameThread'

interface ChatListItemProps {
  thread: Thread
  isActive: boolean
  onDelete: () => void
  onTogglePin: () => void
}

export function ChatListItem({ thread, isActive, onDelete, onTogglePin }: ChatListItemProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const rename = useRenameThread()

  return (
    <div className="relative" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      <Link
        to="/t/$threadId"
        params={{ threadId: thread.id }}
        // Double-clic : renommer le fil.
        onDoubleClick={(e) => {
          e.preventDefault()
          setEditing(true)
        }}
        className={cn(
          'relative flex items-center gap-2.5 overflow-hidden rounded-lg px-2 py-1.5 text-sm transition-colors',
          isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )}
      >
        {thread.coverUrl ? (
          <img src={thread.coverUrl} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" loading="lazy" />
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <ImageIcon className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          {editing ? (
            <InlineEdit
              value={thread.title}
              onSubmit={(title) => {
                setEditing(false)
                rename.mutate({ id: thread.id, title })
              }}
              onCancel={() => setEditing(false)}
              className="h-6 text-foreground"
            />
          ) : (
            <span className="block truncate" title="Double-clic pour renommer">
              {thread.title}
            </span>
          )}
          <span className="block text-[11px] text-muted-foreground/70">
            {thread.generationCount} génération{thread.generationCount > 1 ? 's' : ''} · {formatUsd(thread.totalCost)}
          </span>
        </span>
      </Link>

      {/* Actions visibles au survol */}
      {isHovered && !editing && (
        <div className="absolute top-1/2 right-1 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-accent/90 px-0.5">
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onTogglePin()
            }}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              thread.isPinned ? 'text-primary hover:text-primary/70' : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label={thread.isPinned ? 'Désépingler' : 'Épingler'}
            title={thread.isPinned ? 'Désépingler' : 'Épingler'}
          >
            <Pin className={cn('h-3.5 w-3.5', thread.isPinned && 'fill-current')} />
          </button>
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setConfirming(true)
            }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive-foreground"
            aria-label="Supprimer le fil"
            title="Supprimer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Supprimer ce fil ?"
        description={
          <>
            « {thread.title} » sera retiré de l’app. Les images et vidéos restent dans ton dossier local.
          </>
        }
        onConfirm={() => {
          setConfirming(false)
          onDelete()
        }}
      />
    </div>
  )
}
