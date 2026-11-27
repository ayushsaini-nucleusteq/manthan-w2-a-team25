/**
 * Shared constants for ExpenseFlow: statuses, roles, navigation and display metadata.
 * Tones map to the chip colours in styles/components.css (.tone-*).
 */

export const APP_NAME = 'ExpenseFlow'

/* ------------------------------------------------------------------ */
/* Claim statuses                                                      */
/* ------------------------------------------------------------------ */

export const STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  AUTO_APPROVED: 'AUTO_APPROVED',
  PENDING_MANAGER: 'PENDING_MANAGER',
  PENDING_AUDITOR: 'PENDING_AUDITOR',
  PENDING_FINANCE_HEAD: 'PENDING_FINANCE_HEAD',
  APPROVED: 'APPROVED',
  SENT_BACK: 'SENT_BACK',
  REJECTED: 'REJECTED',
  AUTO_REJECTED: 'AUTO_REJECTED',
  IN_BATCH: 'IN_BATCH',
  PAID: 'PAID',
})

/** tone: neutral | brand | success | warning | purple | danger | info | navy */
export const STATUS_META = Object.freeze({
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'brand' },
  AUTO_APPROVED: { label: 'Auto-approved', tone: 'success' },
  PENDING_MANAGER: { label: 'Pending manager', tone: 'warning' },
  PENDING_AUDITOR: { label: 'Pending auditor', tone: 'warning' },
  PENDING_FINANCE_HEAD: { label: 'Pending head', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  SENT_BACK: { label: 'Sent back', tone: 'purple' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  AUTO_REJECTED: { label: 'Auto-rejected', tone: 'danger' },
  IN_BATCH: { label: 'In batch', tone: 'info' },
  PAID: { label: 'Paid', tone: 'navy' },
})

/** Display order for status filter chips (E1). */
export const STATUS_ORDER = Object.freeze([
  'DRAFT',
  'SENT_BACK',
  'PENDING_MANAGER',
  'PENDING_AUDITOR',
  'PENDING_FINANCE_HEAD',
  'AUTO_APPROVED',
  'APPROVED',
  'IN_BATCH',
  'PAID',
  'REJECTED',
  'AUTO_REJECTED',
])

/** Statuses in which the owner may edit the claim. */
export const EDITABLE_STATUSES = Object.freeze(['DRAFT', 'SENT_BACK'])
export const PENDING_STATUSES = Object.freeze(['PENDING_MANAGER', 'PENDING_AUDITOR', 'PENDING_FINANCE_HEAD'])
export const FINAL_STATUSES = Object.freeze(['REJECTED', 'AUTO_REJECTED', 'PAID'])

/* ------------------------------------------------------------------ */
/* Policy outcomes and flags                                           */
/* ------------------------------------------------------------------ */

export const OUTCOME = Object.freeze({
  AUTO_APPROVE: 'AUTO_APPROVE',
  ROUTE: 'ROUTE',
  AUTO_REJECT: 'AUTO_REJECT',
})

export const OUTCOME_META = Object.freeze({
  AUTO_APPROVE: { label: 'Auto-approve', tone: 'success', icon: 'check' },
  ROUTE: { label: 'Route for approval', tone: 'warning', icon: 'arrow-right' },
  AUTO_REJECT: { label: 'Reject', tone: 'danger', icon: 'x' },
})

/** Severity used to compute "worst" outcomes. */
export const OUTCOME_SEVERITY = Object.freeze({ AUTO_APPROVE: 0, ROUTE: 1, AUTO_REJECT: 2 })

export const FLAG_META = Object.freeze({
  WEEKEND: { label: 'Weekend', tone: 'warning' },
  DUPLICATE: { label: 'Possible duplicate', tone: 'warning' },
  SOFT_LIMIT: { label: 'Over limit', tone: 'warning' },
  SAMPLE: { label: 'Sample audit', tone: 'purple' },
  DELEGATED: { label: 'Delegated', tone: 'info' },
  OVERDUE: { label: 'Overdue', tone: 'danger' },
})

export const REASON_CODE_LABEL = Object.freeze({
  WITHIN_LIMIT: 'Within limit',
  SOFT_LIMIT_EXCEEDED: 'Over soft limit',
  HARD_LIMIT_EXCEEDED: 'Over hard limit',
  DUPLICATE_RECEIPT: 'Duplicate receipt',
  DUPLICATE: 'Possible duplicate',
  WEEKEND_EXPENSE: 'Weekend expense',
  NO_POLICY_RULE: 'No policy rule',
  AUTO_APPROVE_MAX_TOTAL: 'Above auto-approve total',
})

export const SUBMIT_BLOCKER_LABEL = Object.freeze({
  RECEIPT_REQUIRED: 'Receipt required',
  FUTURE_DATE: 'Date in the future',
  TOO_OLD: 'Too old to claim',
  MISSING_FIELDS: 'Missing details',
  NO_LINES: 'No line items',
})

export const UNIT_LABEL = Object.freeze({
  PER_DAY: 'per day',
  PER_NIGHT: 'per night',
  PER_TRIP: 'per trip',
})

/* ------------------------------------------------------------------ */
/* Roles and navigation                                                */
/* ------------------------------------------------------------------ */

export const ROLES = Object.freeze({
  EMPLOYEE: 'EMPLOYEE',
  MANAGER: 'MANAGER',
  AUDITOR: 'AUDITOR',
  FINANCE_HEAD: 'FINANCE_HEAD',
})

/** Highest first. */
export const ROLE_PRIORITY = Object.freeze(['FINANCE_HEAD', 'AUDITOR', 'MANAGER', 'EMPLOYEE'])

export const ROLE_LABEL = Object.freeze({
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  AUDITOR: 'Auditor',
  FINANCE_HEAD: 'Finance head',
})

/** Short labels for the segmented role switch. */
export const ROLE_SHORT_LABEL = Object.freeze({
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  AUDITOR: 'Auditor',
  FINANCE_HEAD: 'Head',
})

export const ROLE_HOME = Object.freeze({
  EMPLOYEE: '/claims',
  MANAGER: '/approvals',
  AUDITOR: '/audit/queue',
  FINANCE_HEAD: '/finance/dashboard',
})

/** Backend `homeScreen` (GET /api/auth/me) to the role it stands for. */
export const HOME_SCREEN_ROLE = Object.freeze({
  F1: 'FINANCE_HEAD',
  A1: 'AUDITOR',
  M1: 'MANAGER',
  E1: 'EMPLOYEE',
})

/** Primary nav links per active role. `icon` is an icon name from components/icons.jsx. */
export const NAV_BY_ROLE = Object.freeze({
  EMPLOYEE: [
    { to: '/claims', label: 'My claims', icon: 'receipt', end: true },
    { to: '/claims/new', label: 'New claim', icon: 'plus' },
    { to: '/notifications', label: 'Notifications', icon: 'bell' },
  ],
  MANAGER: [
    { to: '/approvals', label: 'Approvals', icon: 'check' },
    { to: '/delegation', label: 'Delegation', icon: 'users' },
    { to: '/notifications', label: 'Notifications', icon: 'bell' },
  ],
  AUDITOR: [
    { to: '/audit/queue', label: 'Review queue', icon: 'shield' },
    { to: '/audit/samples', label: 'Sample audit', icon: 'sparkles' },
    { to: '/finance/audit-log', label: 'Audit log', icon: 'file-text' },
    { to: '/delegation', label: 'Delegation', icon: 'users' },
  ],
  FINANCE_HEAD: [
    { to: '/finance/dashboard', label: 'Dashboard', icon: 'bar-chart' },
    { to: '/approvals', label: 'Approvals', icon: 'check' },
    { to: '/finance/payouts', label: 'Payouts', icon: 'wallet' },
    { to: '/finance/policy', label: 'Policy', icon: 'settings' },
    { to: '/finance/users', label: 'Users', icon: 'users' },
    { to: '/finance/audit-log', label: 'Audit log', icon: 'file-text' },
  ],
})

/* ------------------------------------------------------------------ */
/* Categories, approval steps, comments, notifications                 */
/* ------------------------------------------------------------------ */

export const CATEGORY_META = Object.freeze({
  MEALS: { label: 'Meals', icon: 'receipt', tone: 'warning', requiresHotelDetails: false },
  HOTEL: { label: 'Hotel', icon: 'building', tone: 'brand', requiresHotelDetails: true },
  LOCAL_CAB: { label: 'Local cab', icon: 'arrow-right', tone: 'info', requiresHotelDetails: false },
  AIRFARE: { label: 'Airfare', icon: 'send', tone: 'purple', requiresHotelDetails: false },
  TRAIN: { label: 'Train', icon: 'clock', tone: 'success', requiresHotelDetails: false },
  OTHER: { label: 'Other', icon: 'file-text', tone: 'neutral', requiresHotelDetails: false },
})

export const STEP_TYPE_LABEL = Object.freeze({
  MANAGER: 'Manager',
  AUDITOR: 'Auditor',
  FINANCE_HEAD: 'Finance head',
  SAMPLE_AUDIT: 'Sample audit',
})

export const STEP_STATUS_META = Object.freeze({
  WAITING: { label: 'Waiting', tone: 'neutral' },
  PENDING: { label: 'Pending', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  SENT_BACK: { label: 'Sent back', tone: 'purple' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
})

export const COMMENT_KIND_LABEL = Object.freeze({
  COMMENT: 'Comment',
  SEND_BACK: 'Sent back',
  REPLY: 'Reply',
  REJECT_REASON: 'Rejection reason',
  APPROVE_NOTE: 'Approval note',
})

export const NOTIFICATION_TYPE_META = Object.freeze({
  APPROVAL_WAITING: { label: 'Approval waiting', icon: 'clock', tone: 'warning' },
  SENT_BACK: { label: 'Sent back', icon: 'corner-up-left', tone: 'purple' },
  PAYOUT_DONE: { label: 'Payout done', icon: 'wallet', tone: 'success' },
  CLAIM_DECIDED: { label: 'Claim decided', icon: 'check', tone: 'brand' },
})

export const PAYOUT_STATUS_META = Object.freeze({
  CREATED: { label: 'Created', tone: 'brand' },
  EXPORTED: { label: 'Exported', tone: 'info' },
  PAID: { label: 'Paid', tone: 'navy' },
})

export const SAMPLE_STATUS_META = Object.freeze({
  PENDING: { label: 'Sample pending', tone: 'purple' },
  CLEARED: { label: 'Sample cleared', tone: 'success' },
  REJECTED: { label: 'Sample rejected', tone: 'danger' },
  SENT_BACK: { label: 'Sample sent back', tone: 'purple' },
})

export const AMOUNT_BANDS = Object.freeze([
  { value: 'ALL', label: 'All amounts' },
  { value: '25K_50K', label: '₹25,000 – ₹50,000' },
  { value: '50K_1L', label: '₹50,000 – ₹1,00,000' },
  { value: '1L_PLUS', label: 'Above ₹1,00,000' },
])

/* ------------------------------------------------------------------ */
/* Limits and storage keys                                             */
/* ------------------------------------------------------------------ */

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024
export const RECEIPT_ACCEPT = 'image/jpeg,image/png,application/pdf'
export const RECEIPT_TYPES = Object.freeze(['image/jpeg', 'image/png', 'application/pdf'])

export const FIELD_LIMITS = Object.freeze({
  claimTitle: 150,
  claimPurpose: 1000,
  vendor: 150,
  notes: 500,
  city: 80,
  nightsMin: 1,
  nightsMax: 60,
  delegationReason: 500,
  changeNote: 500,
  comment: 2000,
  maxLineAmount: '9999999999.99',
})

/** Default submission window (days) used when the policy has not loaded. */
export const DEFAULT_SUBMISSION_WINDOW_DAYS = 60

export const NOTIFICATION_POLL_MS = 30_000

export const STORAGE_KEYS = Object.freeze({
  activeRole: 'expenseflow.activeRole',
  /** Any localStorage key starting with this prefix is an offline draft and is wiped on logout. */
  draftsPrefix: 'expenseflow.draft',
})

/** Window event names used for cross-component signals. */
export const EVENTS = Object.freeze({
  notificationsChanged: 'expenseflow:notifications-changed',
  unauthorized: 'expenseflow:unauthorized',
})
