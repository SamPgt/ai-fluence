import { useStore } from '@tanstack/react-store'
import { ChevronDown, FileText } from 'lucide-react'

import { Button } from '../ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { settingsStore, setProviderAndModel, AI_PROVIDERS } from '@/lib/store'
import { PROVIDER_ICONS, PROVIDER_COLORS } from './ProviderIcons'

export function ModelSelector() {
    const { selectedProvider, selectedModel } = useStore(settingsStore, (s) => ({
        selectedProvider: s.selectedProvider,
        selectedModel: s.selectedModel,
    }))

    const currentProvider = AI_PROVIDERS.find((p) => p.id === selectedProvider)
    const currentModel = currentProvider?.models.find((m) => m.id === selectedModel)

    const ProviderIcon = currentProvider ? PROVIDER_ICONS[currentProvider.id as keyof typeof PROVIDER_ICONS] : null
    const iconColor = currentProvider ? PROVIDER_COLORS[currentProvider.id as keyof typeof PROVIDER_COLORS] : ''

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 h-8 px-3 font-normal text-sm hover:bg-muted"
                >
                    {ProviderIcon && <ProviderIcon className={`h-3.5 w-3.5 ${iconColor}`} />}
                    <span className="font-medium">
                        {currentModel?.name || 'Select Model'}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                {AI_PROVIDERS.map((provider, index) => {
                    const ProviderIconItem = PROVIDER_ICONS[provider.id as keyof typeof PROVIDER_ICONS]
                    const providerColor = PROVIDER_COLORS[provider.id as keyof typeof PROVIDER_COLORS]

                    return (
                        <div key={provider.id}>
                            {index > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuLabel className="text-xs font-semibold flex items-center gap-2">
                                <ProviderIconItem className={`h-3.5 w-3.5 ${providerColor}`} />
                                {provider.name}
                            </DropdownMenuLabel>
                            <DropdownMenuGroup>
                                {provider.models.map((model) => {
                                    const isSelected =
                                        selectedProvider === provider.id && selectedModel === model.id
                                    return (
                                        <DropdownMenuItem
                                            key={model.id}
                                            onClick={() => setProviderAndModel(provider.id, model.id)}
                                            className="cursor-pointer"
                                        >
                                            <div className="flex items-center justify-between w-full gap-2">
                                                <div className="flex items-center gap-2">
                                                    <span className={isSelected ? 'font-medium' : ''}>
                                                        {model.name}
                                                    </span>
                                                    {model.supportsPDF && (
                                                        <FileText className="h-3 w-3 text-muted-foreground" />
                                                    )}
                                                </div>
                                                {isSelected && (
                                                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                                                )}
                                            </div>
                                        </DropdownMenuItem>
                                    )
                                })}
                            </DropdownMenuGroup>
                        </div>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
