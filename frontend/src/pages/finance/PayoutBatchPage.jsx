import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { payoutsApi, errorMessage, isConflictError } from '../../api'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { useToast } from '../../components/toast/useToast.js'
import PageHeader from '../../components/PageHeader.jsx'
import Card from '../../components/Card.jsx'
import DataTable from '../../components/DataTable.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import StepIndicator from '../../components/StepIndicator.jsx'
import InfoBanner from '../../components/InfoBanner.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import Skeleton, { SkeletonText } from '../../components/Skeleton.jsx'
import Money from '../../components/Money.jsx'
import Button from '../../components/Button.jsx'
import { CheckIcon, DownloadIcon, FileTextIcon, RefreshIcon, WalletIcon } from '../../components/icons.jsx'
import { PAYOUT_STATUS_META } from '../../utils/constants.js'
import { formatDateTime, pluralize } from '../../utils/format.js'
import MarkPaidDialog from './payouts/MarkPaidDialog.jsx'
import { BATCH_STATUS_INDEX, BATCH_STEPS, downloadTextFile, totalOf } from './payouts/payoutUtils.js'
import './payouts/payouts.css'

const HOME = { label: 'Home', to: '/finance/dashboard' }
const PAYOUTS = { label: 'Payouts', to: '/finance/payouts' }

