import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { approvalsApi, errorMessage, isApiError } from '../../api'
import { useAuth } from '../../auth/useAuth.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { useToast } from '../../components/toast/useToast.js'
import PageHeader from '../../components/PageHeader.jsx'
import SubNav from '../../components/SubNav.jsx'
import DataTable from '../../components/DataTable.jsx'
import FilterBar from '../../components/FilterBar.jsx'
import Select from '../../components/Select.jsx'
import Button from '../../components/Button.jsx'
import Money from '../../components/Money.jsx'
import FlagTag from '../../components/FlagTag.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import InfoBanner from '../../components/InfoBanner.jsx'
import { CheckIcon, ClockIcon, SortIcon } from '../../components/icons.jsx'
import { formatAge, formatDate, formatDateTime, stepTypeLabel } from '../../utils/format.js'
import { INBOX_AMOUNT_BANDS, INBOX_STATE_LABEL, INBOX_STATES, inAmountBand, normalizeState } from './inbox/inboxFilters.js'
import './inbox/inbox.css'

const DECISION_META = {
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  SENT_BACK: { label: 'Sent back', tone: 'purple' },
}

const LINE_FLAGS = ['WEEKEND', 'DUPLICATE', 'SOFT_LIMIT']

/** M1 Approvals inbox (managers and the finance head). */
export default function ApprovalInboxPage() {
  const { activeRole } = useAuth()
  const isHead = activeRole === 'FINANCE_HEAD'
  const title = isHead ? 'Approvals: final sign-off above ₹1,00,000' : 'Approvals'
  useDocumentTitle('Approvals')

  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const state = normalizeState(params.get('state'))
  const department = params.get('dept') || 'ALL'
  const band = params.get('band') || 'ALL'
  const isQueue = state === 'PENDING' || state === 'OVERDUE'

  const { data, error, loading, reload } = useAsync(() => approvalsApi.getInbox({ state }), [state])
  const [approving, setApproving] = useState({})
  const [sort, setSort] = useState(null)

  const items = useMemo(() => data?.items ?? [], [data])
  const counts = data?.counts

  const departments = useMemo(() => {
    const names = new Map()
    for (const it of items) if (it.departmentId) names.set(it.departmentId, it.departmentName)
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))
  }, [items])

  const rows = useMemo(
    () => items.filter((it) => (department === 'ALL' || it.departmentId === department) && inAmountBand(it.totalAmount, band)),
    [items, department, band],
  )

  const setParam = (key, value, fallback = 'ALL') => {
    const next = new URLSearchParams(params)
    if (!value || value === fallback) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const clearFilters = () => {
    const next = new URLSearchParams(params)
    next.delete('dept')
    next.delete('band')
    setParams(next, { replace: true })
  }

  const activeFilters = (department !== 'ALL' ? 1 : 0) + (band !== 'ALL' ? 1 : 0)

  const tabHref = (s) => {
    const next = new URLSearchParams(params)
    next.set('state', s)
    return `/approvals?${next.toString()}`
  }

  const tabs = INBOX_STATES.map((s) => ({
    id: s,
    label: INBOX_STATE_LABEL[s],
    count: counts ? counts[s] : undefined,
    to: tabHref(s),
    active: state === s,
  }))

  const quickApprove = async (row) => {
    setApproving((prev) => ({ ...prev, [row.claimId]: true }))
    try {
      await approvalsApi.approve(row.claimId, { version: row.version })
      toast.success(`${row.claimNumber} approved for ${row.employeeName}.`, { title: 'Claim approved' })
      reload()
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        toast.warning(`${row.claimNumber} changed since you opened the inbox. The list has been reloaded.`, { title: 'This claim changed, reload' })
        reload()
      } else {
        toast.error(errorMessage(err), { title: `Could not approve ${row.claimNumber}` })
      }
    } finally {
      setApproving((prev) => {
        const next = { ...prev }
        delete next[row.claimId]
        return next
      })
    }
  }

  const columns = [
    {
      key: 'claimNumber',
      header: 'Claim',
      mobileTitle: true,
      sortable: true,
      render: (r) => (
        <span>
          <Link className="inbox-claim-link" to={`/approvals/${r.claimId}`}>
            {r.claimNumber}
          </Link>
          <span className="inbox-title" title={r.title}>
            {r.title}
          </span>
        </span>
      ),
    },
    {
      key: 'employeeName',
      header: 'Employee',
      sortable: true,
      render: (r) => (
        <span>
          {r.employeeName}
          {r.delegated && <span className="inbox-behalf">On behalf of {r.onBehalfOfName}</span>}
        </span>
      ),
    },
    { key: 'departmentName', header: 'Department', sortable: true },
    {
      key: 'totalAmount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (r) => <Money value={r.totalAmount} strong />,
    },
    {
      key: 'stepType',
      header: 'Step',
      render: (r) => <span className="muted">{stepTypeLabel(r.stepType)}</span>,
    },
    isQueue
      ? {
          key: 'pendingSince',
          header: 'Age',
          sortable: true,
          sortValue: (r) => r.pendingSince,
          mobileLabel: 'Waiting',
          render: (r) => (
            <span className="inbox-age" title={`Waiting since ${formatDateTime(r.pendingSince)}`}>
              {formatAge(r.ageHours)}
              {r.overdue && <FlagTag flag="OVERDUE" />}
            </span>
          ),
        }
      : {
          key: 'decidedAt',
          header: state === 'SENT_BACK' ? 'Sent back' : 'Decision',
          sortable: true,
          render: (r) => (
            <span className="inbox-age">
              {r.decision && <StatusChip status={r.decision} meta={DECISION_META} size="sm" />}
              <span className="muted">{formatDate(r.decidedAt)}</span>
            </span>
          ),
        },
    {
      key: 'flags',
      header: 'Flags',
      render: (r) => {
        const flags = (r.flags || []).filter((f) => LINE_FLAGS.includes(f) || f === 'DELEGATED')
        if (!flags.length) return <span className="muted">—</span>
        return (
          <span className="inbox-flags">
            {flags.map((f) => (
              <FlagTag key={f} flag={f} title={f === 'DELEGATED' && r.onBehalfOfName ? `On behalf of ${r.onBehalfOfName}` : undefined} />
            ))}
          </span>
        )
      },
    },
  ]

  if (isQueue) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      mobileLabel: '',
      render: (r) => (
        <Button
          size="sm"
          variant="secondary"
          icon={<CheckIcon size={14} />}
          loading={Boolean(approving[r.claimId])}
          loadingLabel={`Approving ${r.claimNumber}`}
          onClick={() => quickApprove(r)}
          aria-label={`Approve ${r.claimNumber} (${r.employeeName})`}
        >
          Approve
        </Button>
      ),
    })
  }

  const isDefaultSort = !sort
  const sortLabel = isQueue ? 'Oldest first' : 'Newest first'

  const empty = isQueue
    ? {
        title: "You're all caught up",
        message:
          activeFilters > 0
            ? 'No claims match these filters. Clear them to see everything waiting for you.'
            : state === 'OVERDUE'
              ? 'Nothing is overdue. Nice work keeping the queue moving.'
              : 'No claims are waiting for your decision right now.',
        icon: <CheckIcon size={32} />,
        action: activeFilters > 0 ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : undefined,
      }
    : {
        title: state === 'SENT_BACK' ? 'Nothing sent back' : 'No decisions yet',
        message: state === 'SENT_BACK' ? 'Claims you send back for changes appear here.' : 'Claims you approve or reject appear here.',
      }

  return (
    <div className="page page-hero">
      <PageHeader
        variant="hero"
        eyebrow={isHead ? 'Finance head' : 'Line manager'}
        title={title}
        subtitle={
          isHead
            ? 'Claims above ₹1,00,000 that passed the manager and auditor, oldest first.'
            : 'Claims waiting for your decision, oldest first. Flags never block approval.'
        }
        meta={
          counts ? (
            <span className="row row-sm">
              <ClockIcon size={16} /> {counts.PENDING} pending · {counts.OVERDUE} overdue
            </span>
          ) : null
        }
      />
      <SubNav tabs={tabs} ariaLabel="Inbox" />
      <div className="page-body stack">
        {isHead && (
          <InfoBanner tone="info" title="When a claim needs your sign-off">
            Only claims with a total strictly above ₹1,00,000 reach you. A claim of exactly ₹1,00,000 is completed by the auditor.
            <span className="inbox-chain" aria-label="Approval chain">
              <span className="inbox-chain-step">Manager</span>
              <span aria-hidden="true">→</span>
              <span className="inbox-chain-step">Auditor</span>
              <span aria-hidden="true">→</span>
              <span className="inbox-chain-step is-current">Finance head (you)</span>
            </span>
          </InfoBanner>
        )}

        <FilterBar activeCount={activeFilters} onClear={clearFilters} label="Inbox filters">
          <div className="inbox-filters-row">
            <Select
              label="Department"
              size="sm"
              value={department}
              onChange={(e) => setParam('dept', e.target.value)}
              options={[{ value: 'ALL', label: 'All departments' }, ...departments]}
            />
            <Select
              label="Amount"
              size="sm"
              value={band}
              onChange={(e) => setParam('band', e.target.value)}
              options={INBOX_AMOUNT_BANDS}
            />
          </div>
        </FilterBar>

        <div className="inbox-toolbar">
          <p className="muted" aria-live="polite">
            {loading && !data ? 'Loading claims…' : `${rows.length} ${rows.length === 1 ? 'claim' : 'claims'} in ${INBOX_STATE_LABEL[state].toLowerCase()}`}
          </p>
          <span className="inbox-sort-indicator">
            <SortIcon size={14} />
            {isDefaultSort ? `Sorted: ${sortLabel}` : 'Custom sort'}
            {!isDefaultSort && (
              <button type="button" className="inbox-sort-reset" onClick={() => setSort(null)}>
                Reset to {sortLabel.toLowerCase()}
              </button>
            )}
          </span>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => `${r.claimId}:${r.stepId}`}
          sort={sort}
          onSortChange={setSort}
          loading={loading}
          error={error}
          onRetry={reload}
          empty={empty}
          dense
          onRowClick={(r) => navigate(`/approvals/${r.claimId}`)}
          rowLabel={(r) => `Open ${r.claimNumber} from ${r.employeeName}`}
          rowClassName={(r) => (r.overdue ? 'is-overdue' : '')}
          caption={`${INBOX_STATE_LABEL[state]} approvals, ${isDefaultSort ? sortLabel.toLowerCase() : 'custom sort'}`}
          skeletonRows={6}
        />
      </div>
    </div>
  )
}
