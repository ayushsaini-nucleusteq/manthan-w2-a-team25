/**
 * Client-side validators. Each `validateX(values, ctx)` returns an errors object
 * `{field: message}`; an empty object means valid. Messages say exactly what is
 * needed. The server re-validates everything, so these exist for fast feedback.
 *
 * Money input is a user-typed string; it is parsed with parseMoneyInput and
 * compared as paise integers (never float maths).
 */
import { compareMoney, parseMoneyInput, toPaise } from './money.js'
import {
  DEFAULT_SUBMISSION_WINDOW_DAYS,
  FIELD_LIMITS,
  MAX_RECEIPT_BYTES,
  RECEIPT_TYPES,
} from './constants.js'
import { addDaysISO, formatDate, formatMoney, todayISO } from './format.js'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/* ---------- Generic helpers ---------- */

export function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

export function hasErrors(errors) {
  return Object.values(errors || {}).some(Boolean)
}

export function isValid(errors) {
  return !hasErrors(errors)
}

/** Removes empty entries so `Object.keys(errors)` lists only real problems. */
function clean(errors) {
  const out = {}
  for (const [k, v] of Object.entries(errors)) if (v) out[k] = v
  return out
}

function maxLength(value, max, label) {
  if (value && String(value).length > max) {
    return `${label} must be ${max} characters or fewer (now ${String(value).length}).`
  }
  return null
}

function validIsoDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(new Date(value).getTime())
}

/**
 * Validates a money input. Returns an error message or null.
 * @param {string} text user input
 * @param {{label?: string, required?: boolean, allowZero?: boolean, max?: string}} [opts]
 */
export function validateMoney(text, opts = {}) {
  const { label = 'Amount', required = true, allowZero = false, max } = opts
  if (isBlank(text)) return required ? `Enter the ${label.toLowerCase()}.` : null
  if (/^\s*-/.test(String(text))) return `${label} cannot be negative.`
  const parsed = parseMoneyInput(String(text))
  if (parsed === null || parsed === undefined) {
    return `${label} must be a number with up to 2 decimal places, for example 1500 or 1500.50.`
  }
  const paise = toPaise(parsed)
  if (paise < 0) return `${label} cannot be negative.`
  if (!allowZero && paise === 0) return `${label} must be more than ₹0.`
  if (max && compareMoney(parsed, max) > 0) return `${label} cannot be more than ${formatMoney(max)}.`
  return null
}

/* ---------- Claim header (E2) ---------- */

/**
 * @param {{title?: string, purpose?: string, tripStartDate?: string, tripEndDate?: string}} values
 */
export function validateClaimHeader(values = {}) {
  const { title, purpose, tripStartDate, tripEndDate } = values
  const errors = {}

  if (isBlank(title)) errors.title = 'Enter a title, for example "Client visit to Pune".'
  else if (String(title).trim().length < 3) errors.title = 'Title must be at least 3 characters.'
  else errors.title = maxLength(title, FIELD_LIMITS.claimTitle, 'Title')

  errors.purpose = maxLength(purpose, FIELD_LIMITS.claimPurpose, 'Purpose')

  if (tripStartDate && !validIsoDate(tripStartDate)) errors.tripStartDate = 'Enter a valid start date.'
  if (tripEndDate && !validIsoDate(tripEndDate)) errors.tripEndDate = 'Enter a valid end date.'
  if (!errors.tripStartDate && !errors.tripEndDate) {
    if (tripEndDate && !tripStartDate) errors.tripStartDate = 'Enter the trip start date too, or clear the end date.'
    else if (tripStartDate && tripEndDate && tripEndDate < tripStartDate) {
      errors.tripEndDate = `End date must be on or after the start date (${formatDate(tripStartDate)}).`
    }
  }
  return clean(errors)
}

/* ---------- Line item (E4) ---------- */

/**
 * @param {{category?: string, amount?: string, expenseDate?: string, vendor?: string,
 *          notes?: string, city?: string, nights?: string|number}} values
 * @param {{today?: string, submissionWindowDays?: number, requiresHotelDetails?: boolean}} [ctx]
 */
