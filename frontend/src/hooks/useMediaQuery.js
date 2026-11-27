import { useCallback, useSyncExternalStore } from 'react'

/** Breakpoints from the spec (480 / 720 / 900 / 1200 px). */
export const MOBILE_QUERY = '(max-width: 719.98px)'
export const NARROW_QUERY = '(max-width: 899.98px)'
export const WIDE_QUERY = '(min-width: 900px)'

/**
 * Subscribes to a CSS media query.
 * @param {string} query e.g. '(max-width: 899.98px)'
 * @returns {boolean}
 */
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (callback) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', callback)
      return () => mql.removeEventListener('change', callback)
    },
    [query],
  )
  const getSnapshot = () => window.matchMedia(query).matches
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/** True below 720 px (phones). */
export const useIsMobile = () => useMediaQuery(MOBILE_QUERY)

/** True below 900 px (phones and portrait tablets). */
export const useIsNarrow = () => useMediaQuery(NARROW_QUERY)
