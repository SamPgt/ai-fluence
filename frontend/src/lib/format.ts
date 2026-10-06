/** Montant USD lisible : 0.0360 → « 0,036 $ », 12.5 → « 12,50 $ ». */
export function formatUsd(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0)
  if (!Number.isFinite(n)) return '—'
  const digits = n === 0 ? 2 : Math.abs(n) < 0.1 ? 3 : 2
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) })} $`
}

export function formatUnit(unit: string, quantity: string): string {
  const q = Number(quantity)
  if (unit === 'per_second' || unit === 'second') return `${q} s`
  if (unit === 'per_image' || unit === 'image') return `${q} image${q > 1 ? 's' : ''}`
  return `${quantity} ${unit.replace('per_', '')}`
}

export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return "à l'instant"
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}
