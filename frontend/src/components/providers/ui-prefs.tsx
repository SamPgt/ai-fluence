import { createContext, useContext, useState, type ReactNode } from 'react'

import { UI_PREFS_DEFAULTS, writeUiPrefCookie, type UiPrefs } from '@/lib/ui-prefs'

interface UiPrefsContextValue {
  prefs: UiPrefs
  set: <K extends keyof UiPrefs>(key: K, value: UiPrefs[K]) => void
}

const UiPrefsContext = createContext<UiPrefsContextValue | null>(null)

/**
 * Fournit les préférences d'UI. `initial` vient du SSR (cookie lu côté
 * serveur), donc le 1er rendu est déjà correct.
 */
export function UiPrefsProvider({ initial, children }: { initial?: UiPrefs; children: ReactNode }) {
  const [prefs, setPrefs] = useState<UiPrefs>(initial ?? UI_PREFS_DEFAULTS)

  const set = <K extends keyof UiPrefs>(key: K, value: UiPrefs[K]) => {
    writeUiPrefCookie(key, value)
    setPrefs((prev) => ({ ...prev, [key]: value }))
  }

  return <UiPrefsContext.Provider value={{ prefs, set }}>{children}</UiPrefsContext.Provider>
}

/** `const [collapsed, setCollapsed] = useUiPref('sidebarCollapsed')` */
export function useUiPref<K extends keyof UiPrefs>(key: K): [UiPrefs[K], (value: UiPrefs[K]) => void] {
  const ctx = useContext(UiPrefsContext)
  if (!ctx) throw new Error('useUiPref doit être utilisé dans <UiPrefsProvider>.')
  return [ctx.prefs[key], (value) => ctx.set(key, value)]
}
