import { STATUS_META } from '../utils/constants.js'
import { humanize } from '../utils/format.js'

/**
 * Coloured status pill. Pass `meta` to use another map (e.g. PAYOUT_STATUS_META).
 * @param {{status: string, meta?: Record<string, {label: string, tone: string}>, size?: 'sm'|'md', dot?: boolean, className?: string}} props
 */
export default function StatusChip({ status, meta = STATUS_META, size = 'md', dot = true, className = '' }) {
  if (!status) return null
  const entry = meta[status] || { label: humanize(status), tone: 'neutral' }
  return (
    <span className={`chip chip-${size} tone-${entry.tone} ${className}`} data-status={status}>
      {dot && <span className="chip-dot" aria-hidden="true" />}
      {entry.label}
    </span>
  )
}
