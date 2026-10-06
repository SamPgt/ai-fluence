import { useState, useRef, DragEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '../ui/button'
import type { AttachedFile } from '@/types/chat'

interface FileAttachmentProps {
    files: AttachedFile[]
    onFilesChange: (files: AttachedFile[]) => void
    supportsFiles: boolean
}

export function FileAttachment({
    files,
    onFilesChange,
    supportsFiles,
}: FileAttachmentProps) {
    const [isDragging, setIsDragging] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleFileSelect = async (selectedFiles: FileList | null) => {
        if (!selectedFiles || !supportsFiles) return

        const newFiles: AttachedFile[] = []

        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i]

            // Only accept images for now
            if (!file.type.startsWith('image/')) {
                continue
            }

            // Convert to base64
            const reader = new FileReader()
            const base64Promise = new Promise<string>((resolve) => {
                reader.onload = () => resolve(reader.result as string)
                reader.readAsDataURL(file)
            })

            const base64 = await base64Promise

            newFiles.push({
                id: crypto.randomUUID(),
                name: file.name,
                type: file.type,
                size: file.size,
                data: base64,
                preview: base64, // Use same base64 for preview
            })
        }

        onFilesChange([...files, ...newFiles])
    }

    const handleDragOver = (e: DragEvent) => {
        e.preventDefault()
        if (supportsFiles) {
            setIsDragging(true)
        }
    }

    const handleDragLeave = () => {
        setIsDragging(false)
    }

    const handleDrop = async (e: DragEvent) => {
        e.preventDefault()
        setIsDragging(false)

        if (!supportsFiles) return

        await handleFileSelect(e.dataTransfer.files)
    }

    const removeFile = (id: string) => {
        onFilesChange(files.filter((f) => f.id !== id))
    }

    return (
        <div
            className="relative"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* File Input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files)}
                disabled={!supportsFiles}
            />

            {/* Add File Button */}
            <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={!supportsFiles}
                className="shrink-0 h-10 w-10 rounded-lg"
                title={
                    supportsFiles ? 'Attach image' : 'Selected model does not support images'
                }
            >
                <Plus className="h-5 w-5" />
            </Button>

            {/* Drag Overlay */}
            {isDragging && supportsFiles && (
                <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center z-50">
                    <div className="text-sm text-primary font-medium">Drop images here</div>
                </div>
            )}

            {/* File Previews */}
            {files.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                    {files.map((file) => (
                        <div
                            key={file.id}
                            className="relative group rounded-lg overflow-hidden border bg-muted"
                        >
                            <img
                                src={file.preview}
                                alt={file.name}
                                className="h-16 w-16 object-cover"
                            />
                            <button
                                type="button"
                                onClick={() => removeFile(file.id)}
                                className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <X className="h-3 w-3" />
                            </button>
                            <div className="absolute bottom-0 inset-x-0 bg-black/50 px-1 py-0.5 text-[10px] text-white truncate">
                                {file.name}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
