import { createFileRoute, Outlet, useParams } from '@tanstack/react-router'
import { ChatLayout } from '@/components/chat/ChatLayout'

export const Route = createFileRoute('/chat')({
    component: ChatLayoutRoute,
})

function ChatLayoutRoute() {
    const params = useParams({ strict: false })
    const chatId = 'chatId' in params ? params.chatId : undefined

    return (
        <ChatLayout activeChatId={chatId}>
            <Outlet />
        </ChatLayout>
    )
}
