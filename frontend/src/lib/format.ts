/**
 * Montant USD lisible, toujours à 2 décimales : 12.5 → « 12,50 $ ».
 * Un coût est arrondi au centime supérieur (0,004 → « 0,01 $ » : un coût non nul n'affiche
 * jamais 0,00 et on n'annonce jamais moins que ce qui sera payé) ; un solde au centime
 * inférieur (on n'affiche jamais plus que ce qui est disponible).
 */
export function formatUsd(value: string | number | null | undefined, kind: 'cost' | 'balance' = 'cost'): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0)
  if (!Number.isFinite(n)) return '—'
  // Marge contre les erreurs de calcul en virgule flottante (0.07 * 100 = 7.000000000000001).
  // `|| 0` : pas de « -0,00 $ ».
  const cents = (kind === 'cost' ? Math.ceil(n * 100 - 1e-6) : Math.floor(n * 100 + 1e-6)) || 0
  return `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
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
