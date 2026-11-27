import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useDebounce } from '../../hooks/useDebounce.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { useToast } from '../../components/toast/useToast.js'
import { errorMessage } from '../../api'
import Logo from '../../components/Logo.jsx'
import Button from '../../components/Button.jsx'
import TextInput from '../../components/TextInput.jsx'
import InfoBanner from '../../components/InfoBanner.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import { ArrowRightIcon, CameraIcon, CheckIcon, ShieldIcon, UserIcon, WalletIcon } from '../../components/icons.jsx'
import { ROLE_PRIORITY, ROLE_SHORT_LABEL } from '../../utils/constants.js'
import { initials } from '../../utils/format.js'
import { DEMO_PERSONAS, safeNextPath } from './shared-screens/helpers.js'
import './shared-screens/shared.css'

function isDemoDisabled(err) {
  return err?.code === 'DEMO_LOGIN_DISABLED' || err?.status === 403
}

function RoleChips({ roles = [] }) {
  const sorted = ROLE_PRIORITY.filter((r) => roles.includes(r))
  return (
    <span className="picker-roles">
      {sorted.map((r) => (
        <span key={r} className={`chip chip-sm tone-${r === 'EMPLOYEE' ? 'neutral' : 'brand'}`}>
          {ROLE_SHORT_LABEL[r] || r}
        </span>
      ))}
    </span>
  )
}

function PromoPanel() {
  return (
    <aside className="promo-panel" aria-labelledby="promo-title">
      <svg className="promo-art" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="promo-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.4" fill="rgba(255,255,255,0.16)" />
          </pattern>
          <linearGradient id="promo-glow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2b8ceb" stopOpacity="0.55" />
            <stop offset="1" stopColor="#006fcf" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="400" height="500" fill="url(#promo-dots)" />
        <circle cx="340" cy="70" r="150" fill="url(#promo-glow)" />
        <circle cx="340" cy="70" r="95" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
        <circle cx="340" cy="70" r="140" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
        <g transform="translate(70 70) rotate(-8)">
          <rect width="150" height="190" rx="12" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.35)" />
          <rect x="18" y="22" width="80" height="10" rx="5" fill="rgba(255,255,255,0.55)" />
          <rect x="18" y="48" width="114" height="6" rx="3" fill="rgba(255,255,255,0.3)" />
          <rect x="18" y="64" width="96" height="6" rx="3" fill="rgba(255,255,255,0.3)" />
          <rect x="18" y="80" width="106" height="6" rx="3" fill="rgba(255,255,255,0.3)" />
          <rect x="18" y="150" width="60" height="14" rx="7" fill="rgba(255,255,255,0.55)" />
          <circle cx="118" cy="157" r="14" fill="#00875a" />
          <path d="M111 157l5 5 9-10" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
      <div className="promo-content">
        <p className="promo-eyebrow">ExpenseFlow</p>
        <h2 id="promo-title" className="promo-title">Expenses, approved on the go</h2>
        <ul className="promo-list">
          <li>
            <span className="promo-icon" aria-hidden="true"><CameraIcon size={18} /></span>
            <span>
              <strong>Snap receipts from your phone</strong>
              <span className="promo-sub">Capture a bill and add it to your claim in seconds.</span>
            </span>
          </li>
          <li>
            <span className="promo-icon" aria-hidden="true"><ShieldIcon size={18} /></span>
            <span>
              <strong>Policy checks as you type</strong>
              <span className="promo-sub">See limits and flags before you submit, not after.</span>
            </span>
          </li>
          <li>
            <span className="promo-icon" aria-hidden="true"><WalletIcon size={18} /></span>
            <span>
              <strong>Faster approvals and payouts</strong>
              <span className="promo-sub">Approvers review side by side; finance pays in batches.</span>
            </span>
          </li>
        </ul>
      </div>
    </aside>
  )
}

