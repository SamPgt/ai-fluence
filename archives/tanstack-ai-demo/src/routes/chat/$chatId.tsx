import { createFileRoute } from '@tanstack/react-router'
import { Chat } from '../../components/chat/Chat'
import { getChatWithMessages } from '@/lib/chat-actions'
import type { Message } from '@/types'

export const Route = createFileRoute('/chat/$chatId')({
    loader: async ({ params }) => {
        const result = await getChatWithMessages({
            data: { chatId: params.chatId } as any,
        })
        // Transform DB messages to frontend messages (remove chatId field and filter to user/assistant only)
        const messages: Message[] = (result.messages || [])
            .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
            .map(({ chatId, ...msg }) => msg as Message)
        return {
            chatId: params.chatId,
            messages,
            chat: result.chat,
        }
    },
    component: ChatPage,
})

function ChatPage() {
    const { chatId, messages } = Route.useLoaderData()

    return <Chat key={chatId} chatId={chatId} initialMessages={messages} />
}
