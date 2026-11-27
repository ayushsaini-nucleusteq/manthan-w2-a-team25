import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { useUnreadCount } from '../hooks/useUnreadCount.js'
import { BellIcon } from './icons.jsx'

/**
 * Bell linking to /notifications with an unread badge. Polls the unread count
 * every 30 s (and refreshes on `notifyNotificationsChanged()`).
 */
export default function NotificationBell() {
  const { isAuthenticated } = useAuth()
  const { count } = useUnreadCount(isAuthenticated)
  const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications'
  return (
    <NavLink to="/notifications" className={({ isActive }) => `icon-btn bell${isActive ? ' is-active' : ''}`} aria-label={label} title={label}>
      <BellIcon size={22} />
      {count > 0 && (
        <span className="bell-badge num" key={count} aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </NavLink>
  )
}
