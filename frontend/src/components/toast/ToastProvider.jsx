import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ToastContext } from './toastContext.js'
import { AlertTriangleIcon, CheckIcon, InfoIcon, XIcon } from '../icons.jsx'

const ICONS = { success: CheckIcon, error: AlertTriangleIcon, warning: AlertTriangleIcon, info: InfoIcon }
const DEFAULT_DURATION = { success: 4000, info: 5000, warning: 6000, error: 7000 }
const MAX_TOASTS = 4
const EXIT_MS = 200

let nextId = 1

function ToastItem({ toast, onDismiss }) {
  const [paused, setPaused] = useState(false)
  const remaining = useRef(toast.duration)
  const startedAt = useRef(0)

  useEffect(() => {
    if (toast.leaving || paused || !toast.duration) return undefined
    startedAt.current = Date.now()
    const t = setTimeout(() => onDismiss(toast.id), remaining.current)
    return () => {
      clearTimeout(t)
      remaining.current -= Date.now() - startedAt.current
    }
  }, [paused, toast.leaving, toast.duration, toast.id, onDismiss])

  const IconComponent = ICONS[toast.tone] || InfoIcon
  return (
    <li
      className={`toast toast-${toast.tone}${toast.leaving ? ' is-leaving' : ''}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast-icon" aria-hidden="true">
        <IconComponent size={18} strokeWidth={2.25} />
      </span>
      <div className="toast-body">
        {toast.title && <p className="toast-title">{toast.title}</p>}
        {toast.message && <p className="toast-message">{toast.message}</p>}
        {toast.action && (
          <button
            type="button"
            className="toast-action"
            onClick={() => {
              toast.action.onClick?.()
              onDismiss(toast.id)
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button type="button" className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
        <XIcon size={16} />
      </button>
      {toast.duration > 0 && (
        <span
          className="toast-timer"
          aria-hidden="true"
          style={{ animationDuration: `${toast.duration}ms`, animationPlayState: paused ? 'paused' : 'running' }}
        />
      )}
    </li>
  )
}

/**
 * Global toasts (success / error / info / warning) that slide in at the top right
 * (bottom on mobile) and auto-dismiss. Hovering or focusing a toast pauses it.
 */
export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    timers.current.delete(id)
  }, [])

  const dismiss = useCallback(
    (id) => {
      setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
      if (!timers.current.has(id)) timers.current.set(id, setTimeout(() => remove(id), EXIT_MS))
    },
    [remove],
  )

  useEffect(() => {
    const map = timers.current
    return () => map.forEach((t) => clearTimeout(t))
  }, [])

  const show = useCallback((opts) => {
    const tone = opts.tone || 'info'
    const toast = {
      id: nextId++,
      tone,
      title: opts.title,
      message: opts.message,
      action: opts.action,
      duration: opts.duration ?? DEFAULT_DURATION[tone] ?? 5000,
      leaving: false,
    }
    setToasts((list) => [...list, toast].slice(-MAX_TOASTS))
    return toast.id
  }, [])

  const api = useMemo(() => {
    const make = (tone) => (message, opts = {}) => show({ ...opts, tone, message })
    return { show, dismiss, success: make('success'), error: make('error'), info: make('info'), warning: make('warning') }
  }, [show, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <section className="toasts" aria-label="Notifications">
          <ol className="toast-list">
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
            ))}
          </ol>
        </section>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}
