import { Suspense, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { useRouteFocus } from '../hooks/useRouteFocus.js'
import ErrorBoundary from './ErrorBoundary.jsx'
import HelpButton from './HelpButton.jsx'
import NavBar from './NavBar.jsx'
import OfflineBanner from './OfflineBanner.jsx'
import PageLoader from './PageLoader.jsx'
import { SubNavSlotContext } from './subNavContext.js'

/**
 * Signed-in layout: sticky navbar, sub-nav slot (filled by <SubNav/>), offline
 * banner, the routed page (with its own error boundary and Suspense), footer, and
 * the floating help button on employee screens.
 *
 * On every route change it scrolls to the top, moves focus to the new page's <h1>
 * (or <main>) and announces the page politely (see useRouteFocus). Pages therefore
 * render exactly one <h1> (PageHeader does this).
 */
export default function AppShell() {
  const { activeRole } = useAuth()
  const location = useLocation()
  const [subNavEl, setSubNavEl] = useState(null)
  const mainRef = useRef(null)
  const announcement = useRouteFocus(mainRef, location.pathname)

  // New screen: start at the top (keeps scroll when only the query string changes).
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <SubNavSlotContext.Provider value={subNavEl}>
      <div className="app">
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
        <NavBar />
        <div className="subnav-slot" ref={setSubNavEl} />
        <OfflineBanner />
        <main id="main" ref={mainRef} className="app-main" tabIndex={-1}>
          <ErrorBoundary inline resetKey={location.pathname}>
            <Suspense fallback={<PageLoader label="Loading screen…" />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
        <footer className="app-footer">
          <div className="app-footer-inner">
            <span>© {new Date().getFullYear()} ExpenseFlow</span>
            <span className="muted">Demo build · mock data</span>
          </div>
        </footer>
        {activeRole === 'EMPLOYEE' && <HelpButton />}
      </div>
    </SubNavSlotContext.Provider>
  )
}
