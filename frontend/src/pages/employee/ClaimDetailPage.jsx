import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { claimsApi, referenceApi, isConflictError, errorMessage, fieldErrors } from '../../api'
import PageHeader from '../../components/PageHeader.jsx'
import Button from '../../components/Button.jsx'
import Card from '../../components/Card.jsx'
import InfoBanner from '../../components/InfoBanner.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import OutcomeBadge from '../../components/OutcomeBadge.jsx'
import Money from '../../components/Money.jsx'
import Timeline from '../../components/Timeline.jsx'
import TextArea from '../../components/TextArea.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import Skeleton, { SkeletonText } from '../../components/Skeleton.jsx'
import { FlagList } from '../../components/FlagTag.jsx'
import {
  CornerUpLeftIcon,
  EditIcon,
  FileTextIcon,
  MessageIcon,
  RefreshIcon,
  SendIcon,
  ShieldIcon,
  TrashIcon,
} from '../../components/icons.jsx'
import { useToast } from '../../components/toast/useToast.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { formatDate, formatDateRange, formatDateTime } from '../../utils/format.js'
import { validateComment } from '../../utils/validation.js'
import { employeeFlags, isNeverSubmitted, latestComment, nextStepInfo } from './emp-view/claimView.js'
import ApprovalChain from './emp-view/ApprovalChain.jsx'
import DetailLineCard from './emp-view/DetailLineCard.jsx'
import ReceiptModal from './emp-view/ReceiptModal.jsx'
import './emp-view/employee-view.css'

const MAX_COMMENT = 2000

function commentError(text) {
  return validateComment(text, { label: 'Reply', required: true, max: MAX_COMMENT })
}

function DetailSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <div className="page-header page-body">
        <Skeleton width={220} height={14} />
        <div style={{ height: 12 }} />
        <Skeleton width="60%" height={32} />
      </div>
      <div className="page-body stack" aria-label="Loading claim">
        <div className="card card-pad">
          <SkeletonText lines={3} />
        </div>
        <div className="emp-detail-grid">
          <div className="stack">
            {[0, 1].map((i) => (
              <div key={i} className="card card-pad">
                <SkeletonText lines={4} />
              </div>
            ))}
          </div>
          <div className="card card-pad">
            <SkeletonText lines={6} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** E7: the employee's view of one of their claims. */
