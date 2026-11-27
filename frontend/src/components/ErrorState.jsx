import { useState } from 'react'
import Button from './Button.jsx'
import NotFound from './NotFound.jsx'
import { AlertTriangleIcon, RefreshIcon } from './icons.jsx'
import { errorMessage, isNotFoundError } from '../utils/format.js'

/**
 * Error with a "Try again" button that re-runs the request.
 * API 403/404 errors render the "Not found" block instead (US4-AC3) unless
 * `mapNotFound` is false.
 *
 * @param {object} props
 * @param {any} [props.error] thrown error (ApiError)
 * @param {string} [props.title]
 * @param {string} [props.message] overrides the message derived from `error`
 * @param {() => any} [props.onRetry] may return a promise; the button spins until it settles
 * @param {boolean} [props.compact] inline variant for cards and table bodies
 * @param {boolean} [props.mapNotFound]
 */
export default function ErrorState({
  error,
  title = "We couldn't load this",
  message,
  onRetry,
  compact = false,
  mapNotFound = true,
  children,
}) {
  const [retrying, setRetrying] = useState(false)

  if (mapNotFound && isNotFoundError(error)) return <NotFound compact={compact} />

  const handleRetry = async () => {
    if (!onRetry) return
    setRetrying(true)
    try {
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className={`state state-error${compact ? ' state-compact' : ''}`} role="alert">
      <span className="state-icon state-icon-danger" aria-hidden="true">
        <AlertTriangleIcon size={compact ? 22 : 28} />
      </span>
      <div className="state-body">
        <h3 className="state-title">{title}</h3>
        <p className="state-message">{message || errorMessage(error)}</p>
        {error?.code && <p className="state-code muted xsmall">Error code: {error.code}</p>}
        {children}
      </div>
      {onRetry && (
        <Button variant="secondary" size={compact ? 'sm' : 'md'} icon={<RefreshIcon size={18} />} loading={retrying} onClick={handleRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
