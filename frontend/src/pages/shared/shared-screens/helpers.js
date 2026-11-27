/** Helpers for the shared screens (S1, S2, S3). Non-component exports live here. */
import { formatDate, formatMoney, humanize, statusLabel, categoryLabel } from '../../../utils/format.js'

/** Quick demo personas on the sign-in page, matched by email after a name search. */
export const DEMO_PERSONAS = Object.freeze([
  { key: 'employee', label: 'Employee', name: 'Priya Nair', email: 'employee@expenseflow.test' },
  { key: 'manager', label: 'Manager', name: 'Ravi Kumar', email: 'manager@expenseflow.test' },
  { key: 'auditor', label: 'Auditor', name: 'Meera Iyer', email: 'auditor@expenseflow.test' },
  { key: 'head', label: 'Finance head', name: 'Vikram Shah', email: 'head@expenseflow.test' },
])

/** Only same-origin app paths are honoured for ?next= (no protocol-relative or absolute URLs). */
export function safeNextPath(next) {
  if (!next || typeof next !== 'string') return null
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  if (next.startsWith('/login') || next.startsWith('/signed-out')) return null
  return next
}

/**
 * Where a notification leads for this user.
 * Approvers go to their review screens, never to /claims/:id (that would switch to EMPLOYEE).
 */
export function notificationTarget(n, { activeRole, hasRole }) {
  if (n.type === 'APPROVAL_WAITING' && n.claimId) {
    if (activeRole === 'AUDITOR') return `/audit/claims/${n.claimId}`
    if (activeRole === 'MANAGER' || activeRole === 'FINANCE_HEAD') return `/approvals/${n.claimId}`
    if (hasRole('MANAGER') || hasRole('FINANCE_HEAD')) return `/approvals/${n.claimId}`
    if (hasRole('AUDITOR')) return `/audit/claims/${n.claimId}`
    return null
  }
  if (n.type === 'PAYOUT_DONE' && !n.claimId && n.payoutBatchId && hasRole('FINANCE_HEAD')) {
    return `/finance/payouts/${n.payoutBatchId}`
  }
  if (n.claimId) return `/claims/${n.claimId}`
  if (n.payoutBatchId && hasRole('FINANCE_HEAD')) return `/finance/payouts/${n.payoutBatchId}`
  return null
}

/** Breadcrumb trail back to the claim, by active role. */
export function claimCrumbs(activeRole, claimId, claimNumber) {
  const claimLabel = claimNumber || 'Claim'
  if (activeRole === 'AUDITOR') {
    return [
      { label: 'Review queue', to: '/audit/queue' },
      { label: claimLabel, to: `/audit/claims/${claimId}` },
      { label: 'Audit trail' },
    ]
  }
  if (activeRole === 'MANAGER' || activeRole === 'FINANCE_HEAD') {
    return [
      { label: 'Approvals', to: '/approvals' },
      { label: claimLabel, to: `/approvals/${claimId}` },
      { label: 'Audit trail' },
    ]
  }
  return [
    { label: 'My claims', to: '/claims' },
    { label: claimLabel, to: `/claims/${claimId}` },
    { label: 'Audit trail' },
  ]
}

