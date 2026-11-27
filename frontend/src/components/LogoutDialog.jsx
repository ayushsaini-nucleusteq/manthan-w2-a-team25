import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import { LogoutIcon } from './icons.jsx'

/**
 * "Log out of ExpenseFlow?" confirmation. On confirm it signs out and goes to /signed-out.
 * @param {{open: boolean, onClose: () => void}} props
 */
export default function LogoutDialog({ open, onClose }) {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const confirm = () => {
    onClose()
    navigate('/signed-out', { replace: true })
    logout()
  }

  return (
    <ConfirmDialog
      open={open}
      title="Log out of ExpenseFlow?"
      message="Unsynced offline drafts on this device will be lost."
      confirmLabel="Log out"
      cancelLabel="Cancel"
      icon={<LogoutIcon size={22} />}
      onConfirm={confirm}
      onCancel={onClose}
    />
  )
}
