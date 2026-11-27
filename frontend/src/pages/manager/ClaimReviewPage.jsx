import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { approvalsApi, claimsApi, errorMessage, isConflictError, isNotFoundError } from '../../api'
import { useAuth } from '../../auth/useAuth.js'
import Button from '../../components/Button.jsx'
import Card from '../../components/Card.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import { FlagList } from '../../components/FlagTag.jsx'
import InfoBanner from '../../components/InfoBanner.jsx'
import Modal from '../../components/Modal.jsx'
import Money from '../../components/Money.jsx'
import NotFound from '../../components/NotFound.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import Skeleton, { SkeletonText } from '../../components/Skeleton.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import TextArea from '../../components/TextArea.jsx'
import TextInput from '../../components/TextInput.jsx'
import Timeline from '../../components/Timeline.jsx'
import {
  CheckIcon,
  CornerUpLeftIcon,
  FileTextIcon,
  HelpCircleIcon,
  MessageIcon,
  ReceiptIcon,
  RefreshIcon,
  XIcon,
} from '../../components/icons.jsx'
import { useToast } from '../../components/toast/useToast.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { useIsNarrow } from '../../hooks/useMediaQuery.js'
import { formatDate, formatDateRange, formatDateTime, stepTypeLabel } from '../../utils/format.js'
import { validateComment } from '../../utils/validation.js'
import ApprovalChain from './review/ApprovalChain.jsx'
import LineReviewTable from './review/LineReviewTable.jsx'
import ReceiptPanel from './review/ReceiptPanel.jsx'
import { HEAD_APPROVAL_ABOVE, MIN_DECISION_TEXT, isTypingTarget, needsHeadApproval } from './review/reviewUtils.js'
import './review/review.css'

const DECISION_COPY = {
  APPROVE: { done: 'Approved', verb: 'approve' },
  SEND_BACK: { done: 'Sent back to the employee', verb: 'send back' },
  REJECT: { done: 'Rejected', verb: 'reject' },
}

