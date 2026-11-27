/**
 * Circular spinner.
 * @param {{size?: 'sm'|'md'|'lg', tone?: 'brand'|'current'|'inverse', label?: string, showLabel?: boolean, className?: string}} props
 */
export default function Spinner({ size = 'md', tone = 'brand', label = 'Loading…', showLabel = false, className = '' }) {
  return (
    <span className={`spinner-wrap ${className}`} role="status" aria-live="polite">
      <span className={`spinner spinner-${size} spinner-${tone}`} aria-hidden="true" />
      {showLabel ? <span className="spinner-label">{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  )
}
