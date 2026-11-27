import { useState } from 'react'
import ConfirmDialog from '../../../components/ConfirmDialog.jsx'
import TextInput from '../../../components/TextInput.jsx'
import Checkbox from '../../../components/Checkbox.jsx'
import Money from '../../../components/Money.jsx'
import { WalletIcon } from '../../../components/icons.jsx'

const REF_PATTERN = /^[A-Za-z0-9/-]{6,64}$/

/**
 * Separate confirmation before marking a batch paid (US14-AC1): the user either
 * types the batch number or ticks "Bank has confirmed payment", and enters the
 * bank reference (UTR). Mount it only while open so its fields start empty.
 *
 * @param {{batch: object, loading: boolean, serverError?: string, onConfirm: (bankReference: string) => void, onCancel: () => void}} props
 */
export default function MarkPaidDialog({ batch, loading, serverError, onConfirm, onCancel }) {
  const [typed, setTyped] = useState('')
  const [ticked, setTicked] = useState(false)
  const [reference, setReference] = useState('')
  const [touched, setTouched] = useState(false)

  const ref = reference.trim()
  const refError = !ref
    ? 'Enter the bank reference (UTR) from the bank confirmation.'
    : !REF_PATTERN.test(ref)
      ? 'Use 6–64 letters, digits, "/" or "-".'
      : null
  const typedOk = typed.trim().toUpperCase() === batch.batchNumber.toUpperCase()
  const confirmed = typedOk || ticked
  const canConfirm = confirmed && !refError

  return (
    <ConfirmDialog
      open
      title={`Mark ${batch.batchNumber} as paid?`}
      icon={<WalletIcon size={22} />}
      message={
        <>
          All {batch.claimCount} claims (<Money value={batch.totalAmount} strong />) move to Paid and each employee is notified.
          This cannot be undone.
        </>
      }
      confirmLabel="Mark as paid"
      loading={loading}
      confirmDisabled={!canConfirm}
      onConfirm={() => {
        setTouched(true)
        if (canConfirm) onConfirm(ref)
      }}
      onCancel={onCancel}
    >
      <div className="stack" style={{ marginTop: 12 }}>
        <TextInput
          id="mark-paid-ref"
          label="Bank reference (UTR)"
          required
          value={reference}
          maxLength={64}
          autoComplete="off"
          onChange={(e) => setReference(e.target.value)}
          onBlur={() => setTouched(true)}
          error={touched ? refError : null}
          hint="From the bank's payment confirmation."
        />
        <TextInput
          id="mark-paid-typed"
          label={`Type ${batch.batchNumber} to confirm`}
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
          hint={ticked ? 'Not needed: you ticked the bank confirmation.' : 'Or tick the box below instead.'}
        />
        <Checkbox
          label="Bank has confirmed payment"
          description="The bank statement shows every credit in this batch."
          checked={ticked}
          onChange={(e) => setTicked(e.target.checked)}
        />
        {serverError && (
          <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>
            {serverError}
          </p>
        )}
      </div>
    </ConfirmDialog>
  )
}
