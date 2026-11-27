import { useRef } from 'react'
import Button from './Button.jsx'
import Modal from './Modal.jsx'
import { AlertTriangleIcon, HelpCircleIcon } from './icons.jsx'

/**
 * Yes/no confirmation built on Modal (role="alertdialog").
 * Put extra inputs (e.g. a reason textarea) in `children`.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} [props.message]
 * @param {React.ReactNode} [props.confirmLabel]
 * @param {React.ReactNode} [props.cancelLabel]
 * @param {'primary'|'danger'} [props.tone]
 * @param {boolean} [props.loading] spinner on confirm; blocks dismiss
 * @param {boolean} [props.confirmDisabled]
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  icon,
  children,
}) {
  const cancelRef = useRef(null)
  const IconComponent = tone === 'danger' ? AlertTriangleIcon : HelpCircleIcon
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      role="alertdialog"
      dismissible={!loading}
      initialFocusRef={children ? undefined : cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm">
        <span className={`confirm-icon tone-${tone === 'danger' ? 'danger' : 'brand'}`} aria-hidden="true">
          {icon || <IconComponent size={22} />}
        </span>
        <div className="confirm-body">
          {message && <div className="confirm-message">{message}</div>}
          {children}
        </div>
      </div>
    </Modal>
  )
}