/** M2 + M3: review a claim side by side with its receipts, then decide. */
export default function ClaimReviewPage() {
  const { claimId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { activeRole } = useAuth()
  const narrow = useIsNarrow()

  const { data: claim, error, loading, reload, setData } = useAsync(
    () => approvalsApi.getReviewClaim(claimId),
    [claimId],
  )

  const [selectedLineId, setSelectedLineId] = useState(null)
  const [receiptModalOpen, setReceiptModalOpen] = useState(false)
  const [modal, setModal] = useState(null) // 'SEND_BACK' | 'REJECT' | 'COMMENT' | 'HELP'
  const [text, setText] = useState('')
  const [textTouched, setTextTouched] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(null) // decision currently being saved
  const [conflict, setConflict] = useState(null)
  const [decided, setDecided] = useState(null) // {decision, claim}
  const textRef = useRef(null)
  const approveRef = useRef(null)

  useDocumentTitle(claim ? `Review ${claim.claimNumber}` : 'Review claim')

  // Reset local state when moving to another claim (render-time reset pattern).
  const [seenClaimId, setSeenClaimId] = useState(claimId)
  if (seenClaimId !== claimId) {
    setSeenClaimId(claimId)
    setSelectedLineId(null)
    setConflict(null)
    setDecided(null)
    setNote('')
    setNoteOpen(false)
    setModal(null)
  }

  const lines = useMemo(() => claim?.lines ?? [], [claim])
  const firstReceiptLineId = lines.find((l) => l.receipt)?.id ?? lines[0]?.id ?? null
  const activeLineId = selectedLineId && lines.some((l) => l.id === selectedLineId) ? selectedLineId : firstReceiptLineId

  const canAct = Boolean(claim?.canAct) && !decided
  const isHead = activeRole === 'FINANCE_HEAD'
  const headRequired = claim ? needsHeadApproval(claim.totalAmount) : false
  const flagCount = lines.reduce((n, l) => n + (l.flags?.length ?? 0), 0)

  const selectLine = useCallback(
    (id) => {
      setSelectedLineId(id)
      if (narrow) setReceiptModalOpen(true)
    },
    [narrow],
  )

  const openModal = useCallback((kind) => {
    setText('')
    setTextTouched(false)
    setModal(kind)
  }, [])

  const goNext = useCallback(async () => {
    try {
      const { items } = await approvalsApi.getInbox({ state: 'PENDING' })
      const next = items.find((i) => i.claimId !== claimId)
      if (next) {
        navigate(`/approvals/${next.claimId}`)
        return
      }
    } catch {
      // Fall back to the inbox below.
    }
    navigate('/approvals')
  }, [claimId, navigate])

  const runDecision = useCallback(
    async (decision, body) => {
      if (!claim || busy) return
      setBusy(decision)
      setConflict(null)
      try {
        const payload = { version: claim.version, ...body }
        let updated
        if (decision === 'APPROVE') updated = await approvalsApi.approve(claim.id, payload)
        else if (decision === 'SEND_BACK') updated = await approvalsApi.sendBack(claim.id, payload)
        else updated = await approvalsApi.reject(claim.id, payload)
        setModal(null)
        setDecided({ decision, claim: updated })
        setData(updated)
        const auditPath = `/claims/${claim.id}/audit`
        toast.success(`${claim.claimNumber}: ${DECISION_COPY[decision].done}. Recorded in the audit trail.`, {
          title: DECISION_COPY[decision].done,
          action: { label: 'View audit trail', onClick: () => navigate(auditPath) },
        })
        await goNext()
      } catch (err) {
        if (isConflictError(err)) {
          setModal(null)
          setConflict(errorMessage(err, 'This claim changed since you opened it.'))
          toast.warning('This claim changed. Reload to see the latest version.', { title: 'Conflict' })
        } else if (isNotFoundError(err)) {
          setModal(null)
          toast.error('This claim is no longer available.', { title: 'Not found' })
          reload()
        } else {
          toast.error(errorMessage(err), { title: `Couldn't ${DECISION_COPY[decision].verb}` })
        }
      } finally {
        setBusy(null)
      }
    },
    [busy, claim, goNext, navigate, reload, setData, toast],
  )

  const approve = useCallback(() => {
    const comment = note.trim()
    runDecision('APPROVE', comment ? { comment } : {})
  }, [note, runDecision])

  const textError = useMemo(() => {
    if (modal === 'SEND_BACK') return validateComment(text, { label: 'Comment', min: MIN_DECISION_TEXT })
    if (modal === 'REJECT') return validateComment(text, { label: 'Reason', min: MIN_DECISION_TEXT })
    if (modal === 'COMMENT') return validateComment(text, { label: 'Comment', min: 1 })
    return null
  }, [modal, text])

  const submitModal = useCallback(async () => {
    setTextTouched(true)
    if (textError) {
      textRef.current?.focus()
      return
    }
    const value = text.trim()
    if (modal === 'SEND_BACK') runDecision('SEND_BACK', { comment: value })
    else if (modal === 'REJECT') runDecision('REJECT', { reason: value })
    else if (modal === 'COMMENT') {
      setBusy('COMMENT')
      try {
        const updated = await claimsApi.addComment(claim.id, value)
        setData(updated)
        setModal(null)
        toast.success('Your comment was added to the claim.', { title: 'Comment added' })
      } catch (err) {
        toast.error(errorMessage(err), { title: "Couldn't add the comment" })
      } finally {
        setBusy(null)
      }
    }
  }, [claim, modal, runDecision, setData, text, textError, toast])

  // Keyboard shortcuts: A approve, S send back, R reject, J/K next/previous line, ? help.
  useEffect(() => {
    if (!claim) return undefined
    function onKey(e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
      if (modal || receiptModalOpen || isTypingTarget(e.target)) return
      if (document.querySelector('[aria-modal="true"]')) return
      const key = e.key.toLowerCase()
      if (key === '?') {
        e.preventDefault()
        setModal('HELP')
        return
      }
      if (key === 'j' || key === 'k') {
        if (lines.length === 0) return
        e.preventDefault()
        const idx = Math.max(0, lines.findIndex((l) => l.id === activeLineId))
        const nextIdx = key === 'j' ? Math.min(lines.length - 1, idx + 1) : Math.max(0, idx - 1)
        setSelectedLineId(lines[nextIdx].id)
        return
      }
      if (!canAct || busy) return
      if (key === 'a') {
        e.preventDefault()
        approve()
      } else if (key === 's') {
        e.preventDefault()
        openModal('SEND_BACK')
      } else if (key === 'r') {
        e.preventDefault()
        openModal('REJECT')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeLineId, approve, busy, canAct, claim, lines, modal, openModal, receiptModalOpen])

  const breadcrumbs = [
    { label: 'Home', to: '/' },
    { label: 'Approvals', to: '/approvals' },
    { label: claim?.claimNumber ?? 'Review' },
  ]

  /* ---------------- loading / error ---------------- */
  if (!claim) {
    if (error) {
      return (
        <div className="page">
          <PageHeader title={isNotFoundError(error) ? 'Not found' : 'Review claim'} breadcrumbs={breadcrumbs} />
          <div className="page-body">
            {isNotFoundError(error) ? <NotFound /> : <ErrorState error={error} onRetry={reload} />}
          </div>
        </div>
      )
    }
    return (
      <div className="page" aria-busy="true">
        <PageHeader title="Review claim" breadcrumbs={breadcrumbs} />
        <div className="page-body">
          <span className="sr-only" role="status">
            Loading claim…
          </span>
          <div className="rv-layout">
            <div className="rv-main">
              <Card>
                <Skeleton width="40%" height={22} />
                <div style={{ height: 12 }} />
                <SkeletonText lines={4} />
              </Card>
              <Card>
                <SkeletonText lines={6} />
              </Card>
            </div>
            {!narrow && (
              <aside className="rv-aside">
                <Skeleton height={420} />
              </aside>
            )}
          </div>
        </div>
      </div>
    )
  }

  const current = claim.currentStep
  const readOnlyReason = decided
    ? `You ${DECISION_COPY[decided.decision].verb === 'approve' ? 'approved' : DECISION_COPY[decided.decision].done.toLowerCase()} this claim.`
    : current
      ? `This claim is waiting on the ${stepTypeLabel(current.stepType).toLowerCase()} step${
          current.assigneeName ? ` (${current.assigneeName})` : ''
        }, so it is read-only for you.`
      : 'This claim is no longer pending, so it is read-only.'

  /* ---------------- page ---------------- */
  return (
    <div className="page rv-page">
      <PageHeader
        title={claim.claimNumber}
        eyebrow={isHead ? 'Final sign-off review' : 'Claim review'}
        subtitle={claim.title}
        breadcrumbs={breadcrumbs}
        meta={
          <span className="rv-header-meta">
            <StatusChip status={claim.status} />
            {claim.actingOnBehalfOfName && canAct && (
              <span className="rv-delegated">
                <FlagList flags={['DELEGATED']} /> on behalf of {claim.actingOnBehalfOfName}
              </span>
            )}
          </span>
        }
        actions={
          <Button variant="secondary" size="sm" to={`/claims/${claim.id}/audit`} icon={<FileTextIcon size={16} />}>
            View audit trail
          </Button>
        }
      />
      <div className="page-body">
        {conflict && (
          <InfoBanner
            tone="warning"
            title="This claim changed, reload"
            live
            action={
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshIcon size={16} />}
                loading={loading}
                onClick={async () => {
                  await reload()
                  setConflict(null)
                }}
              >
                Reload
              </Button>
            }
          >
            {conflict} Someone else may have acted on it. Reload to see the latest version before deciding.
          </InfoBanner>
        )}
        {!canAct && (
          <InfoBanner tone={decided ? 'success' : 'info'} title={decided ? 'Decision recorded' : 'Read-only view'} live>
            {readOnlyReason}{' '}
            <Link to={`/claims/${claim.id}/audit`}>View audit trail</Link> · <Link to="/approvals">Back to inbox</Link>
          </InfoBanner>
        )}
        {error && claim && <ErrorState error={error} onRetry={reload} compact />}

        <div className="rv-layout">
          <div className="rv-main">
            <Card title="Claim details" headingLevel={2}>
              <dl className="rv-facts">
                <div>
                  <dt>Employee</dt>
                  <dd>
                    {claim.employeeName}
                    {claim.employeeCode && <span className="muted"> · {claim.employeeCode}</span>}
                  </dd>
                </div>
                <div>
                  <dt>Department</dt>
                  <dd>{claim.departmentName || '—'}</dd>
                </div>
                <div className="rv-fact-wide">
                  <dt>Purpose</dt>
                  <dd>{claim.purpose || '—'}</dd>
                </div>
                <div>
                  <dt>Trip dates</dt>
                  <dd>{formatDateRange(claim.tripStartDate, claim.tripEndDate)}</dd>
                </div>
                <div>
                  <dt>Total</dt>
                  <dd className="rv-total">
                    <Money value={claim.totalAmount} strong />
                  </dd>
                </div>
                <div>
                  <dt>Submission</dt>
                  <dd>
                    No. {claim.submissionNo ?? 1}
                    {claim.submittedAt && <span className="muted"> · {formatDateTime(claim.submittedAt)}</span>}
                  </dd>
                </div>
                <div>
                  <dt>Policy version</dt>
                  <dd>{claim.policyVersionNo ? `v${claim.policyVersionNo}` : '—'}</dd>
                </div>
              </dl>
              <div className="rv-chain-wrap">
                <h3 className="rv-subhead">Approval chain</h3>
                <ApprovalChain steps={claim.approvalSteps} />
                <p className="rv-chain-note muted">
                  {headRequired ? (
                    <>
                      Total is above <Money value={HEAD_APPROVAL_ABOVE} whole />, so finance-head sign-off is required.
                    </>
                  ) : (
                    <>
                      Total is <Money value={HEAD_APPROVAL_ABOVE} whole /> or less, so no finance-head sign-off is
                      needed.
                    </>
                  )}
                </p>
              </div>
            </Card>

            <Card
              title="Expense lines"
              subtitle={
                flagCount > 0
                  ? `${flagCount} flag${flagCount === 1 ? '' : 's'} to check. Flags never block approval.`
                  : 'No policy flags on this claim.'
              }
              headingLevel={2}
              padded={false}
            >
              {lines.length === 0 ? (
                <p className="muted rv-pad">This claim has no lines.</p>
              ) : (
                <LineReviewTable
                  lines={lines}
                  selectedId={activeLineId}
                  onSelect={selectLine}
                  total={claim.totalAmount}
                  narrow={narrow}
                />
              )}
            </Card>

            <Card title="Comments and history" headingLevel={2}>
              <Timeline statusHistory={claim.statusHistory} comments={claim.comments} order="desc" />
            </Card>
          </div>

          {!narrow && (
            <aside className="rv-aside" aria-label="Receipts">
              <div className="rv-aside-sticky">
                <h2 className="rv-aside-title">
                  <ReceiptIcon size={18} aria-hidden="true" /> Receipt
                </h2>
                <ReceiptPanel lines={lines} selectedId={activeLineId} onSelect={setSelectedLineId} height={460} />
              </div>
            </aside>
          )}
        </div>

        {narrow && lines.some((l) => l.receipt) && (
          <Button
            variant="secondary"
            block
            icon={<ReceiptIcon size={18} />}
            onClick={() => setReceiptModalOpen(true)}
          >
            View receipts
          </Button>
        )}
      </div>

      {/* M3 sticky decision bar (comes after the content it acts on). */}
      <div className="rv-decision-bar" role="region" aria-label="Decision">
        <div className="rv-decision-inner">
          {canAct ? (
            <>
              {noteOpen && (
                <div className="rv-note">
                  <TextInput
                    id="rv-approve-note"
                    label="Approval note (optional)"
                    size="sm"
                    value={note}
                    maxLength={2000}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note for the record"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        approve()
                      }
                    }}
                  />
                </div>
              )}
              <div className="rv-decision-actions">
                <Button
                  ref={approveRef}
                  variant="primary"
                  icon={<CheckIcon size={18} />}
                  loading={busy === 'APPROVE'}
                  loadingLabel="Approving…"
                  disabled={Boolean(busy) && busy !== 'APPROVE'}
                  onClick={approve}
                  aria-keyshortcuts="A"
                >
                  Approve <kbd className="rv-kbd" aria-hidden="true">A</kbd>
                </Button>
                <Button
                  variant="secondary"
                  icon={<CornerUpLeftIcon size={18} />}
                  disabled={Boolean(busy)}
                  onClick={() => openModal('SEND_BACK')}
                  aria-keyshortcuts="S"
                >
                  Send back <kbd className="rv-kbd" aria-hidden="true">S</kbd>
                </Button>
                <Button
                  variant="danger"
                  icon={<XIcon size={18} />}
                  disabled={Boolean(busy)}
                  onClick={() => openModal('REJECT')}
                  aria-keyshortcuts="R"
                >
                  Reject <kbd className="rv-kbd" aria-hidden="true">R</kbd>
                </Button>
                <span className="rv-decision-secondary">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={noteOpen}
                    aria-controls={noteOpen ? 'rv-approve-note' : undefined}
                    onClick={() => setNoteOpen((v) => !v)}
                  >
                    {noteOpen ? 'Hide note' : 'Add note'}
                  </Button>
                  <Button variant="ghost" size="sm" icon={<MessageIcon size={16} />} onClick={() => openModal('COMMENT')}>
                    Comment
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label="Keyboard shortcuts"
                    onClick={() => setModal('HELP')}
                    icon={<HelpCircleIcon size={18} />}
                  />
                </span>
              </div>
            </>
          ) : (
            <div className="rv-decision-actions">
              <span className="rv-decision-status">
                <StatusChip status={claim.status} /> {claim.decidedAt && `Decided ${formatDate(claim.decidedAt)}`}
              </span>
              <span className="rv-decision-secondary">
                <Button variant="ghost" size="sm" icon={<MessageIcon size={16} />} onClick={() => openModal('COMMENT')}>
                  Comment
                </Button>
                <Button variant="secondary" size="sm" to="/approvals">
                  Back to inbox
                </Button>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Receipt modal for narrow screens */}
      <Modal
        open={narrow && receiptModalOpen}
        onClose={() => setReceiptModalOpen(false)}
        title={`Receipts · ${claim.claimNumber}`}
        size="full"
      >
        <ReceiptPanel lines={lines} selectedId={activeLineId} onSelect={setSelectedLineId} height={360} />
      </Modal>

      {/* Send back / reject / comment */}
      <Modal
        open={modal === 'SEND_BACK' || modal === 'REJECT' || modal === 'COMMENT'}
        onClose={() => !busy && setModal(null)}
        initialFocusRef={textRef}
        title={
          modal === 'SEND_BACK' ? 'Send back to employee' : modal === 'REJECT' ? 'Reject claim' : 'Add a comment'
        }
        description={
          modal === 'SEND_BACK'
            ? `${claim.employeeName} can edit and resubmit ${claim.claimNumber}. Say what needs to change.`
            : modal === 'REJECT'
              ? `Rejecting ${claim.claimNumber} is final. The employee sees your reason.`
              : 'Your comment is visible to the employee and the approvers.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)} disabled={Boolean(busy)}>
              Cancel
            </Button>
            <Button
              variant={modal === 'REJECT' ? 'danger' : 'primary'}
              onClick={submitModal}
              loading={Boolean(busy)}
              disabled={Boolean(textError)}
              icon={
                modal === 'REJECT' ? (
                  <XIcon size={18} />
                ) : modal === 'SEND_BACK' ? (
                  <CornerUpLeftIcon size={18} />
                ) : (
                  <MessageIcon size={18} />
                )
              }
            >
              {modal === 'SEND_BACK' ? 'Send back' : modal === 'REJECT' ? 'Reject claim' : 'Add comment'}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submitModal()
          }}
        >
          <TextArea
            ref={textRef}
            label={modal === 'REJECT' ? 'Reason for rejection' : 'Comment'}
            required
            rows={5}
            showCount
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setTextTouched(true)}
            hint={
              modal === 'COMMENT' ? undefined : `At least ${MIN_DECISION_TEXT} characters. Stored in the audit trail.`
            }
            error={textTouched ? textError : undefined}
          />
        </form>
      </Modal>

      {/* Keyboard shortcut help */}
      <Modal open={modal === 'HELP'} onClose={() => setModal(null)} title="Keyboard shortcuts" size="sm">
        <dl className="rv-shortcuts">
          {[
            ['A', 'Approve'],
            ['S', 'Send back (opens comment)'],
            ['R', 'Reject (opens reason)'],
            ['J / K', 'Next / previous line'],
            ['+ / − / 0', 'Zoom receipt in / out / reset'],
            ['?', 'Show this help'],
          ].map(([k, label]) => (
            <div key={k}>
              <dt>
                <kbd className="rv-kbd">{k}</kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">Shortcuts are ignored while you type in a field.</p>
      </Modal>
    </div>
  )
}
