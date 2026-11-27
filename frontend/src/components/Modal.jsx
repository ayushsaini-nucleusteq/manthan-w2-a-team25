import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from './icons.jsx'

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, object, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/** Open modals, topmost last. Only the topmost one reacts to Escape and traps focus. */
const stack = []
let lockedScrollY = 0

function lockScroll() {
  if (stack.length === 1) {
    lockedScrollY = window.scrollY
    document.body.classList.add('has-modal')
    document.body.style.top = `-${lockedScrollY}px`
  }
}

function unlockScroll() {
  if (stack.length === 0) {
    document.body.classList.remove('has-modal')
    document.body.style.top = ''
    window.scrollTo(0, lockedScrollY)
  }
}

/**
 * Accessible dialog: focus trap, Escape to close, focus returns to the opener,
 * body scroll lock. Renders as a bottom sheet under 720 px.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} [props.description]
 * @param {'sm'|'md'|'lg'|'xl'|'full'} [props.size]
 * @param {React.ReactNode} [props.footer] sticky action row
 * @param {React.RefObject} [props.initialFocusRef] element to focus on open (defaults to first field, then close button)
 * @param {boolean} [props.closeOnBackdrop]
 * @param {boolean} [props.dismissible] false hides the close button and ignores Esc/backdrop (e.g. while saving)
 * @param {'dialog'|'alertdialog'} [props.role]
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  initialFocusRef,
  closeOnBackdrop = true,
  dismissible = true,
  role = 'dialog',
  className = '',
  bodyClassName = '',
  children,
}) {
  const dialogRef = useRef(null)
  const titleId = useId()
  const descId = useId()
  const onCloseRef = useRef(onClose)
  const dismissibleRef = useRef(dismissible)

  useEffect(() => {
    onCloseRef.current = onClose
    dismissibleRef.current = dismissible
  })

  useEffect(() => {
    if (!open) return undefined
    const dialog = dialogRef.current
    const opener = document.activeElement
    const token = {}
    stack.push(token)
    lockScroll()

    const focusFirst = () => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus()
        return
      }
      const field = dialog.querySelector('.modal-body input:not([disabled]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled])')
      ;(field || dialog.querySelector('.modal-close') || dialog).focus()
    }
    const raf = requestAnimationFrame(focusFirst)

    const onKeyDown = (e) => {
      if (stack[stack.length - 1] !== token) return
      if (e.key === 'Escape') {
        if (dismissibleRef.current) {
          e.stopPropagation()
          onCloseRef.current?.()
        }
        return
      }
      if (e.key !== 'Tab') return
      const nodes = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      )
      if (nodes.length === 0) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeyDown, true)
      const i = stack.indexOf(token)
      if (i !== -1) stack.splice(i, 1)
      unlockScroll()
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus({ preventScroll: true })
      }
    }
  }, [open, initialFocusRef])

  if (!open) return null

  const onBackdrop = (e) => {
    if (e.target === e.currentTarget && closeOnBackdrop && dismissible) onClose?.()
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onBackdrop}>
      <div
        ref={dialogRef}
        className={`modal modal-${size} ${className}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <span className="modal-grabber" aria-hidden="true" />
        <div className="modal-header">
          <div className="modal-heading">
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            {description && (
              <p id={descId} className="modal-desc">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close dialog">
              <XIcon size={20} />
            </button>
          )}
        </div>
        <div className={`modal-body ${bodyClassName}`}>{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
