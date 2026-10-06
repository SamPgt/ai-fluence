import { PanelLeft } from 'lucide-react'
import { Button } from '../ui/button'
import { ThemeToggle } from '../ThemeToggle'
import { ModelSelector } from './ModelSelector'
import { SidebarProvider, useSidebar } from '../ui/sidebar'
import { ChatSidebar } from './ChatSidebar'

interface ChatLayoutProps {
    children: React.ReactNode
    activeChatId?: string
}

function ChatHeader() {
    const { toggleSidebar } = useSidebar()

    return (
        <header className="h-14 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shrink-0">
            <div className="flex h-full items-center justify-between px-4">
                {/* Left side: Sidebar toggle + Model selector */}
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleSidebar}
                    >
                        <PanelLeft className="h-5 w-5" />
                    </Button>

                    <ModelSelector />
                </div>

                {/* Right side: Theme toggle */}
                <ThemeToggle />
            </div>
        </header>
    )
}

function ChatLayoutContent({ children, activeChatId }: ChatLayoutProps) {
    return (
        <div className="flex h-full w-full">
            {/* Sidebar - full height */}
            <ChatSidebar activeChatId={activeChatId} />

            {/* Main content area with header */}
            <div className="flex flex-col flex-1 overflow-hidden">
                <ChatHeader />
                <main className="flex-1 overflow-hidden">{children}</main>
            </div>
        </div>
    )
}

export function ChatLayout({ children, activeChatId }: ChatLayoutProps) {
    return (
        <SidebarProvider>
            <ChatLayoutContent activeChatId={activeChatId}>
                {children}
            </ChatLayoutContent>
        </SidebarProvider>
    )
}
