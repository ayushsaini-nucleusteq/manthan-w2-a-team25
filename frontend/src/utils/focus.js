/**
 * Keyboard helpers for menu-like panels (user menu, hamburger panel): ↓/↑ move
 * between items with wrap-around, Home/End jump to the ends.
 */

const ITEM_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'

/** Visible, enabled items inside `container`, in DOM order. */
export function menuItems(container, selector = ITEM_SELECTOR) {
  if (!container) return []
  return Array.from(container.querySelectorAll(selector)).filter(
    (el) => el.getClientRects().length > 0 && !el.closest('[inert]'),
  )
}

/**
 * Focuses the first or last item of `container`.
 * @param {HTMLElement|null} container
 * @param {'first'|'last'} [which]
 * @returns {boolean} whether an item was focused
 */
export function focusMenuItem(container, which = 'first') {
  const items = menuItems(container)
  const el = which === 'last' ? items[items.length - 1] : items[0]
  if (!el) return false
  el.focus()
  return true
}

/**
 * Handles ↓/↑/Home/End inside a menu-like panel. Keys already handled by an inner
 * widget (which called preventDefault, e.g. the role switch radiogroup) are ignored.
 * @param {KeyboardEvent} event
 * @param {HTMLElement|null} container
 * @returns {boolean} whether the key was handled
 */
export function handleMenuArrowKeys(event, container) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return false
  const target = event.target
  if (target instanceof HTMLElement && target.matches('input:not([type="checkbox"]):not([type="radio"]), select, textarea')) return false
  const items = menuItems(container)
  if (items.length === 0) return false
  const index = items.indexOf(document.activeElement)
  let next
  if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = items.length - 1
  else if (event.key === 'ArrowDown') next = index === -1 ? 0 : (index + 1) % items.length
  else next = index === -1 ? items.length - 1 : (index - 1 + items.length) % items.length
  event.preventDefault()
  items[next].focus()
  return true
}
