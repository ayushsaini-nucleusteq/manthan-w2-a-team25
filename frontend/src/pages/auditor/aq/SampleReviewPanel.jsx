import { useEffect, useRef, useState } from 'react'
import { approvalsApi, auditorApi, errorMessage, isConflictError } from '../../../api'
import Button from '../../../components/Button.jsx'
import ConfirmDialog from '../../../components/ConfirmDialog.jsx'
import ErrorState from '../../../components/ErrorState.jsx'
import InfoBanner from '../../../components/InfoBanner.jsx'
import Money from '../../../components/Money.jsx'
import ReceiptViewer from '../../../components/ReceiptViewer.jsx'
import StatusChip from '../../../components/StatusChip.jsx'
import { FlagList } from '../../../components/FlagTag.jsx'
import Skeleton, { SkeletonText } from '../../../components/Skeleton.jsx'
import { CheckIcon, CornerUpLeftIcon, XIcon } from '../../../components/icons.jsx'
import { useAsync } from '../../../hooks/useAsync.js'
import { useToast } from '../../../components/toast/useToast.js'
import { SAMPLE_STATUS_META } from '../../../utils/constants.js'
import { categoryLabel, formatDate, formatDateTime } from '../../../utils/format.js'
import { sumMoney } from '../../../utils/money.js'
import ReasonDialog from './ReasonDialog.jsx'

/**
 * Inline side-by-side review of one sampled claim (A4): lines on the left,
 * the receipt viewer on the right, and Clear / Reject / Send back actions.
 */
