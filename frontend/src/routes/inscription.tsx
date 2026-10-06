import { createFileRoute, redirect } from '@tanstack/react-router'

import { AuthCard } from '@/components/auth/AuthCard'
import { sessionQueryOptions } from '@/server/auth'

export const Route = createFileRoute('/inscription')({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions())
    if (user) throw redirect({ to: '/' })
  },
  component: () => <AuthCard mode="signup" />,
})
