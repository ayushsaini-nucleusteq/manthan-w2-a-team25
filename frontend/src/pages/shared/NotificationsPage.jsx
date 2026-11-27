import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { notificationsApi, errorMessage } from '../../api'
import { useAuth } from '../../auth/useAuth.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { notifyNotificationsChanged } from '../../hooks/useUnreadCount.js'
import { useToast } from '../../components/toast/useToast.js'
import PageHeader from '../../components/PageHeader.jsx'
import Tabs from '../../components/Tabs.jsx'
import Button from '../../components/Button.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import Spinner from '../../components/Spinner.jsx'
import { BellIcon, CheckIcon, Icon } from '../../components/icons.jsx'
import { NOTIFICATION_TYPE_META } from '../../utils/constants.js'
import { formatDateTime, formatRelative } from '../../utils/format.js'
import { notificationTarget } from './shared-screens/helpers.js'
import './shared-screens/shared.css'

const TAB_PREFIX = 'notif-tabs'

function NotificationSkeleton() {
  return (
    <div className="stack-sm" role="status" aria-label="Loading notifications">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="notif-skel" aria-hidden="true">
          <Skeleton circle width={40} height={40} />
          <div className="grow stack-sm">
            <Skeleton width="40%" height={14} />
            <Skeleton width="85%" height={12} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** S2 Notifications: All / Unread, click to open (marks read), mark all as read. */
export default function NotificationsPage() {
  useDocumentTitle('Notifications')
  const navigate = useNavigate()
  const toast = useToast()
  const { activeRole, hasRole } = useAuth()
  const [tab, setTab] = useState('all')
  const [openingId, setOpeningId] = useState(null)
  const [markingAll, setMarkingAll] = useState(false)

  const { data, error, loading, reload, setData } = useAsync(() => notificationsApi.listNotifications({}), [])
  const all = useMemo(() => data || [], [data])
  const unread = useMemo(() => all.filter((n) => !n.readAt), [all])
  const visible = tab === 'unread' ? unread : all

  const tabs = [
    { id: 'all', label: 'All', count: data ? all.length : undefined },
    { id: 'unread', label: 'Unread', count: data ? unread.length : undefined },
  ]

  async function openNotification(n) {
    const target = notificationTarget(n, { activeRole, hasRole })
    if (!n.readAt) {
      setOpeningId(n.id)
      try {
        const updated = await notificationsApi.markRead(n.id)
        setData((prev) => (prev || []).map((x) => (x.id === n.id ? { ...x, readAt: updated?.readAt || new Date().toISOString() } : x)))
        notifyNotificationsChanged()
      } catch (err) {
        toast.error(errorMessage(err, 'Could not mark the notification as read.'))
      } finally {
        setOpeningId(null)
      }
    }
    if (target) navigate(target)
    else if (n.readAt) toast.info('This notification has nothing more to open.')
  }

  async function markAll() {
    setMarkingAll(true)
    try {
      const { updated } = await notificationsApi.markAllRead()
      const now = new Date().toISOString()
      setData((prev) => (prev || []).map((x) => (x.readAt ? x : { ...x, readAt: now })))
      notifyNotificationsChanged()
      toast.success(updated ? `Marked ${updated} notification${updated === 1 ? '' : 's'} as read.` : 'Everything was already read.')
    } catch (err) {
      toast.error(errorMessage(err, 'Could not mark notifications as read.'), { title: 'Mark all as read failed' })
    } finally {
      setMarkingAll(false)
    }
  }

  let body
  if (error && !data) {
    body = <ErrorState error={error} title="We couldn't load your notifications" onRetry={reload} />
  } else if (!data) {
    body = <NotificationSkeleton />
  } else if (!visible.length) {
    body = (
      <EmptyState
        icon={<BellIcon size={28} />}
        title={tab === 'unread' ? "You're all caught up" : 'No notifications yet'}
        message={
          tab === 'unread'
            ? 'There are no unread notifications. New approvals, send-backs and payouts will show up here.'
            : 'When something happens on your claims or approvals, we will let you know here.'
        }
        action={tab === 'unread' && all.length ? <Button variant="secondary" onClick={() => setTab('all')}>Show all notifications</Button> : undefined}
      />
    )
  } else {
    body = (
      <ul className="notif-list" aria-busy={loading || undefined}>
        {visible.map((n) => {
          const meta = NOTIFICATION_TYPE_META[n.type] || { label: 'Update', icon: 'bell', tone: 'neutral' }
          const isUnread = !n.readAt
          const busy = openingId === n.id
          return (
            <li key={n.id}>
              <button
                type="button"
                className={`notif-item${isUnread ? ' is-unread' : ''}`}
                onClick={() => openNotification(n)}
                disabled={busy}
                aria-label={`${isUnread ? 'Unread. ' : ''}${meta.label}: ${n.title}. ${formatRelative(n.createdAt)}.`}
              >
                <span className={`notif-icon tone-bg-${meta.tone}`} aria-hidden="true">
                  {busy ? <Spinner size="sm" label="Opening" /> : <Icon name={meta.icon} size={20} />}
                </span>
                <span className="notif-body">
                  <span className="notif-head">
                    <span className="notif-title">
                      {isUnread && <span className="notif-unread-dot" aria-hidden="true" />}
                      {n.title}
                    </span>
                    <time className="notif-time" dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
                      {formatRelative(n.createdAt)}
                    </time>
                  </span>
                  {n.message && <span className="notif-message">{n.message}</span>}
                  <span className={`chip chip-sm tone-${meta.tone}`} style={{ alignSelf: 'flex-start' }}>
                    {meta.label}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="page">
      <div className="page-body stack-lg">
        <PageHeader
          title="Notifications"
          subtitle="Updates on your claims, approvals and payouts."
          breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Notifications' }]}
          actions={
            <Button
              variant="secondary"
              icon={<CheckIcon size={18} />}
              onClick={markAll}
              loading={markingAll}
              loadingLabel="Marking all as read…"
              disabled={!unread.length || markingAll}
            >
              Mark all as read
            </Button>
          }
        />
        <div className="notif-toolbar">
          <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Filter notifications" idPrefix={TAB_PREFIX} />
          {loading && data && <Spinner size="sm" label="Refreshing" showLabel />}
        </div>
        <div role="tabpanel" id={`${TAB_PREFIX}-panel-${tab}`} aria-labelledby={`${TAB_PREFIX}-tab-${tab}`} tabIndex={-1}>
          {body}
        </div>
      </div>
    </div>
  )
}
