import Breadcrumbs from './Breadcrumbs.jsx'

/**
 * Page header.
 * - `variant="hero"`: blue gradient band with a faint pattern, white H1 and subtitle (E1, M1, A1, F1).
 * - `variant="plain"` (default): plain H1 with optional breadcrumbs.
 *
 * @param {object} props
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} [props.subtitle]
 * @param {React.ReactNode} [props.eyebrow] small label above the title
 * @param {'hero'|'plain'} [props.variant]
 * @param {Array<{label: React.ReactNode, to?: string}>} [props.breadcrumbs]
 * @param {React.ReactNode} [props.actions] right-aligned buttons
 * @param {React.ReactNode} [props.meta] chips/badges row under the title
 * @param {React.ReactNode} [props.children] extra hero content (e.g. stat tiles overlapping the band)
 */
export default function PageHeader({ title, subtitle, eyebrow, variant = 'plain', breadcrumbs, actions, meta, children }) {
  if (variant === 'hero') {
    return (
      <header className="hero">
        <div className="hero-pattern" aria-hidden="true" />
        <div className="hero-inner">
          {breadcrumbs && <Breadcrumbs items={breadcrumbs} inverse />}
          <div className="page-header-row">
            <div className="page-header-text">
              {eyebrow && <p className="hero-eyebrow">{eyebrow}</p>}
              <h1 className="hero-title">{title}</h1>
              {subtitle && <p className="hero-subtitle">{subtitle}</p>}
              {meta && <div className="page-header-meta">{meta}</div>}
            </div>
            {actions && <div className="page-header-actions">{actions}</div>}
          </div>
          {children && <div className="hero-extra">{children}</div>}
        </div>
      </header>
    )
  }

  return (
    <header className="page-header">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="page-header-row">
        <div className="page-header-text">
          {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
          {meta && <div className="page-header-meta">{meta}</div>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
      {children}
    </header>
  )
}
