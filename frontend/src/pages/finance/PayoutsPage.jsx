import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { payoutsApi } from '../../api'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import PageHeader from '../../components/PageHeader.jsx'
import Card from '../../components/Card.jsx'
import DataTable from '../../components/DataTable.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import StatTile from '../../components/StatTile.jsx'
import Money from '../../components/Money.jsx'
import Button from '../../components/Button.jsx'
import { PlusIcon, WalletIcon, RefreshIcon } from '../../components/icons.jsx'
import { PAYOUT_STATUS_META } from '../../utils/constants.js'
import { formatDate, formatDateTime } from '../../utils/format.js'
import BatchBuilder from './payouts/BatchBuilder.jsx'
import { totalOf } from './payouts/payoutUtils.js'
import './payouts/payouts.css'

const TITLE = 'Payouts'

/** F2 Payouts: batch list and the "New batch" builder. */
export default function PayoutsPage() {
  useDocumentTitle(TITLE)
  const [params, setParams] = useSearchParams()
  const building = params.get('new') === '1'
  const batches = useAsync(() => payoutsApi.listBatches(), [])
  const [sort, setSort] = useState({ key: 'createdAt', dir: 'desc' })

  const setBuilding = (on) => {
    const next = new URLSearchParams(params)
    if (on) next.set('new', '1')
    else next.delete('new')
    setParams(next, { replace: true })
  }

  const rows = batches.data ?? []
  const openRows = rows.filter((b) => b.status !== 'PAID')
  const paidRows = rows.filter((b) => b.status === 'PAID')

  const columns = [
    {
      key: 'batchNumber',
      header: 'Batch',
      sortable: true,
      mobileTitle: true,
      render: (b) => (
        <Link to={`/finance/payouts/${b.id}`} className="mono" data-no-row-click>
          {b.batchNumber}
        </Link>
      ),
    },
    { key: 'status', header: 'Status', sortable: true, render: (b) => <StatusChip status={b.status} meta={PAYOUT_STATUS_META} size="sm" /> },
    { key: 'claimCount', header: 'Claims', align: 'right', sortable: true },
    {
      key: 'totalAmount',
      header: 'Total',
      align: 'right',
      sortable: true,
      sortValue: (b) => Number(b.totalAmount),
      render: (b) => <Money value={b.totalAmount} strong />,
    },
    { key: 'createdAt', header: 'Created', sortable: true, render: (b) => <span title={formatDateTime(b.createdAt)}>{formatDate(b.createdAt)}</span> },
    { key: 'exportedAt', header: 'Exported', sortable: true, render: (b) => formatDate(b.exportedAt), mobileHidden: true },
    { key: 'paidAt', header: 'Paid', sortable: true, render: (b) => formatDate(b.paidAt) },
  ]

  return (
    <div className="page">
      <div className="page-body stack-lg stack">
        <PageHeader
          title={TITLE}
          subtitle="Batch approved claims, export the bank file and confirm payment."
          breadcrumbs={[{ label: 'Home', to: '/finance/dashboard' }, { label: TITLE }]}
          actions={
            !building && (
              <Button icon={<PlusIcon size={18} />} onClick={() => setBuilding(true)}>
                New batch
              </Button>
            )
          }
        />

        <div className="grid grid-3">
          <StatTile label="Open batches" value={openRows.length} hint="Created or exported" icon={<WalletIcon size={20} />} loading={batches.loading && !batches.data} tone="brand" />
          <StatTile label="Awaiting payment" value={<Money value={totalOf(openRows)} compact />} hint="Total of open batches" loading={batches.loading && !batches.data} tone="warning" />
          <StatTile label="Paid out" value={<Money value={totalOf(paidRows)} compact />} hint={`${paidRows.length} paid batches`} loading={batches.loading && !batches.data} tone="success" />
        </div>

        {building && (
          <Card padded>
            <BatchBuilder onCancel={() => setBuilding(false)} />
          </Card>
        )}

        <Card
          title="Payout batches"
          subtitle="Newest first. Open a batch to export the bank file or mark it paid."
          actions={
            <Button variant="ghost" size="sm" icon={<RefreshIcon size={16} />} onClick={batches.reload} loading={batches.loading && Boolean(batches.data)}>
              Refresh
            </Button>
          }
        >
          <DataTable
            columns={columns}
            rows={rows}
            sort={sort}
            onSortChange={setSort}
            loading={batches.loading}
            error={batches.error}
            onRetry={batches.reload}
            caption="Payout batches"
            rowLabel={(b) => `batch ${b.batchNumber}`}
            maxHeight="none"
            empty={{
              title: 'No payout batches yet',
              message: 'Create a batch from approved claims to start paying employees.',
              icon: <WalletIcon size={28} />,
              action: !building && (
                <Button icon={<PlusIcon size={18} />} onClick={() => setBuilding(true)}>
                  New batch
                </Button>
              ),
            }}
          />
        </Card>
      </div>
    </div>
  )
}
