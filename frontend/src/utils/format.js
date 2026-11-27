/**
 * Display formatting. Money values arrive as decimal strings ("1500.00"); they are
 * converted with Number() for display only and never used for arithmetic here.
 */
import {
  CATEGORY_META,
  FLAG_META,
  OUTCOME_META,
  REASON_CODE_LABEL,
  ROLE_LABEL,
  STATUS_META,
  STEP_TYPE_LABEL,
  UNIT_LABEL,
} from './constants.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const inrWholeFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const numberFormatter = new Intl.NumberFormat('en-IN')

function toNumber(value) {
  if (value === null || value === undefined || value === '') return NaN
  if (typeof value === 'number') return value
  return Number(String(value).replace(/[,\s₹]/g, ''))
}

/**
 * ₹1,20,000.00 (Indian grouping).
 * @param {string|number|null|undefined} value decimal string or number
 * @param {{whole?: boolean, compact?: boolean, fallback?: string}} [opts]
 */
export function formatMoney(value, opts = {}) {
  const { whole = false, compact = false, fallback = '—' } = opts
  const n = toNumber(value)
  if (!Number.isFinite(n)) return fallback
  if (compact) {
    const abs = Math.abs(n)
    const sign = n < 0 ? '-' : ''
    if (abs >= 1e7) return `${sign}₹${trimZeros((abs / 1e7).toFixed(2))} Cr`
    if (abs >= 1e5) return `${sign}₹${trimZeros((abs / 1e5).toFixed(2))} L`
    if (abs >= 1e3) return `${sign}₹${trimZeros((abs / 1e3).toFixed(1))} K`
  }
  return (whole ? inrWholeFormatter : inrFormatter).format(n)
}

function trimZeros(s) {
  return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

export function formatNumber(value, fallback = '—') {
  const n = toNumber(value)
  return Number.isFinite(n) ? numberFormatter.format(n) : fallback
}

export function formatPercent(value, digits = 0) {
  const n = toNumber(value)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

/**
 * Parses an ISO date ("2026-11-27") as a local calendar date, or any other
 * date/time string or Date as-is. Returns null when invalid.
 */
export function parseDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

const pad = (n) => String(n).padStart(2, '0')

/** 27 Nov 2026 */
export function formatDate(value, fallback = '—') {
  const d = parseDate(value)
  if (!d) return fallback
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** 27 Nov 2026, 14:05 */
export function formatDateTime(value, fallback = '—') {
  const d = parseDate(value)
  if (!d) return fallback
  return `${formatDate(d)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 27 Nov – 2 Dec 2026 (or a single date when only one side is known). */
export function formatDateRange(from, to, fallback = '—') {
  const a = parseDate(from)
  const b = parseDate(to)
  if (!a && !b) return fallback
  if (!a || !b) return formatDate(a || b)
  if (a.getFullYear() === b.getFullYear()) {
    if (a.getMonth() === b.getMonth() && a.getDate() === b.getDate()) return formatDate(a)
    return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${formatDate(b)}`
  }
  return `${formatDate(a)} – ${formatDate(b)}`
}

/** Local date as "YYYY-MM-DD" (for <input type="date"> values and comparisons). */
export function toISODate(value = new Date()) {
  const d = parseDate(value)
  if (!d) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayISO() {
  return toISODate(new Date())
}

/** Adds whole days to an ISO date and returns an ISO date. */
export function addDaysISO(iso, days) {
  const d = parseDate(iso)
  if (!d) return ''
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/**
 * Age as "3 d 4 h", "5 h 12 m", "12 m" or "just now".
 * @param {number} value hours by default
 * @param {{unit?: 'hours'|'ms'}} [opts]
 */
export function formatAge(value, opts = {}) {
  const { unit = 'hours' } = opts
  const n = toNumber(value)
  if (!Number.isFinite(n)) return '—'
  const totalMinutes = Math.max(0, Math.floor(unit === 'ms' ? n / 60000 : n * 60))
  if (totalMinutes < 1) return 'just now'
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} m` : `${hours} h`
  return `${minutes} m`
}

/** Age since a timestamp, e.g. "3 d 4 h ago". */
export function formatRelative(value, now = Date.now()) {
  const d = parseDate(value)
  if (!d) return '—'
  const age = formatAge(now - d.getTime(), { unit: 'ms' })
  return age === 'just now' ? age : `${age} ago`
}

export function formatFileSize(bytes) {
  const n = toNumber(bytes)
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** "a1b2c3d4…e5f6" for long hashes. */
export function shortHash(hash, head = 8, tail = 6) {
  if (!hash) return '—'
  return hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}

/* ---------- Enum labels ---------- */

export const statusLabel = (status) => STATUS_META[status]?.label ?? humanize(status)
export const outcomeLabel = (outcome) => OUTCOME_META[outcome]?.label ?? humanize(outcome)
export const flagLabel = (flag) => FLAG_META[flag]?.label ?? humanize(flag)
export const roleLabel = (role) => ROLE_LABEL[role] ?? humanize(role)
export const categoryLabel = (code) => CATEGORY_META[code]?.label ?? humanize(code)
export const stepTypeLabel = (type) => STEP_TYPE_LABEL[type] ?? humanize(type)
export const reasonLabel = (code) => REASON_CODE_LABEL[code] ?? humanize(code)
export const unitLabel = (unit) => UNIT_LABEL[unit] ?? ''

/** "PENDING_MANAGER" → "Pending manager" */
export function humanize(value) {
  if (!value) return ''
  const s = String(value).replace(/_/g, ' ').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/* ---------- Errors ---------- */

/** True for API errors that must be shown as "Not found" (403 and 404, US4-AC3). */
export function isNotFoundError(error) {
  return Boolean(error) && (error.status === 404 || error.status === 403)
}

/** A user-facing message for any thrown value. */
export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (error.status === 0 || (error.name === 'TypeError' && error.status === undefined)) {
    return 'We could not reach the server. Check your connection and try again.'
  }
  if (error.message) return error.message
  if (error.status >= 500) return 'The server had a problem handling that request. Please try again.'
  return fallback
}
