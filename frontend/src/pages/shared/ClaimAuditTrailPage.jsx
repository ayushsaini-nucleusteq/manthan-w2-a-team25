import { useId, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { claimsApi } from '../../api'
import { useAuth } from '../../auth/useAuth.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import PageHeader from '../../components/PageHeader.jsx'
import Card from '../../components/Card.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Skeleton, { SkeletonText } from '../../components/Skeleton.jsx'
import Select from '../../components/Select.jsx'
import Spinner from '../../components/Spinner.jsx'
import Money from '../../components/Money.jsx'
import { ArrowRightIcon, ChevronDownIcon, FileTextIcon, Icon, ShieldIcon } from '../../components/icons.jsx'
import { formatDateTime, formatRelative } from '../../utils/format.js'
import { auditActionMeta, changeRows, claimCrumbs, extraDetails, fieldLabel, formatAuditValue } from './shared-screens/helpers.js'
import './shared-screens/shared.css'

function ChangesTable({ rows, id }) {
  return (
    <div className="diff-wrap" id={id}>
      <table className="diff-table">
        <caption className="sr-only">What changed</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{fieldLabel(r.field)}</th>
              <td>
                <span className="diff-from">{formatAuditValue(r.field, r.from)}</span>
              </td>
              <td>
                <span className="diff-to">{formatAuditValue(r.field, r.to)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AuditEntry({ event }) {
  const meta = auditActionMeta(event.action)
  const rows = changeRows(event.details)
  const extras = extraDetails(event.details)
  const [open, setOpen] = useState(false)
  const diffId = useId()
  const actor = event.actorName || 'System'

  return (
    <li className="atrail-item">
      <span className={`atrail-dot tone-bg-${meta.tone}`} aria-hidden="true">
        <Icon name={meta.icon} size={18} />
      </span>
      <article className="atrail-card" aria-label={`${meta.label}, ${formatDateTime(event.occurredAt)}`}>
        <div className="atrail-head">
          <h3 className="atrail-action">{meta.label}</h3>
          <time className="atrail-time" dateTime={event.occurredAt} title={formatRelative(event.occurredAt)}>
            {formatDateTime(event.occurredAt)}
          </time>
        </div>
        <p className="atrail-actor">
          by <strong>{actor}</strong>
          {event.onBehalfOfName && (
            <>
              {' '}on behalf of <strong>{event.onBehalfOfName}</strong>
            </>
          )}
        </p>
        {(event.fromStatus || event.toStatus) && (
          <div className="atrail-status">
            <span className="sr-only">Status</span>
            {event.fromStatus && <StatusChip status={event.fromStatus} size="sm" dot={false} />}
            {event.fromStatus && event.toStatus && (
              <>
                <ArrowRightIcon size={14} className="muted" aria-hidden="true" />
                <span className="sr-only">to</span>
              </>
            )}
            {event.toStatus && <StatusChip status={event.toStatus} size="sm" />}
          </div>
        )}
        {event.comment && <p className="atrail-comment">{event.comment}</p>}
        {extras.length > 0 && (
          <dl className="atrail-details">
            {extras.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{fieldLabel(k)}</dt>
                <dd>{formatAuditValue(k, v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {rows.length > 0 && (
          <>
            <button type="button" className="atrail-toggle" aria-expanded={open} aria-controls={diffId} onClick={() => setOpen((o) => !o)}>
              What changed ({rows.length})
              <ChevronDownIcon size={16} aria-hidden="true" />
            </button>
            {open && <ChangesTable rows={rows} id={diffId} />}
          </>
        )}
      </article>
    </li>
  )
}

function TrailSkeleton() {
  return (
    <div className="stack" role="status" aria-label="Loading audit trail">
      {[0, 1, 2].map((i) => (
        <div key={i} className="atrail-item" aria-hidden="true">
          <Skeleton circle width={40} height={40} />
          <div className="atrail-card">
            <Skeleton width="45%" height={16} />
            <SkeletonText lines={2} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * S3 Audit trail (US17): who acted, when, what changed. Read-only and append-only.
 * The API returns 404 when the viewer may not see the claim (e.g. another employee's), shown as "Not found".
 */
export default function ClaimAuditTrailPage() {
  const { id } = useParams()
  const { activeRole } = useAuth()
  const [order, setOrder] = useState('desc')

  const { data, error, loading, reload } = useAsync(
    () => Promise.all([claimsApi.getClaim(id), claimsApi.getAuditTrail(id)]).then(([claim, events]) => ({ claim, events })),
    [id],
  )
  const claim = data?.claim
  const events = useMemo(() => {
    const list = [...(data?.events || [])]
    list.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || (a.id > b.id ? 1 : a.id < b.id ? -1 : 0))
    return order === 'desc' ? list.reverse() : list
  }, [data, order])

  useDocumentTitle(claim ? `Audit trail · ${claim.claimNumber}` : 'Audit trail')
  const crumbs = claimCrumbs(activeRole, id, claim?.claimNumber)

  if (error && !data) {
    return (
      <div className="page">
        <div className="page-body stack-lg">
          <PageHeader title="Audit trail" breadcrumbs={crumbs} />
          <ErrorState error={error} title="We couldn't load the audit trail" onRetry={reload} />
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-body stack-lg">
        <PageHeader
          title="Audit trail"
          eyebrow={claim ? claim.claimNumber : undefined}
          subtitle={claim ? claim.title : 'Every change made to this claim.'}
          breadcrumbs={crumbs}
          meta={
            <span className="atrail-summary">
              <span className="ro-badge">
                <ShieldIcon size={14} aria-hidden="true" />
                Read-only, append-only
              </span>
              {claim && <StatusChip status={claim.status} />}
              {claim && claim.totalAmount != null && (
                <span className="small">
                  Total <Money value={claim.totalAmount} strong />
                </span>
              )}
              {claim?.employeeName && <span className="small muted">Claimant: {claim.employeeName}</span>}
            </span>
          }
        />

        <Card
          title="Activity"
          subtitle={data ? `${events.length} recorded ${events.length === 1 ? 'event' : 'events'}. Entries can't be edited or deleted.` : undefined}
          headingLevel={2}
          actions={
            <div className="row-sm">
              {loading && data && <Spinner size="sm" label="Refreshing" />}
              <Select
                label="Order"
                hideLabel
                value={order}
                onChange={(e) => setOrder(e.target.value)}
                options={[
                  { value: 'desc', label: 'Newest first' },
                  { value: 'asc', label: 'Oldest first' },
                ]}
              />
            </div>
          }
        >
          {!data ? (
            <TrailSkeleton />
          ) : events.length === 0 ? (
            <EmptyState compact icon={<FileTextIcon size={24} />} title="No activity recorded yet" message="Changes to this claim will appear here as they happen." />
          ) : (
            <ol className="atrail" aria-label="Audit trail entries">
              {events.map((e) => (
                <AuditEntry key={e.id} event={e} />
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  )
}
