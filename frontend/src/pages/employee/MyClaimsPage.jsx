import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { claimsApi } from '../../api'
import PageHeader from '../../components/PageHeader.jsx'
import Button from '../../components/Button.jsx'
import DataTable from '../../components/DataTable.jsx'
import TextInput from '../../components/TextInput.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import Money from '../../components/Money.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import { FlagList } from '../../components/FlagTag.jsx'
import { EditIcon, PlusIcon, ReceiptIcon, SearchIcon, XIcon } from '../../components/icons.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDebounce } from '../../hooks/useDebounce.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { STATUS_META, STATUS_ORDER } from '../../utils/constants.js'
import { formatDateTime, formatRelative, pluralize } from '../../utils/format.js'
import { CONTINUE_STATUSES, employeeFlags } from './emp-view/claimView.js'
import './emp-view/employee-view.css'

const TITLE = 'My claims'

/** E1: the employee's own claims with status filters, search and a responsive list. */
export default function MyClaimsPage() {
  useDocumentTitle(TITLE)
  const [statuses, setStatuses] = useState([])
  const [query, setQuery] = useState('')
  const q = useDebounce(query.trim(), 300)
  const statusKey = statuses.join(',')

  const { data, error, loading, reload } = useAsync(
    () => claimsApi.listMyClaims({ status: statusKey ? statusKey.split(',') : undefined, q: q || undefined }),
    [statusKey, q],
  )

  const items = useMemo(() => data?.items ?? [], [data])
  const counts = data?.statusCounts
  const filtered = statuses.length > 0 || Boolean(q)

  const toggleStatus = (s) =>
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : STATUS_ORDER.filter((x) => x === s || prev.includes(x))))
  const clearFilters = () => {
    setStatuses([])
    setQuery('')
  }

  const columns = useMemo(
    () => [
      {
        key: 'claimNumber',
        header: 'Claim',
        width: '170px',
        mobileTitle: true,
        sortable: true,
        render: (row) => (
          <span className="emp-claim-cell">
            <Link to={`/claims/${row.id}`} className="emp-claim-link">
              {row.claimNumber}
            </Link>
            <span className="emp-claim-title-sm">{row.title}</span>
          </span>
        ),
      },
      {
        key: 'title',
        header: 'Title',
        mobileHidden: true,
        sortable: true,
        render: (row) => (
          <span className="emp-title-cell">
            <span className="emp-title-text">{row.title}</span>
            <span className="muted emp-sub">{pluralize(row.lineCount, 'line')}</span>
          </span>
        ),
      },
      {
        key: 'totalAmount',
        header: 'Total',
        align: 'right',
        sortable: true,
        sortValue: (row) => Number(row.totalAmount),
        render: (row) => <Money value={row.totalAmount} strong />,
      },
      {
        key: 'status',
        header: 'Status',
        sortable: true,
        sortValue: (row) => STATUS_ORDER.indexOf(row.status),
        render: (row) => <StatusChip status={row.status} size="sm" />,
      },
      {
        key: 'flags',
        header: 'Flags',
        mobileLabel: 'Flags',
        render: (row) => {
          const flags = employeeFlags(row.flags)
          return flags.length ? <FlagList flags={flags} /> : <span className="muted">—</span>
        },
      },
      {
        key: 'updatedAt',
        header: 'Updated',
        sortable: true,
        render: (row) => (
          <time dateTime={row.updatedAt} title={formatDateTime(row.updatedAt)}>
            {formatRelative(row.updatedAt)}
          </time>
        ),
      },
      {
        key: 'actions',
        header: <span className="sr-only">Actions</span>,
        mobileLabel: ' ',
        align: 'right',
        render: (row) =>
          CONTINUE_STATUSES.has(row.status) ? (
            <Button
              to={`/claims/${row.id}/edit`}
              variant={row.status === 'SENT_BACK' ? 'primary' : 'secondary'}
              size="sm"
              icon={<EditIcon size={16} />}
              aria-label={`Continue editing ${row.claimNumber}`}
            >
              Continue editing
            </Button>
          ) : (
            <Button to={`/claims/${row.id}`} variant="ghost" size="sm" aria-label={`View ${row.claimNumber}`}>
              View
            </Button>
          ),
      },
    ],
    [],
  )

  const visibleStatuses = STATUS_ORDER.filter((s) => (counts?.[s] ?? 0) > 0 || statuses.includes(s))

  return (
    <div className="page page-hero">
      <PageHeader
        variant="hero"
        eyebrow="Expenses"
        title={TITLE}
        subtitle="Create, track and resubmit your expense claims."
        actions={
          <Button to="/claims/new" variant="inverse" size="lg" icon={<PlusIcon size={18} />}>
            New claim
          </Button>
        }
      />
      <div className="page-body stack">
        <section className="card card-pad emp-filters" aria-label="Filter claims">
          <div className="emp-filter-search">
            <TextInput
              label="Search claims"
              hideLabel
              type="search"
              placeholder="Search by claim number, title or purpose"
              icon={<SearchIcon size={18} />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="emp-status-filters" role="group" aria-label="Filter by status">
            <button
              type="button"
              className={`emp-filter-chip ${statuses.length === 0 ? 'is-active' : ''}`}
              aria-pressed={statuses.length === 0}
              onClick={() => setStatuses([])}
            >
              All <span className="emp-filter-count">{counts ? counts.ALL : '…'}</span>
            </button>
            {!counts && loading
              ? [0, 1, 2, 3].map((i) => <Skeleton key={i} width={110} height={34} radius={999} />)
              : visibleStatuses.map((s) => {
                  const active = statuses.includes(s)
                  return (
                    <button
                      key={s}
                      type="button"
                      className={`emp-filter-chip tone-${STATUS_META[s]?.tone ?? 'neutral'} ${active ? 'is-active' : ''}`}
                      aria-pressed={active}
                      onClick={() => toggleStatus(s)}
                    >
                      {STATUS_META[s]?.label ?? s} <span className="emp-filter-count">{counts?.[s] ?? 0}</span>
                    </button>
                  )
                })}
            {filtered && (
              <Button variant="ghost" size="sm" icon={<XIcon size={16} />} onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        </section>

        <div className="row row-between emp-result-row" aria-live="polite">
          <p className="muted">
            {loading && !data ? 'Loading claims…' : `${items.length} ${pluralize(items.length, 'claim')}${filtered ? ' match your filters' : ''}`}
          </p>
        </div>

        <DataTable
          columns={columns}
          rows={items}
          loading={loading}
          error={error}
          onRetry={reload}
          caption="My expense claims"
          rowLabel={(row) => `${row.claimNumber} ${row.title}`}
          maxHeight="none"
          empty={
            filtered
              ? {
                  icon: <SearchIcon size={28} />,
                  title: 'No claims match',
                  message: 'Try a different search or clear the status filters.',
                  action: (
                    <Button variant="secondary" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ),
                }
              : {
                  icon: <ReceiptIcon size={28} />,
                  title: 'No claims yet',
                  message: 'Start a claim for your travel or business expenses. You can save it as a draft and finish later.',
                  action: (
                    <Button to="/claims/new" icon={<PlusIcon size={18} />}>
                      New claim
                    </Button>
                  ),
                }
          }
        />
      </div>
    </div>
  )
}
