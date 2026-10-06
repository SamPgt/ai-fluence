import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Search, MessageSquare, FileText, X } from 'lucide-react'
import type { SearchResult } from '@ai-fluence/shared'

import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { threadsApi } from '@/lib/api'

export function ChatSearchDialog() {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()

  // Recherche avec debounce
  useEffect(() => {
    if (search.trim().length === 0) {
      setResults([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    const timeoutId = setTimeout(() => {
      threadsApi
        .search(search.trim())
        .then((data) => setResults(data.results))
        .catch(() => setResults([]))
        .finally(() => setIsLoading(false))
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [search])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  const handleClose = () => {
    setOpen(false)
    setSearch('')
    setResults([])
  }

  const handleSelect = (threadId: string) => {
    handleClose()
    navigate({ to: '/t/$threadId', params: { threadId } })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-border/40 bg-muted/50 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Search className="h-4 w-4" />
        <span>Rechercher…</span>
        <kbd className="pointer-events-none ml-auto inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground select-none">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
        <DialogContent className="gap-0 p-0 sm:max-w-[600px]" showCloseButton={false}>
          <DialogTitle className="sr-only">Rechercher dans les fils</DialogTitle>
          <div className="flex items-center border-b px-4 py-3">
            <Search className="mr-2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Rechercher dans les fils et les prompts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 border-0 bg-transparent text-sm focus:outline-none"
              autoFocus
            />
            <button onClick={handleClose} className="ml-2 rounded p-1 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[400px] overflow-y-auto p-2">
            {isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Recherche…</div>}

            {!isLoading && search.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">Tape pour chercher…</div>
            )}

            {!isLoading && search.length > 0 && results.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">Aucun résultat pour « {search} »</div>
            )}

            {!isLoading && results.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {results.length} résultat{results.length > 1 ? 's' : ''}
                </div>
                {results.map((result) => (
                  <button
                    key={result.threadId}
                    onClick={() => handleSelect(result.threadId)}
                    className="flex w-full flex-col gap-2 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted"
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate text-sm font-medium">{result.threadTitle}</span>
                    </div>
                    {result.matchedPrompt && (
                      <div className="flex items-start gap-2 pl-6">
                        <FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="line-clamp-2 text-xs text-muted-foreground">{result.matchedPrompt}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
