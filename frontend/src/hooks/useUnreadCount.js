import { useCallback, useEffect, useState } from 'react'
import { notificationsApi } from '../api'
import { EVENTS, NOTIFICATION_POLL_MS } from '../utils/constants.js'

/**
 * Tells the notification bell to refresh now, for example after a page marks
 * notifications as read.
 */
export function notifyNotificationsChanged() {
  window.dispatchEvent(new CustomEvent(EVENTS.notificationsChanged))
}

function readCount(result) {
  if (typeof result === 'number') return result
  if (result && typeof result === 'object') {
    return Number(result.count ?? result.unreadCount ?? result.unread ?? 0) || 0
  }
  return 0
}

/**
 * Polls `notificationsApi.unreadCount()` every 30 s while `enabled` and the tab is
 * visible. Also refreshes on `notifyNotificationsChanged()` and when the tab becomes
 * visible again. A failed poll keeps the last known count.
 */
export function useUnreadCount(enabled = true) {
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const result = await notificationsApi.unreadCount()
      setCount(readCount(result))
    } catch {
      /* keep the last known count; the next poll retries */
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    let timer = null
    const tick = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const start = () => {
      clearInterval(timer)
      timer = setInterval(tick, NOTIFICATION_POLL_MS)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh()
        start()
      }
    }
    const first = setTimeout(refresh, 0)
    start()
    window.addEventListener(EVENTS.notificationsChanged, refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      window.removeEventListener(EVENTS.notificationsChanged, refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, refresh])

  return { count: enabled ? count : 0, refresh }
}
