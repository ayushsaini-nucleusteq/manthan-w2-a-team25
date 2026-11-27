import { formatMoney } from '../utils/format.js'

/**
 * Money in ₹ with Indian grouping and tabular figures. Accepts the API's decimal
 * strings ("1500.00") or numbers.
 * @param {{value: string|number|null, compact?: boolean, whole?: boolean, strong?: boolean, tone?: 'danger'|'success'|'muted', className?: string}} props
 */
export default function Money({ value, compact = false, whole = false, strong = false, tone, className = '' }) {
  const text = formatMoney(value, { compact, whole })
  const full = compact ? formatMoney(value) : undefined
  const classes = ['money', 'num', strong && 'strong', tone && `money-${tone}`, className].filter(Boolean).join(' ')
  return (
    <span className={classes} title={full}>
      {text}
    </span>
  )
}
