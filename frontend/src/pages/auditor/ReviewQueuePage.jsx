import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { approvalsApi, auditorApi, referenceApi, errorMessage, isConflictError } from '../../api'
import PageHeader from '../../components/PageHeader.jsx'
import SubNav from '../../components/SubNav.jsx'
import FilterBar from '../../components/FilterBar.jsx'
import DataTable from '../../components/DataTable.jsx'
import BulkActionBar from '../../components/BulkActionBar.jsx'
import Button from '../../components/Button.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import InfoBanner from '../../components/InfoBanner.jsx'
import Money from '../../components/Money.jsx'
import Select from '../../components/Select.jsx'
import TextInput from '../../components/TextInput.jsx'
import FlagTag from '../../components/FlagTag.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import { CheckIcon, CornerUpLeftIcon, SearchIcon, XIcon, InboxIcon, AlertTriangleIcon, RefreshIcon } from '../../components/icons.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDebounce } from '../../hooks/useDebounce.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { useToast } from '../../components/toast/useToast.js'
import { formatAge, formatMoney, formatDateTime } from '../../utils/format.js'
import { sumMoney } from '../../utils/money.js'
import ReasonDialog from './aq/ReasonDialog.jsx'
import {
  AGE_OPTIONS,
  BAND_OPTIONS,
  FLAG_OPTIONS,
  QUEUE_DEFAULTS,
  amountSortValue,
  countActiveFilters,
  deriveQueueDetails,
  filtersToParams,
  optionLabel,
  readQueueFilters,
} from './aq/auditorQueue.js'
import './aq/auditor.css'

const TITLE = 'Review queue'
const SUCCESS_HIGHLIGHT_MS = 1600
const AUDITOR_TABS = [
  { id: 'queue', label: 'Review queue', to: '/audit/queue' },
  { id: 'samples', label: 'Sample audit', to: '/audit/samples' },
]

