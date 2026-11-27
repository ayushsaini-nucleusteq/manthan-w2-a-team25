import { InboxIcon } from './icons.jsx'

/**
 * Empty list/table state: illustration-style icon, message and a call to action.
 * @param {{icon?: React.ReactNode, title: string, message?: React.ReactNode, action?: React.ReactNode, compact?: boolean}} props
 */
export default function EmptyState({ icon, title = 'Nothing here yet', message, action, compact = false }) {
  return (
    <div className={`state state-empty${compact ? ' state-compact' : ''}`}>
      <span className="state-illustration" aria-hidden="true">
        <span className="state-illustration-ring" />
        <span className="state-illustration-icon">{icon || <InboxIcon size={compact ? 24 : 32} />}</span>
      </span>
      <div className="state-body">
        <h3 className="state-title">{title}</h3>
        {message && <p className="state-message">{message}</p>}
      </div>
      {action && <div className="state-action">{action}</div>}
    </div>
  )
}
