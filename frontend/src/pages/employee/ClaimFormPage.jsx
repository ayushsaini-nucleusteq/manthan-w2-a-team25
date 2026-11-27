import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader.jsx'
import StepColumns from '../../components/StepColumns.jsx'
import TextInput from '../../components/TextInput.jsx'
import TextArea from '../../components/TextArea.jsx'
import DateInput from '../../components/DateInput.jsx'
import Button from '../../components/Button.jsx'
import InfoBanner from '../../components/InfoBanner.jsx'
import OutcomeBadge from '../../components/OutcomeBadge.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import Money from '../../components/Money.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import ErrorState from '../../components/ErrorState.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Accordion from '../../components/Accordion.jsx'
import Skeleton, { SkeletonText } from '../../components/Skeleton.jsx'
import Spinner from '../../components/Spinner.jsx'
import { FlagList } from '../../components/FlagTag.jsx'
import {
  Icon,
  PlusIcon,
  EditIcon,
  TrashIcon,
  SendIcon,
  CheckIcon,
  AlertTriangleIcon,
  ReceiptIcon,
  ArrowRightIcon,
  WifiOffIcon,
  RefreshIcon,
} from '../../components/icons.jsx'
import { useToast } from '../../components/toast/useToast.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js'
import { claimsApi, referenceApi, errorMessage, fieldErrors, isApiError } from '../../api'
import { CATEGORY_META, FIELD_LIMITS, SUBMIT_BLOCKER_LABEL } from '../../utils/constants.js'
import { categoryLabel, formatDate, formatMoney, stepTypeLabel, statusLabel } from '../../utils/format.js'
import { addMoney, isPositiveMoney } from '../../utils/money.js'
import { isReceiptRequired, isValid, validateClaimHeader, validateComment } from '../../utils/validation.js'
import LineEditor from './emp-form/LineEditor.jsx'
import FindingList from './emp-form/FindingList.jsx'
import {
  QUEUE_EVENT,
  applyLocal,
  enqueue,
  isNetworkError,
  newUuid,
  pendingCount,
  readSnapshot,
  replayQueue,
} from './emp-form/offlineDrafts.js'
import './emp-form/emp-form.css'

function headerFrom(claim) {
  return {
    title: claim?.title ?? '',
    purpose: claim?.purpose ?? '',
    tripStartDate: claim?.tripStartDate ?? '',
    tripEndDate: claim?.tripEndDate ?? '',
  }
}

function headerPayload(h) {
  return {
    title: h.title.trim(),
    purpose: h.purpose.trim(),
    tripStartDate: h.tripStartDate || null,
    tripEndDate: h.tripEndDate || null,
  }
}

async function loadClaim(id) {
  const snapshot = readSnapshot(id)
  if (snapshot && pendingCount(id) > 0) return snapshot
  try {
    return await claimsApi.getClaim(id)
  } catch (error) {
    if (snapshot && (isNetworkError(error) || error?.status === 404)) return snapshot
    throw error
  }
}

