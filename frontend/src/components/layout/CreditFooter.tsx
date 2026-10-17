/** Pied des volets de gauche (fils, palette des workflows) : crédit SpicyAPI restant. */
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Wallet } from 'lucide-react'

import { balanceQuery, settingsQuery } from '@/lib/queries'
import { formatUsd } from '@/lib/format'

export function CreditFooter() {
  const { data: settings } = useQuery(settingsQuery())
  const { data: balance } = useQuery(balanceQuery(Boolean(settings?.hasApiKey)))
  return (
    <Link
      to="/parametres"
      search={{ tab: 'credits' }}
      className="flex shrink-0 items-center gap-2 border-t border-border/40 px-4 py-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <Wallet className="h-3.5 w-3.5" />
      {settings && !settings.hasApiKey ? (
        <span className="text-amber-300">Clé API manquante</span>
      ) : (
        <span>
          Crédit :{' '}
          <span className="font-medium text-foreground">
            {balance ? formatUsd(balance.available, 'balance') : '…'}
          </span>
        </span>
      )}
    </Link>
  )
}
