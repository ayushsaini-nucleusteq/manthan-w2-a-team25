import { OUTCOME_META } from '../utils/constants.js'
import { humanize } from '../utils/format.js'
import { ArrowRightIcon, CheckIcon, XIcon } from './icons.jsx'

const ICONS = { AUTO_APPROVE: CheckIcon, ROUTE: ArrowRightIcon, AUTO_REJECT: XIcon }

/**
 * Policy outcome badge: Auto-approve (green, tick), Route for approval (amber, arrow), Reject (red, cross).
 * @param {{outcome: 'AUTO_APPROVE'|'ROUTE'|'AUTO_REJECT', size?: 'sm'|'md', label?: string}} props
 */
export default function OutcomeBadge({ outcome, size = 'md', label }) {
  if (!outcome) return null
  const meta = OUTCOME_META[outcome] || { label: humanize(outcome), tone: 'neutral' }
  const IconComponent = ICONS[outcome]
  return (
    <span className={`chip chip-${size} chip-outcome tone-${meta.tone}`} data-outcome={outcome}>
      {IconComponent && <IconComponent size={size === 'sm' ? 12 : 14} strokeWidth={2.5} />}
      {label || meta.label}
    </span>
  )
}
