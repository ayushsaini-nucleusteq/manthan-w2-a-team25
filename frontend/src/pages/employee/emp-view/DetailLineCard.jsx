import OutcomeBadge from '../../../components/OutcomeBadge.jsx'
import Money from '../../../components/Money.jsx'
import { FlagList } from '../../../components/FlagTag.jsx'
import { AlertTriangleIcon, FileTextIcon, Icon } from '../../../components/icons.jsx'
import { CATEGORY_META } from '../../../utils/constants.js'
import { categoryLabel, formatDate, reasonLabel, unitLabel } from '../../../utils/format.js'
import { findingNumbers } from './claimView.js'

const FINDING_TONE = { AUTO_REJECT: 'danger', ROUTE: 'warning', AUTO_APPROVE: 'success' }

function isImage(type) {
  return typeof type === 'string' && type.startsWith('image/')
}

/** One expense line on the claim detail page, with findings and a receipt thumbnail. */
export default function DetailLineCard({ line, onOpenReceipt }) {
  const meta = CATEGORY_META[line.category] ?? CATEGORY_META.OTHER
  const name = line.categoryName ?? categoryLabel(line.category)
  const findings = (line.findings ?? []).filter((f) => f.outcome !== 'AUTO_APPROVE')
  const hotel = line.category === 'HOTEL' && line.city
  return (
    <article className="emp-line" aria-label={`Line ${line.lineNo}: ${name}`}>
      <div className="emp-line-main">
        <span className={`emp-line-icon tone-${meta.tone}`} aria-hidden="true">
          <Icon name={meta.icon} size={20} />
        </span>
        <div className="emp-line-info">
          <div className="emp-line-top">
            <strong>
              {line.lineNo}. {name}
            </strong>
            <Money value={line.amount} strong className="emp-line-amount" />
          </div>
          <p className="muted emp-line-sub">
            {line.vendor} &middot; {formatDate(line.expenseDate)}
            {hotel ? ` · ${line.city}, ${line.nights} night${line.nights === 1 ? '' : 's'}` : ''}
          </p>
          {line.notes && <p className="emp-line-notes">{line.notes}</p>}
          <div className="row row-sm emp-line-tags">
            {line.policyOutcome && <OutcomeBadge outcome={line.policyOutcome} size="sm" />}
            {line.flags?.length > 0 && <FlagList flags={line.flags} />}
          </div>
        </div>
        <div className="emp-line-receipt">
          {line.receipt ? (
            <button
              type="button"
              className="emp-thumb"
              onClick={onOpenReceipt}
              aria-label={`View receipt for line ${line.lineNo}: ${line.receipt.fileName}`}
            >
              {isImage(line.receipt.contentType) && line.receipt.url ? (
                <img src={line.receipt.url} alt="" loading="lazy" />
              ) : (
                <FileTextIcon size={26} />
              )}
            </button>
          ) : (
            <span className="emp-thumb emp-thumb-missing" title="No receipt attached">
              <AlertTriangleIcon size={18} aria-hidden="true" />
              <span>No receipt</span>
            </span>
          )}
        </div>
      </div>
      {findings.length > 0 && (
        <ul className="emp-findings" aria-label={`Policy findings for line ${line.lineNo}`}>
          {findings.map((f, i) => {
            const nums = findingNumbers(f, f.unit ? unitLabel(f.unit) : '')
            return (
              <li key={`${f.ruleCode}-${i}`} className={`emp-finding tone-${FINDING_TONE[f.outcome] ?? 'warning'}`}>
                <strong>{f.ruleName || reasonLabel(f.reasonCode)}</strong>
                {f.message && <span> {f.message}</span>}
                {nums && <span className="emp-finding-nums">{nums}</span>}
                {f.matchedClaimNumber && (
                  <span className="emp-finding-nums">
                    Matches {f.matchedClaimNumber}
                    {f.matchedLineNo ? ` line ${f.matchedLineNo}` : ''}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </article>
  )
}
