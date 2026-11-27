import { toPaise } from '../../../utils/money.js'

/** Filter defaults for the A1 queue; everything is mirrored in the URL query string. */
export const QUEUE_DEFAULTS = Object.freeze({ band: 'ALL', dept: '', flag: '', age: '', q: '' })

export const BAND_OPTIONS = [
  { value: 'ALL', label: 'All amounts' },
  { value: '25K_50K', label: '₹25k – 50k' },
  { value: '50K_1L', label: '₹50k – 1L' },
  { value: '1L_PLUS', label: 'Above ₹1L' },
]

export const FLAG_OPTIONS = [
  { value: '', label: 'Any flag' },
  { value: 'WEEKEND', label: 'Weekend' },
  { value: 'DUPLICATE', label: 'Duplicate' },
  { value: 'SOFT_LIMIT', label: 'Over limit' },
]

export const AGE_OPTIONS = [
  { value: '', label: 'Any age' },
  { value: '24', label: 'Older than 24h' },
  { value: '48', label: 'Older than 48h' },
  { value: '72', label: 'Older than 72h' },
]

const KEYS = Object.keys(QUEUE_DEFAULTS)

/** Reads the queue filters from URLSearchParams, ignoring unknown values. */
export function readQueueFilters(params) {
  const f = {}
  for (const k of KEYS) f[k] = params.get(k) ?? QUEUE_DEFAULTS[k]
  if (!BAND_OPTIONS.some((o) => o.value === f.band)) f.band = 'ALL'
  if (!FLAG_OPTIONS.some((o) => o.value === f.flag)) f.flag = ''
  if (!AGE_OPTIONS.some((o) => o.value === f.age)) f.age = ''
  return f
}

/** Builds the query-string object for a filter set, dropping defaults. */
export function filtersToParams(filters) {
  const out = {}
  for (const k of KEYS) {
    const v = filters[k]
    if (v != null && v !== '' && v !== QUEUE_DEFAULTS[k]) out[k] = String(v)
  }
  return out
}

export function countActiveFilters(filters) {
  return KEYS.filter((k) => filters[k] && filters[k] !== QUEUE_DEFAULTS[k]).length
}

export function optionLabel(options, value) {
  return options.find((o) => o.value === value)?.label ?? value
}

/** Details derived from a full Claim used to enrich queue rows. */
export function deriveQueueDetails(claim) {
  if (!claim) return null
  const mgr = (claim.approvalSteps ?? []).find((s) => s.stepType === 'MANAGER' && s.status === 'APPROVED')
  const needsReview = (claim.lines ?? []).some((l) => (l.findings ?? []).some((f) => f.outcome === 'ROUTE'))
  return {
    managerApprovedBy: mgr?.actedByName ?? null,
    managerOnBehalfOf: mgr?.onBehalfOfName ?? null,
    managerApprovedAt: mgr?.actedAt ?? null,
    needsReview,
  }
}

export const amountSortValue = (row) => toPaise(row.totalAmount) ?? 0
