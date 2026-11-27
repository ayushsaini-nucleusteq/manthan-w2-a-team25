import { createContext } from 'react'

/**
 * Toast API: `{ show({tone, title, message, duration, action}), success(msg, opts), error(msg, opts), info(msg, opts), dismiss(id) }`.
 * The default is a no-op so components work outside a ToastProvider (e.g. in isolation).
 */
const noop = () => undefined
export const ToastContext = createContext({
  show: noop,
  success: noop,
  error: noop,
  info: noop,
  warning: noop,
  dismiss: noop,
})
