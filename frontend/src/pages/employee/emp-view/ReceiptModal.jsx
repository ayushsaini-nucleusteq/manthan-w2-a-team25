import Modal from '../../../components/Modal.jsx'
import ReceiptViewer from '../../../components/ReceiptViewer.jsx'
import { claimsApi } from '../../../api'
import { useAsync } from '../../../hooks/useAsync.js'
import { formatDateTime, formatFileSize, shortHash } from '../../../utils/format.js'

function ReceiptBody({ claimId, line }) {
  const { data, error, loading, reload } = useAsync(() => claimsApi.getReceipt(claimId, line.id), [claimId, line.id])
  const receipt = data ?? line.receipt
  return (
    <ReceiptViewer
      src={receipt?.url}
      contentType={receipt?.contentType}
      fileName={receipt?.fileName}
      alt={`Receipt for line ${line.lineNo}`}
      loading={loading && !data}
      error={error}
      onRetry={reload}
      height="min(65vh, 640px)"
      footer={
        receipt ? (
          <p className="muted emp-receipt-meta">
            {receipt.fileName} &middot; {formatFileSize(receipt.sizeBytes)} &middot; uploaded {formatDateTime(receipt.uploadedAt)}
            {receipt.sha256 ? (
              <>
                {' '}
                &middot; SHA-256 <code title={receipt.sha256}>{shortHash(receipt.sha256)}</code>
              </>
            ) : null}
          </p>
        ) : null
      }
    />
  )
}

/** Modal showing a line's receipt in the shared ReceiptViewer. */
export default function ReceiptModal({ claimId, line, onClose }) {
  return (
    <Modal
      open={Boolean(line)}
      onClose={onClose}
      size="lg"
      title={line ? `Receipt · line ${line.lineNo}` : 'Receipt'}
      description={line?.vendor}
    >
      {line && <ReceiptBody key={line.id} claimId={claimId} line={line} />}
    </Modal>
  )
}
