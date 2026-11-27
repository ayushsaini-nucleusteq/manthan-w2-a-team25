import { useRef } from 'react'
import { useAuth } from '../auth/useAuth.js'
import { ROLE_LABEL, ROLE_PRIORITY, ROLE_SHORT_LABEL } from '../utils/constants.js'

/**
 * Segmented pill that switches the active role (only for users holding 2+ roles).
 * The active segment is a filled blue pill. Arrow keys move between roles.
 * Switching navigates to that role's home screen.
 */
export default function RoleSwitch({ className = '', onSwitched }) {
  const { roles, activeRole, switchRole } = useAuth()
  const groupRef = useRef(null)
  if (roles.length < 2) return null

  // Employee first reads naturally left-to-right: Employee · Manager · Auditor · Head
  const ordered = [...ROLE_PRIORITY].reverse().filter((r) => roles.includes(r))

  const choose = (role) => {
    if (role !== activeRole) {
      switchRole(role)
      onSwitched?.(role)
    }
  }

  const onKeyDown = (e) => {
    const i = ordered.indexOf(activeRole)
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = ordered[(i + 1) % ordered.length]
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = ordered[(i - 1 + ordered.length) % ordered.length]
    if (!next) return
    e.preventDefault()
    choose(next)
    requestAnimationFrame(() => groupRef.current?.querySelector(`[data-role="${next}"]`)?.focus())
  }

  return (
    <div
      ref={groupRef}
      className={`role-switch ${className}`}
      role="radiogroup"
      aria-label="Active role"
      onKeyDown={onKeyDown}
      style={{ '--segments': ordered.length, '--active-index': Math.max(0, ordered.indexOf(activeRole)) }}
    >
      <span className="role-switch-thumb" aria-hidden="true" />
      {ordered.map((role) => {
        const active = role === activeRole
        return (
          <button
            key={role}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            data-role={role}
            className={`role-switch-option${active ? ' is-active' : ''}`}
            onClick={() => choose(role)}
            title={`View as ${ROLE_LABEL[role]}`}
          >
            {ROLE_SHORT_LABEL[role]}
          </button>
        )
      })}
    </div>
  )
}
