import { Link } from 'react-router-dom'

/**
 * ExpenseFlow logo: blue rounded square with a white "EF" monogram, then the wordmark.
 * @param {{to?: string, inverse?: boolean, compact?: boolean}} props
 */
export default function Logo({ to, inverse = false, compact = false, onClick }) {
  const content = (
    <>
      <span className="logo-mark" aria-hidden="true">
        EF
      </span>
      <span className={`logo-word${compact ? ' sr-only' : ''}`}>
        Expense<span className="logo-word-accent">Flow</span>
      </span>
    </>
  )
  const className = `logo${inverse ? ' logo-inverse' : ''}`
  if (to) {
    return (
      <Link to={to} className={className} aria-label="ExpenseFlow home" onClick={onClick}>
        {content}
      </Link>
    )
  }
  return <span className={className}>{content}</span>
}
