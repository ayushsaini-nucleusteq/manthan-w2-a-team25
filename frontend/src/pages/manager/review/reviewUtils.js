import { compareMoney } from '../../../utils/money.js'
import { formatMoney, unitLabel } from '../../../utils/format.js'

/** Claims strictly above this total need finance-head sign-off (US12). */
export const HEAD_APPROVAL_ABOVE = '100000.00'

/** Minimum characters for a send-back comment or a rejection reason. */
export const MIN_DECISION_TEXT = 5

export function needsHeadApproval(total) {
  return compareMoney(total ?? '0.00', HEAD_APPROVAL_ABOVE) > 0
}

const FLAG_REASON = {
  WEEKEND: 'WEEKEND_EXPENSE',
  DUPLICATE: 'DUPLICATE',
  SOFT_LIMIT: 'SOFT_LIMIT_EXCEEDED',
}

/**
 * Human explanation for a line flag, built from the matching finding.
 * @param {string} flag
 * @param {object} line
 */
export function flagExplanation(flag, line) {
  const findings = line?.findings ?? []
  const finding =
    findings.find((f) => f.reasonCode === FLAG_REASON[flag]) ||
    (flag === 'DUPLICATE' ? findings.find((f) => f.reasonCode === 'DUPLICATE_RECEIPT') : null)
  if (flag === 'WEEKEND') return 'Weekend expense, flag only, does not block approval'
  if (flag === 'DUPLICATE') {
    if (finding?.matchedClaimNumber) {
      return `Matches ${finding.matchedClaimNumber}${finding.matchedLineNo ? ` line ${finding.matchedLineNo}` : ''}`
    }
    return finding?.message || "Matches a line on another employee's claim"
  }
  if (flag === 'SOFT_LIMIT') {
    if (finding?.excessValue && finding?.limitValue) {
      const unit = unitLabel(finding.unit).replace(/^per /, '/')
      return `Over limit by ${formatMoney(finding.excessValue)} (limit ${formatMoney(finding.limitValue)}${unit})`
    }
    return finding?.message || 'Over the soft limit'
  }
  return finding?.message || ''
}

/** True when keyboard shortcuts should be ignored (typing in a field). */
export function isTypingTarget(target) {
  if (!target || !(target instanceof Element)) return false
  if (target.isContentEditable) return true
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function isImageType(contentType) {
  return typeof contentType === 'string' && contentType.startsWith('image/')
}
