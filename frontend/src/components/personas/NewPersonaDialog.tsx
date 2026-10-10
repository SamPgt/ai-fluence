import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { personasApi } from '@/lib/api'
import { qk } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { useUiPref } from '@/components/providers/ui-prefs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const PERSONA_COLORS = ['#8b5cf6', '#ec4899', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#64748b']

export function NewPersonaDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [, setPersonaId] = useUiPref('personaId')
  const [name, setName] = useState('')
  const [color, setColor] = useState(PERSONA_COLORS[0])

  const create = useMutation({
    mutationFn: () => personasApi.create({ name, color }),
    onSuccess: ({ persona }) => {
      queryClient.invalidateQueries({ queryKey: qk.personas })
      setPersonaId(persona.id)
      onOpenChange(false)
      setName('')
      navigate({ to: '/personas/$personaId', params: { personaId: persona.id } })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) create.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouveau persona</DialogTitle>
          <DialogDescription>Un personnage ou une page : ses LoRA, ses références et son contexte.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="persona-name">Nom</Label>
            <Input id="persona-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={40} />
          </div>
          <div className="flex gap-2">
            {PERSONA_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                style={{ backgroundColor: c }}
                className={cn('h-7 w-7 rounded-full ring-offset-2 ring-offset-background', color === c && 'ring-2 ring-white')}
                aria-label={`Couleur ${c}`}
              />
            ))}
          </div>
          <Button type="submit" disabled={!name.trim() || create.isPending} variant="outline" className="w-full">
            Créer et configurer
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
