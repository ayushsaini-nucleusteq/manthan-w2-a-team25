import { useAuth } from '../auth/useAuth.js'
import { ROLE_HOME } from '../utils/constants.js'
import Button from './Button.jsx'
import { ArrowLeftIcon, SearchIcon } from './icons.jsx'

/**
 * Reusable "Not found" block. Also used for "no permission" (never say forbidden).
 * Pass `headingLevel={1}` when it is the whole page (no other <h1>).
 * @param {{title?: string, message?: string, compact?: boolean, action?: React.ReactNode, headingLevel?: 1|2|3}} props
 */
export default function NotFound({
  title = 'Not found',
  message = "We couldn't find what you were looking for. It may have been moved, or the link may be wrong.",
  compact = false,
  action,
  headingLevel = 2,
}) {
  const { activeRole, isAuthenticated } = useAuth()
  const home = isAuthenticated ? ROLE_HOME[activeRole] || '/' : '/login'
  const Heading = `h${headingLevel}`
  return (
    <div className={`state state-notfound${compact ? ' state-compact' : ''}`} role="region" aria-label={title}>
      <span className="state-illustration" aria-hidden="true">
        <span className="state-illustration-ring" />
        <span className="state-illustration-icon">
          <SearchIcon size={compact ? 24 : 34} />
        </span>
      </span>
      <div className="state-body">
        {!compact && <p className="state-eyebrow">404</p>}
        <Heading className="state-title">{title}</Heading>
        <p className="state-message">{message}</p>
      </div>
      <div className="state-action">
        {action || (
          <Button to={home} variant="primary" icon={<ArrowLeftIcon size={18} />}>
            Back to home
          </Button>
        )}
      </div>
    </div>
  )
}
