import { Link } from 'react-router-dom'
import Skeleton from './Skeleton.jsx'

/**
 * KPI tile: label, big value, optional icon, hint and tone accent.
 *
 * @param {object} props
 * @param {React.ReactNode} props.label
 * @param {React.ReactNode} props.value
 * @param {React.ReactNode} [props.icon]
 * @param {React.ReactNode} [props.hint] small text under the value
 * @param {'brand'|'success'|'warning'|'danger'|'info'|'purple'|'neutral'} [props.tone]
 * @param {boolean} [props.loading]
 * @param {string} [props.to] makes the tile a link
 * @param {() => void} [props.onClick]
 * @param {boolean} [props.active] highlighted (e.g. as a filter)
 */
export default function StatTile({ label, value, icon, hint, tone = 'brand', loading = false, to, onClick, active = false }) {
  const classes = ['stat-tile', `stat-${tone}`, (to || onClick) && 'stat-interactive', active && 'is-active'].filter(Boolean).join(' ')
  const body = (
    <>
      <span className="stat-accent" aria-hidden="true" />
      <span className="stat-top">
        <span className="stat-label">{label}</span>
        {icon && (
          <span className="stat-icon" aria-hidden="true">
            {icon}
          </span>
        )}
      </span>
      <span className="stat-value num">{loading ? <Skeleton width="60%" height={28} /> : value}</span>
      {hint && <span className="stat-hint">{loading ? <Skeleton width="40%" height={12} /> : hint}</span>}
    </>
  )
  if (to) {
    return (
      <Link to={to} className={classes} aria-busy={loading || undefined}>
        {body}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} aria-pressed={active} aria-busy={loading || undefined}>
        {body}
      </button>
    )
  }
  return (
    <div className={classes} aria-busy={loading || undefined}>
      {body}
    </div>
  )
}