function subscribeQueue(cb) {
  window.addEventListener(QUEUE_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(QUEUE_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

function submitToast(toast, claim, resubmit) {
  switch (claim.status) {
    case 'AUTO_APPROVED':
      toast.success('Every line is within policy, so your claim was auto-approved.', { title: 'Claim auto-approved' })
      break
    case 'AUTO_REJECTED':
      toast.error(claim.decisionReason || 'A line is over a hard limit or duplicates another receipt.', { title: 'Claim auto-rejected' })
      break
    case 'PENDING_MANAGER':
      toast.success(resubmit ? 'Resubmitted. It goes to your manager for approval.' : 'Sent to your manager for approval.', { title: 'Claim submitted' })
      break
    default:
      toast.success(`Status: ${statusLabel(claim.status)}.`, { title: resubmit ? 'Claim resubmitted' : 'Claim submitted' })
  }
}

/* ------------------------------------------------------------------ */
/* Line card (column 2)                                                */
/* ------------------------------------------------------------------ */

function LineCard({ line, threshold, onEdit, onDelete, disabled }) {
  const meta = CATEGORY_META[line.category] ?? {}
  const needsReceipt = isReceiptRequired(line.amount, threshold)
  return (
    <li className="ef-line card">
      <span className={`ef-cat-icon tone-${meta.tone ?? 'neutral'}`} aria-hidden="true">
        <Icon name={meta.icon ?? 'receipt'} size={20} />
      </span>
      <div className="ef-line-main">
        <div className="ef-line-top">
          <strong className="ef-ellipsis">
            {line.lineNo ? `${line.lineNo}. ` : ''}
            {line.vendor}
          </strong>
          <Money value={line.amount} strong />
        </div>
        <p className="ef-line-sub">
          {categoryLabel(line.category)} · {formatDate(line.expenseDate)}
          {line.category === 'HOTEL' && line.city ? ` · ${line.city}, ${line.nights} night${line.nights === 1 ? '' : 's'}` : ''}
        </p>
        <div className="row row-sm ef-line-tags">
          {line.policyOutcome ? (
            <OutcomeBadge outcome={line.policyOutcome} size="sm" />
          ) : (
            <span className="ef-pill">Policy check pending</span>
          )}
          {line.receipt ? (
            <span className="ef-pill is-ok">
              <CheckIcon size={12} /> Receipt
            </span>
          ) : needsReceipt ? (
            <span className="ef-pill is-bad">
              <AlertTriangleIcon size={12} /> Receipt required
            </span>
          ) : (
            <span className="ef-pill">No receipt</span>
          )}
          <FlagList flags={line.flags ?? []} />
        </div>
      </div>
      <div className="ef-line-actions">
        <Button variant="ghost" size="sm" iconOnly aria-label={`Edit line ${line.lineNo ?? ''} ${line.vendor}`} icon={<EditIcon size={16} />} onClick={onEdit} disabled={disabled} />
        <Button variant="ghost" size="sm" iconOnly aria-label={`Delete line ${line.lineNo ?? ''} ${line.vendor}`} icon={<TrashIcon size={16} />} onClick={onDelete} disabled={disabled} />
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Review panel (column 3, E6)                                         */
/* ------------------------------------------------------------------ */

function ReviewPanel({ claim, preview, canCheck, serverBlockers, onFix, sentBack, reply, setReply, replyError, onReplyBlur }) {
  const { data, error, loading, reload } = preview
  const blockers = serverBlockers ?? data?.submitBlockers ?? []

  return (
    <div className="stack">
      {sentBack && (
        <TextArea
          label="Reply to approver"
          required
          rows={3}
          showCount
          maxLength={FIELD_LIMITS.comment}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onBlur={onReplyBlur}
          error={replyError}
          hint="Sent with the resubmission. Explain what you changed or why no change is needed."
        />
      )}
      {!canCheck ? (
        <InfoBanner tone="offline" title="Review needs a connection">
          The pre-submit check runs when you're online and the draft has synced.
        </InfoBanner>
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} compact />
      ) : !data ? (
        <div className="stack stack-sm" aria-busy="true">
          <Skeleton height={28} width="60%" />
          <SkeletonText lines={4} />
        </div>
      ) : (
        <>
          <div className="ef-review-summary">
            <div className="row row-between">
              <span className="ef-muted">Claim outcome</span>
              {loading && <Spinner size={14} label="Refreshing check" />}
            </div>
            {data.claimOutcome ? <OutcomeBadge outcome={data.claimOutcome} /> : <span className="ef-muted">Add lines to see the outcome.</span>}
            <div className="row row-between">
              <span className="ef-muted">Total</span>
              <Money value={data.totalAmount} strong />
            </div>
            {data.expectedStatus && (
              <p className="ef-muted">
                After submit: <StatusChip status={data.expectedStatus} size="sm" />
              </p>
            )}
            {data.routePreview?.length > 0 && (
              <ol className="ef-route" aria-label="Approval route">
                {data.routePreview.map((step, i) => (
                  <li key={step}>
                    {i > 0 && <ArrowRightIcon size={14} aria-hidden="true" />}
                    <span className="ef-route-chip">{stepTypeLabel(step)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {blockers.length > 0 && (
            <InfoBanner tone="danger" title={`Fix ${blockers.length === 1 ? 'this' : 'these'} before submitting`} live>
              <ul className="ef-blockers">
                {blockers.map((b, i) => (
                  <li key={`${b.lineId}-${b.code}-${i}`}>
                    <span>
                      <strong>{SUBMIT_BLOCKER_LABEL[b.code] ?? 'Blocked'}:</strong> {b.message}
                    </span>
                    {b.lineId && (
                      <Button variant="secondary" size="sm" onClick={() => onFix(b.lineId)}>
                        Fix line {b.lineNo}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </InfoBanner>
          )}

          {data.lines?.length > 0 && (
            <ul className="ef-review-lines">
              {data.lines.map((l) => {
                const line = claim.lines.find((x) => x.id === l.lineId)
                return (
                  <li key={l.lineId}>
                    <div className="row row-between">
                      <strong>
                        Line {l.lineNo}: {line ? `${categoryLabel(line.category)}, ${line.vendor}` : ''}
                      </strong>
                      {l.outcome && <OutcomeBadge outcome={l.outcome} size="sm" />}
                    </div>
                    <FindingList findings={l.findings} compact />
                  </li>
                )
              })}
            </ul>
          )}

          <Accordion
            headingLevel={3}
            items={[
              {
                id: 'rules',
                title: 'How policy rules work',
                content: (
                  <ul className="ef-help-list">
                    <li>Within the limit: the line can be auto-approved.</li>
                    <li>Over the soft limit, a weekend date, a possible duplicate or a category without a rule: a person must approve it.</li>
                    <li>Over the hard limit or a reused receipt: the claim is auto-rejected.</li>
                    <li>Claims above {formatMoney('25000.00', { whole: true })} also go to the finance auditor; above {formatMoney('100000.00', { whole: true })} to the finance head.</li>
                  </ul>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The form                                                            */
/* ------------------------------------------------------------------ */

function ClaimForm({ initialClaim, categories, policy, onCreated }) {
  const toast = useToast()
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const [claim, setClaimState] = useState(initialClaim)
  const claimRef = useRef(initialClaim)
  const setClaim = useCallback((c) => {
    claimRef.current = c
    setClaimState(c)
  }, [])

  const [header, setHeader] = useState(() => headerFrom(initialClaim))
  const [savedHeader, setSavedHeader] = useState(() => JSON.stringify(headerFrom(initialClaim)))
  const [touched, setTouched] = useState({})
  const [serverErrors, setServerErrors] = useState({})
  const [savingHeader, setSavingHeader] = useState(false)
  const [current, setCurrent] = useState(0)
  const [editor, setEditor] = useState(null) // {lineId, line}
  const [toDelete, setToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [reply, setReply] = useState('')
  const [replyTouched, setReplyTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [serverBlockers, setServerBlockers] = useState(null)
  const savePromise = useRef(null)
  const step1Ref = useRef(null)

  const claimId = claim?.id ?? null
  const pending = useSyncExternalStore(subscribeQueue, () => (claimId ? pendingCount(claimId) : 0), () => 0)
  const isOfflineDraft = Boolean(claim?.offline) || pending > 0
  const canCheck = online && Boolean(claimId) && !isOfflineDraft
  const sentBack = claim?.status === 'SENT_BACK'
  const sendBackComment = sentBack ? [...(claim.comments ?? [])].reverse().find((c) => c.kind === 'SEND_BACK') : null
  const threshold = policy?.receiptThreshold ?? '500.00'

  const headerErrors = { ...validateClaimHeader(header), ...serverErrors }
  const headerValid = isValid(headerErrors)
  const headerDirty = JSON.stringify(header) !== savedHeader
  const lines = claim?.lines ?? []
  const runningTotal = lines.reduce((sum, l) => addMoney(sum, l.amount), '0.00')
  const showErr = (f) => (touched[f] || serverErrors[f] ? headerErrors[f] : undefined)

  useDocumentTitle(claim?.claimNumber ? `Edit ${claim.claimNumber}` : 'New claim')

  /* ---- Online / offline plumbing ---- */
  const perform = useCallback(
    async (op, apiCall) => {
      const offlineMode = !navigator.onLine || pendingCount(op.claimId) > 0 || claimRef.current?.offline
      if (!offlineMode) {
        try {
          const result = await apiCall()
          setClaim(result)
          return result
        } catch (error) {
          if (!isNetworkError(error)) throw error
        }
      }
      enqueue(op)
      const local = applyLocal(claimRef.current, op)
      setClaim(local)
      return local
    },
    [setClaim],
  )

  const handleConflict = (error) => {
    if (isApiError(error) && error.status === 409) {
      setConflict(true)
      return true
    }
    return false
  }

  const reloadClaim = useCallback(async () => {
    const id = claimRef.current?.id
    if (!id) return
    try {
      const fresh = await claimsApi.getClaim(id)
      setClaim(fresh)
      setHeader(headerFrom(fresh))
      setSavedHeader(JSON.stringify(headerFrom(fresh)))
      setConflict(false)
      setServerBlockers(null)
      if (!fresh.editable) navigate(`/claims/${id}`, { replace: true })
    } catch (error) {
      toast.error(errorMessage(error), { title: 'Could not reload the claim' })
    }
  }, [navigate, setClaim, toast])

  // Replay queued offline changes when the connection returns.
  useEffect(() => {
    const sync = async () => {
      if (!navigator.onLine || pendingCount() === 0) return
      const result = await replayQueue(claimsApi)
      const id = claimRef.current?.id
      if (result.failed.length) {
        toast.error(`${result.failed.length} offline change(s) could not be applied: ${errorMessage(result.failed[0].error)}`, { title: 'Sync problem' })
      }
      if (result.synced > 0 && !result.stopped) {
        toast.success('Your offline changes are saved to your claim.', { title: 'Draft synced' })
        if (id && result.claimIds.includes(id)) {
          try {
            setClaim(await claimsApi.getClaim(id))
          } catch {
            /* keep the local copy */
          }
        }
      }
    }
    sync()
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [setClaim, toast])

  /* ---- Step 1: create / save the header ---- */
  const saveHeader = useCallback(
    async ({ quiet = false } = {}) => {
      if (savePromise.current) return savePromise.current
      const errors = validateClaimHeader(header)
      if (!isValid(errors)) {
        setTouched({ title: true, purpose: true, tripStartDate: true, tripEndDate: true })
        return null
      }
      const current = claimRef.current
      if (current && JSON.stringify(header) === savedHeader) return current
      const payload = headerPayload(header)
      const snapshot = JSON.stringify(header)
      setSavingHeader(true)
      savePromise.current = (async () => {
        try {
          let result
          if (!current) {
            const id = newUuid()
            result = await perform({ op: 'create', claimId: id, payload }, () => claimsApi.createClaim({ id, ...payload }))
            onCreated?.(result)
            if (!quiet) toast.success(result.offline ? 'Saved on this device. It syncs when you are back online.' : `Draft ${result.claimNumber ?? ''} created.`, { title: 'Draft saved' })
          } else {
            result = await perform({ op: 'update', claimId: current.id, payload }, () =>
              claimsApi.updateClaim(current.id, { ...payload, version: current.version }),
            )
            if (!quiet) toast.success('Claim details saved.')
          }
          setSavedHeader(snapshot)
          setServerErrors({})
          return result
        } catch (error) {
          if (!handleConflict(error)) {
            setServerErrors(fieldErrors(error) ?? {})
            toast.error(errorMessage(error), { title: 'Could not save the claim details' })
          }
          return null
        } finally {
          setSavingHeader(false)
          savePromise.current = null
        }
      })()
      return savePromise.current
    },
    [header, savedHeader, perform, onCreated, toast],
  )

  const onStep1Blur = (e) => {
    if (step1Ref.current && e.relatedTarget && step1Ref.current.contains(e.relatedTarget)) return
    if (validateClaimHeader(header) && isValid(validateClaimHeader(header)) && (headerDirty || !claimRef.current)) {
      saveHeader({ quiet: Boolean(claimRef.current) })
    }
  }

  const onCurrentChange = async (i) => {
    if (current === 0 && i > 0 && (headerDirty || !claimRef.current)) {
      const saved = await saveHeader()
      if (!saved) return
    }
    setCurrent(i)
  }

  const setField = (field) => (e) => {
    setHeader((h) => ({ ...h, [field]: e.target.value }))
    if (serverErrors[field]) setServerErrors((s) => ({ ...s, [field]: undefined }))
  }
  const touch = (field) => () => setTouched((t) => ({ ...t, [field]: true }))

  /* ---- Step 2: lines ---- */
  const openNewLine = async () => {
    const c = headerDirty || !claimRef.current ? await saveHeader({ quiet: Boolean(claimRef.current) }) : claimRef.current
    if (!c) return
    setEditor({ lineId: newUuid(), line: null })
  }

  const openLine = (lineId) => {
    const line = claimRef.current?.lines.find((l) => l.id === lineId)
    if (line) setEditor({ lineId, line })
  }

  const saveLine = async (lineId, payload, isNew) => {
    const id = claimRef.current.id
    try {
      if (isNew) {
        await perform({ op: 'addLine', claimId: id, payload: { id: lineId, ...payload } }, () =>
          claimsApi.addLine(id, { id: lineId, ...payload }),
        )
      } else {
        await perform({ op: 'updateLine', claimId: id, lineId, payload }, () => claimsApi.updateLine(id, lineId, payload))
      }
      setServerBlockers(null)
    } catch (error) {
      if (handleConflict(error)) throw new Error('This claim changed. Reload it and try again.', { cause: error })
      throw error
    }
  }

  const uploadReceipt = async (lineId, payload, file, onProgress) => {
    const id = claimRef.current.id
    if (!claimRef.current.lines.some((l) => l.id === lineId)) {
      setClaim(await claimsApi.addLine(id, { id: lineId, ...payload }))
    }
    await claimsApi.uploadReceipt(id, lineId, file, { onProgress })
    setClaim(await claimsApi.getClaim(id))
    setServerBlockers(null)
  }

  const removeReceipt = async (lineId) => {
    setClaim(await claimsApi.removeReceipt(claimRef.current.id, lineId))
  }

  const previewLine = useCallback((line, lineId, hasReceipt) => claimsApi.policyPreview(claimRef.current.id, { line, lineId, hasReceipt }), [])

  const confirmDelete = async () => {
    const id = claimRef.current.id
    setDeleting(true)
    try {
      await perform({ op: 'deleteLine', claimId: id, lineId: toDelete.id }, () => claimsApi.deleteLine(id, toDelete.id))
      toast.success(`Line ${toDelete.lineNo ?? ''} deleted.`)
      setToDelete(null)
      setServerBlockers(null)
    } catch (error) {
      if (!handleConflict(error)) toast.error(errorMessage(error), { title: 'Could not delete the line' })
      setToDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  /* ---- Step 3: review & submit ---- */
  const preview = useAsync(
    () => (canCheck && lines.length ? claimsApi.policyPreview(claimId) : Promise.resolve(null)),
    [canCheck, claimId, claim?.version, claim?.updatedAt, lines.length],
  )
  const replyError = sentBack ? validateComment(reply, { label: 'Reply' }) : null
  const blockers = serverBlockers ?? preview.data?.submitBlockers ?? []
  const reviewReady = canCheck && Boolean(preview.data) && !preview.loading
  const step3Valid = reviewReady && blockers.length === 0 && !replyError && lines.length > 0

  const saveDraft = async () => {
    setSavingDraft(true)
    try {
      const c = await saveHeader({ quiet: true })
      if (c) toast.success(c.offline ? 'Offline: saved on this device. It syncs when you are back online.' : 'Your draft is saved in My claims.', { title: 'Draft saved' })
    } finally {
      setSavingDraft(false)
    }
  }

  const submit = async () => {
    if (sentBack && replyError) {
      setReplyTouched(true)
      return
    }
    if (headerDirty) {
      const saved = await saveHeader({ quiet: true })
      if (!saved) return
    }
    setSubmitting(true)
    try {
      const result = await claimsApi.submitClaim(claimId, {
        comment: sentBack ? reply.trim() : undefined,
        version: claimRef.current.version,
      })
      submitToast(toast, result, sentBack)
      navigate(`/claims/${result.id}`)
    } catch (error) {
      if (isApiError(error) && error.status === 422 && error.details?.blockers) {
        setServerBlockers(error.details.blockers)
        setCurrent(2)
        toast.error('Some lines need fixing before you can submit.', { title: 'Submit blocked' })
        preview.reload()
      } else if (!handleConflict(error)) {
        toast.error(errorMessage(error), { title: 'Could not submit the claim' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  /* ---- Render ---- */
  const step1 = (
    <div className="stack" ref={step1Ref} onBlur={onStep1Blur}>
      <TextInput
        label="Title"
        required
        maxLength={FIELD_LIMITS.claimTitle}
        value={header.title}
        onChange={setField('title')}
        onBlur={touch('title')}
        error={showErr('title')}
        placeholder="e.g. Client visit to Pune"
        hint="3 to 150 characters"
      />
      <TextArea
        label="Purpose"
        rows={3}
        showCount
        maxLength={FIELD_LIMITS.claimPurpose}
        value={header.purpose}
        onChange={setField('purpose')}
        onBlur={touch('purpose')}
        error={showErr('purpose')}
      />
      <div className="grid grid-2 ef-grid-collapse">
        <DateInput label="Trip start" value={header.tripStartDate} onChange={setField('tripStartDate')} onBlur={touch('tripStartDate')} error={showErr('tripStartDate')} />
        <DateInput
          label="Trip end"
          value={header.tripEndDate}
          min={header.tripStartDate || undefined}
          onChange={setField('tripEndDate')}
          onBlur={touch('tripEndDate')}
          error={showErr('tripEndDate')}
        />
      </div>
      <div className="ef-currency">
        <span className="ef-currency-label">Currency</span>
        <span className="ef-currency-value">₹ INR (Indian rupee)</span>
        <span className="ef-muted">All claims are in rupees.</span>
      </div>
      <div className="row row-sm ef-save-state" aria-live="polite">
        {savingHeader ? (
          <>
            <Spinner size={14} /> Saving…
          </>
        ) : claimId && !headerDirty ? (
          <>
            <CheckIcon size={14} /> {claim.offline ? 'Saved on this device' : 'Saved'}
          </>
        ) : headerValid ? (
          <Button variant="secondary" size="sm" onClick={() => saveHeader()}>
            {claimId ? 'Save details' : 'Create draft'}
          </Button>
        ) : null}
      </div>
    </div>
  )

  const step2 = (
    <div className="stack">
      <div className="ef-total">
        <span>Running total</span>
        <Money value={runningTotal} strong />
      </div>
      {lines.length === 0 ? (
        <EmptyState icon={<ReceiptIcon size={28} />} title="No lines yet" message="Add each expense with its receipt." compact />
      ) : (
        <ul className="ef-lines">
          {lines.map((line) => (
            <LineCard
              key={line.id}
              line={line}
              threshold={threshold}
              disabled={submitting}
              onEdit={() => openLine(line.id)}
              onDelete={() => setToDelete(line)}
            />
          ))}
        </ul>
      )}
      <Button variant={lines.length ? 'secondary' : 'primary'} icon={<PlusIcon size={18} />} onClick={openNewLine} loading={savingHeader} block>
        Add line
      </Button>
    </div>
  )

  const step3 = (
    <ReviewPanel
      claim={claim ?? { lines: [] }}
      preview={preview}
      canCheck={canCheck}
      serverBlockers={serverBlockers}
      onFix={openLine}
      sentBack={sentBack}
      reply={reply}
      setReply={setReply}
      replyError={replyTouched ? replyError : undefined}
      onReplyBlur={() => setReplyTouched(true)}
    />
  )

  const title = claim?.claimNumber ? `Edit ${claim.claimNumber}` : 'New claim'

  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle="Claim details, line items, then review and submit."
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'My claims', to: '/claims' },
          ...(claim?.claimNumber ? [{ label: claim.claimNumber, to: `/claims/${claimId}` }] : []),
          { label: claim?.claimNumber ? 'Edit' : 'New claim' },
        ]}
        meta={
          <div className="row row-sm">
            {claim?.status && <StatusChip status={claim.status} size="sm" />}
            {isOfflineDraft && (
              <span className="ef-pill is-warn" title="Changes waiting to sync">
                <WifiOffIcon size={12} /> {pending > 0 ? `${pending} change${pending === 1 ? '' : 's'} pending sync` : 'Pending sync'}
              </span>
            )}
          </div>
        }
      />
      <div className="page-body stack">
        {!online && (
          <InfoBanner tone="offline" title="Offline: saved on this device" live>
            Keep editing. Your draft syncs automatically when the connection returns.
          </InfoBanner>
        )}
        {conflict && (
          <InfoBanner
            tone="warning"
            title="This claim changed, reload"
            live
            action={
              <Button size="sm" variant="secondary" icon={<RefreshIcon size={16} />} onClick={reloadClaim}>
                Reload
              </Button>
            }
          >
            Someone or another window changed this claim. Reload to see the latest version before you continue.
          </InfoBanner>
        )}
        {sentBack && (
          <InfoBanner tone="warning" title="Sent back for changes">
            {sendBackComment ? (
              <p>
                <strong>{sendBackComment.authorName}:</strong> &ldquo;{sendBackComment.text}&rdquo;
              </p>
            ) : null}
            <p>
              If you resubmit without changing any line it goes straight back to the approver who sent it. If you edit, add or remove lines, the policy check runs again and approval restarts at your manager.
            </p>
          </InfoBanner>
        )}

        <StepColumns
          ariaLabel="Claim steps"
          current={current}
          onCurrentChange={onCurrentChange}
          columnTemplate="1fr 1.25fr 1.15fr"
          steps={[
            { id: 'details', title: 'Claim details', description: 'What the trip or expense was for', valid: headerValid, content: step1 },
            { id: 'lines', title: 'Line items', description: `${lines.length} line${lines.length === 1 ? '' : 's'}`, valid: Boolean(claimId) && lines.length > 0, content: step2 },
            { id: 'review', title: 'Review & submit', description: 'Policy check before you send', valid: step3Valid, content: step3 },
          ]}
        />

        <div className="ef-sticky-footer" role="region" aria-label="Claim actions">
          <div className="ef-sticky-inner">
            <div className="ef-sticky-total">
              <span className="ef-muted">Total</span>
              <Money value={runningTotal} strong />
            </div>
            <div className="row row-sm">
              <Button variant="secondary" onClick={saveDraft} loading={savingDraft} disabled={!headerValid || submitting}>
                Save draft
              </Button>
              <Button
                icon={<SendIcon size={18} />}
                onClick={submit}
                loading={submitting}
                disabled={!step3Valid || !headerValid || !isPositiveMoney(runningTotal)}
                title={!step3Valid ? 'Fix the items in Review & submit first' : undefined}
              >
                {sentBack ? 'Resubmit' : 'Submit'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {editor && (
        <LineEditor
          key={editor.lineId}
          open
          onClose={() => setEditor(null)}
          lineId={editor.lineId}
          line={editor.line}
          lines={lines}
          policy={policy}
          categories={categories}
          online={canCheck}
          onSave={saveLine}
          onUpload={uploadReceipt}
          onRemoveReceipt={removeReceipt}
          preview={previewLine}
        />
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title={`Delete line ${toDelete?.lineNo ?? ''}?`}
        message={toDelete ? `${categoryLabel(toDelete.category)} at ${toDelete.vendor} for ${formatMoney(toDelete.amount)}. This also removes its receipt.` : ''}
        confirmLabel="Delete line"
        tone="danger"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page: loading, errors, edit guard                                   */
/* ------------------------------------------------------------------ */

function FormSkeleton() {
  return (
    <div className="page">
      <div className="page-body stack" aria-busy="true" aria-label="Loading claim">
        <Skeleton height={32} width="40%" />
        <div className="ef-skeleton-cols">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card ef-skeleton-card">
              <Skeleton circle width={36} height={36} />
              <SkeletonText lines={5} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** E2–E6 New / edit claim. */
export default function ClaimFormPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [created, setCreated] = useState(null)
  const isJustCreated = Boolean(id && created?.id === id)

  const refs = useAsync(() => Promise.all([referenceApi.listCategories(), referenceApi.getCurrentPolicy()]), [])
  const claimQ = useAsync(() => (id && !isJustCreated ? loadClaim(id) : Promise.resolve(null)), [id, isJustCreated])
  useDocumentTitle(id ? 'Edit claim' : 'New claim')

  const onCreated = useCallback(
    (claim) => {
      setCreated({ id: claim.id, key: `new:${location.key}` })
      navigate(`/claims/${claim.id}/edit`, { replace: true })
    },
    [location.key, navigate],
  )

  if (refs.error && !refs.data) {
    return (
      <div className="page">
        <div className="page-body">
          <ErrorState error={refs.error} onRetry={refs.reload} />
        </div>
      </div>
    )
  }

  if (!isJustCreated && id) {
    if (claimQ.error) {
      return (
        <div className="page">
          <div className="page-body">
            <ErrorState error={claimQ.error} onRetry={claimQ.reload} />
          </div>
        </div>
      )
    }
    if (claimQ.loading || !claimQ.data || !refs.data) return <FormSkeleton />
    if (!claimQ.data.editable) return <Navigate to={`/claims/${id}`} replace />
  } else if (!refs.data) {
    return <FormSkeleton />
  }

  const [categories, policy] = refs.data
  const formKey = isJustCreated ? created.key : id ? `edit:${id}` : `new:${location.key}`
  return (
    <ClaimForm
      key={formKey}
      initialClaim={isJustCreated ? null : (claimQ.data ?? null)}
      categories={categories}
      policy={policy}
      onCreated={onCreated}
    />
  )
}
