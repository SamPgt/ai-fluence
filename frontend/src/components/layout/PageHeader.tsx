import { PanelLeft } from 'lucide-react'

import { useUiPref } from '@/components/providers/ui-prefs'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function PageHeader({
  children,
  right,
}: {
  children?: React.ReactNode
  right?: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useUiPref('sidebarCollapsed')
  return (
    <header className="flex h-10.5 shrink-0 items-center gap-2 border-b border-border/40 bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            aria-label="Replier le panneau"
          >
            <PanelLeft className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {collapsed ? 'Afficher' : 'Replier'} les fils (⌘B)
        </TooltipContent>
      </Tooltip>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {right}
    </header>
  )
}
