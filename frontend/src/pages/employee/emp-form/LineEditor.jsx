import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../../../components/Modal.jsx'
import StepColumns from '../../../components/StepColumns.jsx'
import Select from '../../../components/Select.jsx'
import TextInput from '../../../components/TextInput.jsx'
import TextArea from '../../../components/TextArea.jsx'
import DateInput from '../../../components/DateInput.jsx'
import Button from '../../../components/Button.jsx'
import InfoBanner from '../../../components/InfoBanner.jsx'
import OutcomeBadge from '../../../components/OutcomeBadge.jsx'
import ReceiptViewer from '../../../components/ReceiptViewer.jsx'
import Spinner from '../../../components/Spinner.jsx'
import { Icon, CameraIcon, UploadIcon, TrashIcon, RefreshIcon, AlertTriangleIcon, CheckIcon, FileTextIcon } from '../../../components/icons.jsx'
import { useToast } from '../../../components/toast/useToast.js'
import { useDebounce } from '../../../hooks/useDebounce.js'
import { useIsMobile } from '../../../hooks/useMediaQuery.js'
import { errorMessage } from '../../../api'
import { CATEGORY_META, FIELD_LIMITS, RECEIPT_ACCEPT, DEFAULT_SUBMISSION_WINDOW_DAYS } from '../../../utils/constants.js'
import { addDaysISO, formatDate, formatFileSize, formatMoney, shortHash, todayISO } from '../../../utils/format.js'
import { parseMoneyInput } from '../../../utils/money.js'
import { isReceiptRequired, isValid, validateLine, validateReceiptFile } from '../../../utils/validation.js'
import { detectBlur, isTouchDevice, isWeekend, linePayload } from './blur.js'
import FindingList from './FindingList.jsx'

const OUTCOME_SUMMARY = {
  AUTO_APPROVE: 'Within policy. This line can be auto-approved.',
  ROUTE: 'Needs approval: this line will route to your manager.',
  AUTO_REJECT: 'Over the hard limit: the claim will be auto-rejected if you submit it like this.',
}

function initialValues(line) {
  return {
    category: line?.category ?? '',
    amount: line?.amount ?? '',
    expenseDate: line?.expenseDate ?? '',
    vendor: line?.vendor ?? '',
    notes: line?.notes ?? '',
    city: line?.city ?? '',
    nights: line?.nights != null ? String(line.nights) : '',
  }
}

/**
 * Line editor (E4 Expense + E5 Receipt) in a modal / bottom sheet with two gated columns.
 */
