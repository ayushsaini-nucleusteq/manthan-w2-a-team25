import { FLAG_META } from '../utils/constants.js'
import { humanize } from '../utils/format.js'

/**
 * Small square-ish tag for claim/line flags (WEEKEND, DUPLICATE, SOFT_LIMIT, SAMPLE, DELEGATED, OVERDUE).
 * @param {{flag: string, title?: string}} props
 */
export default function FlagTag({ flag, title }) {
  if (!flag) return null
  const meta = FLAG_META[flag] || { label: humanize(flag), tone: 'neutral' }
  return (
    <span className={`flag-tag tone-${meta.tone}`} title={title} data-flag={flag}>
      {meta.label}
    </span>
  )
}

/** Renders a wrapping list of flags; nothing when empty. */
export function FlagList({ flags }) {
  if (!flags || flags.length === 0) return null
  return (
    <span className="flag-list">
      {flags.map((f) => (
        <FlagTag key={f} flag={f} />
      ))}
    </span>
  )
}
