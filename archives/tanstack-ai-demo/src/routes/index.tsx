import { Link, createFileRoute } from '@tanstack/react-router'
import { Bot, MessageSquare, Zap, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] p-6">
      <div className="max-w-2xl mx-auto text-center space-y-8">
        {/* Hero */}
        <div className="space-y-4">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg">
            <Bot className="w-10 h-10 text-primary-foreground" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            AI Chat Assistant
          </h1>
          <p className="text-lg text-muted-foreground max-w-md mx-auto">
            Start a conversation with our intelligent AI. Fast, powerful, and always ready to help.
          </p>
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button asChild size="lg" className="rounded-xl px-8">
            <Link to="/chat">
              <MessageSquare className="w-4 h-4 mr-2" />
              Start Chatting
            </Link>
          </Button>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-8">
          <div className="p-4 rounded-2xl bg-muted/50 border border-border/40">
            <Zap className="w-6 h-6 text-primary mb-2" />
            <h3 className="font-medium">Lightning Fast</h3>
            <p className="text-sm text-muted-foreground">Instant AI responses</p>
          </div>
          <div className="p-4 rounded-2xl bg-muted/50 border border-border/40">
            <MessageSquare className="w-6 h-6 text-primary mb-2" />
            <h3 className="font-medium">Multi-Model</h3>
            <p className="text-sm text-muted-foreground">Switch between AI models</p>
          </div>
          <div className="p-4 rounded-2xl bg-muted/50 border border-border/40">
            <Shield className="w-6 h-6 text-primary mb-2" />
            <h3 className="font-medium">Chat History</h3>
            <p className="text-sm text-muted-foreground">All conversations saved</p>
          </div>
        </div>
      </div>
    </div>
  )
}
