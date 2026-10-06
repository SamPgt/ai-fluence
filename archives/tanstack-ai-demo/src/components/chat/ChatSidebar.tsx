import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { getChats, createChat, deleteChat, toggleChatPin } from '@/lib/chat-actions'
import { ChatSearchDialog } from './ChatSearchDialog'
import { ChatListItem } from './ChatListItem'
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
} from '../ui/sidebar'

interface ChatSidebarProps {
    activeChatId?: string
}

export function ChatSidebar({ activeChatId }: ChatSidebarProps) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const { data: allChats = [] } = useQuery({
        queryKey: ['chats'],
        queryFn: () => getChats(),
    })

    const createChatMutation = useMutation({
        mutationFn: () => createChat({ data: { title: 'New Chat' } as any }),
        onSuccess: (newChat) => {
            queryClient.invalidateQueries({ queryKey: ['chats'] })
            navigate({ to: '/chat/$chatId', params: { chatId: newChat.id } })
        },
    })

    const deleteChatMutation = useMutation({
        mutationFn: (chatId: string) => deleteChat({ data: { chatId } } as any),
        onSuccess: (_, deletedChatId) => {
            queryClient.invalidateQueries({ queryKey: ['chats'] })
            // If we deleted the active chat, navigate to home
            if (deletedChatId === activeChatId) {
                navigate({ to: '/' })
            }
        },
    })

    const togglePinMutation = useMutation({
        mutationFn: (chatId: string) => toggleChatPin({ data: { chatId } } as any),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['chats'] })
        },
    })

    const pinnedChats = allChats.filter((chat) => chat.isPinned)
    const recentChats = allChats.filter((chat) => !chat.isPinned).slice(0, 10)

    return (
        <Sidebar>
            <SidebarHeader>
                <div className="space-y-3 p-4">
                    <Button
                        onClick={() => createChatMutation.mutate()}
                        className="w-full gap-2 blue-gradient blue-button-shadow border border-blue-400/30 hover:opacity-90 active:scale-[0.99] transition-all duration-150 text-white font-medium"
                        size="sm"
                    >
                        <Plus className="h-4 w-4" />
                        New Chat
                    </Button>
                    <ChatSearchDialog />
                </div>
            </SidebarHeader>

            <SidebarContent>
                <ScrollArea className="flex-1">
                    {pinnedChats.length > 0 && (
                        <SidebarGroup>
                            <SidebarGroupLabel>Pinned</SidebarGroupLabel>
                            <SidebarGroupContent>
                                <div className="space-y-1">
                                    {pinnedChats.map((chat) => (
                                        <ChatListItem
                                            key={chat.id}
                                            chat={chat}
                                            isActive={activeChatId === chat.id}
                                            onDelete={() => deleteChatMutation.mutate(chat.id)}
                                            onTogglePin={() => togglePinMutation.mutate(chat.id)}
                                        />
                                    ))}
                                </div>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    )}

                    <SidebarGroup>
                        <SidebarGroupLabel>Recent</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <div className="space-y-1">
                                {recentChats.map((chat) => (
                                    <ChatListItem
                                        key={chat.id}
                                        chat={chat}
                                        isActive={activeChatId === chat.id}
                                        onDelete={() => deleteChatMutation.mutate(chat.id)}
                                        onTogglePin={() => togglePinMutation.mutate(chat.id)}
                                    />
                                ))}
                            </div>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </ScrollArea>
            </SidebarContent>
        </Sidebar>
    )
}


