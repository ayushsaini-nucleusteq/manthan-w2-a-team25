import { useSyncExternalStore } from 'react'

function subscribe(callback) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

const getSnapshot = () => navigator.onLine
const getServerSnapshot = () => true

/** `true` while the browser reports a network connection. */
export function useOnlineStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
