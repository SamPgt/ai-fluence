import { Store } from '@tanstack/store'

// Available AI models grouped by provider
export const AI_PROVIDERS = [
    {
        id: 'openai',
        name: 'OpenAI',
        models: [
            {
                id: 'gpt-5.2',
                name: 'GPT-5.2',
                supportsVision: true,
                supportsPDF: false,
            },
            {
                id: 'gpt-5',
                name: 'GPT-5.0',
                supportsVision: true,
                supportsPDF: false,
            },
            {
                id: 'gpt-4o-mini',
                name: 'GPT-4o Mini',
                supportsVision: true,
                supportsPDF: false,
            },
            { id: 'gpt-4o', name: 'GPT-4o', supportsVision: true, supportsPDF: false },
            {
                id: 'gpt-4-turbo',
                name: 'GPT-4 Turbo',
                supportsVision: true,
                supportsPDF: false,
            },
            {
                id: 'gpt-3.5-turbo',
                name: 'GPT-3.5 Turbo',
                supportsVision: false,
                supportsPDF: false,
            },
        ],
    },
    {
        id: 'anthropic',
        name: 'Anthropic',
        models: [
            {
                id: 'claude-sonnet-4-5',
                name: 'Claude Sonnet 4.5',
                supportsVision: true,
                supportsPDF: true,
            },
            {
                id: 'claude-3-5-sonnet-latest',
                name: 'Claude 3.5 Sonnet',
                supportsVision: true,
                supportsPDF: true,
            },
            {
                id: 'claude-3-5-haiku-latest',
                name: 'Claude 3.5 Haiku',
                supportsVision: true,
                supportsPDF: false,
            },
        ],
    },
    {
        id: 'gemini',
        name: 'Google',
        models: [
            {
                id: 'gemini-pro',
                name: 'Gemini Pro',
                supportsVision: true,
                supportsPDF: true,
            },
            {
                id: 'gemini-2.5-flash',
                name: 'Gemini 2.0 Flash',
                supportsVision: true,
                supportsPDF: true,
            },
        ],
    },
    {
        id: 'ollama',
        name: 'Ollama (Local)',
        models: [
            {
                id: 'llama3',
                name: 'Llama 3',
                supportsVision: false,
                supportsPDF: false,
            },
        ],
    },
    {
        id: 'grok',
        name: 'xAI',
        models: [
            {
                id: 'grok-4',
                name: 'Grok 4',
                supportsVision: true,
                supportsPDF: false,
            },
            {
                id: 'grok-3',
                name: 'Grok 3',
                supportsVision: true,
                supportsPDF: false,
            },
        ],
    },
] as const


export type ProviderId = (typeof AI_PROVIDERS)[number]['id']

// App settings store
interface AppSettings {
    theme: 'light' | 'dark' | 'system'
    selectedProvider: ProviderId
    selectedModel: string
}

export const settingsStore = new Store<AppSettings>({
    theme: 'system',
    selectedProvider: 'openai',
    selectedModel: 'gpt-4o-mini',
})

// Helper functions
export const setTheme = (theme: AppSettings['theme']) => {
    settingsStore.setState((state) => ({ ...state, theme }))
    if (typeof window !== 'undefined') {
        localStorage.setItem('theme', theme)
    }
    applyTheme(theme)
}

export const setProviderAndModel = (provider: ProviderId, model: string) => {
    settingsStore.setState((state) => ({
        ...state,
        selectedProvider: provider,
        selectedModel: model,
    }))
    if (typeof window !== 'undefined') {
        localStorage.setItem('selectedProvider', provider)
        localStorage.setItem('selectedModel', model)
    }
}

export const applyTheme = (theme: AppSettings['theme']) => {
    if (typeof window === 'undefined') return

    const root = document.documentElement

    if (theme === 'system') {
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
            .matches
            ? 'dark'
            : 'light'
        root.classList.toggle('dark', systemTheme === 'dark')
    } else {
        root.classList.toggle('dark', theme === 'dark')
    }
}

// Initialize theme on load
if (typeof window !== 'undefined') {
    applyTheme(settingsStore.state.theme)

    window
        .matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', () => {
            if (settingsStore.state.theme === 'system') {
                applyTheme('system')
            }
        })
}
