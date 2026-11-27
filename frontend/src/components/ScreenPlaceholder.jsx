import { useDocumentTitle } from '../hooks/useDocumentTitle.js'
import Card from './Card.jsx'
import PageHeader from './PageHeader.jsx'
import { SparklesIcon } from './icons.jsx'

/**
 * Temporary body for screens that are still being built. Each page file renders this
 * until its real implementation lands.
 *
 * @param {{code: string, title: string, subtitle?: string, variant?: 'hero'|'plain', breadcrumbs?: Array}} props
 */
export default function ScreenPlaceholder({ code, title, subtitle, variant = 'plain', breadcrumbs }) {
  useDocumentTitle(title)
  return (
    <div className={variant === 'hero' ? 'page page-hero' : 'page'}>
      <PageHeader variant={variant} title={title} subtitle={subtitle} eyebrow={code} breadcrumbs={breadcrumbs} />
      <div className="page-body">
        <Card className="placeholder-card">
          <span className="placeholder-icon" aria-hidden="true">
            <SparklesIcon size={28} />
          </span>
          <h2 className="card-title">This screen is being built</h2>
          <p className="muted">
            {code} will appear here soon. Everything around it (navigation, roles, notifications and help) already works.
          </p>
        </Card>
      </div>
    </div>
  )
}
