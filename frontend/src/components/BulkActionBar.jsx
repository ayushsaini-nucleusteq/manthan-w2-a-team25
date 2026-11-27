import { XIcon } from './icons.jsx'

/**
 * Sticky bar that slides up from the bottom while rows are selected:
 * "N selected", the action buttons (children) and "Clear selection".
 *
 * @param {object} props
 * @param {number} props.count
 * @param {() => void} props.onClear
 * @param {React.ReactNode} props.children action buttons
 * @param {React.ReactNode} [props.summary] extra text, e.g. the selected total
 * @param {string} [props.noun] "claim" → "3 claims selected"
 */
export default function BulkActionBar({ count, onClear, children, summary, noun }) {
  const open = count > 0
  const label = noun ? `${count} ${count === 1 ? noun : `${noun}s`} selected` : `${count} selected`
  return (
    <div className={`bulk-bar${open ? ' is-open' : ''}`} role="region" aria-label="Bulk actions" aria-hidden={!open} inert={!open}>
      <div className="bulk-bar-inner">
        <div className="bulk-bar-info">
          <span className="bulk-bar-count" aria-live="polite">
            {label}
          </span>
          {summary && <span className="bulk-bar-summary">{summary}</span>}
        </div>
        <div className="bulk-bar-actions">{children}</div>
        <button type="button" className="bulk-bar-clear" onClick={onClear}>
          <XIcon size={16} />
          <span>Clear selection</span>
        </button>
      </div>
    </div>
  )
}
