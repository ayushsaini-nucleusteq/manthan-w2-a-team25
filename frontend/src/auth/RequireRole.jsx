import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import NotFoundPage from '../pages/shared/NotFoundPage.jsx'
import { useAuth } from './useAuth.js'

/**
 * Guards a route by role.
 * - The user holds none of `roles` → renders the 404 page (never "forbidden", US4-AC3).
 * - The user holds one of them but another role is active → switches the active role
 *   automatically (first match in `roles` order), so nav and data match the screen.
 *
 * @param {{roles: string[], children?: React.ReactNode}} props
 */
export default function RequireRole({ roles, children }) {
  const { roles: held, activeRole, activateRole } = useAuth()
  const match = roles.find((r) => held.includes(r))
  const needsSwitch = Boolean(match) && !roles.includes(activeRole)

  useEffect(() => {
    if (needsSwitch) activateRole(match)
  }, [needsSwitch, match, activateRole])

  if (!match) return <NotFoundPage />
  return children ?? <Outlet />
}