export function validateLine(values = {}, ctx = {}) {
  const {
    today = todayISO(),
    submissionWindowDays = DEFAULT_SUBMISSION_WINDOW_DAYS,
    requiresHotelDetails = values.category === 'HOTEL',
  } = ctx
  const { category, amount, expenseDate, vendor, notes, city, nights } = values
  const errors = {}

  if (isBlank(category)) errors.category = 'Choose a category.'

  errors.amount = validateMoney(amount, { label: 'Amount', max: FIELD_LIMITS.maxLineAmount })

  if (isBlank(expenseDate)) errors.expenseDate = 'Enter the date of the expense.'
  else if (!validIsoDate(expenseDate)) errors.expenseDate = 'Enter a valid date.'
  else if (expenseDate > today) errors.expenseDate = `The date cannot be in the future (today is ${formatDate(today)}).`
  else {
    const oldest = addDaysISO(today, -submissionWindowDays)
    if (expenseDate < oldest) {
      errors.expenseDate = `Expenses older than ${submissionWindowDays} days can't be claimed. Use a date on or after ${formatDate(oldest)}.`
    }
  }

  if (isBlank(vendor)) errors.vendor = 'Enter the vendor or merchant name.'
  else errors.vendor = maxLength(vendor, FIELD_LIMITS.vendor, 'Vendor')

  errors.notes = maxLength(notes, FIELD_LIMITS.notes, 'Notes')

  if (requiresHotelDetails) {
    if (isBlank(city)) errors.city = 'Enter the city of the hotel stay.'
    else errors.city = maxLength(city, FIELD_LIMITS.city, 'City')

    if (isBlank(nights)) errors.nights = 'Enter the number of nights.'
    else {
      const n = Number(nights)
      if (!Number.isInteger(n)) errors.nights = 'Nights must be a whole number.'
      else if (n < FIELD_LIMITS.nightsMin || n > FIELD_LIMITS.nightsMax) {
        errors.nights = `Nights must be between ${FIELD_LIMITS.nightsMin} and ${FIELD_LIMITS.nightsMax}.`
      }
    }
  }
  return clean(errors)
}

/** True when the amount is strictly above the receipt threshold. */
export function isReceiptRequired(amount, receiptThreshold) {
  if (isBlank(amount) || isBlank(receiptThreshold)) return false
  const parsed = parseMoneyInput(String(amount))
  if (parsed === null || parsed === undefined) return false
  return compareMoney(parsed, String(receiptThreshold)) > 0
}

/**
 * Receipt step (E5). Returns `{receipt}` error when a receipt is required but missing.
 * @param {{amount?: string, hasReceipt: boolean}} values
 * @param {{receiptThreshold?: string}} ctx
 */
export function validateLineReceipt(values = {}, ctx = {}) {
  const { amount, hasReceipt } = values
  if (!hasReceipt && isReceiptRequired(amount, ctx.receiptThreshold)) {
    return { receipt: `A receipt is required for amounts above ${formatMoney(ctx.receiptThreshold)}.` }
  }
  return {}
}

/** Checks a picked receipt file. Returns a message or null. */
export function validateReceiptFile(file) {
  if (!file) return 'Choose a photo or PDF of the receipt.'
  if (file.type && !RECEIPT_TYPES.includes(file.type)) {
    return 'Upload a JPEG, PNG or PDF file.'
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    return `The file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Receipts must be 5 MB or smaller.`
  }
  if (file.size === 0) return 'The file is empty. Choose another file.'
  return null
}

/* ---------- Comments / reasons (E7, M3, A2) ---------- */

/**
 * @param {string} text
 * @param {{label?: string, required?: boolean, min?: number, max?: number}} [opts]
 */
export function validateComment(text, opts = {}) {
  const { label = 'Comment', required = true, min = 3, max = FIELD_LIMITS.comment } = opts
  if (isBlank(text)) return required ? `Enter a ${label.toLowerCase()}.` : null
  if (String(text).trim().length < min) return `${label} must be at least ${min} characters.`
  return maxLength(text, max, label)
}

/* ---------- Delegation (M4) ---------- */

/**
 * @param {{delegateId?: string, startsOn?: string, endsOn?: string, reason?: string}} values
 * @param {{today?: string}} [ctx]
 */
export function validateDelegateChoice(values = {}) {
  return clean({ delegateId: isBlank(values.delegateId) ? 'Choose who will approve on your behalf.' : null })
}

