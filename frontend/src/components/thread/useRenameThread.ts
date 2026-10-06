import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { threadsApi } from '@/lib/api'
import { qk } from '@/lib/queries'

/** Renomme un fil et rafraîchit la liste et le fil ouvert. */
export function useRenameThread() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => threadsApi.update(id, { title }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: qk.threadsAll })
      queryClient.invalidateQueries({ queryKey: qk.thread(id) })
    },
    onError: (e) => toast.error((e as Error).message),
  })
}
