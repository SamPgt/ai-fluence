import type { Persona } from '@ai-fluence/shared'

import { cn } from '@/lib/utils'

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  )
}

export function PersonaAvatar({
  persona,
  size = 40,
  className,
}: {
  persona: Pick<Persona, 'name' | 'color' | 'avatarUrl'>
  size?: number
  className?: string
}) {
  return persona.avatarUrl ? (
    <img
      src={persona.avatarUrl}
      alt={persona.name}
      style={{ width: size, height: size }}
      className={cn('shrink-0 object-cover', className)}
    />
  ) : (
    <span
      style={{ width: size, height: size, backgroundColor: persona.color, fontSize: size * 0.36 }}
      className={cn('flex shrink-0 items-center justify-center font-semibold text-white', className)}
    >
      {initials(persona.name)}
    </span>
  )
}
