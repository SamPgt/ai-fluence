import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { useSidebar } from '@/components/ui/sidebar'

export default function Header() {
  const { toggleSidebar, isMobile } = useSidebar()

  return (
    <header className="h-14 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-20">
      <div className="flex h-full items-center justify-between px-4">
        {/* Left side: Mobile sidebar toggle + Model selector */}
        <div className="flex items-center gap-2">
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <ModelSelector />
        </div>

        {/* Right side: Theme toggle */}
        <ThemeToggle />
      </div>
    </header>
  )
}