export default function ClaimDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: claim, error, loading, reload, setData } = useAsync(() => claimsApi.getClaim(id), [id])
  const { data: policy } = useAsync(() => referenceApi.getCurrentPolicy().catch(() => null), [])
  useDocumentTitle(claim ? `${claim.claimNumber} · ${claim.title}` : 'Claim details')

  const [conflict, setConflict] = useState(false)
  const [receiptLine, setReceiptLine] = useState(null)
  const [comment, setComment] = useState('')
  const [commentErr, setCommentErr] = useState(null)
  const [commenting, setCommenting] = useState(false)
  const [resubmitOpen, setResubmitOpen] = useState(false)
  const [reply, setReply] = useState('')
  const [replyErr, setReplyErr] = useState(null)
  const [resubmitting, setResubmitting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleConflict = (err) => {
    if (isConflictError(err)) {
      setConflict(true)
      toast.error('This claim changed since you opened it. Reload to see the latest version.', { title: 'Claim changed' })
      return true
    }
    return false
  }

  const reloadLatest = async () => {
    setConflict(false)
    await reload()
  }

  if (!claim && loading) return <DetailSkeleton />
  if (!claim && error) {
    return (
      <div className="page">
        <div className="page-body emp-detail-error">
          <ErrorState error={error} onRetry={reload} />
        </div>
      </div>
    )
  }
  if (!claim) return <DetailSkeleton />

  const info = nextStepInfo(claim, policy)
  const sendBack = claim.status === 'SENT_BACK' ? latestComment(claim.comments, 'SEND_BACK') : null
  const sendBackStep = claim.status === 'SENT_BACK' ? [...claim.approvalSteps].reverse().find((s) => s.status === 'SENT_BACK') : null
  const canDelete = isNeverSubmitted(claim)
  const flags = employeeFlags(claim.flags)
  const finalRejected = claim.status === 'REJECTED' || claim.status === 'AUTO_REJECTED'

  const submitComment = async (e) => {
    e.preventDefault()
    const text = comment.trim()
    if (!text) return setCommentErr('Write a comment first.')
    if (text.length > MAX_COMMENT) return setCommentErr(`Keep it under ${MAX_COMMENT} characters.`)
    setCommentErr(null)
    setCommenting(true)
    try {
      const updated = await claimsApi.addComment(claim.id, text)
      setData(updated)
      setComment('')
      toast.success('Your comment was added.', { title: 'Comment posted' })
    } catch (err) {
      if (!handleConflict(err)) {
        setCommentErr(fieldErrors(err)?.text ?? null)
        toast.error(errorMessage(err), { title: "Couldn't post the comment" })
      }
    } finally {
      setCommenting(false)
    }
  }

  const resubmit = async () => {
    const msg = commentError(reply)
    if (msg) {
      setReplyErr(msg)
      return
    }
    setResubmitting(true)
    try {
      const updated = await claimsApi.submitClaim(claim.id, { comment: reply.trim(), version: claim.version })
      setData(updated)
      setResubmitOpen(false)
      setReply('')
      const to = updated.currentStep ? updated.currentStep.assigneeName || updated.currentStep.poolLabel : null
      toast.success(to ? `Resubmitted. It is back with ${to}.` : 'Your claim was resubmitted.', { title: 'Claim resubmitted' })
    } catch (err) {
      if (handleConflict(err)) setResubmitOpen(false)
      else if (err?.status === 422) {
        const blockers = err.details?.blockers ?? []
        setReplyErr(blockers.length ? blockers.map((b) => b.message).join(' ') : errorMessage(err))
        toast.error('Fix the problems on the claim before resubmitting.', { title: "Couldn't resubmit" })
      } else {
        setReplyErr(fieldErrors(err)?.comment ?? null)
        toast.error(errorMessage(err), { title: "Couldn't resubmit" })
      }
    } finally {
      setResubmitting(false)
    }
  }

  const deleteDraft = async () => {
    setDeleting(true)
    try {
      await claimsApi.deleteClaim(claim.id)
      toast.success(`${claim.claimNumber} was deleted.`, { title: 'Draft deleted' })
      navigate('/claims', { replace: true })
    } catch (err) {
      setDeleting(false)
      setDeleteOpen(false)
      if (!handleConflict(err)) toast.error(errorMessage(err), { title: "Couldn't delete the draft" })
    }
  }

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'My claims', to: '/claims' }, { label: claim.claimNumber }]}
        eyebrow={claim.claimNumber}
        title={claim.title}
        meta={
          <>
            <StatusChip status={claim.status} />
            {flags.length > 0 && <FlagList flags={flags} />}
          </>
        }
        actions={
          <>
            {claim.editable && (
              <Button to={`/claims/${claim.id}/edit`} icon={<EditIcon size={18} />}>
                {claim.status === 'SENT_BACK' ? 'Edit & resubmit' : 'Continue editing'}
              </Button>
            )}
            <Button to={`/claims/${claim.id}/audit`} variant="secondary" icon={<ShieldIcon size={18} />}>
              View audit trail
            </Button>
            {canDelete && (
              <Button variant="danger-outline" icon={<TrashIcon size={18} />} onClick={() => setDeleteOpen(true)}>
                Delete draft
              </Button>
            )}
          </>
        }
      />

      <div className="page-body stack">
        {conflict && (
          <InfoBanner
            tone="warning"
            title="This claim changed"
            live
            action={
              <Button size="sm" variant="secondary" icon={<RefreshIcon size={16} />} loading={loading} onClick={reloadLatest}>
                Reload
              </Button>
            }
          >
            Someone updated this claim after you opened it. Reload to see the latest version before you continue.
          </InfoBanner>
        )}
        {error && claim && !conflict && (
          <ErrorState error={error} onRetry={reload} compact title="We couldn't refresh this claim" />
        )}

        <section className="card card-pad emp-summary" aria-label="Claim summary">
          <dl className="emp-summary-grid">
            <div>
              <dt>Total</dt>
              <dd className="emp-summary-total">
                <Money value={claim.totalAmount} strong />
              </dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>{claim.submittedAt ? formatDateTime(claim.submittedAt) : 'Not yet'}</dd>
            </div>
            <div>
              <dt>Trip dates</dt>
              <dd>{claim.tripStartDate ? formatDateRange(claim.tripStartDate, claim.tripEndDate) : '—'}</dd>
            </div>
            <div>
              <dt>Lines</dt>
              <dd>{claim.lines.length}</dd>
            </div>
            <div>
              <dt>Policy check</dt>
              <dd>{claim.policyOutcome ? <OutcomeBadge outcome={claim.policyOutcome} size="sm" /> : <span className="muted">Runs on submit</span>}</dd>
            </div>
            {claim.paidAt && (
              <div>
                <dt>Paid on</dt>
                <dd>{formatDate(claim.paidAt)}</dd>
              </div>
            )}
          </dl>
          {claim.purpose && <p className="emp-purpose">{claim.purpose}</p>}
        </section>

        <InfoBanner tone={info.tone} title={info.title}>
          {info.text}
        </InfoBanner>

        {finalRejected && claim.decisionReason && (
          <InfoBanner tone="danger" title={claim.status === 'AUTO_REJECTED' ? 'Why it was auto-rejected' : 'Rejection reason'}>
            {claim.decisionReason}
          </InfoBanner>
        )}

        {claim.status === 'SENT_BACK' && (
          <section className="card card-pad emp-sendback" aria-labelledby="sendback-h">
            <div className="emp-sendback-head">
              <span className="emp-sendback-icon" aria-hidden="true">
                <CornerUpLeftIcon size={22} />
              </span>
              <div>
                <h2 id="sendback-h" className="emp-section-title">
                  Changes requested
                </h2>
                <p className="muted">
                  {sendBack?.authorName ?? sendBackStep?.actedByName ?? 'Your approver'}
                  {sendBack?.at || sendBackStep?.actedAt ? ` · ${formatDateTime(sendBack?.at ?? sendBackStep?.actedAt)}` : ''}
                </p>
              </div>
            </div>
            <blockquote className="emp-sendback-quote">{sendBack?.text ?? sendBackStep?.comment ?? 'No comment was given.'}</blockquote>
            <p className="muted emp-sendback-note">
              If you resubmit without changing any lines, the claim goes straight back to the approver who sent it back. If you edit
              lines, policy checks run again and approval restarts at your manager.
            </p>
            <div className="row">
              <Button to={`/claims/${claim.id}/edit`} icon={<EditIcon size={18} />}>
                Edit &amp; resubmit
              </Button>
              <Button variant="secondary" icon={<SendIcon size={18} />} onClick={() => setResubmitOpen(true)}>
                Resubmit without changes
              </Button>
            </div>
          </section>
        )}

        <div className="emp-detail-grid">
          <div className="stack">
            <Card title={`Expense lines (${claim.lines.length})`} headingLevel={2}>
              {claim.lines.length === 0 ? (
                <div className="emp-empty-lines">
                  <FileTextIcon size={28} aria-hidden="true" />
                  <p>No lines yet.</p>
                  {claim.editable && (
                    <Button to={`/claims/${claim.id}/edit`} variant="secondary" size="sm">
                      Add lines
                    </Button>
                  )}
                </div>
              ) : (
                <ol className="emp-line-list">
                  {claim.lines.map((line) => (
                    <li key={line.id}>
                      <DetailLineCard line={line} onOpenReceipt={() => setReceiptLine(line)} />
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card title="Activity" headingLevel={2}>
              <Timeline statusHistory={claim.statusHistory} comments={claim.comments} />
              <form className="emp-comment-form" onSubmit={submitComment} noValidate>
                <TextArea
                  label="Add a comment"
                  rows={3}
                  showCount
                  maxLength={MAX_COMMENT}
                  value={comment}
                  error={commentErr}
                  onChange={(e) => {
                    setComment(e.target.value)
                    if (commentErr) setCommentErr(null)
                  }}
                  placeholder="Add context for your approver"
                />
                <div className="row row-end">
                  <Button type="submit" icon={<MessageIcon size={18} />} loading={commenting} loadingLabel="Posting…">
                    Post comment
                  </Button>
                </div>
              </form>
            </Card>
          </div>

          <aside className="stack" aria-label="Approval chain">
            <Card title="Approval chain" headingLevel={2}>
              <ApprovalChain steps={claim.approvalSteps} status={claim.status} />
            </Card>
            <Card title="Policy outcome" headingLevel={2}>
              {claim.policyOutcome ? (
                <p>
                  <OutcomeBadge outcome={claim.policyOutcome} /> <span className="muted">is the worst line result, so it applies to the whole claim.</span>
                </p>
              ) : (
                <p className="muted">Policy checks run when you submit.</p>
              )}
              <p className="emp-audit-link">
                <Link to={`/claims/${claim.id}/audit`}>View the full audit trail</Link>
              </p>
            </Card>
          </aside>
        </div>
      </div>

      <ReceiptModal line={receiptLine} claimId={claim.id} onClose={() => setReceiptLine(null)} />

      <ConfirmDialog
        open={resubmitOpen}
        title="Resubmit without changes"
        message="Your reply goes to the approver who sent the claim back, and the claim returns to them."
        confirmLabel="Resubmit"
        icon={<SendIcon size={22} />}
        loading={resubmitting}
        onConfirm={resubmit}
        onCancel={() => {
          if (resubmitting) return
          setResubmitOpen(false)
          setReplyErr(null)
        }}
      >
        <TextArea
          label="Reply to approver"
          required
          rows={4}
          showCount
          maxLength={MAX_COMMENT}
          value={reply}
          error={replyErr}
          onChange={(e) => {
            setReply(e.target.value)
            if (replyErr) setReplyErr(null)
          }}
          hint="Explain what you checked or why no change is needed."
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this draft?"
        message={`${claim.claimNumber} and its ${claim.lines.length} line(s) will be removed. This cannot be undone.`}
        confirmLabel="Delete draft"
        tone="danger"
        icon={<TrashIcon size={22} />}
        loading={deleting}
        onConfirm={deleteDraft}
        onCancel={() => !deleting && setDeleteOpen(false)}
      />
    </div>
  )
}