/** A1 + A3: high-value claims waiting for an auditor, with filters and bulk actions. */
export default function ReviewQueuePage() {
  useDocumentTitle(TITLE)
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => readQueueFilters(params), [params])

  // Search is typed locally and written to the URL after a short pause.
  const [search, setSearch] = useState(filters.q)
  const debouncedSearch = useDebounce(search, 300)
  const filtersQ = filters.q

  const setFilters = (patch) => {
    const next = { ...filters, ...patch }
    setParams(filtersToParams(next), { replace: true })
  }

  useEffect(() => {
    // Only write once typing has settled, so a cleared box is never overwritten by a stale value.
    if (debouncedSearch !== search) return
    const trimmed = debouncedSearch.trim()
    if (trimmed === filtersQ) return
    setParams((prev) => filtersToParams({ ...readQueueFilters(prev), q: trimmed }), { replace: true })
  }, [debouncedSearch, search, filtersQ, setParams])

  const clearAll = () => {
    setSearch('')
    setParams({}, { replace: true })
  }

  const departments = useAsync(() => referenceApi.listDepartments(), [])
  const policy = useAsync(() => referenceApi.getCurrentPolicy(), [])
  const threshold = policy.data?.auditorAboveTotal ?? '25000.00'

  const queue = useAsync(
    () =>
      auditorApi.getAuditorQueue({
        amountBand: filters.band,
        departmentId: filters.dept || undefined,
        flag: filters.flag || undefined,
        minAgeHours: filters.age ? Number(filters.age) : undefined,
        q: filters.q || undefined,
      }),
    [filters.band, filters.dept, filters.flag, filters.age, filters.q],
  )
  const items = useMemo(() => queue.data?.items ?? [], [queue.data])
  const idsKey = items.map((i) => i.claimId).join(',')

  // Enrich rows with the manager approval and policy findings (not part of InboxItem).
  const details = useAsync(
    async () => {
      const ids = idsKey ? idsKey.split(',') : []
      const claims = await Promise.all(ids.map((id) => approvalsApi.getReviewClaim(id).catch(() => null)))
      const map = {}
      ids.forEach((id, i) => {
        map[id] = deriveQueueDetails(claims[i])
      })
      return map
    },
    [idsKey],
  )
  const detailMap = useMemo(() => details.data ?? {}, [details.data])

  const [sort, setSort] = useState(null)
  const [selected, setSelected] = useState([])
  const [results, setResults] = useState({}) // claimId -> {ok, error}
  const [dialog, setDialog] = useState(null) // 'approve' | 'sendBack'
  const [busy, setBusy] = useState(false)
  const [dialogKey, setDialogKey] = useState(0)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  // Keep the selection limited to rows still in the list.
  const visibleSelected = useMemo(() => {
    const present = new Set(items.map((i) => i.claimId))
    return selected.filter((id) => present.has(id))
  }, [items, selected])
  const selectedRows = useMemo(() => items.filter((i) => visibleSelected.includes(i.claimId)), [items, visibleSelected])
  const selectedTotal = sumMoney(selectedRows, 'totalAmount')
  const hasResults = Object.keys(results).length > 0
  const activeCount = countActiveFilters(filters)

  const applyResults = (res, verb) => {
    const map = {}
    for (const r of res.results) map[r.claimId] = { ok: r.ok, error: r.error }
    setResults(map)
    const failed = res.results.filter((r) => !r.ok)
    const okCount = res.results.length - failed.length
    setSelected(failed.map((r) => r.claimId))
    if (okCount && failed.length) {
      toast.warning(`${okCount} ${verb}, ${failed.length} could not be processed. See the highlighted rows.`, { title: 'Partly done' })
    } else if (okCount) {
      toast.success(`${okCount} ${okCount === 1 ? 'claim' : 'claims'} ${verb}.`, { title: 'Done' })
    } else {
      toast.error(`None of the ${failed.length} selected claims could be processed. See the reasons in the table.`, { title: 'Nothing processed' })
    }
    clearTimeout(timer.current)
    if (okCount) {
      timer.current = setTimeout(() => {
        setResults((prev) => Object.fromEntries(Object.entries(prev).filter(([, v]) => !v.ok)))
        queue.reload()
      }, SUCCESS_HIGHLIGHT_MS)
    }
  }

  const runBulk = async (kind, comment) => {
    const ids = [...visibleSelected]
    setBusy(true)
    try {
      const res = kind === 'approve' ? await auditorApi.bulkApprove(ids) : await auditorApi.bulkSendBack(ids, comment)
      setDialog(null)
      applyResults(res, kind === 'approve' ? 'approved' : 'sent back')
    } catch (err) {
      if (isConflictError(err)) {
        toast.error('Some claims changed since you loaded the queue. Reload and try again.', { title: 'This claim changed, reload' })
        queue.reload()
      } else {
        toast.error(errorMessage(err), { title: kind === 'approve' ? 'Bulk approve failed' : 'Bulk send back failed' })
      }
    } finally {
      setBusy(false)
    }
  }

  const openDialog = (kind) => {
    setDialogKey((k) => k + 1)
    setDialog(kind)
  }

  const deptOptions = [{ value: '', label: 'All departments' }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]

  const chips = []
  if (filters.band !== 'ALL') chips.push({ key: 'band', label: `Amount: ${optionLabel(BAND_OPTIONS, filters.band)}` })
  if (filters.dept) chips.push({ key: 'dept', label: `Dept: ${optionLabel(deptOptions, filters.dept)}` })
  if (filters.flag) chips.push({ key: 'flag', label: `Flag: ${optionLabel(FLAG_OPTIONS, filters.flag)}` })
  if (filters.age) chips.push({ key: 'age', label: optionLabel(AGE_OPTIONS, filters.age) })
  if (filters.q) chips.push({ key: 'q', label: `Search: “${filters.q}”` })

  const removeChip = (key) => {
    if (key === 'q') {
      setSearch('')
    }
    setFilters({ [key]: QUEUE_DEFAULTS[key] })
  }

  const renderManager = (row) => {
    if (details.loading && !detailMap[row.claimId]) return <Skeleton width={90} height={12} />
    const d = detailMap[row.claimId]
    if (!d?.managerApprovedBy) return <span className="aq-muted-dash">{'—'}</span>
    return (
      <span title={d.managerApprovedAt ? `Approved ${formatDateTime(d.managerApprovedAt)}` : undefined}>
        Manager approved by {d.managerApprovedBy}
        {d.managerOnBehalfOf && <span className="aq-sub">for {d.managerOnBehalfOf}</span>}
      </span>
    )
  }

  const renderFlags = (row) => {
    const d = detailMap[row.claimId]
    const flags = row.flags.filter((f) => f !== 'DELEGATED')
    return (
      <span className="aq-tags">
        {flags.map((f) => (
          <FlagTag key={f} flag={f} />
        ))}
        {d?.needsReview && (
          <span className="aq-review-tag" title="Needs individual review: has policy flags. Bulk approve will skip this claim.">
            <AlertTriangleIcon size={12} aria-hidden="true" /> Needs individual review
          </span>
        )}
        {!flags.length && !d?.needsReview && <span className="aq-muted-dash">{'—'}</span>}
      </span>
    )
  }

  const columns = [
    {
      key: 'claimNumber',
      header: 'Claim no.',
      mobileTitle: true,
      sortable: true,
      render: (row) => (
        <Link
          className="aq-claimno"
          to={`/audit/claims/${row.claimId}`}
          state={{ queueIds: items.map((i) => i.claimId) }}
          onClick={(e) => e.stopPropagation()}
        >
          {row.claimNumber}
        </Link>
      ),
    },
    { key: 'employeeName', header: 'Employee', sortable: true, render: (row) => row.employeeName ?? '—' },
    { key: 'departmentName', header: 'Department', sortable: true },
    { key: 'title', header: 'Title', mobileHidden: false, render: (row) => <span className="truncate" title={row.title}>{row.title}</span> },
    { key: 'lineCount', header: 'Lines', align: 'right', width: '64px' },
    {
      key: 'totalAmount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      sortValue: amountSortValue,
      render: (row) => <Money value={row.totalAmount} strong />,
    },
    {
      key: 'ageHours',
      header: 'Age',
      sortable: true,
      sortValue: (row) => row.ageHours ?? 0,
      render: (row) => <span className={`nowrap${row.overdue ? ' text-danger semibold' : ''}`}>{formatAge(row.ageHours)}</span>,
    },
    { key: 'flags', header: 'Flags', render: renderFlags },
    { key: 'manager', header: 'Manager approval', render: renderManager },
    {
      key: 'delegated',
      header: 'Delegated',
      mobileHidden: true,
      render: (row) =>
        row.delegated ? <FlagTag flag="DELEGATED" title={row.onBehalfOfName ? `Acting for ${row.onBehalfOfName}` : undefined} /> : null,
    },
  ]
  if (hasResults) {
    columns.splice(1, 0, {
      key: 'result',
      header: 'Result',
      render: (row) => {
        const r = results[row.claimId]
        if (!r) return null
        return r.ok ? (
          <span className="aq-result aq-result-ok" role="status">
            <CheckIcon size={14} aria-hidden="true" /> Done
          </span>
        ) : (
          <span className="aq-result aq-result-fail" role="status">
            <XIcon size={14} aria-hidden="true" /> {r.error || 'Failed'}
          </span>
        )
      },
    })
  }

  const filtered = activeCount > 0
  const empty = filtered
    ? {
        icon: <SearchIcon size={28} />,
        title: 'No claims match these filters',
        message: 'Try a wider amount band or clear some filters.',
        action: (
          <Button variant="secondary" onClick={clearAll}>
            Clear all filters
          </Button>
        ),
      }
    : {
        icon: <InboxIcon size={28} />,
        title: 'The review queue is clear',
        message: 'No claim above the auditor threshold is waiting for you right now.',
      }

  return (
    <div className="page page-hero">
      <SubNav ariaLabel="Auditor sections" tabs={AUDITOR_TABS} />
      <PageHeader
        variant="hero"
        eyebrow="Finance audit"
        title={TITLE}
        subtitle={
          <>
            Claims above {formatMoney(threshold, { whole: true })} that a manager has already approved. Claims of{' '}
            {formatMoney(threshold, { whole: true })} or less never reach this queue.
          </>
        }
        meta={
          queue.data ? (
            <span className="chip tone-navy">
              {queue.data.total ?? items.length} waiting for an auditor
            </span>
          ) : null
        }
        actions={
          <Button variant="inverse" icon={<RefreshIcon size={16} />} onClick={queue.reload} loading={queue.loading && !!queue.data}>
            Refresh
          </Button>
        }
      />
      <div className="page-body stack">
        <InfoBanner
          tone="info"
          title="Sample-tagged claims are not in this queue"
          action={
            <Button variant="secondary" size="sm" to="/audit/samples">
              Open Sample audit
            </Button>
          }
        >
          Auto-approved claims picked for random sampling are reviewed only in the Sample audit tab.
        </InfoBanner>

        <FilterBar
          label="Queue filters"
          activeCount={activeCount}
          onClear={clearAll}
          search={
            <TextInput
              label="Search claims"
              hideLabel
              size="sm"
              type="search"
              icon={<SearchIcon size={16} />}
              placeholder="Search claim no., employee, title"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          }
        >
          <div className="aq-filters">
            <Select label="Amount band" size="sm" options={BAND_OPTIONS} value={filters.band} onChange={(e) => setFilters({ band: e.target.value })} />
            <Select
              label="Department"
              size="sm"
              options={deptOptions}
              value={filters.dept}
              disabled={departments.loading && !departments.data}
              onChange={(e) => setFilters({ dept: e.target.value })}
            />
            <Select label="Flag" size="sm" options={FLAG_OPTIONS} value={filters.flag} onChange={(e) => setFilters({ flag: e.target.value })} />
            <Select label="Minimum age" size="sm" options={AGE_OPTIONS} value={filters.age} onChange={(e) => setFilters({ age: e.target.value })} />
          </div>
        </FilterBar>

        {chips.length > 0 && (
          <div className="aq-chips" aria-label="Active filters" role="group">
            {chips.map((c) => (
              <span key={c.key} className="aq-chip">
                {c.label}
                <button type="button" aria-label={`Remove filter ${c.label}`} onClick={() => removeChip(c.key)}>
                  <XIcon size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear all
            </Button>
          </div>
        )}

        <div className="row-between small muted" aria-live="polite">
          <span>
            {queue.data ? `${items.length} ${items.length === 1 ? 'claim' : 'claims'} shown` : ' '}
            {visibleSelected.length > 0 && ` · ${visibleSelected.length} selected`}
          </span>
          <span className="hide-mobile">Rows marked {'“'}Needs individual review{'”'} fail bulk approve; open them instead.</span>
        </div>

        <DataTable
          caption="Claims waiting for an auditor decision"
          columns={columns}
          rows={items}
          rowKey="claimId"
          dense
          selectable
          selectedIds={visibleSelected}
          onSelectionChange={setSelected}
          sort={sort}
          onSortChange={setSort}
          loading={queue.loading}
          error={queue.error}
          onRetry={queue.reload}
          empty={empty}
          onRowClick={(row) => navigate(`/audit/claims/${row.claimId}`, { state: { queueIds: items.map((i) => i.claimId) } })}
          rowLabel={(row) => `Open ${row.claimNumber} from ${row.employeeName}`}
          rowClassName={(row) => (results[row.claimId] ? (results[row.claimId].ok ? 'aq-row-ok' : 'aq-row-fail') : '')}
          skeletonRows={8}
          maxHeight="none"
        />

        <BulkActionBar
          count={visibleSelected.length}
          onClear={() => setSelected([])}
          noun="claim"
          summary={<>total <Money value={selectedTotal} strong /></>}
        >
          <Button variant="secondary" icon={<CornerUpLeftIcon size={16} />} onClick={() => openDialog('sendBack')} disabled={busy}>
            Bulk send back
          </Button>
          <Button icon={<CheckIcon size={16} />} onClick={() => openDialog('approve')} loading={busy && dialog === 'approve'}>
            Bulk approve
          </Button>
        </BulkActionBar>
      </div>

      <ConfirmDialog
        open={dialog === 'approve'}
        title={`Approve ${visibleSelected.length} ${visibleSelected.length === 1 ? 'claim' : 'claims'}?`}
        message={
          <>
            You are approving {visibleSelected.length} {visibleSelected.length === 1 ? 'claim' : 'claims'} worth{' '}
            <Money value={selectedTotal} strong /> in total. Claims with policy flags need individual review and will be skipped with a
            reason; the others will still be approved.
          </>
        }
        confirmLabel="Approve selected"
        loading={busy}
        icon={<CheckIcon size={22} />}
        onConfirm={() => runBulk('approve')}
        onCancel={() => !busy && setDialog(null)}
      />

      <ReasonDialog
        key={dialogKey}
        open={dialog === 'sendBack'}
        title={`Send back ${visibleSelected.length} ${visibleSelected.length === 1 ? 'claim' : 'claims'}`}
        description={
          <>
            The same comment is sent to every employee. Total <Money value={selectedTotal} />.
          </>
        }
        label="Comment"
        hint="Tell the employees what to fix."
        confirmLabel="Send back"
        loading={busy}
        onConfirm={(text) => runBulk('sendBack', text)}
        onCancel={() => !busy && setDialog(null)}
      />
    </div>
  )
}
