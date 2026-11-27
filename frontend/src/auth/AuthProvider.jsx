import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { authApi } from '../api'
import { clearSession, getSession, setSession, subscribeSession } from '../api/session.js'
import { AuthContext } from './authContext.js'
import { EVENTS, HOME_SCREEN_ROLE, ROLE_HOME, ROLE_PRIORITY, STORAGE_KEYS } from '../utils/constants.js'

/* ---------- helpers ---------- */

function isExpired(session) {
  if (!session?.expiresAt) return false
  const t = new Date(session.expiresAt).getTime()
  return Number.isFinite(t) && t <= Date.now()
}

function restoreSession() {
  try {
    const s = getSession()
    if (!s || !s.token || !s.user) return null
    if (isExpired(s)) {
      clearSession()
      return null
    }
    return s
  } catch {
    return null
  }
}

function userRoles(session) {
  const roles = session?.user?.roles || []
  return ROLE_PRIORITY.filter((r) => roles.includes(r))
}

/** Backend contract: homeScreen = the highest role (F1→FINANCE_HEAD, A1→AUDITOR, M1→MANAGER, E1→EMPLOYEE). */
function defaultRole(session) {
  const roles = userRoles(session)
  const fromHome = HOME_SCREEN_ROLE[session?.homeScreen]
  if (fromHome && roles.includes(fromHome)) return fromHome
  return roles[0] || 'EMPLOYEE'
}

function readStoredRole() {
  try {
    return sessionStorage.getItem(STORAGE_KEYS.activeRole)
  } catch {
    return null
  }
}

function writeStoredRole(role) {
  try {
    if (role) sessionStorage.setItem(STORAGE_KEYS.activeRole, role)
    else sessionStorage.removeItem(STORAGE_KEYS.activeRole)
  } catch {
    /* storage unavailable (private mode): the role just won't survive a reload */
  }
}

function initialRole(session) {
  if (!session) return null
  const stored = readStoredRole()
  return stored && userRoles(session).includes(stored) ? stored : defaultRole(session)
}

/** Unsynced offline drafts live in localStorage under STORAGE_KEYS.draftsPrefix. */
function clearOfflineDrafts() {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(STORAGE_KEYS.draftsPrefix)) keys.push(k)
    }
    keys.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* ignore */
  }
}

/**
 * Holds `{user, roles, activeRole, token}` and the auth actions.
 *
 * BACKEND CONTRACT (S1): there are no passwords. The sign-in page lists users with
 * `loadPickerUsers(q)` (GET /api/auth/users) and signs in with `login(userId)`
 * (POST /api/auth/login). The JWT carries every role the user holds; the active role
 * only changes which screens are shown. The session lives in the API's session.js
 * store and is restored on reload; the active role is kept in sessionStorage.
 *
 * Context value:
 *   session, user, roles (highest first), activeRole, token, homeScreen, homePath,
 *   isAuthenticated, hasRole(role),
 *   loadPickerUsers(q) → Promise<[{id, fullName, email, employeeCode, departmentName, roles}]>,
 *   login(userId) → Promise<Session & {activeRole, homePath}>,
 *   logout(), switchRole(role) (navigates to that role's home),
 *   activateRole(role) (no navigation; used by RequireRole)
 *
 * Session end: a 401 from any request (the API clears session.js, and useAsync also
 * broadcasts EVENTS.unauthorized) or reaching `expiresAt` signs out and redirects to
 * /login?expired=1&next=<current path>. A user-initiated logout() never redirects;
 * the caller navigates (LogoutDialog → /signed-out, "Switch user" → /login).
 */
