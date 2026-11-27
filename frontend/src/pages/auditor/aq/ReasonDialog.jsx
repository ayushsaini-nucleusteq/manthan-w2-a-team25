import { useState } from 'react'
import Modal from '../../../components/Modal.jsx'
import Button from '../../../components/Button.jsx'
import TextArea from '../../../components/TextArea.jsx'
import { validateComment } from '../../../utils/validation.js'

/**
 * Modal asking for a required comment or reason before a decision.
 * Mount it with a changing `key` to reset the text between uses.
 */
export default function ReasonDialog({
  open,
  title,
  description,
  label = 'Comment',
  hint,
  confirmLabel = 'Submit',
  tone = 'primary',
  loading = false,
  serverError,
  onConfirm,
  onCancel,
}) {
  const [text, setText] = useState('')
  const [touched, setTouched] = useState(false)
  const error = validateComment(text, { label })
  const shownError = (touched && error) || serverError || null

  const submit = (e) => {
    e?.preventDefault()
    setTouched(true)
    if (error) return
    onConfirm(text.trim())
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="md"
      dismissible={!loading}
      footer={
        <div className="row row-end">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={submit} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} noValidate>
        <TextArea
          label={label}
          required
          hint={hint}
          value={text}
          rows={4}
          showCount
          maxLength={1000}
          error={shownError}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setTouched(true)}
        />
      </form>
    </Modal>
  )
}