/** F3 Payout batch: status stepper, items, bank-file export and mark paid. */
export default function PayoutBatchPage() {
  const { batchId } = useParams()
  const toast = useToast()
  const { data: batch, error, loading, reload, setData } = useAsync(() => payoutsApi.getBatch(batchId), [batchId])
  const [file, setFile] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState(null)
  const [stale, setStale] = useState(null)

  useDocumentTitle(batch ? `Batch ${batch.batchNumber}` : 'Payout batch')

  if (error && !batch) {
    return (
      <div className="page">
        <div className="page-body stack-lg stack">
          <PageHeader title="Payout batch" breadcrumbs={[HOME, PAYOUTS, { label: 'Batch' }]} />
          <ErrorState error={error} onRetry={reload} />
        </div>
      </div>
    )
  }

  if (!batch) {
    return (
      <div className="page">
        <div className="page-body stack-lg stack" aria-busy="true">
          <PageHeader title="Payout batch" breadcrumbs={[HOME, PAYOUTS, { label: 'Loading…' }]} />
          <Card padded>
            <Skeleton height={40} />
            <div style={{ marginTop: 16 }}>
              <SkeletonText lines={3} />
            </div>
          </Card>
          <DataTable columns={[{ key: 'a', header: 'Claim' }, { key: 'b', header: 'Amount', align: 'right' }]} rows={[]} loading caption="Loading batch items" />
        </div>
      </div>
    )
  }

  const stepIndex = BATCH_STATUS_INDEX[batch.status] ?? 0
  const steps = BATCH_STEPS.map((s, i) => ({ ...s, valid: i < stepIndex || batch.status === 'PAID' }))
  const isPaid = batch.status === 'PAID'
  const canPay = batch.status === 'EXPORTED'
  const payReason = isPaid
    ? `Already marked paid on ${formatDateTime(batch.paidAt)}.`
    : batch.status === 'CREATED'
      ? 'Export the bank file first. Mark as paid is enabled once the batch is exported.'
      : null
  const itemsTotal = batch.items?.length ? totalOf(batch.items, 'amount') : batch.totalAmount

  const handleConflict = (err) => {
    setStale(errorMessage(err))
    toast.warning('This batch changed. Reload to see the latest state.', { title: 'Batch changed' })
  }

  const doExport = async () => {
    setExporting(true)
    try {
      const result = await payoutsApi.exportBatch(batch.id)
      setFile(result)
      setData(result.batch)
      downloadTextFile(result.fileName, result.csv)
      toast.success(
        batch.status === 'CREATED'
          ? `${result.fileName} downloaded. ${pluralize(batch.claimCount, 'claim')} moved to In batch.`
          : `${result.fileName} downloaded again (same file).`,
        { title: 'Bank file ready' },
      )
    } catch (err) {
      if (isConflictError(err)) handleConflict(err)
      else toast.error(errorMessage(err), { title: 'Export failed' })
    } finally {
      setExporting(false)
    }
  }

  const doMarkPaid = async (bankReference) => {
    setPaying(true)
    setPayError(null)
    try {
      const updated = await payoutsApi.markPaid(batch.id, { confirm: true, bankReference, version: batch.version })
      setData(updated)
      setPayOpen(false)
      toast.success(`${updated.batchNumber} marked paid. ${pluralize(updated.claimCount, 'employee notification')} sent.`, { title: 'Batch paid' })
    } catch (err) {
      if (isConflictError(err)) {
        setPayOpen(false)
        handleConflict(err)
        reload()
      } else {
        setPayError(errorMessage(err))
        toast.error(errorMessage(err), { title: 'Could not mark as paid' })
      }
    } finally {
      setPaying(false)
    }
  }

  const columns = [
    {
      key: 'claimNumber',
      header: 'Claim',
      sortable: true,
      mobileTitle: true,
      render: (r) => (
        <Link to={`/approvals/${r.claimId}`} className="mono">
          {r.claimNumber}
        </Link>
      ),
    },
    { key: 'employeeName', header: 'Employee', sortable: true },
    { key: 'employeeCode', header: 'Emp. code', mobileHidden: true, render: (r) => <span className="mono">{r.employeeCode}</span> },
    { key: 'departmentName', header: 'Department', sortable: true, mobileHidden: true },
    { key: 'bankAccountMasked', header: 'Account', render: (r) => <span className="mono">{r.bankAccountMasked}</span> },
    { key: 'ifscCode', header: 'IFSC', mobileHidden: true, render: (r) => <span className="mono">{r.ifscCode}</span> },
    { key: 'claimStatus', header: 'Claim status', render: (r) => (r.claimStatus ? <StatusChip status={r.claimStatus} size="sm" /> : '—') },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      sortValue: (r) => Number(r.amount),
      render: (r) => <Money value={r.amount} />,
    },
  ]

  const sha = file?.sha256 || batch.fileSha256

  return (
    <div className="page">
      <div className="page-body stack-lg stack">
        <PageHeader
          title={`Batch ${batch.batchNumber}`}
          subtitle={`${pluralize(batch.claimCount, 'claim')} · created by ${batch.createdByName || 'finance'} on ${formatDateTime(batch.createdAt)}`}
          breadcrumbs={[HOME, PAYOUTS, { label: batch.batchNumber }]}
          meta={<StatusChip status={batch.status} meta={PAYOUT_STATUS_META} />}
          actions={
            <Button variant="secondary" icon={<RefreshIcon size={16} />} onClick={reload} loading={loading}>
              Refresh
            </Button>
          }
        />

        {stale && (
          <InfoBanner
            tone="warning"
            title="This batch changed, reload"
            live
            onDismiss={() => setStale(null)}
            action={
              <Button size="sm" variant="secondary" onClick={() => { setStale(null); reload() }}>
                Reload
              </Button>
            }
          >
            {stale}
          </InfoBanner>
        )}

        <Card padded>
          <div className="payout-stepper">
            <StepIndicator steps={steps} current={isPaid ? -1 : stepIndex} />
          </div>
          <dl className="payout-kv">
            <div>
              <dt>Batch total</dt>
              <dd><Money value={batch.totalAmount} strong /></dd>
            </div>
            <div>
              <dt>Claims</dt>
              <dd>{batch.claimCount}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDateTime(batch.createdAt)}</dd>
            </div>
            <div>
              <dt>Exported</dt>
              <dd>{formatDateTime(batch.exportedAt)}</dd>
            </div>
            <div>
              <dt>Paid</dt>
              <dd>{formatDateTime(batch.paidAt)}</dd>
            </div>
          </dl>
        </Card>

        {isPaid ? (
          <Card padded>
            <div className="payout-paid-success" role="status">
              <span className="payout-paid-icon" aria-hidden="true">
                <CheckIcon size={24} strokeWidth={3} />
              </span>
              <div className="stack-sm stack">
                <h2 style={{ margin: 0 }}>Batch paid</h2>
                <p style={{ margin: 0 }}>
                  Marked paid by <strong>{batch.paidByName || 'finance head'}</strong> on {formatDateTime(batch.paidAt)}. Every claim is
                  now Paid and employees have been notified.
                </p>
                <p style={{ margin: 0 }}>
                  Bank reference: <span className="mono">{batch.bankReference}</span>
                </p>
              </div>
            </div>
          </Card>
        ) : null}

        <Card title="Bank file and payment" subtitle="Export the mock bank file, upload it to the bank, then confirm payment.">
          <div className="stack">
            <div className="payout-actions">
              <Button icon={<DownloadIcon size={18} />} onClick={doExport} loading={exporting} loadingLabel="Exporting bank file…" variant={batch.status === 'CREATED' ? 'primary' : 'secondary'}>
                {batch.status === 'CREATED' ? 'Export bank file' : 'Download bank file again'}
              </Button>
              {!isPaid && (
                <Button
                  icon={<WalletIcon size={18} />}
                  variant={canPay ? 'primary' : 'secondary'}
                  disabled={!canPay}
                  aria-describedby={payReason ? 'pay-reason' : undefined}
                  onClick={() => { setPayError(null); setPayOpen(true) }}
                >
                  Mark as paid
                </Button>
              )}
            </div>
            {payReason && (
              <p className="payout-reason" id="pay-reason">
                {payReason}
              </p>
            )}
            {batch.status === 'CREATED' && (
              <InfoBanner tone="info">
                Exporting moves every claim in this batch to <strong>In batch</strong>. Re-downloading later returns the same file.
              </InfoBanner>
            )}
            {sha && (
              <div className="stack-sm stack">
                <span className="row row-sm">
                  <FileTextIcon size={18} />
                  <strong>{file?.fileName || batch.fileName || `${batch.batchNumber}.csv`}</strong>
                </span>
                <div>
                  <span className="payout-reason" style={{ display: 'block', margin: '0 0 4px' }}>
                    File SHA-256
                  </span>
                  <code className="payout-hash">{sha}</code>
                </div>
              </div>
            )}
            {file?.csv && (
              <div className="stack-sm stack">
                <span className="payout-reason" id="csv-preview-label" style={{ margin: 0 }}>
                  Bank file preview (H header, D detail, T trailer rows)
                </span>
                <pre className="payout-csv" tabIndex={0} aria-labelledby="csv-preview-label">
                  {file.csv}
                </pre>
              </div>
            )}
          </div>
        </Card>

        <section aria-labelledby="batch-items-title" className="stack-sm stack">
          <h2 id="batch-items-title" style={{ margin: 0 }}>
            Claims in this batch
          </h2>
          <DataTable
            columns={columns}
            rows={batch.items ?? []}
            rowKey="claimId"
            loading={loading && !batch.items}
            caption={`Claims in batch ${batch.batchNumber}`}
            maxHeight="none"
            empty={{ title: 'No claims in this batch', message: 'This batch has no items.' }}
          />
          <div className="payout-total-footer">
            <span>Total ({pluralize(batch.items?.length ?? 0, 'claim')})</span>
            <Money value={itemsTotal} strong />
          </div>
        </section>

        {payOpen && canPay && (
          <MarkPaidDialog
            batch={batch}
            loading={paying}
            serverError={payError}
            onConfirm={doMarkPaid}
            onCancel={() => !paying && setPayOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
