import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'

/** Interrupteur : pilule 40 × 22, pastille blanche ronde et ombrée, verte une fois activé. */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-[20px] w-[35px] shrink-0 cursor-pointer items-center rounded-full p-[3px] shadow-sm transition-all duration-300 ease-in-out outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-green-700/70 data-[state=unchecked]:bg-white/15',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block aspect-square w-[15px] rounded-full bg-white shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-[14px] data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
