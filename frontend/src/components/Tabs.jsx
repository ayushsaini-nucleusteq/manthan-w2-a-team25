import { useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'

function Count({ value, active }) {
  if (value === undefined || value === null) return null
  return (
    <span className={`tab-count${active ? ' is-active' : ''}`}>
      <span className="sr-only"> (</span>
      {value}
      <span className="sr-only">)</span>
    </span>
  )
}

/**
 * Whether a route tab is the current page. Unlike NavLink (which ignores the query
 * string), a `to` with a query ("/approvals?state=OVERDUE") also requires those
 * params to match, so tabs that differ only by query highlight one at a time.
 * An explicit boolean `tab.active` always wins (use it for a default tab whose
 * URL has no query, e.g. "/approvals" meaning state=PENDING).
 */
function isTabActive(tab, location) {
  if (typeof tab.active === 'boolean') return tab.active
  const to = typeof tab.to === 'string' ? tab.to : `${tab.to?.pathname ?? ''}${tab.to?.search ?? ''}`
  const [beforeHash] = to.split('#')
  const queryAt = beforeHash.indexOf('?')
  const pathname = (queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt)) || location.pathname
  const search = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1)
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const exact = location.pathname === trimmed || location.pathname === `${trimmed}/`
  const nested = !tab.end && !search && trimmed !== '/' && location.pathname.startsWith(`${trimmed}/`)
  if (!exact && !nested) return false
  if (!search) return true
  const current = new URLSearchParams(location.search)
  for (const [key, val] of new URLSearchParams(search)) {
    if (current.get(key) !== val) return false
  }
  return true
}

/**
 * Sub-nav style tabs with optional counts.
 *
 * Two modes:
 * - Route tabs: every tab has `to` → renders a <nav> of links (aria-current="page" on the
 *   active one). Query strings count: "/approvals?state=OVERDUE" is active only when the URL
 *   has state=OVERDUE. Pass `active: true|false` on a tab to decide it yourself.
 * - State tabs: `value` + `onChange(id)` → renders an ARIA tablist with arrow-key navigation.
 *   Pair with <TabPanel idPrefix=… id=…> for the panels.
 *
 * @param {object} props
 * @param {Array<{id: string, label: React.ReactNode, count?: number, to?: string, end?: boolean, active?: boolean, icon?: React.ReactNode, disabled?: boolean}>} props.tabs
 * @param {string} [props.value]
 * @param {(id: string) => void} [props.onChange]
 * @param {string} props.ariaLabel
 * @param {string} [props.idPrefix] used to link tabs and panels
 * @param {'subnav'|'underline'|'pills'} [props.variant]
 */
export default function Tabs({ tabs, value, onChange, ariaLabel, idPrefix = 'tabs', variant = 'underline', className = '' }) {
  const listRef = useRef(null)
  const location = useLocation()
  const routeMode = tabs.every((t) => t.to)

  if (routeMode) {
    return (
      <nav className={`tabs tabs-${variant} ${className}`} aria-label={ariaLabel}>
        <ul className="tabs-list">
          {tabs.map((t) => {
            const active = isTabActive(t, location)
            return (
              <li key={t.id}>
                <Link to={t.to} className={`tab${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                  {t.icon}
                  <span>{t.label}</span>
                  <Count value={t.count} active={active} />
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    )
  }

  const enabled = tabs.filter((t) => !t.disabled)
  const onKeyDown = (e) => {
    const index = enabled.findIndex((t) => t.id === value)
    let next = null
    if (e.key === 'ArrowRight') next = enabled[(index + 1) % enabled.length]
    else if (e.key === 'ArrowLeft') next = enabled[(index - 1 + enabled.length) % enabled.length]
    else if (e.key === 'Home') next = enabled[0]
    else if (e.key === 'End') next = enabled[enabled.length - 1]
    if (!next) return
    e.preventDefault()
    onChange?.(next.id)
    requestAnimationFrame(() => {
      listRef.current?.querySelector(`[data-tab-id="${CSS.escape(next.id)}"]`)?.focus()
    })
  }

  return (
    <div className={`tabs tabs-${variant} ${className}`}>
      <div className="tabs-list" role="tablist" aria-label={ariaLabel} ref={listRef} onKeyDown={onKeyDown}>
        {tabs.map((t) => {
          const active = t.id === value
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${t.id}`}
              aria-controls={`${idPrefix}-panel-${t.id}`}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              disabled={t.disabled}
              data-tab-id={t.id}
              className={`tab${active ? ' is-active' : ''}`}
              onClick={() => onChange?.(t.id)}
            >
              {t.icon}
              <span>{t.label}</span>
              <Count value={t.count} active={active} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Panel for a state-mode tab. Render only the active one, or all with `hidden`. */
export function TabPanel({ idPrefix = 'tabs', id, hidden = false, children, className = '' }) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      hidden={hidden}
      tabIndex={0}
      className={`tab-panel ${className}`}
    >
      {children}
    </div>
  )
}
