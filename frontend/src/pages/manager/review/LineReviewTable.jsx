import FlagTag from '../../../components/FlagTag.jsx'
import Money from '../../../components/Money.jsx'
import OutcomeBadge from '../../../components/OutcomeBadge.jsx'
import { EyeIcon, ReceiptIcon } from '../../../components/icons.jsx'
import { categoryLabel, formatDate } from '../../../utils/format.js'
import { flagExplanation } from './reviewUtils.js'

/**
 * Claim lines with the outcome badge and flag explanations beside each line.
 * Each row has a real button that selects it (and shows its receipt).
 */
export default function LineReviewTable({ lines = [], selectedId, onSelect, total, narrow }) {
  return (
    <div className="rv-lines" role="table" aria-label="Claim lines">
      <div className="rv-lines-head" role="row">
        <span role="columnheader">#</span>
        <span role="columnheader">Expense</span>
        <span role="columnheader">Policy</span>
        <span role="columnheader" className="num">
          Amount
        </span>
        <span role="columnheader">
          <span className="sr-only">Receipt</span>
        </span>
      </div>
      {lines.map((line) => {
        const selected = line.id === selectedId
        const flags = line.flags ?? []
        return (
          <div key={line.id} role="row" className={`rv-line${selected ? ' is-selected' : ''}`}>
            <span role="cell" className="rv-line-no">
              <span className="sr-only">Line </span>
              {line.lineNo}
            </span>
            <span role="cell" className="rv-line-main">
              <span className="rv-line-title">
                {line.categoryName || categoryLabel(line.category)} · {line.vendor || 'No vendor'}
              </span>
              <span className="rv-line-sub">
                {formatDate(line.expenseDate)}
                {line.city ? ` · ${line.city}` : ''}
                {line.nights ? ` · ${line.nights} night${line.nights === 1 ? '' : 's'}` : ''}
              </span>
              {line.notes && <span className="rv-line-notes">{line.notes}</span>}
              {flags.length > 0 && (
                <ul className="rv-line-flags" aria-label={`Flags on line ${line.lineNo}`}>
                  {flags.map((flag) => (
                    <li key={flag}>
                      <FlagTag flag={flag} />
                      <span className="rv-flag-text">{flagExplanation(flag, line)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </span>
            <span role="cell" className="rv-line-outcome">
              {line.policyOutcome ? (
                <OutcomeBadge outcome={line.policyOutcome} size="sm" />
              ) : (
                <span className="muted">Not evaluated</span>
              )}
            </span>
            <span role="cell" className="num rv-line-amount">
              <Money value={line.amount} strong />
            </span>
            <span role="cell" className="rv-line-action">
              {line.receipt ? (
                <button
                  type="button"
                  className={`rv-receipt-btn${selected && !narrow ? ' is-active' : ''}`}
                  onClick={() => onSelect(line.id)}
                  aria-pressed={narrow ? undefined : selected}
                  aria-label={`${narrow ? 'View' : 'Show'} receipt for line ${line.lineNo}`}
                >
                  {narrow ? <EyeIcon size={16} aria-hidden="true" /> : <ReceiptIcon size={16} aria-hidden="true" />}
                  <span aria-hidden="true">{narrow ? 'View' : selected ? 'Showing' : 'Receipt'}</span>
                </button>
              ) : (
                <span className="rv-no-receipt">No receipt</span>
              )}
            </span>
          </div>
        )
      })}
      <div className="rv-lines-total" role="row">
        <span role="cell" className="rv-total-label">
          Total ({lines.length} line{lines.length === 1 ? '' : 's'})
        </span>
        <span role="cell" className="num">
          <Money value={total} strong />
        </span>
      </div>
    </div>
  )
}
