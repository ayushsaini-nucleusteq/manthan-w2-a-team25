import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { useMediaQuery, NARROW_QUERY } from '../hooks/useMediaQuery.js'
import { NAV_BY_ROLE, ROLE_LABEL } from '../utils/constants.js'
import Button from './Button.jsx'
import Logo from './Logo.jsx'
import LogoutDialog from './LogoutDialog.jsx'
import NotificationBell from './NotificationBell.jsx'
import RoleSwitch from './RoleSwitch.jsx'
import UserMenu from './UserMenu.jsx'
import { Icon, LogoutIcon, MenuIcon, XIcon } from './icons.jsx'

/** The link whose `to` is the longest prefix of the current path wins (e.g. /claims/new beats /claims). */
function activeLinkFor(links, pathname) {
  let best = null
  for (const link of links) {
    const exact = pathname === link.to
    const prefix = pathname.startsWith(`${link.to}/`)
    if ((exact || prefix) && (!best || link.to.length > best.to.length)) best = link
  }
  return best
}

function NavLinks({ links, pathname, onNavigate, vertical = false }) {
  const active = activeLinkFor(links, pathname)
  return (
    <ul className={vertical ? 'nav-links-vertical' : 'nav-links'}>
      {links.map((link) => {
        const isActive = active === link
        return (
          <li key={link.to}>
            <Link
              to={link.to}
              className={`nav-link${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={onNavigate}
            >
              <Icon name={link.icon} size={18} />
              <span>{link.label}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Sticky white top navbar: logo, role links, bell, role switch, user menu and Log out.
 * Below 900 px the links, role switch and Log out move into a slide-down panel.
 */
export default function NavBar() {
  const { user, activeRole, homePath } = useAuth()
  const { pathname } = useLocation()
  const narrow = useMediaQuery(NARROW_QUERY)
  const [menuOpenAt, setMenuOpenAt] = useState(null)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const links = NAV_BY_ROLE[activeRole] || []

  // The panel closes on navigation: it is "open" only for the path it was opened on.
  const menuOpen = narrow && menuOpenAt === pathname
  const closeMenu = () => setMenuOpenAt(null)

  useEffect(() => {
    if (!menuOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setMenuOpenAt(null)
        document.getElementById('nav-menu-toggle')?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const openLogout = () => {
    closeMenu()
    setLogoutOpen(true)
  }

  return (
    <header className={`navbar${menuOpen ? ' is-menu-open' : ''}`}>
      <div className="navbar-inner">
        {narrow && (
          <button
            id="nav-menu-toggle"
            type="button"
            className="icon-btn nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="nav-panel"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpenAt(menuOpen ? null : pathname)}
          >
            {menuOpen ? <XIcon size={22} /> : <MenuIcon size={22} />}
          </button>
        )}

        <Logo to={homePath} />

        {!narrow && (
          <nav className="nav-primary" aria-label="Main">
            <NavLinks links={links} pathname={pathname} />
          </nav>
        )}

        <div className="navbar-right">
          <NotificationBell />
          {!narrow && <RoleSwitch />}
          <UserMenu compact={narrow} />
          {!narrow && (
            <Button variant="primary" size="sm" onClick={openLogout} icon={<LogoutIcon size={16} />}>
              Log out
            </Button>
          )}
        </div>
      </div>

      {narrow && (
        <div id="nav-panel" className={`nav-panel${menuOpen ? ' is-open' : ''}`} hidden={!menuOpen}>
          <nav aria-label="Main">
            <NavLinks links={links} pathname={pathname} onNavigate={closeMenu} vertical />
          </nav>
          <div className="nav-panel-footer">
            {user && (
              <p className="nav-panel-user">
                Signed in as <strong>{user.fullName}</strong>
                <span className="muted"> · {ROLE_LABEL[activeRole]}</span>
              </p>
            )}
            <RoleSwitch className="role-switch-block" onSwitched={closeMenu} />
            <Button variant="primary" block onClick={openLogout} icon={<LogoutIcon size={18} />}>
              Log out
            </Button>
          </div>
        </div>
      )}
      {menuOpen && <div className="nav-scrim" onClick={closeMenu} aria-hidden="true" />}

      <LogoutDialog open={logoutOpen} onClose={() => setLogoutOpen(false)} />
    </header>
  )
}
