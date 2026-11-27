import { useEffect, useRef, useState } from 'react'
import { APP_NAME } from '../utils/constants.js'

/** How long to wait for a lazily loaded or data-driven page to render its <h1>. */
const HEADING_WAIT_MS = 5000

function isVisible(el) {
  return el.getClientRects().length > 0
}

/** The new page's heading. Suspense may keep the previous page in the DOM but hidden, so skip hidden ones. */
function findHeading(main) {
  return Array.from(main.querySelectorAll('h1')).find(isVisible) || null
}

/** True when the page (or the user) has already put focus on something inside <main>. */
function pageHasFocus(main) {
  const active = document.activeElement
  return Boolean(active) && active !== main && active !== document.body && main.contains(active)
}

function pageTitle() {
  return document.title.replace(new RegExp(`\\s*·\\s*${APP_NAME}$`), '').trim()
}

/**
 * Focus management for client-side navigation (spec §5): after the pathname changes
 * (not on the first load), focus moves to <main> right away and then to the new page's
 * <h1> as soon as it renders, so the next Tab starts at the top of the new screen.
 * Focus is left alone when the page has already focused something inside <main>
 * (an autofocused field, a J/K "next claim" button).
 *
 * Returns text for a polite live region. It stays empty when focus landed on the <h1>,
 * because the screen reader then reads the heading itself; otherwise it holds the page
 * title so the change is still announced.
 *
 * @param {React.RefObject<HTMLElement>} mainRef the <main tabIndex={-1}> element
 * @param {string} pathname current location.pathname
 * @returns {string}
 */
export function useRouteFocus(mainRef, pathname) {
  const [announcement, setAnnouncement] = useState('')
  const lastPathname = useRef(pathname)

  useEffect(() => {
    // First load (and StrictMode's effect re-run): leave focus at the top of the document.
    if (lastPathname.current === pathname) return undefined
    // "/" only ever redirects to the role's home, so leaving it is still the first load.
    const isHomeRedirect = lastPathname.current === '/'
    lastPathname.current = pathname
    const main = mainRef.current
    if (!main || isHomeRedirect) return undefined

    let observer = null
    let timer = null

    const announce = (text) => {
      // Appending a no-break space on repeats makes the live region read an identical title again.
      setAnnouncement((prev) => (text && prev === text ? `${text}\u00A0` : text))
    }

    const finish = (heading) => {
      observer?.disconnect()
      clearTimeout(timer)
      const focusIsFree = !pageHasFocus(main)
      if (heading && focusIsFree) {
        if (!heading.hasAttribute('tabindex')) {
          heading.setAttribute('tabindex', '-1')
          heading.setAttribute('data-route-focus', '')
        }
        heading.focus({ preventScroll: true })
        announce('')
        return
      }
      announce(heading?.textContent?.trim() || pageTitle())
    }

    if (!pageHasFocus(main)) main.focus({ preventScroll: true })

    const heading = findHeading(main)
    if (heading) {
      finish(heading)
      return undefined
    }

    observer = new MutationObserver(() => {
      const found = findHeading(main)
      if (found) finish(found)
    })
    observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden', 'class'] })
    timer = setTimeout(() => finish(null), HEADING_WAIT_MS)

    return () => {
      observer?.disconnect()
      clearTimeout(timer)
    }
  }, [pathname, mainRef])

  return announcement
}
