/** Logo de l'app (public/logo.svg). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/logo.svg"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className}
    />
  )
}