export default function SampleReviewPanel({ item, readOnly, onDecided, onClose }) {
  const toast = useToast()
  const { data: claim, error, loading, reload } = useAsync(() => approvalsApi.getReviewClaim(item.id), [item.id])
  const [lineIdx, setLineIdx] = useState(0)
  const [dialog, setDialog] = useState(null) // 'clear' | 'reject' | 'sendBack'
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [dialogKey, setDialogKey] = useState(0)
  const headingRef = useRef(null)

  useEffect(() => {
    headingRef.current?.focus()
    headingRef.current?.closest('.sa-panel')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [item.id])

  const lines = claim?.lines ?? []
  const safeIdx = Math.min(lineIdx, Math.max(lines.length - 1, 0))
  const line = lines[safeIdx]
  const receipt = line?.receipt ?? null

  const open = (kind) => {
    setDialogKey((k) => k + 1)
    setDialog(kind)
  }

  const act = async (kind, text) => {
    setBusy(true)
    try {
      if (kind === 'clear') await auditorApi.clearSample(item.id)
      else if (kind === 'reject') await auditorApi.rejectSample(item.id, text)
      else await auditorApi.sendBackSample(item.id, text)
      setDialog(null)
      const msg = {
        clear: `${item.claimNumber} cleared. It is now payable.`,
        reject: `${item.claimNumber} rejected.`,
        sendBack: `${item.claimNumber} sent back to ${item.employeeName ?? 'the employee'}.`,
      }[kind]
      toast.success(msg, { title: 'Sample audit recorded' })
      onDecided?.()
    } catch (err) {
      setDialog(null)
      if (isConflictError(err)) {
        setConflict(true)
        toast.error('Someone else changed this claim. Reload to see the latest version.', { title: 'This claim changed, reload' })
      } else {
        toast.error(errorMessage(err), { title: 'Could not record the audit' })
      }
    } finally {
      setBusy(false)
    }
  }

  const reloadAll = () => {
    setConflict(false)
    reload()
    onDecided?.({ keepSelection: true })
  }

  const onLineKey = (e) => {
    if (!lines.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      setLineIdx((i) => Math.min(i + 1, lines.length - 1))
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      setLineIdx((i) => Math.max(i - 1, 0))
    }
  }

  return (
    <section className="sa-panel" aria-labelledby="sa-panel-title">
      <div className="sa-panel-head">
        <div className="stack-sm">
          <h2 id="sa-panel-title" className="sa-panel-title" tabIndex={-1} ref={headingRef}>
            Reviewing {item.claimNumber}
          </h2>
          <div className="aq-meta">
            <span>
              Employee <strong>{item.employeeName ?? '—'}</strong>
            </span>
            <span>
              Department <strong>{item.departmentName ?? '—'}</strong>
            </span>
            <span>
              Total <Money value={item.totalAmount} strong />
            </span>
            <span>
              Auto-approved <strong>{formatDateTime(item.submittedAt)}</strong>
            </span>
          </div>
        </div>
        <div className="row-sm">
          <StatusChip status={item.sampleAuditStatus} meta={SAMPLE_STATUS_META} />
          <Button variant="ghost" size="sm" iconOnly aria-label="Close review panel" icon={<XIcon size={16} />} onClick={onClose} />
        </div>
      </div>

      {conflict && (
        <div style={{ padding: '16px 20px 0' }}>
          <InfoBanner
            tone="warning"
            title="This claim changed, reload"
            live
            action={
              <Button size="sm" variant="secondary" onClick={reloadAll}>
                Reload
              </Button>
            }
          >
            The claim was updated by someone else after you opened it.
          </InfoBanner>
        </div>
      )}

      {error ? (
        <div style={{ padding: 20 }}>
          <ErrorState error={error} onRetry={reload} compact />
        </div>
      ) : (
        <div className="sa-panel-body">
          <div className="stack-sm">
            <h3 className="small semibold muted mt-0">Expense lines</h3>
            {loading && !claim ? (
              <SkeletonText lines={5} />
            ) : (
              <>
                <ul className="sa-lines" aria-label="Expense lines (select to view receipt)">
                  {lines.map((l, i) => (
                    <li key={l.id}>
                      <button
                        type="button"
                        className={`sa-line${i === safeIdx ? ' is-active' : ''}`}
                        aria-pressed={i === safeIdx}
                        onClick={() => setLineIdx(i)}
                        onKeyDown={onLineKey}
                      >
                        <span className="sa-line-no" aria-hidden="true">
                          {l.lineNo}
                        </span>
                        <span className="sa-line-main">
                          <span className="sa-line-title">
                            {categoryLabel(l.category)}
                            {l.vendor ? ` · ${l.vendor}` : ''}
                          </span>
                          <span className="aq-sub">
                            {formatDate(l.expenseDate)}
                            {l.city ? ` · ${l.city}` : ''}
                            {l.receipt ? '' : ' · No receipt'}
                          </span>
                          {l.flags?.length > 0 && (
                            <span className="mt-8" style={{ display: 'block' }}>
                              <FlagList flags={l.flags} />
                            </span>
                          )}
                          {(l.findings ?? []).filter((f) => f.outcome !== 'AUTO_APPROVE').length > 0 && (
                            <ul className="sa-findings">
                              {l.findings
                                .filter((f) => f.outcome !== 'AUTO_APPROVE')
                                .map((f, fi) => (
                                  <li key={fi}>{f.message}</li>
                                ))}
                            </ul>
                          )}
                        </span>
                        <Money value={l.amount} strong />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="sa-total">
                  <span>Total ({lines.length} {lines.length === 1 ? 'line' : 'lines'})</span>
                  <Money value={claim ? sumMoney(lines, 'amount') : item.totalAmount} strong />
                </div>
              </>
            )}
          </div>

          <div className="stack-sm">
            <div className="row-between">
              <h3 className="small semibold muted mt-0">Receipt</h3>
              {lines.length > 0 && (
                <span className="small muted" aria-live="polite">
                  Line {safeIdx + 1} of {lines.length}
                </span>
              )}
            </div>
            {loading && !claim ? (
              <Skeleton height={360} />
            ) : (
              <ReceiptViewer
                src={receipt?.url ?? null}
                contentType={receipt?.contentType}
                fileName={receipt?.fileName}
                alt={line ? `Receipt for line ${line.lineNo}` : 'Receipt'}
                height={420}
              />
            )}
            {lines.length > 1 && (
              <div className="sa-thumbs" role="group" aria-label="Receipts by line">
                {lines.map((l, i) => (
                  <button
                    key={l.id}
                    type="button"
                    className={`sa-thumb${i === safeIdx ? ' is-active' : ''}`}
                    style={l.receipt?.url && l.receipt.contentType?.startsWith('image/') ? { backgroundImage: `url("${l.receipt.url}")` } : undefined}
                    aria-label={`Show receipt for line ${l.lineNo}${l.receipt ? '' : ' (no receipt)'}`}
                    aria-pressed={i === safeIdx}
                    onClick={() => setLineIdx(i)}
                  >
                    {!(l.receipt?.url && l.receipt.contentType?.startsWith('image/')) && l.lineNo}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {readOnly ? (
        <div className="sa-actions">
          <span className="small muted">
            Audited by <strong>{item.auditedByName ?? '—'}</strong> on {formatDateTime(item.auditedAt)}
          </span>
        </div>
      ) : (
        <div className="sa-actions">
          <Button variant="danger-outline" icon={<XIcon size={16} />} onClick={() => open('reject')} disabled={busy || !claim || item.canAct === false}>
            Reject
          </Button>
          <Button variant="secondary" icon={<CornerUpLeftIcon size={16} />} onClick={() => open('sendBack')} disabled={busy || !claim || item.canAct === false}>
            Send back
          </Button>
          <Button icon={<CheckIcon size={16} />} onClick={() => open('clear')} loading={busy && dialog === 'clear'} disabled={!claim || item.canAct === false}>
            Clear
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={dialog === 'clear'}
        title={`Clear ${item.claimNumber}?`}
        message={
          <>
            The sample audit passes and the claim of <Money value={item.totalAmount} strong /> becomes payable. Your name and the time are
            recorded.
          </>
        }
        confirmLabel="Clear claim"
        loading={busy}
        icon={<CheckIcon size={22} />}
        onConfirm={() => act('clear')}
        onCancel={() => !busy && setDialog(null)}
      />
      <ReasonDialog
        key={`r${dialogKey}`}
        open={dialog === 'reject'}
        title={`Reject ${item.claimNumber}`}
        description="The claim becomes Rejected and will not be paid."
        label="Reason"
        hint="The employee sees this reason."
        confirmLabel="Reject claim"
        tone="danger"
        loading={busy}
        onConfirm={(text) => act('reject', text)}
        onCancel={() => !busy && setDialog(null)}
      />
      <ReasonDialog
        key={`s${dialogKey}`}
        open={dialog === 'sendBack'}
        title={`Send back ${item.claimNumber}`}
        description="The employee can fix the claim and resubmit it."
        label="Comment"
        hint="Tell the employee what to fix."
        confirmLabel="Send back"
        loading={busy}
        onConfirm={(text) => act('sendBack', text)}
        onCancel={() => !busy && setDialog(null)}
      />
    </section>
  )
}