function SkeletonRows() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="picker-skel">
          <Skeleton circle width={40} height={40} />
          <div className="grow stack-sm">
            <Skeleton width="55%" height={14} />
            <Skeleton width="80%" height={12} />
          </div>
        </div>
      ))}
    </div>
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Real sign-in against the backend: POST /api/auth/login {email, password}. */
function PasswordSignIn({ next, onUnavailable }) {
  const { loginWithPassword } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const emailError = touched && email && !EMAIL_RE.test(email.trim()) ? 'Enter a valid work email, for example name@company.com.' : null
  const canSubmit = EMAIL_RE.test(email.trim()) && password.length > 0 && !busy

  async function onSubmit(event) {
    event.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const s = await loginWithPassword(email.trim(), password)
      toast.success(`Signed in as ${s.user?.fullName || email.trim()}.`)
      navigate(next || s.homePath || '/', { replace: true })
    } catch (err) {
      setBusy(false)
      if (err?.status === 0 || err?.status >= 502) {
        toast.info('The server is not reachable, so ExpenseFlow switched to demo data.', { title: 'Using demo data' })
        onUnavailable()
        return
      }
      setError(err)
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <TextInput
        label="Work email"
        type="email"
        autoComplete="username"
        icon={<UserIcon size={18} />}
        value={email}
        required
        onChange={(e) => setEmail(e.target.value)}
        onBlur={() => setTouched(true)}
        error={emailError}
      />
      <TextInput
        label="Password"
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        icon={<ShieldIcon size={18} />}
        value={password}
        required
        onChange={(e) => setPassword(e.target.value)}
        labelAction={
          <button type="button" className="link-button" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword}>
            {showPassword ? 'Hide' : 'Show'}
          </button>
        }
      />
      {error && (
        <InfoBanner tone="danger" live>
          {error.status === 401 ? 'Email or password is incorrect.' : errorMessage(error, 'Sign-in failed. Please try again.')}
        </InfoBanner>
      )}
      <Button
        type="submit"
        size="lg"
        block
        className="btn-signin"
        disabled={!canSubmit}
        loading={busy}
        loadingLabel="Signing in…"
        iconRight={<ArrowRightIcon size={18} />}
      >
        Log in
      </Button>
    </form>
  )
}

/**
 * S1 Sign-in. When the backend answers, sign in with email and password (POST /api/auth/login).
 * When it does not, fall back to the demo picker over mock data.
 */
export default function LoginPage() {
  const { probeBackend } = useAuth()
  const [params] = useSearchParams()
  const forceDemo = params.get('demo') === '1'
  const [mode, setMode] = useState(forceDemo ? 'demo' : 'checking')

  useEffect(() => {
    let cancelled = false
    if (forceDemo) return undefined
    probeBackend({ force: true }).then(
      (up) => !cancelled && setMode(up ? 'server' : 'demo'),
      () => !cancelled && setMode('demo'),
    )
    return () => {
      cancelled = true
    }
  }, [probeBackend, forceDemo])

  return <SignInScreen mode={mode} setMode={setMode} />
}

