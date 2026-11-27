import { useSyncExternalStore } from 'react'
import { getBackendStatus, subscribeBackendStatus } from '../api'

/** Where data is coming from right now: {mode: 'unknown'|'http'|'mock', reason, since}. */
export function useBackendStatus() {
  return useSyncExternalStore(subscribeBackendStatus, getBackendStatus, getBackendStatus)
}
