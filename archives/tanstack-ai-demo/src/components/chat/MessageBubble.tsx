import { useState } from 'react'
import type { Message } from '@/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Image preview modal
function ImagePreview({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={onClose}
        >
            <img
                src={src}
                alt={alt}
                className="max-w-full max-h-full rounded-lg object-contain"
                onClick={(e) => e.stopPropagation()}
            />
        </div>
    )
}

export function MessageBubble({ message }: { message: Message }) {
    const isUser = message.role === 'user'
    const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null)

    if (isUser) {
        return (
            <>
                {/* Image preview modal */}
                {previewImage && (
                    <ImagePreview
                        src={previewImage.src}
                        alt={previewImage.alt}
                        onClose={() => setPreviewImage(null)}
                    />
                )}

                <div className="flex flex-col items-end gap-2">
                    {/* Images displayed separately (like separate messages) */}
                    {message.files && message.files.length > 0 && (
                        <div className="flex flex-wrap justify-end gap-2 max-w-[80%]">
                            {message.files.map((file) => (
                                <img
                                    key={file.id}
                                    src={file.data}
                                    alt={file.name}
                                    className="max-w-[250px] max-h-[250px] rounded-2xl object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                    onClick={() => setPreviewImage({ src: file.data, alt: file.name })}
                                />
                            ))}
                        </div>
                    )}

                    {/* Text message bubble */}
                    <div className="rounded-2xl px-4 py-3 max-w-[80%] text-sm bg-primary text-primary-foreground">
                        <p className="whitespace-pre-wrap">{message.content}</p>
                    </div>
                </div>
            </>
        )
    }

    // Assistant message with Markdown rendering
    return (
        <div className="max-w-[85%]">
            <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        h1: ({ ...props }) => <h1 className="text-2xl font-bold mt-6 mb-4" {...props} />,
                        h2: ({ ...props }) => <h2 className="text-xl font-bold mt-5 mb-3" {...props} />,
                        h3: ({ ...props }) => <h3 className="text-lg font-semibold mt-4 mb-2" {...props} />,
                        p: ({ ...props }) => <p className="mb-4 leading-relaxed" {...props} />,
                        ul: ({ ...props }) => <ul className="list-disc list-inside mb-4 space-y-1" {...props} />,
                        ol: ({ ...props }) => <ol className="list-decimal list-inside mb-4 space-y-1" {...props} />,
                        li: ({ ...props }) => <li className="ml-2" {...props} />,
                        code: ({ className, children, ...props }: any) => {
                            const isInline = !className
                            return isInline ? (
                                <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                                    {children}
                                </code>
                            ) : (
                                <code className="block bg-muted p-3 rounded-lg overflow-x-auto text-sm font-mono my-4" {...props}>
                                    {children}
                                </code>
                            )
                        },
                        pre: ({ ...props }) => <pre className="my-4" {...props} />,
                        blockquote: ({ ...props }) => (
                            <blockquote className="border-l-4 border-border pl-4 italic my-4 text-muted-foreground" {...props} />
                        ),
                    }}
                >
                    {message.content}
                </ReactMarkdown>
            </div>
        </div>
    )
}

export function TypingIndicator() {
    return (
        <div className="flex items-center gap-2 py-2">
            <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" />
        </div>
    )
}

export function StreamingMessage({ content }: { content: string }) {
    return (
        <div className="max-w-[85%]">
            <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        h1: ({ ...props }) => <h1 className="text-2xl font-bold mt-6 mb-4" {...props} />,
                        h2: ({ ...props }) => <h2 className="text-xl font-bold mt-5 mb-3" {...props} />,
                        h3: ({ ...props }) => <h3 className="text-lg font-semibold mt-4 mb-2" {...props} />,
                        p: ({ ...props }) => <p className="mb-4 leading-relaxed" {...props} />,
                        ul: ({ ...props }) => <ul className="list-disc list-inside mb-4 space-y-1" {...props} />,
                        ol: ({ ...props }) => <ol className="list-decimal list-inside mb-4 space-y-1" {...props} />,
                        li: ({ ...props }) => <li className="ml-2" {...props} />,
                        code: ({ className, children, ...props }: any) => {
                            const isInline = !className
                            return isInline ? (
                                <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                                    {children}
                                </code>
                            ) : (
                                <code className="block bg-muted p-3 rounded-lg overflow-x-auto text-sm font-mono my-4" {...props}>
                                    {children}
                                </code>
                            )
                        },
                        pre: ({ ...props }) => <pre className="my-4" {...props} />,
                        blockquote: ({ ...props }) => (
                            <blockquote className="border-l-4 border-border pl-4 italic my-4 text-muted-foreground" {...props} />
                        ),
                    }}
                >
                    {content}
                </ReactMarkdown>
                <span className="inline-block w-1.5 h-4 ml-0.5 bg-primary/70 animate-pulse" />
            </div>
        </div>
    )
}