export function validateDelegationDates(values = {}, ctx = {}) {
  const { today = todayISO() } = ctx
  const { startsOn, endsOn, reason } = values
  const errors = {}
  if (isBlank(startsOn)) errors.startsOn = 'Enter the first day of your leave.'
  else if (!validIsoDate(startsOn)) errors.startsOn = 'Enter a valid start date.'
  else if (startsOn < today) errors.startsOn = `Start date can't be in the past (today is ${formatDate(today)}).`

  if (isBlank(endsOn)) errors.endsOn = 'Enter the last day of your leave.'
  else if (!validIsoDate(endsOn)) errors.endsOn = 'Enter a valid end date.'
  else if (startsOn && validIsoDate(startsOn) && endsOn < startsOn) {
    errors.endsOn = `End date must be on or after the start date (${formatDate(startsOn)}).`
  }
  errors.reason = maxLength(reason, FIELD_LIMITS.delegationReason, 'Reason')
  return clean(errors)
}

export function validateDelegation(values = {}, ctx = {}) {
  return { ...validateDelegateChoice(values), ...validateDelegationDates(values, ctx) }
}

/* ---------- Policy configuration (F4) ---------- */

/**
 * Step 1 "Spending limits". Keys for rules are `rules.<CODE>.softLimit|hardLimit`.
 * @param {{receiptThreshold, overdueThresholdHours, samplePercent, weekendFlagEnabled,
 *          rules: Array<{code, name, softLimit, hardLimit}>}} values
 */
export function validatePolicyLimits(values = {}) {
  const errors = {}
  errors.receiptThreshold = validateMoney(values.receiptThreshold, {
    label: 'Receipt threshold',
    allowZero: true,
  })

  const hours = Number(values.overdueThresholdHours)
  if (isBlank(values.overdueThresholdHours)) errors.overdueThresholdHours = 'Enter the overdue threshold in hours.'
  else if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
    errors.overdueThresholdHours = 'Overdue threshold must be a whole number of hours between 1 and 720.'
  }

  const pct = Number(values.samplePercent)
  if (isBlank(values.samplePercent)) errors.samplePercent = 'Enter the sample audit percentage.'
  else if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
    errors.samplePercent = 'Sample percentage must be a whole number from 0 to 100.'
  }

  for (const rule of values.rules || []) {
    const name = rule.name || rule.code
    const softKey = `rules.${rule.code}.softLimit`
    const hardKey = `rules.${rule.code}.hardLimit`
    errors[softKey] = validateMoney(rule.softLimit, { label: `${name} soft limit` })
    errors[hardKey] = validateMoney(rule.hardLimit, { label: `${name} hard limit` })
    if (!errors[softKey] && !errors[hardKey]) {
      const soft = parseMoneyInput(String(rule.softLimit))
      const hard = parseMoneyInput(String(rule.hardLimit))
      if (compareMoney(hard, soft) < 0) {
        errors[hardKey] = `Hard limit must be at least the soft limit (${formatMoney(soft)}).`
      }
    }
  }
  return clean(errors)
}

/** Step 2 "Tier-1 cities". */
export function validateTier1Cities(cities = []) {
  if (!cities.length) return { tier1Cities: 'Add at least one tier-1 city.' }
  const seen = new Set()
  for (const c of cities) {
    const key = normalizeCity(c)
    if (!key) return { tier1Cities: 'City names cannot be blank.' }
    if (key.length > FIELD_LIMITS.city) return { tier1Cities: `"${c}" is longer than ${FIELD_LIMITS.city} characters.` }
    if (seen.has(key)) return { tier1Cities: `"${c}" is listed twice.` }
    seen.add(key)
  }
  return {}
}

/** Validates one city before it is added to the list. Returns a message or null. */
export function validateNewCity(name, existing = []) {
  const key = normalizeCity(name)
  if (!key) return 'Type a city name.'
  if (key.length > FIELD_LIMITS.city) return `City name must be ${FIELD_LIMITS.city} characters or fewer.`
  if (existing.some((c) => normalizeCity(c) === key)) return `${String(name).trim()} is already in the list.`
  return null
}

/** Matches the backend `city_key`: lower(trim(city)) with inner spaces collapsed. */
export function normalizeCity(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Step 3 "Review & publish". */
export function validatePolicyPublish(values = {}) {
  const { changeNote } = values
  if (isBlank(changeNote)) return { changeNote: 'Describe what changed and why (at least 10 characters).' }
  if (String(changeNote).trim().length < 10) return { changeNote: 'Change note must be at least 10 characters.' }
  return clean({ changeNote: maxLength(changeNote, FIELD_LIMITS.changeNote, 'Change note') })
}
