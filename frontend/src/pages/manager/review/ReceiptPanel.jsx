import ReceiptViewer from '../../../components/ReceiptViewer.jsx'
import { formatFileSize, shortHash } from '../../../utils/format.js'
import { isImageType } from './reviewUtils.js'

/**
 * Receipt viewer plus thumbnails of every receipt on the claim.
 * Used as the sticky right panel (wide) and inside a modal (narrow).
 */
export default function ReceiptPanel({ lines = [], selectedId, onSelect, height }) {
  const withReceipts = lines.filter((l) => l.receipt)
  const line = lines.find((l) => l.id === selectedId) || null
  const receipt = line?.receipt || null

  return (
    <div className="rv-receipt-panel">
      {receipt ? (
        <ReceiptViewer
          key={receipt.id}
          src={receipt.url}
          contentType={receipt.contentType}
          fileName={receipt.fileName}
          alt={`Receipt for line ${line.lineNo}, ${line.vendor || 'unknown vendor'}`}
          height={height}
          footer={
            <span className="rv-receipt-meta">
              Line {line.lineNo} · {receipt.fileName} · {formatFileSize(receipt.sizeBytes)} · SHA-256{' '}
              <code>{shortHash(receipt.sha256)}</code>
            </span>
          }
        />
      ) : (
        <div className="rv-receipt-empty" style={height ? { minHeight: height } : undefined}>
          <p className="muted">{line ? `Line ${line.lineNo} has no receipt.` : 'Select a line to see its receipt.'}</p>
        </div>
      )}
      {withReceipts.length > 1 && (
        <ul className="rv-thumbs" aria-label="All receipts">
          {withReceipts.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className={`rv-thumb${l.id === selectedId ? ' is-active' : ''}`}
                onClick={() => onSelect(l.id)}
                aria-pressed={l.id === selectedId}
                aria-label={`Receipt for line ${l.lineNo}`}
              >
                {isImageType(l.receipt.contentType) ? (
                  <img src={l.receipt.url} alt="" loading="lazy" />
                ) : (
                  <span className="rv-thumb-pdf">PDF</span>
                )}
                <span className="rv-thumb-no" aria-hidden="true">
                  {l.lineNo}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
