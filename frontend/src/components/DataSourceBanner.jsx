import { useAuth } from '../auth/useAuth.js'
import { useBackendStatus } from '../hooks/useBackendStatus.js'
import InfoBanner from './InfoBanner.jsx'

/**
 * Shown under the navbar when the app is running on demo (mock) data because the server
 * did not answer, either at sign-in or partway through the session.
 */
export default function DataSourceBanner() {
  const { session } = useAuth()
  const status = useBackendStatus()
  if (!session || session.source === 'http') return null
  const fellBack = Boolean(session.fallbackFrom) || status.mode === 'mock'
  return (
    <div className="offline-banner">
      <InfoBanner tone="warning" title="Showing demo data" live={fellBack}>
        {session.fallbackFrom
          ? `The server stopped responding, so you are now seeing sample data as ${session.user?.fullName || 'a demo user'}. Changes stay in this browser; sign out and back in to reconnect.`
          : 'The server is not connected, so ExpenseFlow is using sample data. Changes stay in this browser.'}
      </InfoBanner>
    </div>
  )
}
