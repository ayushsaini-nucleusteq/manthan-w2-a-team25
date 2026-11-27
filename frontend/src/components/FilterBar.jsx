import { useId, useState } from 'react'
import { useMediaQuery, MOBILE_QUERY } from '../hooks/useMediaQuery.js'
import { ChevronDownIcon, FilterIcon, XIcon } from './icons.jsx'

/**
 * Wraps filter controls in a responsive row with "Clear all". Under 720 px the
 * controls collapse behind a "Filters (N)" toggle.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children filter controls (use size="sm" inputs)
 * @param {number} [props.activeCount] number of non-default filters
 * @param {() => void} [props.onClear] shown when activeCount > 0
 * @param {React.ReactNode} [props.search] a search input kept visible on mobile
 * @param {React.ReactNode} [props.actions] right-aligned extras (e.g. export)
 * @param {string} [props.label]
 */
export default function FilterBar({ children, activeCount = 0, onClear, search, actions, label = 'Filters', className = '' }) {
  const mobile = useMediaQuery(MOBILE_QUERY)
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const expanded = !mobile || open

  return (
    <section className={`filter-bar card ${className}`} aria-label={label}>
      <div className="filter-bar-top">
        {search && <div className="filter-bar-search">{search}</div>}
        {mobile && (
          <button
            type="button"
            className={`filter-bar-toggle${activeCount ? ' has-active' : ''}`}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            <FilterIcon size={16} />
            <span>
              {label}
              {activeCount > 0 && <span className="filter-bar-badge">{activeCount}</span>}
            </span>
            <ChevronDownIcon size={16} className={`filter-bar-chevron${open ? ' is-open' : ''}`} />
          </button>
        )}
      </div>
      <div id={panelId} className="filter-bar-controls" hidden={!expanded}>
        {children}
        <div className="filter-bar-end">
          {onClear && activeCount > 0 && (
            <button type="button" className="filter-bar-clear" onClick={onClear}>
              <XIcon size={14} />
              Clear all
              <span className="sr-only"> filters</span>
            </button>
          )}
          {actions}
        </div>
      </div>
    </section>
  )
}
