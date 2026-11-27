/**
 * Pure helpers for the F4 policy editor: building an editable draft from a
 * PolicyVersion, validating it, diffing it against the current version and
 * turning it into the publish payload. Money stays a decimal string throughout.
 */
import { compareMoney, parseMoneyInput } from '../../../utils/money.js'
import { formatMoney } from '../../../utils/format.js'
import { normalizeCity, validatePolicyLimits, validateTier1Cities } from '../../../utils/validation.js'

/** Sample percentages that divide 100 evenly (1 in N claims). */
export const SAMPLE_PERCENT_OPTIONS = [5, 10, 20, 25, 50]

/** Editable copy of a PolicyVersion; numbers become strings so inputs stay controlled. */
export function toDraft(policy) {
  return {
    receiptThreshold: policy.receiptThreshold ?? '',
    weekendFlagEnabled: Boolean(policy.weekendFlagEnabled),
    overdueThresholdHours: String(policy.overdueThresholdHours ?? ''),
    samplePercent: String(policy.samplePercent ?? ''),
    submissionWindowDays: String(policy.submissionWindowDays ?? ''),
    rules: (policy.rules || []).map((r) => ({ ...r })),
    tier1Cities: [...(policy.tier1Cities || [])],
  }
}

/** Step 1 errors: the shared validator plus local rules (window days, sample options, 2 decimals). */
export function validateLimits(draft) {
  const errors = { ...validatePolicyLimits(draft) }
  const days = Number(draft.submissionWindowDays)
  if (String(draft.submissionWindowDays).trim() === '') errors.submissionWindowDays = 'Enter the submission window in days.'
  else if (!Number.isInteger(days) || days < 1 || days > 365) {
    errors.submissionWindowDays = 'Submission window must be a whole number of days between 1 and 365.'
  }
  if (!errors.samplePercent && !SAMPLE_PERCENT_OPTIONS.includes(Number(draft.samplePercent))) {
    errors.samplePercent = 'Choose 5, 10, 20, 25 or 50 % so the sample divides 100 evenly.'
  }
  return errors
}

export function validateCities(draft) {
  return validateTier1Cities(draft.tier1Cities)
}

function money(value) {
  return parseMoneyInput(String(value ?? '')) ?? value
}

function sameMoney(a, b) {
  const pa = parseMoneyInput(String(a ?? ''))
  const pb = parseMoneyInput(String(b ?? ''))
  if (pa === null || pb === null) return String(a) === String(b)
  return compareMoney(pa, pb) === 0
}

const fmtMoney = (v) => formatMoney(money(v))
const fmtBool = (v) => (v ? 'On' : 'Off')

/**
 * Rows for the review diff: [{key, field, from, to}] (display strings).
 * Only changed values are returned.
 */
export function diffPolicy(current, draft) {
  const rows = []
  const push = (key, field, from, to) => rows.push({ key, field, from, to })

  if (!sameMoney(current.receiptThreshold, draft.receiptThreshold)) {
    push('receiptThreshold', 'Receipt required above', fmtMoney(current.receiptThreshold), fmtMoney(draft.receiptThreshold))
  }
  if (Boolean(current.weekendFlagEnabled) !== Boolean(draft.weekendFlagEnabled)) {
    push('weekendFlagEnabled', 'Weekend expense flag', fmtBool(current.weekendFlagEnabled), fmtBool(draft.weekendFlagEnabled))
  }
  if (Number(current.overdueThresholdHours) !== Number(draft.overdueThresholdHours)) {
    push('overdueThresholdHours', 'Overdue / alert threshold', `${current.overdueThresholdHours} h`, `${draft.overdueThresholdHours} h`)
  }
  if (Number(current.samplePercent) !== Number(draft.samplePercent)) {
    push('samplePercent', 'Sample audit rate', `${current.samplePercent} %`, `${draft.samplePercent} %`)
  }
  if (Number(current.submissionWindowDays) !== Number(draft.submissionWindowDays)) {
    push('submissionWindowDays', 'Submission window', `${current.submissionWindowDays} days`, `${draft.submissionWindowDays} days`)
  }
  const baseRules = new Map((current.rules || []).map((r) => [r.code, r]))
  for (const rule of draft.rules) {
    const old = baseRules.get(rule.code)
    if (!old) continue
    if (!sameMoney(old.softLimit, rule.softLimit)) {
      push(`${rule.code}.soft`, `${rule.name}: soft limit`, fmtMoney(old.softLimit), fmtMoney(rule.softLimit))
    }
    if (!sameMoney(old.hardLimit, rule.hardLimit)) {
      push(`${rule.code}.hard`, `${rule.name}: hard limit`, fmtMoney(old.hardLimit), fmtMoney(rule.hardLimit))
    }
  }
  const baseCities = new Set((current.tier1Cities || []).map(normalizeCity))
  const nextCities = new Set(draft.tier1Cities.map(normalizeCity))
  const added = draft.tier1Cities.filter((c) => !baseCities.has(normalizeCity(c)))
  const removed = (current.tier1Cities || []).filter((c) => !nextCities.has(normalizeCity(c)))
  if (added.length) push('citiesAdded', 'Tier-1 cities added', '—', added.join(', '))
  if (removed.length) push('citiesRemoved', 'Tier-1 cities removed', removed.join(', '), '—')
  return rows
}

/** Request body for publishPolicyVersion. */
export function toPayload(current, draft, changeNote) {
  return {
    basedOnVersionNo: current.versionNo,
    changeNote: changeNote.trim(),
    receiptThreshold: money(draft.receiptThreshold),
    weekendFlagEnabled: Boolean(draft.weekendFlagEnabled),
    overdueThresholdHours: Number(draft.overdueThresholdHours),
    samplePercent: Number(draft.samplePercent),
    submissionWindowDays: Number(draft.submissionWindowDays),
    rules: draft.rules.map((r) => ({ ...r, softLimit: money(r.softLimit), hardLimit: money(r.hardLimit) })),
    tier1Cities: draft.tier1Cities.map((c) => c.trim().replace(/\s+/g, ' ')),
  }
}
