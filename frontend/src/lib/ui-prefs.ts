/**
 * Préférences d'INTERFACE persistées en COOKIE (repris d'OLSC) : lisibles côté
 * serveur, donc rendu SSR correct dès le premier HTML (pas de flash « ouvert
 * puis replié »). Le cookie est par appareil (pas de sync).
 *
 * AJOUTER UNE PRÉFÉRENCE = 2 lignes :
 *   1. un champ dans `UiPrefs` ;
 *   2. une entrée dans `UI_PREFS` (cookie + défaut + decode/encode).
 */

export interface UiPrefs {
  /** Panneau des fils replié. */
  sidebarCollapsed: boolean
  /** Persona sélectionné dans la barre de bulles ('' = tous). */
  personaId: string
  /** Modèles épinglés dans le menu des modèles (ids séparés par des virgules). */
  pinnedModels: string
}

interface PrefSpec<T> {
  cookie: string
  default: T
  decode: (raw: string) => T
  encode: (value: T) => string
}

function boolPref(cookie: string, def: boolean): PrefSpec<boolean> {
  return { cookie, default: def, decode: (raw) => raw === 'true', encode: (v) => String(v) }
}

function stringPref(cookie: string, def: string): PrefSpec<string> {
  return { cookie, default: def, decode: (raw) => raw, encode: (v) => v }
}

export const UI_PREFS: { [K in keyof UiPrefs]: PrefSpec<UiPrefs[K]> } = {
  sidebarCollapsed: boolPref('aif-ui-sidebar-collapsed', false),
  personaId: stringPref('aif-ui-persona', ''),
  pinnedModels: stringPref('aif-ui-pinned-models', ''),
}

export const UI_PREFS_DEFAULTS: UiPrefs = Object.fromEntries(
  (Object.keys(UI_PREFS) as (keyof UiPrefs)[]).map((k) => [k, UI_PREFS[k].default]),
) as unknown as UiPrefs

function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function readUiPrefsFromCookie(header: string | null | undefined): UiPrefs {
  const jar = parseCookieHeader(header)
  const out: UiPrefs = { ...UI_PREFS_DEFAULTS }
  for (const k of Object.keys(UI_PREFS) as (keyof UiPrefs)[]) {
    const spec = UI_PREFS[k]
    const raw = jar[spec.cookie]
    if (raw !== undefined) (out as unknown as Record<string, unknown>)[k] = spec.decode(raw)
  }
  return out
}

export function writeUiPrefCookie<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]): void {
  const spec = UI_PREFS[key]
  const v = encodeURIComponent(spec.encode(value))
  document.cookie = `${spec.cookie}=${v}; path=/; max-age=31536000; samesite=lax`
}