function SignInScreen({ mode, setMode }) {
  useDocumentTitle('Sign in')
  const { loadPickerUsers, login, probeBackend } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const expired = params.get('expired') === '1'
  const next = safeNextPath(params.get('next'))
  const [retrying, setRetrying] = useState(false)

  async function retryServer() {
    setRetrying(true)
    const up = await probeBackend({ force: true }).catch(() => false)
    setRetrying(false)
    if (up) setMode('server')
    else toast.info('The server is still not reachable.', { title: 'Using demo data' })
  }

  const [query, setQuery] = useState('')
  const debounced = useDebounce(query.trim(), 300)
  const [selected, setSelected] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState(null)

  const listId = useId()
  const optionId = (id) => `${listId}-opt-${id}`
  const listRef = useRef(null)
  const searchRef = useRef(null)

  const users = useAsync(() => loadPickerUsers(debounced), [debounced, loadPickerUsers])
  const personas = useAsync(async () => {
    const results = await Promise.all(DEMO_PERSONAS.map((p) => loadPickerUsers(p.name)))
    return DEMO_PERSONAS.map((p, i) => ({ ...p, user: results[i].find((u) => u.email === p.email) || null }))
  }, [loadPickerUsers])

  const items = useMemo(() => users.data || [], [users.data])
  // The active (highlighted) row is derived from the list, so it stays valid as results change.
  const activeIndex = useMemo(() => {
    if (!items.length) return -1
    const byActive = activeId ? items.findIndex((u) => u.id === activeId) : -1
    if (byActive >= 0) return byActive
    const bySelected = selected ? items.findIndex((u) => u.id === selected.id) : -1
    return bySelected >= 0 ? bySelected : 0
  }, [items, activeId, selected])
  const setActiveIndex = (update) => {
    const nextIndex = typeof update === 'function' ? update(activeIndex) : update
    const user = items[nextIndex]
    if (user) setActiveId(user.id)
  }
  const disabled = isDemoDisabled(users.error) || isDemoDisabled(personas.error) || isDemoDisabled(signInError)

  // Scroll the active option into view.
  useEffect(() => {
    if (activeIndex < 0 || !items[activeIndex]) return
    const el = document.getElementById(optionId(items[activeIndex].id))
    el?.scrollIntoView?.({ block: 'nearest' })
    // optionId is derived from a stable useId value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, items])

  function choose(user) {
    setSelected(user)
    setSignInError(null)
  }

  async function handleSignIn(event) {
    event?.preventDefault()
    if (!selected || signingIn) return
    setSigningIn(true)
    setSignInError(null)
    try {
      const s = await login(selected.id)
      toast.success(`Signed in as ${selected.fullName}.`)
      navigate(next || s.homePath || '/', { replace: true })
    } catch (err) {
      setSignInError(err)
      if (!isDemoDisabled(err)) toast.error(errorMessage(err, 'Sign-in failed. Please try again.'), { title: 'Could not sign in' })
      setSigningIn(false)
    }
  }

  function onKeyDown(event) {
    if (!items.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, items.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Home' && event.currentTarget !== searchRef.current) {
      event.preventDefault()
      setActiveIndex(0)
    } else if (event.key === 'End' && event.currentTarget !== searchRef.current) {
      event.preventDefault()
      setActiveIndex(items.length - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const user = items[activeIndex]
      if (!user) return
      if (selected?.id === user.id) handleSignIn()
      else choose(user)
    } else if (event.key === ' ' && event.currentTarget === listRef.current) {
      event.preventDefault()
      if (items[activeIndex]) choose(items[activeIndex])
    }
  }

  const activeDescendant = activeIndex >= 0 && items[activeIndex] ? optionId(items[activeIndex].id) : undefined
  const showSkeleton = users.loading && !users.data

  let listBody
  if (disabled) {
    listBody = null
  } else if (users.error && !users.data) {
    listBody = <ErrorState compact error={users.error} title="We couldn't load the people list" onRetry={users.reload} mapNotFound={false} />
  } else if (showSkeleton) {
    listBody = (
      <div className="picker-list" role="status" aria-label="Loading people">
        <SkeletonRows />
      </div>
    )
  } else if (!items.length) {
    listBody = (
      <div className="picker-list" role="status">
        <p className="picker-empty">
          No one matches <strong>{debounced}</strong>. Try a different name or employee code.
        </p>
      </div>
    )
  } else {
    listBody = (
      <ul
        ref={listRef}
        id={listId}
        className="picker-list"
        role="listbox"
        aria-label="People you can sign in as"
        aria-activedescendant={activeDescendant}
        aria-busy={users.loading || undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {items.map((u, i) => {
          const isSel = selected?.id === u.id
          return (
            <li
              key={u.id}
              id={optionId(u.id)}
              role="option"
              aria-selected={isSel}
              className={`picker-option${i === activeIndex ? ' is-active' : ''}`}
              onClick={() => {
                setActiveIndex(i)
                choose(u)
              }}
            >
              <span className="picker-radio" aria-hidden="true" />
              <span className="avatar" aria-hidden="true">{initials(u.fullName)}</span>
              <span className="picker-text">
                <span className="picker-name">{u.fullName}</span>
                <span className="picker-meta">
                  {u.employeeCode} · {u.departmentName || 'No department'}
                </span>
              </span>
              <RoleChips roles={u.roles} />
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="auth-screen">
      <header className="auth-topbar">
        <Logo to="/login" />
      </header>
      <main id="main" tabIndex={-1} className="auth-main">
        <section className="auth-card" aria-labelledby="signin-title">
          <div className="stack-sm">
            <h1 id="signin-title" className="auth-title">Sign in to ExpenseFlow</h1>
            <p className="auth-lead">
              {mode === 'server' ? 'Use your work email and password.' : mode === 'demo' ? 'Choose who you are to continue.' : 'Connecting to the server…'}
            </p>
          </div>

          {expired && !disabled && (
            <InfoBanner tone="warning" title="Your session ended" live>
              For your security you were signed out. Sign in again to continue.
            </InfoBanner>
          )}

          {mode === 'checking' ? (
            <div className="stack-sm" role="status" aria-label="Checking the server">
              <Skeleton height={48} />
              <Skeleton height={48} />
              <Skeleton height={48} />
            </div>
          ) : mode === 'server' ? (
            <>
              <PasswordSignIn next={next} onUnavailable={() => setMode('demo')} />
              <button type="button" className="link-button" onClick={() => setMode('demo')}>
                Use demo data instead
              </button>
            </>
          ) : null}

          {mode === 'demo' && (
            <InfoBanner
              tone="warning"
              title="Using demo data"
              live
              action={
                <Button size="sm" variant="secondary" loading={retrying} loadingLabel="Checking…" onClick={retryServer}>
                  Try the server again
                </Button>
              }
            >
              The server is not reachable, so you are signing in to sample data. Changes stay in this browser.
            </InfoBanner>
          )}

          {mode !== 'demo' ? null : disabled ? (
            <InfoBanner tone="danger" title="Sign-in unavailable" live>
              Demo sign-in is turned off in this environment.
            </InfoBanner>
          ) : (
            <form className="stack" onSubmit={handleSignIn} noValidate>
              <TextInput
                ref={searchRef}
                label="Find yourself"
                icon={<UserIcon size={18} />}
                placeholder="Search by name or employee code"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                autoComplete="off"
                role="combobox"
                aria-expanded={items.length > 0}
                aria-controls={items.length ? listId : undefined}
                aria-autocomplete="list"
                aria-activedescendant={activeDescendant}
                hint="Use the up and down arrows to move, Enter to select."
              />
              {listBody}
              <p className="sr-only" aria-live="polite">
                {users.loading ? 'Searching…' : `${items.length} ${items.length === 1 ? 'person' : 'people'} found.`}
                {selected ? ` Selected ${selected.fullName}.` : ''}
              </p>
              {signInError && !isDemoDisabled(signInError) && (
                <InfoBanner tone="danger" live>
                  {errorMessage(signInError, 'Sign-in failed. Please try again.')}
                </InfoBanner>
              )}
              <Button
                type="submit"
                size="lg"
                block
                className="btn-signin"
                disabled={!selected || signingIn}
                loading={signingIn}
                loadingLabel="Signing in…"
                iconRight={<ArrowRightIcon size={18} />}
              >
                {selected ? `Sign in as ${selected.fullName}` : 'Sign in'}
              </Button>
            </form>
          )}

          {mode === 'demo' && !disabled && (
            <div className="stack-sm">
              <h2 className="section-label" id="personas-label">Quick demo personas</h2>
              {personas.error ? (
                <ErrorState compact error={personas.error} title="We couldn't load the demo personas" onRetry={personas.reload} mapNotFound={false} />
              ) : (
                <div className="persona-grid" role="group" aria-labelledby="personas-label">
                  {DEMO_PERSONAS.map((p, i) => {
                    const user = personas.data?.[i]?.user
                    const pressed = Boolean(user && selected?.id === user.id)
                    return (
                      <button
                        key={p.key}
                        type="button"
                        className="persona-card"
                        aria-pressed={pressed}
                        disabled={!user || signingIn}
                        onClick={() => user && choose(user)}
                      >
                        <span className="persona-role">{p.label}</span>
                        {personas.loading ? (
                          <Skeleton width="80%" height={14} />
                        ) : (
                          <span className="persona-name">{p.name}</span>
                        )}
                        {pressed && <CheckIcon size={16} className="text-success" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

        </section>

        <PromoPanel />
      </main>
    </div>
  )
}
