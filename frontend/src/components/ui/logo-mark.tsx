/** Logo « Horizon » : soleil levant et lignes d'horizon, en couleur courante (currentColor). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="currentColor" className={className} aria-hidden="true">
      <path d="M4 24A20 20 0 0 1 44 24Z" />
      <rect x="5" y="27.5" width="38" height="4.5" rx="2.25" />
      <rect x="10" y="35" width="28" height="4" rx="2" />
      <rect x="17" y="42" width="14" height="3" rx="1.5" />
    </svg>
  )
}
