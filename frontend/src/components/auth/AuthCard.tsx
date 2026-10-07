import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { authApi } from '@/lib/api'
import { SESSION_QUERY_KEY } from '@/server/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

export function AuthCard({ mode }: { mode: 'login' | 'signup' }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const { user } =
        mode === 'login' ? await authApi.login({ email, password }) : await authApi.signup({ email, name, password })
      queryClient.setQueryData(SESSION_QUERY_KEY, user)
      await navigate({ to: mode === 'signup' ? '/parametres' : '/', search: mode === 'signup' ? { tab: 'api-key' } : {} })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6 rounded-2xl border border-border/60 bg-card p-8">
        <div className="space-y-2 text-center">
          <img src="/logo.svg" alt="AI Fluence" className="mx-auto h-12 w-12 select-none" draggable={false} />
          <h1 className="text-xl font-semibold">{mode === 'login' ? 'Connexion' : 'Créer un compte'}</h1>
          <p className="text-sm text-muted-foreground">AI Fluence, ton studio local</p>
        </div>

        <div className="space-y-4">
          {mode === 'signup' && (
            <Field id="name" label="Nom">
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </Field>
          )}
          <Field id="email" label="E-mail">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus={mode === 'login'}
            />
          </Field>
          <Field id="password" label="Mot de passe">
            <Input
              id="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
        </div>

        {error && <p className="text-sm text-destructive-foreground">{error}</p>}

        <Button type="submit" disabled={pending} className="w-full brand-gradient brand-shadow hover:opacity-90">
          {pending ? '…' : mode === 'login' ? 'Se connecter' : 'Créer le compte'}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          {mode === 'login' ? (
            <>
              Pas encore de compte ?{' '}
              <Link to="/inscription" className="text-foreground underline-offset-4 hover:underline">
                Créer un compte
              </Link>
            </>
          ) : (
            <>
              Déjà un compte ?{' '}
              <Link to="/connexion" className="text-foreground underline-offset-4 hover:underline">
                Se connecter
              </Link>
            </>
          )}
        </p>
      </form>
    </div>
  )
}
