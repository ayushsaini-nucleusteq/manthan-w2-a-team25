import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { approvalsApi, auditorApi, errorMessage, fieldErrors, isConflictError } from '../../api'
import PageHeader from '../../components/PageHeader.jsx'
import Card from '../../components/Card.jsx'
import Button from '../../components/Button.jsx'
import Money from '../../components/Money.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import OutcomeBadge from '../../components/OutcomeBadge.jsx'
import FlagTag, { FlagList } from '../../components/FlagTag.jsx'
import ReceiptViewer from '../../components/ReceiptViewer.jsx'
import Timeline from '../../components/Timeline.jsx'
import InfoBanner from '../../components/InfoBanner.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import Skeleton, { SkeletonText } from '../../components/Skeleton.jsx'
import Modal from '../../components/Modal.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import TextArea from '../../components/TextArea.jsx'
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CornerUpLeftIcon,
  HelpCircleIcon,
  ReceiptIcon,
  RefreshIcon,
  XIcon,
} from '../../components/icons.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { useIsNarrow } from '../../hooks/useMediaQuery.js'
import { useToast } from '../../components/toast/useToast.js'
import { sumMoney } from '../../utils/money.js'
import { categoryLabel, formatDate, formatDateTime, formatFileSize, shortHash, stepTypeLabel } from '../../utils/format.js'
import { STEP_STATUS_META } from '../../utils/constants.js'
import { validateComment } from '../../utils/validation.js'
import './a2-viewer/receiptViewerPage.css'

const QUEUE_FILTER_KEYS = ['amountBand', 'departmentId', 'flag', 'minAgeHours', 'q']

