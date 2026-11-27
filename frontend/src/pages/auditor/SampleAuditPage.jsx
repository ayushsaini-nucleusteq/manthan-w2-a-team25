import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { auditorApi } from '../../api'
import PageHeader from '../../components/PageHeader.jsx'
import SubNav from '../../components/SubNav.jsx'
import Tabs, { TabPanel } from '../../components/Tabs.jsx'
import DataTable from '../../components/DataTable.jsx'
import InfoBanner from '../../components/InfoBanner.jsx'
import Money from '../../components/Money.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import Button from '../../components/Button.jsx'
import { RefreshIcon, ShieldIcon, CheckIcon } from '../../components/icons.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDateTime } from '../../utils/format.js'
import { amountSortValue } from './aq/auditorQueue.js'
import SampleReviewPanel from './aq/SampleReviewPanel.jsx'
import './aq/auditor.css'

const TITLE = 'Sample audit'
const AUDITOR_TABS = [
  { id: 'queue', label: 'Review queue', to: '/audit/queue' },
  { id: 'samples', label: 'Sample audit', to: '/audit/samples' },
]
const RESULT_META = {
  PENDING: { label: 'Pending', tone: 'purple' },
  CLEARED: { label: 'Cleared', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  SENT_BACK: { label: 'Sent back', tone: 'purple' },
}

/** A4: randomly sampled auto-approved claims, with an inline side-by-side review. */
export default function SampleAuditPage() {
  useDocumentTitle(TITLE)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'done' ? 'DONE' : 'PENDING'
  const [selectedId, setSelectedId] = useState(null)
  const [sort, setSort] = useState(null)

  const list = useAsync(() => auditorApi.listSampleAudits({ status: tab }), [tab])
  const items = list.data?.items ?? []
  const counts = list.data?.counts
  const selected = items.find((i) => i.id === selectedId) ?? null

  const changeTab = (id) => {
    setSelectedId(null)
    setSort(null)
    setParams(id === 'DONE' ? { tab: 'done' } : {}, { replace: true })
  }

  const onDecided = (opts) => {
    if (!opts?.keepSelection) setSelectedId(null)
    list.reload()
  }

  const columns = [
    {
      key: 'claimNumber',
      header: 'Claim no.',
      mobileTitle: true,
      sortable: true,
      render: (row) => (
        <button
          type="button"
          className="aq-claimno btn-reset"
          style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}
          aria-pressed={row.id === selectedId}
          onClick={(e) => {
            e.stopPropagation()
            setSelectedId(row.id === selectedId ? null : row.id)
          }}
        >
          {row.claimNumber}
        </button>
      ),
    },
    { key: 'employeeName', header: 'Employee', sortable: true, render: (row) => row.employeeName ?? '—' },
    { key: 'departmentName', header: 'Department', sortable: true },
    {
      key: 'totalAmount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      sortValue: amountSortValue,
      render: (row) => <Money value={row.totalAmount} strong />,
    },
    {
      key: 'submittedAt',
      header: 'Auto-approved at',
      sortable: true,
      sortValue: (row) => row.submittedAt ?? '',
      render: (row) => <span className="nowrap">{formatDateTime(row.submittedAt)}</span>,
    },
    { key: 'lineCount', header: 'Lines', align: 'right', width: '64px' },
  ]
  if (tab === 'DONE') {
    columns.push(
      { key: 'result', header: 'Result', render: (row) => <StatusChip status={row.sampleAuditStatus} meta={RESULT_META} size="sm" /> },
      { key: 'auditedByName', header: 'Audited by', sortable: true, render: (row) => row.auditedByName ?? '—' },
      {
        key: 'auditedAt',
        header: 'Audited at',
        sortable: true,
        sortValue: (row) => row.auditedAt ?? '',
        render: (row) => <span className="nowrap">{formatDateTime(row.auditedAt)}</span>,
      },
    )
  }

  const tabs = [
    { id: 'PENDING', label: 'Pending', count: counts?.PENDING },
    { id: 'DONE', label: 'Done', count: counts?.DONE },
  ]

  return (
    <div className="page page-hero">
      <SubNav ariaLabel="Auditor sections" tabs={AUDITOR_TABS} />
      <PageHeader
        variant="hero"
        eyebrow="Finance audit"
        title={TITLE}
        subtitle="Auto-approved claims picked at random for a second look. A sampled claim cannot be paid until you clear it."
        actions={
          <Button variant="inverse" icon={<RefreshIcon size={16} />} onClick={list.reload} loading={list.loading && !!list.data}>
            Refresh
          </Button>
        }
      />
      <div className="page-body stack">
        <InfoBanner tone="info" icon={<ShieldIcon size={20} />} title="1 in every 10 auto-approved claims, randomly selected">
          Exactly 10% of auto-approved claims carry the sample tag. The position inside each block of 10 is chosen at random, so nobody can
          predict which claim is checked. Sampled claims appear only here, never in the review queue. Every result is recorded with your
          name and the time.
        </InfoBanner>

        <Tabs tabs={tabs} value={tab} onChange={changeTab} ariaLabel="Sample audit status" idPrefix="sa" />
        <TabPanel idPrefix="sa" id={tab}>
          <div className="stack">
            <p className="small muted mt-0">
              {tab === 'PENDING'
                ? 'Select a claim to review its lines and receipts side by side.'
                : 'Completed sample audits, latest first. Select a claim to see what was reviewed.'}
            </p>
            <DataTable
              caption={tab === 'PENDING' ? 'Sampled claims waiting for audit' : 'Completed sample audits'}
              columns={columns}
              rows={items}
              rowKey="id"
              dense
              sort={sort}
              onSortChange={setSort}
              loading={list.loading}
              error={list.error}
              onRetry={list.reload}
              empty={
                tab === 'PENDING'
                  ? { icon: <CheckIcon size={28} />, title: 'No samples waiting', message: 'Every sampled claim has been audited. New samples appear here automatically.' }
                  : { title: 'No completed audits yet', message: 'Cleared, rejected and sent-back samples will be listed here.' }
              }
              onRowClick={(row) => setSelectedId(row.id === selectedId ? null : row.id)}
              rowLabel={(row) => `Review ${row.claimNumber} from ${row.employeeName ?? 'unknown employee'}`}
              rowClassName={(row) => (row.id === selectedId ? 'is-selected' : '')}
              skeletonRows={6}
              maxHeight="none"
            />
            {selected && (
              <SampleReviewPanel
                key={selected.id}
                item={selected}
                readOnly={tab === 'DONE'}
                onDecided={onDecided}
                onClose={() => setSelectedId(null)}
              />
            )}
          </div>
        </TabPanel>
      </div>
    </div>
  )
}