export default function AuthProvider({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [session, setSessionState] = useState(restoreSession)
  const [activeRole, setActiveRole] = useState(() => initialRole(session))
  const locationRef = useRef(location)
  // react-router's navigate() changes identity on every pathname change; keep the latest in a ref.
  const navigateRef = useRef(navigate)
  // The session this provider shows. Set to null synchronously when a sign-out starts so
  // late 401s and session-store events can't trigger a second sign-out or redirect.
  const liveSession = useRef(session)

  useEffect(() => {
    locationRef.current = location
    navigateRef.current = navigate
  })

  useEffect(() => {
    writeStoredRole(activeRole)
  }, [activeRole])

  const roles = useMemo(() => userRoles(session), [session])

  const signOutLocally = useCallback(() => {
    liveSession.current = null
    clearSession()
    clearOfflineDrafts()
    writeStoredRole(null)
    setSessionState(null)
    setActiveRole(null)
    // Client-side only (no endpoint); a failure must never block signing out.
    Promise.resolve()
      .then(() => authApi.logout?.())
      .catch(() => undefined)
  }, [])

  /** The session ended without the user asking (401 or expiry): sign out and ask them to sign in again. */
  const expire = useCallback(() => {
    if (!liveSession.current) return
    const { pathname, search } = locationRef.current
    signOutLocally()
    navigateRef.current(`/login?expired=1&next=${encodeURIComponent(pathname + search)}`, { replace: true })
  }, [signOutLocally])

  // Any 401: useAsync broadcasts EVENTS.unauthorized, and the API clears session.js when it
  // rejects a token (expired, invalid, deactivated user), which also covers direct calls
  // from event handlers and the notification poll.
  useEffect(() => {
    window.addEventListener(EVENTS.unauthorized, expire)
    const unsubscribe = subscribeSession((next) => {
      if (!next) expire()
    })
    return () => {
      window.removeEventListener(EVENTS.unauthorized, expire)
      unsubscribe()
    }
  }, [expire])

  // Sign out when the 8 h session runs out.
  const expiresAt = session?.expiresAt
  useEffect(() => {
    if (!expiresAt) return undefined
    const ms = new Date(expiresAt).getTime() - Date.now()
    if (!Number.isFinite(ms)) return undefined
    const timer = setTimeout(expire, Math.max(0, Math.min(ms, 2 ** 31 - 1)))
    return () => clearTimeout(timer)
  }, [expiresAt, expire])

  // Refresh the user from GET /api/auth/me after a reload (roles may have changed).
  // The token is marked verified only once a response is handled, so StrictMode's
  // effect re-run (which cancels the first call) still applies the second one.
  const verifiedToken = useRef(null)
  const token = session?.token
  useEffect(() => {
    if (!token || verifiedToken.current === token) return undefined
    let cancelled = false
    Promise.resolve()
      .then(() => authApi.me())
      .then(
        (me) => {
          if (cancelled || !me) return
          verifiedToken.current = token
          const stored = getSession()
          if (!stored || stored.token !== token || liveSession.current?.token !== token) return
          const { homeScreen, ...user } = me
          const next = { ...stored, user: { ...stored.user, ...user }, homeScreen: homeScreen || stored.homeScreen }
          setSession(next)
          liveSession.current = next
          setSessionState(next)
          setActiveRole((r) => (r && userRoles(next).includes(r) ? r : defaultRole(next)))
        },
        (err) => {
          if (cancelled) return
          verifiedToken.current = token
          if (err && [401, 403, 404].includes(err.status)) expire()
        },
      )
    return () => {
      cancelled = true
    }
  }, [token, expire])

  const loadPickerUsers = useCallback((q = '') => authApi.listLoginUsers({ q }), [])

  const login = useCallback(async (userId) => {
    const next = await authApi.login(userId)
    setSession(next)
    const role = defaultRole(next)
    writeStoredRole(role)
    verifiedToken.current = next.token
    liveSession.current = next
    setSessionState(next)
    setActiveRole(role)
    return { ...next, activeRole: role, homePath: ROLE_HOME[role] || '/' }
  }, [])

  const logout = useCallback(() => signOutLocally(), [signOutLocally])

  const activateRole = useCallback(
    (role) => {
      if (roles.includes(role)) setActiveRole(role)
    },
    [roles],
  )

  const switchRole = useCallback(
    (role) => {
      if (!roles.includes(role)) return
      setActiveRole(role)
      navigateRef.current(ROLE_HOME[role] || '/')
    },
    [roles],
  )

  const hasRole = useCallback((role) => roles.includes(role), [roles])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      roles,
      activeRole: session ? activeRole : null,
      token: session?.token ?? null,
      homeScreen: session?.homeScreen ?? null,
      homePath: session ? ROLE_HOME[activeRole] || '/' : '/login',
      isAuthenticated: Boolean(session),
      hasRole,
      loadPickerUsers,
      login,
      logout,
      switchRole,
      activateRole,
    }),
    [session, roles, activeRole, hasRole, loadPickerUsers, login, logout, switchRole, activateRole],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
