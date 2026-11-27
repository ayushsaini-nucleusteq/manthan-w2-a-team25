import { useOnlineStatus } from '../hooks/useOnlineStatus.js'
import InfoBanner from './InfoBanner.jsx'

/** Shown under the navbar while `navigator.onLine` is false. */
export default function OfflineBanner() {
  const online = useOnlineStatus()
  if (online) return null
  return (
    <div className="offline-banner">
      <InfoBanner tone="offline" title="You're offline" live>
        Changes can't be sent until your connection is back. Drafts you are editing stay on this device.
      </InfoBanner>
    </div>
  )
}
