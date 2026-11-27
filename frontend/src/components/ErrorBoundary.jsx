import { Component } from 'react'
import Logo from './Logo.jsx'
import { AlertTriangleIcon, HomeIcon, RefreshIcon } from './icons.jsx'

function makeErrorId() {
  const time = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `EF-${time}-${rand}`
}

function isChunkLoadError(error) {
  return /dynamically imported module|Loading chunk|Importing a module script failed/i.test(error?.message || '')
}

/**
 * Catches render errors and shows a friendly crash page with a reload button and an error id.
 *
 * @param {object} props
 * @param {unknown} [props.resetKey] when this value changes the boundary resets (e.g. the route path)
 * @param {boolean} [props.inline] render inside the app shell instead of a full-screen page
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, errorId: null, resetKey: props.resetKey }
  }

  static getDerivedStateFromError(error) {
    return { error, errorId: makeErrorId() }
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) {
      return { resetKey: props.resetKey, error: null, errorId: null }
    }
    return null
  }

  componentDidCatch(error, info) {
    console.error(`[ExpenseFlow] Unhandled error ${this.state.errorId ?? ''}`, error, info?.componentStack)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleRetry = () => {
    this.setState({ error: null, errorId: null })
  }

  render() {
    const { error, errorId } = this.state
    if (!error) return this.props.children

    const chunk = isChunkLoadError(error)
    const { inline } = this.props
    // Inline crashes render inside the shell's <main id="main">; only the full-screen one is a landmark.
    const Root = inline ? 'section' : 'main'
    return (
      <Root className={inline ? 'crash crash-inline' : 'crash'} role="alert" aria-labelledby="crash-title">
        <div className="crash-card">
          {!inline && (
            <div className="crash-logo">
              <Logo />
            </div>
          )}
          <span className="state-icon state-icon-danger crash-icon" aria-hidden="true">
            <AlertTriangleIcon size={32} />
          </span>
          <h1 id="crash-title">Something went wrong</h1>
          <p className="muted">
            {chunk
              ? 'A new version of ExpenseFlow may be available, or your connection dropped while loading this screen. Reloading usually fixes it.'
              : 'An unexpected error stopped this screen from loading. Your saved work is safe. Try reloading the page.'}
          </p>
          <p className="crash-id">
            Error id <code>{errorId}</code>
          </p>
          <div className="row crash-actions">
            <button type="button" className="btn btn-primary btn-md" onClick={this.handleReload}>
              <RefreshIcon size={18} />
              <span className="btn-label">Reload page</span>
            </button>
            {inline ? (
              <button type="button" className="btn btn-secondary btn-md" onClick={this.handleRetry}>
                <span className="btn-label">Try again</span>
              </button>
            ) : (
              <a className="btn btn-secondary btn-md" href="/">
                <HomeIcon size={18} />
                <span className="btn-label">Go to home</span>
              </a>
            )}
          </div>
          {import.meta.env.DEV && error?.message && <pre className="crash-detail">{String(error.message)}</pre>}
        </div>
      </Root>
    )
  }
}
