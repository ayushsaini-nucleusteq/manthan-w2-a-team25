import { Link } from 'react-router-dom'
import { ChevronRightIcon } from './icons.jsx'

/**
 * "Home / My claims / EXP-2026-000123". The last item is the current page.
 * @param {{items: Array<{label: React.ReactNode, to?: string}>, inverse?: boolean}} props
 */
export default function Breadcrumbs({ items, inverse = false }) {
  if (!items || items.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className={`breadcrumbs${inverse ? ' breadcrumbs-inverse' : ''}`}>
      <ol>
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <li key={i}>
              {item.to && !last ? <Link to={item.to}>{item.label}</Link> : <span aria-current={last ? 'page' : undefined}>{item.label}</span>}
              {!last && <ChevronRightIcon size={14} className="breadcrumbs-sep" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
