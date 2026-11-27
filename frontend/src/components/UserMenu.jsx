import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { devtoolsApi } from '../api'
import { useAuth } from '../auth/useAuth.js'
import { useDisclosure } from '../hooks/useDisclosure.js'
import { focusMenuItem, handleMenuArrowKeys } from '../utils/focus.js'
import { errorMessage, initials } from '../utils/format.js'
import { ROLE_LABEL } from '../utils/constants.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import { useToast } from './toast/useToast.js'
import { ChevronDownIcon, RefreshIcon, SettingsIcon, SwitchIcon } from './icons.jsx'

const FAIL_RATES = [
  { value: 0, label: 'Off (0%)' },
  { value: 0.3, label: '30% fail' },
]

/**
 * Avatar button with the user's name and active role, opening a panel with
 * "Switch user" (signs out to the picker) and "Demo tools" (fail-rate toggle,
 * reset demo data).
 *
 * Keyboard: Enter/Space toggle; ↓/↑ on the button open the panel and focus the
 * first/last item; ↓/↑/Home/End move between items; Esc closes and returns focus.
 */
export default function UserMenu({ compact = false }) {
  const { user, activeRole, logout } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const { open: menuOpen, onToggle: toggleMenu, onOpen: showMenu, onClose: closeMenu, ref: menuRef } = useDisclosure()
  const panelRef = useRef(null)
  const [failRate, setFailRateState] = useState(null)
  const [busy, setBusy] = useState(null)
  const [confirmReset, setConfirmReset] = useState(false)

  if (!user) return null

  const loadFailRate = () => {
    Promise.resolve()
      .then(() => devtoolsApi.getFailRate?.())
      .then((r) => setFailRateState(Number(r) || 0))
      .catch(() => setFailRateState(0))
  }

  const openMenu = () => {
    toggleMenu()
    if (!menuOpen) loadFailRate()
  }

  const onTriggerKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const which = e.key === 'ArrowDown' ? 'first' : 'last'
    if (!menuOpen) {
      showMenu()
      loadFailRate()
    }
    // The panel renders on the next commit.
    requestAnimationFrame(() => focusMenuItem(panelRef.current, which))
  }

  const switchUser = () => {
    closeMenu()
    navigate('/login', { replace: true })
    logout()
  }

  const changeFailRate = async (value) => {
    setBusy('fail')
    try {
      await devtoolsApi.setFailRate(value)
      setFailRateState(value)
      toast.info(
        value > 0
          ? `About ${Math.round(value * 100)}% of requests will now fail, so you can see error states and retries.`
          : 'Requests will no longer fail on purpose.',
        { title: value > 0 ? 'Simulated failures on' : 'Simulated failures off' },
      )
    } catch (err) {
      toast.error(errorMessage(err), { title: "Couldn't change the fail rate" })
    } finally {
      setBusy(null)
    }
  }

  const resetData = async () => {
    setBusy('reset')
    try {
      await devtoolsApi.resetMockData()
      setConfirmReset(false)
      // Reload so every screen re-reads the freshly seeded data.
      window.location.reload()
    } catch (err) {
      setBusy(null)
      setConfirmReset(false)
      toast.error(errorMessage(err), { title: "Couldn't reset the demo data" })
    }
  }

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className="user-menu-trigger"
        aria-expanded={menuOpen}
        aria-controls="user-menu-panel"
        onClick={openMenu}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="avatar" aria-hidden="true">
          {initials(user.fullName)}
        </span>
        {!compact && (
          <span className="user-menu-text">
            <span className="user-menu-name">{user.fullName}</span>
            <span className="user-menu-role">{ROLE_LABEL[activeRole]}</span>
          </span>
        )}
        <span className="sr-only">Account menu for {user.fullName}</span>
        <ChevronDownIcon size={16} className={`user-menu-chevron${menuOpen ? ' is-open' : ''}`} />
      </button>

      {menuOpen && (
        <div
          className="dropdown user-menu-panel"
          id="user-menu-panel"
          ref={panelRef}
          onKeyDown={(e) => handleMenuArrowKeys(e, panelRef.current)}
        >
          <div className="user-menu-head">
            <span className="avatar avatar-lg" aria-hidden="true">
              {initials(user.fullName)}
            </span>
            <div className="grow">
              <p className="strong truncate">{user.fullName}</p>
              <p className="muted small truncate">{user.email}</p>
              <p className="muted xsmall">
                {[user.employeeCode, user.departmentName].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          <div className="dropdown-section">
            <button type="button" className="dropdown-item" onClick={switchUser}>
              <SwitchIcon size={18} />
              <span>
                Switch user
                <span className="dropdown-item-hint">Sign out and pick another person</span>
              </span>
            </button>
          </div>

          <div className="dropdown-section">
            <p className="dropdown-label">
              <SettingsIcon size={14} /> Demo tools
            </p>
            <div className="demo-tool">
              <span className="demo-tool-label" id="fail-rate-label">
                Simulated failures
              </span>
              <div className="segmented" role="radiogroup" aria-labelledby="fail-rate-label">
                {FAIL_RATES.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={failRate === opt.value}
                    className={`segmented-option${failRate === opt.value ? ' is-active' : ''}`}
                    disabled={busy !== null || failRate === null}
                    onClick={() => changeFailRate(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="dropdown-item"
              onClick={() => {
                closeMenu()
                setConfirmReset(true)
              }}
            >
              <RefreshIcon size={18} />
              <span>
                Reset demo data
                <span className="dropdown-item-hint">Re-seed every claim, user and batch</span>
              </span>
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Reset the demo data?"
        message="All claims, approvals, payouts and settings go back to the original seed. Changes you made in this browser will be lost."
        confirmLabel="Reset data"
        tone="danger"
        loading={busy === 'reset'}
        onConfirm={resetData}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}