export const AUDIT_ACTION_META = Object.freeze({
  CLAIM_CREATED: { label: 'Claim created', icon: 'plus', tone: 'brand' },
  CLAIM_UPDATED: { label: 'Claim details edited', icon: 'edit', tone: 'neutral' },
  CLAIM_DELETED: { label: 'Draft deleted', icon: 'trash', tone: 'danger' },
  CLAIM_SUBMITTED: { label: 'Submitted', icon: 'send', tone: 'brand' },
  CLAIM_ROUTED: { label: 'Routed for approval', icon: 'arrow-right', tone: 'warning' },
  CLAIM_APPROVED: { label: 'Approved', icon: 'check', tone: 'success' },
  CLAIM_AUTO_APPROVED: { label: 'Auto-approved by policy', icon: 'check', tone: 'success' },
  CLAIM_REJECTED: { label: 'Rejected', icon: 'x', tone: 'danger' },
  CLAIM_AUTO_REJECTED: { label: 'Auto-rejected by policy', icon: 'x', tone: 'danger' },
  CLAIM_SENT_BACK: { label: 'Sent back', icon: 'corner-up-left', tone: 'purple' },
  CLAIM_IN_BATCH: { label: 'Added to payout batch', icon: 'wallet', tone: 'info' },
  CLAIM_PAID: { label: 'Paid', icon: 'wallet', tone: 'navy' },
  COMMENT_ADDED: { label: 'Comment added', icon: 'message', tone: 'neutral' },
  LINE_ADDED: { label: 'Expense line added', icon: 'plus', tone: 'brand' },
  LINE_UPDATED: { label: 'Expense line edited', icon: 'edit', tone: 'neutral' },
  LINE_DELETED: { label: 'Expense line removed', icon: 'trash', tone: 'danger' },
  RECEIPT_UPLOADED: { label: 'Receipt uploaded', icon: 'upload', tone: 'info' },
  RECEIPT_REMOVED: { label: 'Receipt removed', icon: 'trash', tone: 'warning' },
  POLICY_EVALUATED: { label: 'Policy checked', icon: 'shield', tone: 'info' },
  SAMPLE_TAGGED: { label: 'Picked for sample audit', icon: 'sparkles', tone: 'purple' },
  SAMPLE_CLEARED: { label: 'Sample audit cleared', icon: 'check', tone: 'success' },
  SAMPLE_REJECTED: { label: 'Sample audit rejected', icon: 'x', tone: 'danger' },
  SAMPLE_SENT_BACK: { label: 'Sample audit sent back', icon: 'corner-up-left', tone: 'purple' },
})

export function auditActionMeta(action) {
  return AUDIT_ACTION_META[action] || { label: humanize(action), icon: 'file-text', tone: 'neutral' }
}

const MONEY_KEY = /amount|total|limit|excess/i
const DATE_KEY = /date$/i
const STATUS_KEY = /status$/i

/** Human-readable value for a field in a diff or details list. */
export function formatAuditValue(key, value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.map((v) => formatAuditValue(key, v)).join(', ') : '—'
  if (typeof value === 'object') return JSON.stringify(value)
  if (MONEY_KEY.test(key) && /^-?\d+(\.\d+)?$/.test(String(value))) return formatMoney(String(value))
  if (DATE_KEY.test(key)) return formatDate(value)
  if (STATUS_KEY.test(key)) return statusLabel(value)
  if (key === 'category') return categoryLabel(value)
  return String(value)
}

const FIELD_LABELS = {
  tripStartDate: 'Trip start',
  tripEndDate: 'Trip end',
  expenseDate: 'Expense date',
  lineNo: 'Line',
  fileName: 'File',
  sha256: 'Receipt hash',
}

export function fieldLabel(key) {
  return FIELD_LABELS[key] || humanize(key.replace(/([a-z])([A-Z])/g, '$1_$2'))
}

/** details.changes as rows [{field, from, to}] (supports {key: {from, to}} or an array). */
export function changeRows(details) {
  const changes = details?.changes
  if (!changes) return []
  if (Array.isArray(changes)) {
    return changes.map((c, i) => ({ key: c.field ?? String(i), field: c.field ?? String(i), from: c.from, to: c.to }))
  }
  return Object.entries(changes).map(([field, v]) => ({
    key: field,
    field,
    from: v && typeof v === 'object' && 'from' in v ? v.from : null,
    to: v && typeof v === 'object' && 'to' in v ? v.to : v,
  }))
}

/** Other simple details worth showing (skip changes and nested objects). */
export function extraDetails(details) {
  if (!details || typeof details !== 'object') return []
  return Object.entries(details).filter(
    ([k, v]) => k !== 'changes' && k !== 'claimNumber' && v !== null && v !== undefined && (typeof v !== 'object' || Array.isArray(v)) && !(Array.isArray(v) && v.some((x) => x && typeof x === 'object')),
  )
}
