import { AlertTriangleIcon, CheckIcon, InfoIcon, WifiOffIcon, XIcon } from './icons.jsx'

const ICONS = { info: InfoIcon, warning: AlertTriangleIcon, danger: AlertTriangleIcon, success: CheckIcon, offline: WifiOffIcon }

/**
 * Outlined banner with a circled icon, for policy notes and offline notices.
 *
 * @param {object} props
 * @param {'info'|'warning'|'danger'|'success'|'offline'} [props.tone]
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.icon] overrides the tone icon
 * @param {React.ReactNode} [props.action] right-hand slot (e.g. a link button)
 * @param {() => void} [props.onDismiss] shows a close button
 * @param {boolean} [props.live] announce to screen readers (role=status / alert)
 */
export default function InfoBanner({ tone = 'info', title, icon, action, onDismiss, live = false, className = '', children }) {
  const IconComponent = ICONS[tone] || InfoIcon
  const role = live ? (tone === 'danger' ? 'alert' : 'status') : undefined
  return (
    <div className={`banner banner-${tone} ${className}`} role={role}>
      <span className="banner-icon" aria-hidden="true">
        {icon || <IconComponent size={18} strokeWidth={2} />}
      </span>
      <div className="banner-body">
        {title && <p className="banner-title">{title}</p>}
        {children && <div className="banner-text">{children}</div>}
      </div>
      {action && <div className="banner-action">{action}</div>}
      {onDismiss && (
        <button type="button" className="banner-close" onClick={onDismiss} aria-label="Dismiss">
          <XIcon size={16} />
        </button>
      )}
    </div>
  )
}
