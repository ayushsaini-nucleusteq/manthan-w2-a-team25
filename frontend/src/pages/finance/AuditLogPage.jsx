import { Fragment, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { auditApi } from '../../api'
import PageHeader from '../../components/PageHeader.jsx'
import FilterBar from '../../components/FilterBar.jsx'
import TextInput from '../../components/TextInput.jsx'
import Select from '../../components/Select.jsx'
import DateInput from '../../components/DateInput.jsx'
import Button from '../../components/Button.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import { ArrowRightIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, FileTextIcon, SearchIcon, ShieldIcon } from '../../components/icons.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDebounce } from '../../hooks/useDebounce.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { useIsMobile } from '../../hooks/useMediaQuery.js'
import { PAYOUT_STATUS_META, STATUS_META } from '../../utils/constants.js'
import { formatDateTime, formatNumber, humanize, todayISO } from '../../utils/format.js'
import AuditDetails from './f1f6/AuditDetails.jsx'
import './f1f6/finance-f1f6.css'

const TITLE = 'Audit log'
const PAGE_SIZES = [25, 50, 100]
const EMPTY_FILTERS = { claim: '', actor: '', action: 'ALL', entityType: 'ALL', from: '', to: '' }

/** F6: global, read-only, append-only audit log with search and filters (US17). */
export default function AuditLogPage() {
  useDocumentTitle(TITLE)
  const [params] = useSearchParams()
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, claim: params.get('claim') ?? '' }))
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [expanded, setExpanded] = useState(() => new Set())
  const mobile = useIsMobile()

  const claimQ = useDebounce(filters.claim.trim(), 350)
  const actorQ = useDebounce(filters.actor.trim(), 350)
  const rangeError = filters.from && filters.to && filters.from > filters.to ? 'End date must be on or after the start date.' : null

  const options = useAsync(() => auditApi.listAuditFilterOptions(), [])
  const { data, error, loading, reload } = useAsync(
    () =>
      auditApi.listAuditEvents({
        ...claimFilter(claimQ),
        actorQ: actorQ || undefined,
        action: filters.action,
        entityType: filters.entityType,
        from: filters.from || undefined,
        to: rangeError ? undefined : filters.to || undefined,
        page,
        pageSize,
      }),
    [claimQ, actorQ, filters.action, filters.entityType, filters.from, filters.to, rangeError, page, pageSize],
  )

  const update = (key) => (e) => {
    const value = e.target.value
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(1)
  }
  const clearAll = () => {
    setFilters(EMPTY_FILTERS)
    setPage(1)
  }
  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const activeCount = Object.keys(EMPTY_FILTERS).filter((k) => filters[k] !== EMPTY_FILTERS[k]).length
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const start = total ? (page - 1) * pageSize + 1 : 0
  const end = Math.min(total, page * pageSize)

  const actionOptions = [{ value: 'ALL', label: 'All actions' }, ...(options.data?.actions ?? []).map((a) => ({ value: a, label: humanize(a) }))]
  const entityOptions = [{ value: 'ALL', label: 'All entities' }, ...(options.data?.entityTypes ?? []).map((t) => ({ value: t, label: humanize(t) }))]

  let content
  if (error && !data) {
    content = <ErrorState error={error} onRetry={reload} title="We couldn't load the audit log" />
  } else if (loading && !data) {
    content = <AuditSkeleton />
  } else if (!items.length) {
    content = (
      <div className="card card-pad">
        <EmptyState
          icon={<FileTextIcon size={32} />}
          title={activeCount ? 'No entries match these filters' : 'No audit entries yet'}
          message={activeCount ? 'Try a wider date range or clear some filters.' : 'Every state change will be recorded here.'}
          action={activeCount ? <Button variant="secondary" onClick={clearAll}>Clear all filters</Button> : null}
        />
      </div>
    )
  } else if (mobile) {
    content = (
      <ul className={`fx-audit-cards${loading ? ' fx-reloading' : ''}`} aria-label="Audit entries">
        {items.map((e) => {
          const open = expanded.has(e.id)
          const detailId = `audit-detail-${e.id}`
          return (
            <li key={e.id} className="card fx-audit-card">
              <div className="fx-audit-card-head">
                <span className="fx-action">{humanize(e.action)}</span>
                <time className="muted fx-small" dateTime={e.occurredAt}>{formatDateTime(e.occurredAt)}</time>
              </div>
              <p className="fx-small">
                <strong>{e.actorName ?? 'System'}</strong>
                {e.onBehalfOfName && <span className="muted"> on behalf of {e.onBehalfOfName}</span>}
              </p>
              <p className="fx-small muted">
                {humanize(e.entityType)} {e.claimId && <ClaimLink event={e} />}
              </p>
              <Transition event={e} />
              {e.comment && <p className="fx-comment">&ldquo;{e.comment}&rdquo;</p>}
              <button type="button" className="fx-expand" aria-expanded={open} aria-controls={detailId} onClick={() => toggle(e.id)}>
                <ChevronDownIcon size={16} className={open ? 'is-open' : undefined} />
                {open ? 'Hide details' : 'Show details'}
              </button>
              {open && (
                <div id={detailId}>
                  <AuditDetails event={e} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    )
  } else {
    content = (
      <div className="dtable-wrap is-dense fx-audit-table" aria-busy={loading || undefined}>
        <table className={`dtable${loading ? ' is-reloading' : ''}`}>
          <caption className="sr-only">Audit log entries, newest first. Expand a row to see its details.</caption>
          <thead>
            <tr>
              <th scope="col" className="fx-col-expand">
                <span className="sr-only">Details</span>
              </th>
              <th scope="col">Time</th>
              <th scope="col">Actor</th>
              <th scope="col">On behalf of</th>
              <th scope="col">Action</th>
              <th scope="col">Entity</th>
              <th scope="col">Claim</th>
              <th scope="col">From &rarr; to</th>
              <th scope="col">Comment</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => {
              const open = expanded.has(e.id)
              const detailId = `audit-detail-${e.id}`
              return (
                <Fragment key={e.id}>
                  <tr className={open ? 'is-selected' : undefined}>
                    <td className="fx-col-expand">
                      <button
                        type="button"
                        className="fx-expand-btn"
                        aria-expanded={open}
                        aria-controls={open ? detailId : undefined}
                        aria-label={`${open ? 'Hide' : 'Show'} details for ${humanize(e.action)} at ${formatDateTime(e.occurredAt)}`}
                        onClick={() => toggle(e.id)}
                      >
                        <ChevronRightIcon size={16} className={open ? 'is-open' : undefined} />
                      </button>
                    </td>
                    <td className="fx-nowrap">
                      <time dateTime={e.occurredAt}>{formatDateTime(e.occurredAt)}</time>
                    </td>
                    <td>{e.actorName ?? <span className="muted">System</span>}</td>
                    <td>{e.onBehalfOfName ?? <span className="muted">&mdash;</span>}</td>
                    <td>
                      <span className="fx-action">{humanize(e.action)}</span>
                    </td>
                    <td className="fx-small">{humanize(e.entityType)}</td>
                    <td className="fx-nowrap">{e.claimId ? <ClaimLink event={e} /> : <span className="muted">&mdash;</span>}</td>
                    <td>
                      <Transition event={e} />
                    </td>
                    <td className="fx-comment-cell" title={e.comment ?? undefined}>
                      {e.comment ?? <span className="muted">&mdash;</span>}
                    </td>
                  </tr>
                  {open && (
                    <tr className="fx-detail-row">
                      <td colSpan={9} id={detailId}>
                        <AuditDetails event={e} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title={TITLE}
        subtitle="Append-only record of every state change across ExpenseFlow."
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: TITLE }]}
        meta={
          <span className="fx-readonly-badge">
            <ShieldIcon size={14} aria-hidden="true" />
            Read-only: entries cannot be edited or deleted
          </span>
        }
      />
      <div className="page-body fx-audit">
        <FilterBar
          label="Audit log filters"
          activeCount={activeCount}
          onClear={clearAll}
          search={
            <TextInput
              label="Claim number or ID"
              size="sm"
              icon={<SearchIcon size={16} />}
              placeholder="CL-000123 or EXP-2026-000123"
              value={filters.claim}
              onChange={update('claim')}
              autoComplete="off"
            />
          }
        >
          <TextInput label="Actor" size="sm" placeholder="Name or employee code" value={filters.actor} onChange={update('actor')} autoComplete="off" />
          <Select label="Action" size="sm" value={filters.action} onChange={update('action')} options={actionOptions} />
          <Select label="Entity type" size="sm" value={filters.entityType} onChange={update('entityType')} options={entityOptions} />
          <DateInput label="From" size="sm" value={filters.from} max={filters.to || todayISO()} onChange={update('from')} />
          <DateInput label="To" size="sm" value={filters.to} min={filters.from || undefined} max={todayISO()} onChange={update('to')} error={rangeError} />
        </FilterBar>

        <p className="fx-result-count muted" role="status" aria-live="polite">
          {loading && data ? 'Updating…' : data ? (total ? `Showing ${formatNumber(start)}–${formatNumber(end)} of ${formatNumber(total)} entries` : 'No entries') : 'Loading entries…'}
        </p>

        {error && data && (
          <ErrorState error={error} onRetry={reload} compact title="The latest update failed" />
        )}

        {content}

        {total > 0 && (
          <nav className="fx-pager" aria-label="Audit log pages">
            <Select
              label="Rows per page"
              size="sm"
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
              }}
              options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
            />
            <div className="fx-pager-buttons">
              <Button variant="secondary" size="sm" icon={<ChevronLeftIcon size={16} />} disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <span className="fx-small" aria-current="page">
                Page {formatNumber(page)} of {formatNumber(pageCount)}
              </span>
              <Button variant="secondary" size="sm" iconRight={<ChevronRightIcon size={16} />} disabled={page >= pageCount || loading} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                Next
              </Button>
            </div>
          </nav>
        )}
      </div>
    </div>
  )
}

function claimFilter(q) {
  if (!q) return {}
  return /^(exp|cl)-/i.test(q) ? { claimNumber: q } : { claimId: q }
}

function ClaimLink({ event }) {
  return (
    <Link to={`/claims/${encodeURIComponent(event.claimId)}/audit`} className="mono fx-small">
      {event.claimNumber ?? 'View claim'}
    </Link>
  )
}

function Transition({ event }) {
  const { fromStatus, toStatus, entityType } = event
  if (!fromStatus && !toStatus) return <span className="muted">&mdash;</span>
  const meta = entityType === 'PAYOUT_BATCH' ? PAYOUT_STATUS_META : STATUS_META
  return (
    <span className="fx-transition">
      {fromStatus ? <StatusChip status={fromStatus} meta={meta} size="sm" dot={false} /> : <span className="muted fx-small">New</span>}
      <ArrowRightIcon size={12} aria-hidden="true" />
      <span className="sr-only">to</span>
      {toStatus ? <StatusChip status={toStatus} meta={meta} size="sm" dot={false} /> : <span className="muted fx-small">&mdash;</span>}
    </span>
  )
}

function AuditSkeleton() {
  return (
    <div className="card fx-audit-skeleton" aria-busy="true">
      <span className="sr-only">Loading audit entries…</span>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="fx-audit-skel-row" aria-hidden="true">
          <Skeleton width={110} height={12} />
          <Skeleton width={120} height={12} />
          <Skeleton width={140} height={12} />
          <Skeleton width="30%" height={12} />
        </div>
      ))}
    </div>
  )
}
