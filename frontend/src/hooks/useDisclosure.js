import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Open/close state for popovers and menus, with outside-click and Escape handling.
 * Attach `ref` to the element that wraps both the trigger and the panel; Escape
 * returns focus to the trigger (the element carrying `aria-expanded`).
 */
export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial)
  const ref = useRef(null)
  const onOpen = useCallback(() => setOpen(true), [])
  const onClose = useCallback(() => setOpen(false), [])
  const onToggle = useCallback(() => setOpen((o) => !o), [])

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        ref.current?.querySelector('[aria-expanded]')?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return { open, setOpen, onOpen, onClose, onToggle, ref }
}