export default function LineEditor({
  open,
  onClose,
  lineId,
  line,
  lines = [],
  policy,
  categories = [],
  online = true,
  onSave,
  onUpload,
  onRemoveReceipt,
  preview,
}) {
  const toast = useToast()
  const isMobile = useIsMobile()
  const touch = useMemo(() => isTouchDevice(), [])
  const isNew = !line
  const [values, setValues] = useState(() => initialValues(line))
  const [touched, setTouched] = useState({})
  const [saving, setSaving] = useState(false)
  const [current, setCurrent] = useState(0)
  const [upload, setUpload] = useState({ status: 'idle', progress: 0, error: null, file: null })
  const [blur, setBlur] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [hint, setHint] = useState({ loading: false, data: null, error: null })
  const [copied, setCopied] = useState(false)
  const cameraRef = useRef(null)
  const fileRef = useRef(null)
  const firstFieldRef = useRef(null)

  const threshold = policy?.receiptThreshold ?? '500.00'
  const windowDays = policy?.submissionWindowDays ?? DEFAULT_SUBMISSION_WINDOW_DAYS
  const today = todayISO()
  const persisted = lines.find((l) => l.id === lineId)
  const receipt = persisted?.receipt ?? null
  const hasReceipt = Boolean(receipt)

  const errors = validateLine(values, { today, submissionWindowDays: windowDays })
  const expenseValid = isValid(errors)
  const receiptRequired = isReceiptRequired(values.amount, threshold)
  const receiptOk = !receiptRequired || hasReceipt || !online
  const show = (field) => (touched[field] ? errors[field] : undefined)

  const set = (field) => (e) => {
    const v = e?.target ? e.target.value : e
    setValues((s) => ({ ...s, [field]: v }))
  }
  const blurField = (field) => () => setTouched((t) => ({ ...t, [field]: true }))

  /* ---- Live policy hints (debounced 400 ms) ---- */
  const payload = expenseValid ? linePayload(values, parseMoneyInput) : null
  const payloadKey = payload ? JSON.stringify(payload) : ''
  const debouncedKey = useDebounce(payloadKey, 400)
  const previewRef = useRef(preview)
  useEffect(() => {
    previewRef.current = preview
  })
  useEffect(() => {
    if (!debouncedKey || !online || !previewRef.current) return undefined
    let cancelled = false
    setHint((h) => ({ ...h, loading: true, error: null }))
    previewRef.current(JSON.parse(debouncedKey), persisted ? lineId : undefined, hasReceipt).then(
      (data) => !cancelled && setHint({ loading: false, data, error: null }),
      (error) => !cancelled && setHint({ loading: false, data: null, error }),
    )
    return () => {
      cancelled = true
    }
  }, [debouncedKey, online, lineId, hasReceipt, persisted])

  const hintLine = payloadKey && payloadKey === debouncedKey ? hint.data?.lines?.[0] : null
  const weekend = isWeekend(values.expenseDate)

  /* ---- Receipt upload ---- */
  const startUpload = async (file) => {
    const problem = validateReceiptFile(file)
    if (problem) {
      setUpload({ status: 'error', progress: 0, error: problem, file: null })
      return
    }
    if (!expenseValid) return
    setUpload({ status: 'uploading', progress: 0, error: null, file })
    setBlur(null)
    detectBlur(file).then(setBlur)
    try {
      await onUpload(lineId, linePayload(values, parseMoneyInput), file, (p) =>
        setUpload((u) => (u.file === file ? { ...u, progress: p } : u)),
      )
      setUpload({ status: 'done', progress: 100, error: null, file: null })
      toast.success('Receipt uploaded.')
    } catch (error) {
      setUpload({ status: 'error', progress: 0, error: errorMessage(error, 'The upload failed.'), file })
      toast.error(errorMessage(error, 'The upload failed.'), { title: 'Upload failed' })
    }
  }

  const onPick = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) startUpload(file)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) startUpload(file)
  }

  const removeReceipt = async () => {
    try {
      await onRemoveReceipt(lineId)
      setBlur(null)
      toast.info('Receipt removed.')
    } catch (error) {
      toast.error(errorMessage(error), { title: 'Could not remove the receipt' })
    }
  }

  const copyHash = async () => {
    try {
      await navigator.clipboard.writeText(receipt.sha256)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.warning('Copying is blocked in this browser.')
    }
  }

  const save = async () => {
    setTouched({ category: true, amount: true, expenseDate: true, vendor: true, city: true, nights: true })
    if (!expenseValid || !receiptOk) return
    setSaving(true)
    try {
      await onSave(lineId, linePayload(values, parseMoneyInput), !persisted)
      toast.success(isNew ? 'Line added.' : 'Line updated.')
      onClose()
    } catch (error) {
      toast.error(errorMessage(error), { title: 'Could not save the line' })
    } finally {
      setSaving(false)
    }
  }

  const busy = saving || upload.status === 'uploading'
  const categoryOptions = (categories.length ? categories : Object.keys(CATEGORY_META).map((code) => ({ code })))
    .map((c) => ({ value: c.code, label: c.name ?? CATEGORY_META[c.code]?.label ?? c.code }))
  const catIcon = CATEGORY_META[values.category]?.icon ?? 'receipt'

  /* ---------------- Column A: Expense ---------------- */
  const expenseStep = (
    <div className="stack">
      <div className="ef-cat-row">
        <span className={`ef-cat-icon tone-${CATEGORY_META[values.category]?.tone ?? 'neutral'}`} aria-hidden="true">
          <Icon name={catIcon} size={20} />
        </span>
        <Select
          ref={firstFieldRef}
          label="Category"
          required
          placeholder="Choose a category"
          options={categoryOptions}
          value={values.category}
          onChange={set('category')}
          onBlur={blurField('category')}
          error={show('category')}
          className="ef-grow"
        />
      </div>
      <div className="grid grid-2 ef-grid-collapse">
        <TextInput
          label="Amount"
          required
          prefix="₹"
          inputMode="decimal"
          autoComplete="off"
          value={values.amount}
          onChange={set('amount')}
          onBlur={blurField('amount')}
          error={show('amount')}
          hint={`Receipt needed above ${formatMoney(threshold)}`}
        />
        <DateInput
          label="Date"
          required
          value={values.expenseDate}
          max={today}
          min={addDaysISO(today, -windowDays)}
          onChange={set('expenseDate')}
          onBlur={blurField('expenseDate')}
          error={show('expenseDate')}
          hint={`Not in the future; on or after ${formatDate(addDaysISO(today, -windowDays))}`}
        />
      </div>
      <TextInput
        label="Vendor"
        required
        maxLength={FIELD_LIMITS.vendor}
        value={values.vendor}
        onChange={set('vendor')}
        onBlur={blurField('vendor')}
        error={show('vendor')}
        placeholder="e.g. Taj Residency, Uber"
      />
      {values.category === 'HOTEL' && (
        <div className="grid grid-2 ef-grid-collapse">
          <TextInput
            label="City"
            required
            maxLength={FIELD_LIMITS.city}
            value={values.city}
            onChange={set('city')}
            onBlur={blurField('city')}
            error={show('city')}
            hint="Tier-1 cities have a higher nightly limit"
          />
          <TextInput
            label="Nights"
            required
            type="number"
            inputMode="numeric"
            min={FIELD_LIMITS.nightsMin}
            max={FIELD_LIMITS.nightsMax}
            suffix="nights"
            value={values.nights}
            onChange={set('nights')}
            onBlur={blurField('nights')}
            error={show('nights')}
          />
        </div>
      )}
      <TextArea
        label="Notes"
        rows={2}
        maxLength={FIELD_LIMITS.notes}
        showCount
        value={values.notes}
        onChange={set('notes')}
        onBlur={blurField('notes')}
        error={show('notes')}
      />

      <div className="ef-hint-box" aria-live="polite">
        {!expenseValid ? (
          <p className="ef-muted">Fill in the required fields to see the policy check.</p>
        ) : !online ? (
          <p className="ef-muted">You're offline. The policy check runs when you're back online.</p>
        ) : hint.loading || !hintLine ? (
          <p className="ef-muted row row-sm">
            <Spinner size={14} /> Checking policy…
          </p>
        ) : hint.error ? (
          <p className="ef-muted">Couldn't run the policy check: {errorMessage(hint.error)}</p>
        ) : (
          <div className="stack stack-sm">
            <div className="row row-sm">
              {hintLine.outcome && <OutcomeBadge outcome={hintLine.outcome} />}
              <span>{OUTCOME_SUMMARY[hintLine.outcome] ?? 'Policy checked.'}</span>
            </div>
            <FindingList findings={hintLine.findings} showWithin={false} compact />
          </div>
        )}
        {weekend && (
          <p className="ef-weekend row row-sm">
            <AlertTriangleIcon size={14} /> {formatDate(values.expenseDate)} is a weekend. It will be flagged for approval but can still be submitted.
          </p>
        )}
      </div>
    </div>
  )

  /* ---------------- Column B: Receipt ---------------- */
  const uploading = upload.status === 'uploading'
  const receiptStep = (
    <div className="stack">
      <p className={`ef-req ${receiptRequired ? 'is-required' : ''}`}>
        {receiptRequired ? (
          <>
            <strong>Receipt required</strong> for amounts above {formatMoney(threshold)}.
          </>
        ) : (
          <>Receipt optional for this amount (required above {formatMoney(threshold)}).</>
        )}
      </p>

      {!online && (
        <InfoBanner tone="offline" title="Offline">
          Receipts upload when you're back online. You can save the line now; submit stays blocked until the receipt is attached.
        </InfoBanner>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onPick}
      />
      <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onPick} />

      {receipt && !uploading ? (
        <div className="ef-receipt-preview">
          <ReceiptViewer
            src={receipt.url}
            contentType={receipt.contentType}
            fileName={receipt.fileName}
            alt={`Receipt for ${values.vendor || 'this line'}`}
            height={isMobile ? 200 : 220}
          />
          <dl className="ef-receipt-meta">
            <div>
              <dt>File</dt>
              <dd className="ef-ellipsis">
                <FileTextIcon size={14} /> {receipt.fileName} ({formatFileSize(receipt.sizeBytes)})
              </dd>
            </div>
            <div>
              <dt>SHA-256</dt>
              <dd className="row row-sm">
                <code title={receipt.sha256}>{shortHash(receipt.sha256)}</code>
                <Button variant="ghost" size="sm" onClick={copyHash} aria-label="Copy SHA-256 hash">
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </dd>
            </div>
          </dl>
          {blur?.blurry && (
            <InfoBanner tone="warning" title="This photo looks blurry; retake?" live>
              Approvers need to read the amount and vendor. You can keep it, or take a sharper photo.
            </InfoBanner>
          )}
          <div className="row row-sm">
            <Button
              variant="secondary"
              size="sm"
              icon={touch ? <CameraIcon size={16} /> : <UploadIcon size={16} />}
              onClick={() => (touch ? cameraRef : fileRef).current?.click()}
              disabled={!online || busy}
            >
              Replace
            </Button>
            <Button variant="danger-outline" size="sm" icon={<TrashIcon size={16} />} onClick={removeReceipt} disabled={!online || busy}>
              Remove
            </Button>
          </div>
        </div>
      ) : touch ? (
        <div className="stack stack-sm">
          <Button
            size="lg"
            block
            icon={<CameraIcon size={20} />}
            onClick={() => cameraRef.current?.click()}
            disabled={!online || uploading || !expenseValid}
          >
            Take photo
          </Button>
          <Button variant="secondary" block icon={<UploadIcon size={18} />} onClick={() => fileRef.current?.click()} disabled={!online || uploading || !expenseValid}>
            Upload file
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className={`ef-dropzone${dragOver ? ' is-over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          disabled={!online || uploading || !expenseValid}
        >
          <UploadIcon size={28} />
          <strong>Drag a receipt here or choose a file</strong>
          <span>JPEG, PNG or PDF, up to 5 MB</span>
        </button>
      )}

      {uploading && (
        <div className="ef-progress" role="progressbar" aria-label="Uploading receipt" aria-valuemin={0} aria-valuemax={100} aria-valuenow={upload.progress}>
          <div className="ef-progress-track">
            <span style={{ width: `${upload.progress}%` }} />
          </div>
          <span className="ef-muted">Uploading {upload.file?.name}… {upload.progress}%</span>
        </div>
      )}

      {upload.status === 'error' && (
        <div className="ef-upload-error" role="alert">
          <p>
            <AlertTriangleIcon size={16} /> {upload.error} Your line details are kept.
          </p>
          {upload.file && (
            <Button variant="secondary" size="sm" icon={<RefreshIcon size={16} />} onClick={() => startUpload(upload.file)}>
              Retry upload
            </Button>
          )}
        </div>
      )}
    </div>
  )

  const footer = (
    <div className="row row-end ef-modal-footer">
      {receiptRequired && !hasReceipt && online && expenseValid && (
        <span className="ef-muted ef-footer-note">Attach the receipt to save this line.</span>
      )}
      <Button variant="ghost" onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button onClick={save} loading={saving} disabled={!expenseValid || !receiptOk || uploading} icon={<CheckIcon size={18} />}>
        {isNew ? 'Save line' : 'Save changes'}
      </Button>
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? 'Add expense line' : `Edit line ${line?.lineNo ?? ''}`}
      description="Expense details first, then the receipt."
      size="xl"
      footer={footer}
      initialFocusRef={firstFieldRef}
      dismissible={!busy}
    >
      <StepColumns
        ariaLabel="Expense line steps"
        current={current}
        onCurrentChange={setCurrent}
        columnTemplate="1.2fr 1fr"
        steps={[
          { id: 'expense', title: 'Expense', description: 'Category, amount, date and vendor', valid: expenseValid, content: expenseStep },
          {
            id: 'receipt',
            title: 'Receipt',
            description: receiptRequired ? 'Required for this amount' : 'Optional',
            valid: receiptOk,
            content: receiptStep,
          },
        ]}
      />
    </Modal>
  )
}
