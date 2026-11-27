import OutcomeBadge from '../../../components/OutcomeBadge.jsx'
import { formatMoney, reasonLabel, unitLabel } from '../../../utils/format.js'

/**
 * Policy findings for one line: rule name, limit, actual, excess and the
 * matched line for duplicates. WITHIN_LIMIT findings are summarised in one row.
 */
export default function FindingList({ findings = [], showWithin = true, compact = false }) {
  const list = findings.filter((f) => showWithin || f.reasonCode !== 'WITHIN_LIMIT')
  if (!list.length) return null
  return (
    <ul className={`ef-findings${compact ? ' is-compact' : ''}`}>
      {list.map((f, i) => (
        <li key={`${f.ruleCode ?? f.reasonCode}-${i}`} className={`ef-finding tone-${f.outcome}`}>
          <div className="ef-finding-head">
            <OutcomeBadge outcome={f.outcome} size="sm" />
            <strong>{f.ruleName || reasonLabel(f.reasonCode)}</strong>
          </div>
          {f.message && <p className="ef-finding-msg">{f.message}</p>}
          {f.limitValue && (
            <p className="ef-finding-meta">
              <span>
                {f.limitType === 'HARD' ? 'Hard limit' : 'Limit'} {formatMoney(f.limitValue)} {unitLabel(f.unit)}
              </span>
              {f.actualValue && <span>Actual {formatMoney(f.actualValue)}</span>}
              {f.excessValue && Number(f.excessValue) > 0 && <span className="is-excess">Over by {formatMoney(f.excessValue)}</span>}
            </p>
          )}
          {(f.matchedClaimNumber || f.matchedLineNo) && (
            <p className="ef-finding-meta">
              <span>
                Matches {f.matchedClaimNumber ?? 'this claim'}
                {f.matchedLineNo ? ` line ${f.matchedLineNo}` : ''}
              </span>
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
