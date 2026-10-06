import { useState, useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import {
    addMessage,
    updateChatTitle,
    saveAssistantMessage,
    streamChatResponse,
} from '@/lib/chat-actions'
import { buildMessagesForStream } from '@/lib/multimodal'
import { settingsStore, AI_PROVIDERS } from '@/lib/store'
import { ChatInput } from './ChatInput'
import { EmptyChatState, MessageList } from './ChatMessages'
import type { Message, AttachedFile } from '@/types'

interface ChatProps {
    chatId: string
    initialMessages?: Message[]
}

export function Chat({ chatId, initialMessages = [] }: ChatProps) {
    const [messages, setMessages] = useState<Message[]>(initialMessages)
    const [isStreaming, setIsStreaming] = useState(false)
    const [streamingContent, setStreamingContent] = useState('')
    const [isDragging, setIsDragging] = useState(false)
    const [droppedFiles, setDroppedFiles] = useState<AttachedFile[]>([])
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const queryClient = useQueryClient()

    const { selectedProvider, selectedModel } = useStore(settingsStore, (s) => ({
        selectedProvider: s.selectedProvider,
        selectedModel: s.selectedModel,
    }))

    // Check if current model supports vision
    const currentProvider = AI_PROVIDERS.find((p) => p.id === selectedProvider)
    const currentModel = currentProvider?.models.find((m) => m.id === selectedModel)
    const supportsVision = currentModel?.supportsVision || false

    useEffect(() => {
        setMessages(initialMessages)
    }, [initialMessages, chatId])

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, streamingContent])

    // Drag and drop handlers
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (supportsVision) setIsDragging(true)
    }, [supportsVision])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
    }, [])

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)

        if (!supportsVision) return

        const files = Array.from(e.dataTransfer.files)
        const imageFiles = files.filter((f) => f.type.startsWith('image/'))

        const newFiles: AttachedFile[] = []
        for (const file of imageFiles) {
            const base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader()
                reader.onload = () => resolve(reader.result as string)
                reader.readAsDataURL(file)
            })

            newFiles.push({
                id: crypto.randomUUID(),
                name: file.name,
                type: file.type,
                size: file.size,
                data: base64,
                preview: base64,
            })
        }

        if (newFiles.length > 0) {
            setDroppedFiles(newFiles)
        }
    }, [supportsVision])

    // Clear dropped files after they're consumed by ChatInput
    const handleDroppedFilesConsumed = useCallback(() => {
        setDroppedFiles([])
    }, [])

    const handleSubmit = async (userContent: string, files?: AttachedFile[]) => {
        if (!userContent.trim() || isStreaming) return

        if (files && files.length > 0 && !supportsVision) {
            console.error('Current model does not support images')
            return
        }

        const userMessage: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            content: userContent,
            createdAt: new Date(),
            files: files,
        }
        setMessages((prev) => [...prev, userMessage])

        await addMessage({ data: { chatId, role: 'user', content: userContent } } as any)

        if (messages.length === 0) {
            await updateChatTitle({
                data: { chatId, title: userContent.slice(0, 50) },
            } as any)
            queryClient.invalidateQueries({ queryKey: ['chats'] })
        }

        setIsStreaming(true)
        setStreamingContent('')

        try {
            const allMessages = buildMessagesForStream(
                messages,
                userContent,
                files,
                supportsVision,
                selectedProvider as any
            )

            let fullContent = ''

            const stream = await streamChatResponse({
                data: {
                    chatId,
                    messages: allMessages,
                    provider: selectedProvider,
                    model: selectedModel,
                },
            } as any)

            for await (const chunk of stream) {
                if (chunk.type === 'content') {
                    fullContent = chunk.content
                    setStreamingContent(fullContent)
                }
            }

            const assistantMessage: Message = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: fullContent,
                createdAt: new Date(),
            }

            setMessages((prev) => [...prev, assistantMessage])
            setStreamingContent('')

            await saveAssistantMessage({
                data: { chatId, content: fullContent },
            } as any)
        } catch (error) {
            console.error('Streaming error:', error)
            const errorMessage: Message = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: "Sorry, I couldn't process your request. Please try again.",
                createdAt: new Date(),
            }
            setMessages((prev) => [...prev, errorMessage])
        } finally {
            setIsStreaming(false)
        }
    }

    return (
        <div
            className="flex flex-col h-full bg-background relative"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Drag overlay */}
            {isDragging && (
                <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center backdrop-blur-sm">
                    <div className="text-center">
                        <div className="text-4xl mb-2">📎</div>
                        <p className="text-lg font-medium text-primary">Drop image here</p>
                    </div>
                </div>
            )}

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6">
                    {messages.length === 0 && !isStreaming ? (
                        <EmptyChatState />
                    ) : (
                        <>
                            <MessageList
                                messages={messages}
                                streamingContent={streamingContent}
                                isStreaming={isStreaming}
                            />
                            <div ref={messagesEndRef} />
                        </>
                    )}
                </div>
            </div>

            {/* Floating input */}
            <div className="shrink-0">
                <ChatInput
                    onSubmit={handleSubmit}
                    isLoading={isStreaming}
                    droppedFiles={droppedFiles}
                    onDroppedFilesConsumed={handleDroppedFilesConsumed}
                />
            </div>
        </div>
    )
}
