import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createChat } from '@/lib/chat-actions'

export const Route = createFileRoute('/chat/')({
    component: NewChatPage,
})

function NewChatPage() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const createChatMutation = useMutation({
        mutationFn: () => createChat({ data: { title: 'New Chat' } as any }),
        onSuccess: (newChat) => {
            queryClient.invalidateQueries({ queryKey: ['chats'] })
            navigate({ to: '/chat/$chatId', params: { chatId: newChat.id } })
        },
    })

    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-6">
                <Bot className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-3xl font-bold mb-3">Welcome to Chat</h1>
            <p className="text-muted-foreground max-w-md mb-8">
                Start a new conversation with our AI assistant.
            </p>
            <Button
                size="lg"
                onClick={() => createChatMutation.mutate()}
                disabled={createChatMutation.isPending}
                className="rounded-xl"
            >
                Start New Chat
            </Button>
        </div>
    )
}
