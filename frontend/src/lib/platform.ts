import { useEffect, useState } from 'react'

/** Vrai sur macOS (et iPadOS). Côté serveur : false. */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform
  return /mac|iphone|ipad/i.test(platform)
}

/** Plateforme lue après le montage, pour ne pas créer d'écart d'hydratation avec le rendu serveur. */
export function useIsMac(): boolean {
  const [mac, setMac] = useState(true)
  useEffect(() => setMac(isMac()), [])
  return mac
}

/** La cible du clavier est un champ de saisie (on n'y intercepte pas les lettres). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}
