export interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    createdAt: Date
    files?: AttachedFile[] // Attached images
}

export interface AttachedFile {
    id: string
    name: string
    type: string
    size: number
    data: string // base64
    preview?: string // URL for preview
}

export interface MessageWithFiles extends Message {
    files?: AttachedFile[]
}