function isTypingTarget(target) {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function ClaimSkeleton() {
  return (
    <div className="a2-split" aria-busy="true" aria-label="Loading claim">
      <div className="a2-left">
        <Card>
          <Skeleton width="40%" height={20} />
          <div style={{ marginTop: 16 }}><SkeletonText lines={3} /></div>
        </Card>
        <Card>
          <SkeletonText lines={6} />
        </Card>
      </div>
      <div className="a2-right">
        <Card><Skeleton height={420} /></Card>
      </div>
    </div>
  )
}

function ApprovalChain({ steps }) {
  if (!steps?.length) return null
  return (
    <ol className="a2-chain" aria-label="Approval chain">
      {steps.map((step) => (
        <li key={step.id} className={step.status === 'PENDING' ? 'is-current' : undefined}>
          <span className="a2-chain-type">{stepTypeLabel(step.stepType)}</span>
          <StatusChip status={step.status} meta={STEP_STATUS_META} size="sm" />
          <span className="a2-chain-who">
            {step.actedByName
              ? `${step.status === 'APPROVED' ? 'Approved' : 'Acted'} by ${step.actedByName}${step.onBehalfOfName ? ` for ${step.onBehalfOfName}` : ''}`
              : step.assigneeName || (step.status === 'PENDING' ? 'Auditor pool' : '—')}
          </span>
          {step.actedAt && <span className="a2-chain-who">{formatDateTime(step.actedAt)}</span>}
        </li>
      ))}
    </ol>
  )
}

function LinesTable({ lines, selected, onSelect, total }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="a2-lines">
        <caption className="sr-only">Claim lines. Select a line to show its receipt.</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Expense</th>
            <th scope="col" className="hide-sm">Date</th>
            <th scope="col">Policy</th>
            <th scope="col" className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr
              key={line.id}
              className={i === selected ? 'is-selected' : undefined}
              aria-selected={i === selected}
              onClick={() => onSelect(i)}
            >
              <td>{line.lineNo}</td>
              <td>
                <button
                  type="button"
                  className="a2-line-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelect(i)
                  }}
                  aria-pressed={i === selected}
                  aria-label={`Line ${line.lineNo}: ${categoryLabel(line.category)}, ${line.vendor}. Show receipt`}
                >
                  {categoryLabel(line.category)}
                </button>
                <span className="a2-line-meta">
                  {line.vendor}
                  {line.city ? ` · ${line.city}` : ''}
                  {line.nights ? ` · ${line.nights} night${line.nights === 1 ? '' : 's'}` : ''}
                </span>
                {line.notes && <span className="a2-line-meta">{line.notes}</span>}
                {!line.receipt && <span className="a2-noreceipt">No receipt</span>}
              </td>
              <td className="hide-sm">{formatDate(line.expenseDate)}</td>
              <td>
                {line.policyOutcome && <OutcomeBadge outcome={line.policyOutcome} size="sm" />}
                {line.flags?.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <FlagList flags={line.flags} />
                  </div>
                )}
                {line.findings?.some((f) => f.outcome !== 'AUTO_APPROVE') && (
                  <ul className="a2-findings">
                    {line.findings
                      .filter((f) => f.outcome !== 'AUTO_APPROVE')
                      .map((f, fi) => (
                        <li key={`${f.ruleCode}-${f.reasonCode}-${fi}`}>{f.message}</li>
                      ))}
                  </ul>
                )}
              </td>
              <td className="num">
                <Money value={line.amount} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="hide-sm">Total ({lines.length} lines)</td>
            <td className="hide-sm" />
            <td className="num">
              <Money value={total} strong />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function ReceiptPanel({ lines, selected, onSelect }) {
  const line = lines[selected]
  const receipt = line?.receipt
  const n = lines.length
  return (
    <Card padded={false}>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="a2-pager">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Previous receipt"
            icon={<ChevronLeftIcon size={18} />}
            disabled={selected <= 0}
            onClick={() => onSelect(selected - 1)}
          />
          <span className="a2-pager-label" aria-live="polite">
            Receipt {n ? selected + 1 : 0} of {n}
            {line ? ` · line ${line.lineNo}` : ''}
          </span>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Next receipt"
            icon={<ChevronRightIcon size={18} />}
            disabled={selected >= n - 1}
            onClick={() => onSelect(selected + 1)}
          />
        </div>
        <ReceiptViewer
          key={line?.id ?? 'none'}
          src={receipt?.url ?? null}
          contentType={receipt?.contentType}
          fileName={receipt?.fileName}
          alt={line ? `Receipt for line ${line.lineNo}, ${line.vendor}` : 'Receipt'}
          height="min(62vh, 640px)"
          footer={
            receipt ? (
              <div className="a2-receipt-meta">
                <span>{receipt.fileName}</span>
                {receipt.sizeBytes ? <span>{formatFileSize(receipt.sizeBytes)}</span> : null}
                {receipt.sha256 && (
                  <span title={receipt.sha256}>
                    SHA-256 <code>{shortHash(receipt.sha256)}</code>
                  </span>
                )}
              </div>
            ) : null
          }
        />
        {n > 1 && (
          <div className="a2-thumbs" role="group" aria-label="Receipts by line">
            {lines.map((l, i) => (
              <button
                key={l.id}
                type="button"
                className={`a2-thumb${i === selected ? ' is-active' : ''}`}
                aria-label={`Line ${l.lineNo} receipt${l.receipt ? '' : ' (missing)'}`}
                aria-current={i === selected ? 'true' : undefined}
                onClick={() => onSelect(i)}
              >
                <span className="a2-thumb-no">{l.lineNo}</span>
                {l.receipt?.url && l.receipt.contentType?.startsWith('image/') ? (
                  <img src={l.receipt.url} alt="" loading="lazy" />
                ) : (
                  <ReceiptIcon size={22} />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function ReasonModal({ kind, open, onClose, onSubmit, saving, serverError }) {
  const [text, setText] = useState('')
  const [touched, setTouched] = useState(false)
  const isReject = kind === 'reject'
  const label = isReject ? 'Reason' : 'Comment'
  const error = validateComment(text, { label })
  const shownError = serverError || (touched ? error : null)
  const submit = (e) => {
    e.preventDefault()
    setTouched(true)
    if (error) return
    onSubmit(text.trim())
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!saving}
      title={isReject ? 'Reject claim' : 'Send back to employee'}
      description={
        isReject
          ? 'Rejection is final. The employee sees your reason.'
          : 'The employee can fix the claim and resubmit it to you.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="a2-reason-form"
            variant={isReject ? 'danger' : 'primary'}
            loading={saving}
            icon={isReject ? <XIcon size={16} /> : <CornerUpLeftIcon size={16} />}
          >
            {isReject ? 'Reject claim' : 'Send back'}
          </Button>
        </>
      }
    >
      <form id="a2-reason-form" onSubmit={submit} noValidate>
        <TextArea
          label={label}
          required
          rows={4}
          maxLength={1000}
          showCount
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setTouched(true)}
          error={shownError}
          hint={isReject ? 'Explain why this claim cannot be paid.' : 'Tell the employee what to change.'}
          autoFocus
        />
      </form>
    </Modal>
  )
}

function ShortcutsModal({ open, onClose }) {
  const rows = [
    ['A', 'Approve'],
    ['S', 'Send back'],
    ['R', 'Reject'],
    ['J / K', 'Next / previous claim in queue'],
    ['← / →', 'Previous / next receipt'],
    ['+ / − / 0', 'Zoom in / out / reset (viewer focused)'],
    ['?', 'Show this help'],
  ]
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <ul className="a2-kbd-list">
        {rows.map(([k, v]) => (
          <li key={k}>
            <span>{v}</span>
            <kbd className="a2-kbd">{k}</kbd>
          </li>
        ))}
      </ul>
      <p className="muted" style={{ marginTop: 12, fontSize: '0.875rem' }}>
        Shortcuts are ignored while you type in a field.
      </p>
    </Modal>
  )
}

function Workspace({ claim, reload, queue, queueSearch }) {
  const navigate = useNavigate()
  const toast = useToast()
  const narrow = useIsNarrow()
  const [selected, setSelected] = useState(0)
  const [view, setView] = useState('lines')
  const [dialog, setDialog] = useState(null) // 'approve' | 'sendBack' | 'reject' | 'help'
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState(null)
  const [conflict, setConflict] = useState(false)

  const lines = useMemo(() => claim.lines ?? [], [claim.lines])
  const total = claim.totalAmount ?? sumMoney(lines, 'amount')
  const managerStep = claim.approvalSteps?.find((s) => s.stepType === 'MANAGER' && s.status === 'APPROVED')
  const canAct = Boolean(claim.canAct) && !conflict

  const queueItems = queue?.items ?? []
  const pos = queueItems.findIndex((it) => it.claimId === claim.id)
  const prevItem = pos > 0 ? queueItems[pos - 1] : null
  const nextItem = pos >= 0 && pos < queueItems.length - 1 ? queueItems[pos + 1] : null
  const claimPath = (id) => `/audit/claims/${id}${queueSearch}`
  const queuePath = `/audit/queue${queueSearch}`

  const selectLine = (i) => {
    if (i < 0 || i >= lines.length) return
    setSelected(i)
    if (narrow) setView('receipt')
  }

  const closeDialog = () => {
    if (saving) return
    setDialog(null)
    setServerError(null)
  }

  const finish = (message) => {
    toast.success(message, { title: claim.claimNumber })
    setDialog(null)
    navigate(nextItem ? claimPath(nextItem.claimId) : queuePath)
  }

  const handleError = (err, action) => {
    if (isConflictError(err)) {
      setConflict(true)
      setDialog(null)
      toast.warning('This claim changed. Reload to see the latest version.', { title: 'Claim changed' })
      return
    }
    const fields = fieldErrors(err)
    const fieldMsg = fields && (fields.comment || fields.reason)
    if (fieldMsg) setServerError(fieldMsg)
    toast.error(errorMessage(err), { title: `Couldn't ${action}` })
  }

  const run = async (action, fn, successMsg) => {
    setSaving(true)
    setServerError(null)
    try {
      await fn()
      finish(successMsg)
    } catch (err) {
      handleError(err, action)
    } finally {
      setSaving(false)
    }
  }

  const doApprove = () =>
    run('approve', () => approvalsApi.approve(claim.id, { version: claim.version }), 'Claim approved.')
  const doSendBack = (comment) =>
    run('send back', () => approvalsApi.sendBack(claim.id, { comment, version: claim.version }), 'Claim sent back to the employee.')
  const doReject = (reason) =>
    run('reject', () => approvalsApi.reject(claim.id, { reason, version: claim.version }), 'Claim rejected.')

  // Keyboard shortcuts. Handlers read the latest values through a ref updated after render.
  const keyState = useRef(null)
  useEffect(() => {
    keyState.current = { canAct, dialog, saving, prevItem, nextItem, selected, lines: lines.length }
  })
  useEffect(() => {
    const onKey = (e) => {
      const s = keyState.current
      if (!s || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target) || s.dialog || s.saving) return
      if (e.target instanceof HTMLElement && e.target.closest('[role="dialog"], [role="alertdialog"]')) return
      const k = e.key
      if (k === '?') {
        e.preventDefault()
        setDialog('help')
      } else if ((k === 'a' || k === 'A') && s.canAct) {
        e.preventDefault()
        setDialog('approve')
      } else if ((k === 's' || k === 'S') && s.canAct) {
        e.preventDefault()
        setDialog('sendBack')
      } else if ((k === 'r' || k === 'R') && s.canAct) {
        // R inside the receipt viewer rotates; only treat it as reject elsewhere.
        if (e.target instanceof HTMLElement && e.target.closest('.rv-viewport, .rv-toolbar')) return
        e.preventDefault()
        setDialog('reject')
      } else if ((k === 'j' || k === 'J') && s.nextItem) {
        e.preventDefault()
        navigate(claimPath(s.nextItem.claimId))
      } else if ((k === 'k' || k === 'K') && s.prevItem) {
        e.preventDefault()
        navigate(claimPath(s.prevItem.claimId))
      } else if (k === 'ArrowRight' || k === 'ArrowLeft') {
        if (e.target instanceof HTMLElement && e.target.closest('.rv-viewport')) return
        const next = s.selected + (k === 'ArrowRight' ? 1 : -1)
        if (next >= 0 && next < s.lines) {
          e.preventDefault()
          setSelected(next)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // claimPath depends only on queueSearch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, queueSearch])

  const summary = (
    <Card
      title={claim.title}
      subtitle={claim.purpose}
      actions={<StatusChip status={claim.status} />}
      headingLevel={2}
    >
      <dl className="a2-summary">
        <div>
          <dt>Employee</dt>
          <dd>{claim.employeeName}</dd>
        </div>
        <div>
          <dt>Department</dt>
          <dd>{claim.departmentName}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>
            <Money value={total} strong />
          </dd>
        </div>
        <div>
          <dt>Trip</dt>
          <dd>
            {formatDate(claim.tripStartDate)}
            {claim.tripEndDate && claim.tripEndDate !== claim.tripStartDate ? ` – ${formatDate(claim.tripEndDate)}` : ''}
          </dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{formatDateTime(claim.submittedAt)}</dd>
        </div>
        <div>
          <dt>Manager approval</dt>
          <dd>
            {managerStep
              ? `${managerStep.actedByName ?? 'Manager'}${managerStep.onBehalfOfName ? ` (for ${managerStep.onBehalfOfName})` : ''}`
              : '—'}
          </dd>
        </div>
      </dl>
      {claim.flags?.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {claim.flags.map((f) => (
            <FlagTag key={f} flag={f} />
          ))}
        </div>
      )}
      <ApprovalChain steps={claim.approvalSteps} />
    </Card>
  )

  const linesCard = (
    <Card title="Lines" subtitle="Select a line to show its receipt." headingLevel={2} padded={false}>
      {lines.length ? (
        <LinesTable lines={lines} selected={selected} onSelect={selectLine} total={total} />
      ) : (
        <p className="muted" style={{ padding: 16 }}>
          This claim has no lines.
        </p>
      )}
    </Card>
  )

  const commentsCard = (
    <Card title="Comments and history" headingLevel={2}>
      <Timeline statusHistory={claim.statusHistory} comments={claim.comments} order="desc" />
    </Card>
  )

  const receiptPanel = <ReceiptPanel lines={lines} selected={selected} onSelect={setSelected} />

  return (
    <>
      {conflict && (
        <InfoBanner
          tone="warning"
          title="This claim changed"
          live
          action={
            <Button
              size="sm"
              variant="secondary"
              icon={<RefreshIcon size={16} />}
              onClick={async () => {
                await reload()
                setConflict(false)
              }}
            >
              Reload
            </Button>
          }
        >
          Someone else acted on it or it was updated. Reload to see the latest version before deciding.
        </InfoBanner>
      )}
      {!claim.canAct && !conflict && (
        <InfoBanner tone="info" title="No decision needed from you">
          This claim is not waiting for an auditor decision. You can still review its lines and receipts.
        </InfoBanner>
      )}

      <div style={{ height: conflict || !claim.canAct ? 16 : 0 }} />

      {narrow ? (
        <>
          <div className="a2-viewtoggle" role="group" aria-label="Show">
            <button type="button" aria-pressed={view === 'lines'} onClick={() => setView('lines')}>
              Lines ({lines.length})
            </button>
            <button type="button" aria-pressed={view === 'receipt'} onClick={() => setView('receipt')}>
              Receipt
            </button>
          </div>
          {view === 'lines' ? (
            <div className="a2-left">
              {summary}
              {linesCard}
              {commentsCard}
            </div>
          ) : (
            receiptPanel
          )}
        </>
      ) : (
        <div className="a2-split">
          <div className="a2-left">
            {summary}
            {linesCard}
            {commentsCard}
          </div>
          <div className="a2-right">{receiptPanel}</div>
        </div>
      )}

      <div className="a2-decisionbar" role="region" aria-label="Decision">
        <div className="a2-decisionbar-info">
          <strong>{claim.claimNumber}</strong> · <Money value={total} /> · {lines.length} line{lines.length === 1 ? '' : 's'}
          {!narrow && (
            <span>
              {' '}
              · press <kbd className="a2-kbd">?</kbd> for shortcuts
            </span>
          )}
        </div>
        <div className="a2-decisionbar-actions">
          <Button
            variant="danger-outline"
            icon={<XIcon size={16} />}
            disabled={!canAct || saving}
            onClick={() => setDialog('reject')}
          >
            Reject
          </Button>
          <Button
            variant="secondary"
            icon={<CornerUpLeftIcon size={16} />}
            disabled={!canAct || saving}
            onClick={() => setDialog('sendBack')}
          >
            Send back
          </Button>
          <Button
            icon={<CheckIcon size={16} />}
            disabled={!canAct}
            loading={saving && dialog === 'approve'}
            onClick={() => setDialog('approve')}
          >
            Approve
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={dialog === 'approve'}
        title="Approve this claim?"
        message={
          <>
            Approve <strong>{claim.claimNumber}</strong> from {claim.employeeName} for <Money value={total} strong />.
            {claim.flags?.length > 0 ? ' This claim has policy flags; make sure you reviewed each line.' : ''}
          </>
        }
        confirmLabel="Approve"
        loading={saving}
        onConfirm={doApprove}
        onCancel={closeDialog}
        icon={<CheckIcon size={22} />}
      />
      {(dialog === 'sendBack' || dialog === 'reject') && (
        <ReasonModal
          kind={dialog === 'reject' ? 'reject' : 'sendBack'}
          open
          onClose={closeDialog}
          onSubmit={dialog === 'reject' ? doReject : doSendBack}
          saving={saving}
          serverError={serverError}
        />
      )}
      <ShortcutsModal open={dialog === 'help'} onClose={closeDialog} />

      {/* Queue position is rendered by the page header; keep a hidden live hint for screen readers. */}
      <span className="sr-only" aria-live="polite">
        {pos >= 0 ? `Claim ${pos + 1} of ${queueItems.length} in the queue.` : ''}
      </span>
    </>
  )
}

/** A2 Audit claim: lines on the left, receipt on the right, decision bar at the bottom. */
export default function ReceiptViewerPage() {
  const { claimId } = useParams()
  const [searchParams] = useSearchParams()

  const queueFilters = useMemo(() => {
    const f = {}
    for (const k of QUEUE_FILTER_KEYS) {
      const v = searchParams.get(k)
      if (v) f[k] = v
    }
    return f
  }, [searchParams])
  const queueSearch = useMemo(() => {
    const qs = new URLSearchParams(queueFilters).toString()
    return qs ? `?${qs}` : ''
  }, [queueFilters])

  const { data: claim, error, loading, reload } = useAsync(() => approvalsApi.getReviewClaim(claimId), [claimId])
  const { data: queue } = useAsync(() => auditorApi.getAuditorQueue(queueFilters), [queueSearch])

  useDocumentTitle(claim ? `Audit ${claim.claimNumber}` : 'Audit claim')

  const items = queue?.items ?? []
  const pos = claim ? items.findIndex((it) => it.claimId === claim.id) : -1
  const prevItem = pos > 0 ? items[pos - 1] : null
  const nextItem = pos >= 0 && pos < items.length - 1 ? items[pos + 1] : null

  const showClaim = claim && claim.id === claimId
  const managerStep = showClaim
    ? claim.approvalSteps?.find((s) => s.stepType === 'MANAGER' && s.status === 'APPROVED')
    : null

  return (
    <div className="page a2-page">
      <PageHeader
        title={showClaim ? `${claim.claimNumber}` : 'Audit claim'}
        eyebrow="Auditor review"
        subtitle={
          showClaim
            ? `${claim.employeeName} · ${claim.departmentName}${managerStep ? ` · Manager approved by ${managerStep.actedByName}` : ''}`
            : 'Compare each line with its receipt.'
        }
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Review queue', to: `/audit/queue${queueSearch}` },
          { label: showClaim ? claim.claimNumber : 'Claim' },
        ]}
        meta={showClaim ? <StatusChip status={claim.status} /> : null}
        actions={
          <div className="a2-nav">
            {pos >= 0 && (
              <span className="a2-nav-pos">
                {pos + 1} of {items.length} in queue
              </span>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<ChevronLeftIcon size={16} />}
              to={prevItem ? `/audit/claims/${prevItem.claimId}${queueSearch}` : undefined}
              disabled={!prevItem}
              aria-label="Previous claim in queue (K)"
              title="Previous claim (K)"
            >
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              iconRight={<ChevronRightIcon size={16} />}
              to={nextItem ? `/audit/claims/${nextItem.claimId}${queueSearch}` : undefined}
              disabled={!nextItem}
              aria-label="Next claim in queue (J)"
              title="Next claim (J)"
            >
              Next
            </Button>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<HelpCircleIcon size={18} />}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}
            />
          </div>
        }
      />
      <div className="page-body">
        {error && !showClaim ? (
          <Card>
            <ErrorState error={error} onRetry={reload} />
            <p style={{ textAlign: 'center', marginTop: 12 }}>
              <Link to={`/audit/queue${queueSearch}`}>Back to the review queue</Link>
            </p>
          </Card>
        ) : !showClaim || (loading && !claim) ? (
          <ClaimSkeleton />
        ) : (
          <Workspace key={claim.id} claim={claim} reload={reload} queue={queue} queueSearch={queueSearch} />
        )}
      </div>
    </div>
  )
}
