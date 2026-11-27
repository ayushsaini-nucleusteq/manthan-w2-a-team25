/** Constants shared by the mock back end. */

export const ROLES = ['EMPLOYEE', 'MANAGER', 'AUDITOR', 'FINANCE_HEAD'];
export const APPROVER_ROLES = ['MANAGER', 'AUDITOR', 'FINANCE_HEAD'];

export const CATEGORIES = [
  { code: 'MEALS', name: 'Meals', requiresHotelDetails: false, active: true },
  { code: 'HOTEL', name: 'Hotel', requiresHotelDetails: true, active: true },
  { code: 'LOCAL_CAB', name: 'Local cab', requiresHotelDetails: false, active: true },
  { code: 'AIRFARE', name: 'Airfare', requiresHotelDetails: false, active: true },
  { code: 'TRAIN', name: 'Train', requiresHotelDetails: false, active: true },
  { code: 'OTHER', name: 'Other', requiresHotelDetails: false, active: true },
];
export const CATEGORY_CODES = CATEGORIES.map((c) => c.code);

export const STATUS = {
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
};
export const ALL_STATUSES = Object.values(STATUS);

/** Statuses whose lines take part in duplicate and meals-per-day checks. */
export const OUT_OF_SCOPE_STATUSES = new Set([STATUS.DRAFT, STATUS.AUTO_REJECTED, STATUS.REJECTED]);

export const STEP_STATUS_FOR_CLAIM = {
  MANAGER: STATUS.PENDING_MANAGER,
  AUDITOR: STATUS.PENDING_AUDITOR,
  FINANCE_HEAD: STATUS.PENDING_FINANCE_HEAD,
};

export const STEP_ORDER = { MANAGER: 1, AUDITOR: 2, FINANCE_HEAD: 3, SAMPLE_AUDIT: 4 };

export const OUTCOME_RANK = { AUTO_APPROVE: 0, ROUTE: 1, AUTO_REJECT: 2 };

export const REASON_LABELS = {
  WITHIN_LIMIT: 'Within limit',
  SOFT_LIMIT_EXCEEDED: 'Over soft limit',
  HARD_LIMIT_EXCEEDED: 'Over hard limit',
  DUPLICATE_RECEIPT: 'Duplicate receipt',
  DUPLICATE: 'Possible duplicate',
  WEEKEND_EXPENSE: 'Weekend expense',
  NO_POLICY_RULE: 'No policy rule',
};

export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export const AUDIT_ACTIONS = [
  'LOGIN',
  'CLAIM_CREATED',
  'CLAIM_UPDATED',
  'CLAIM_DELETED',
  'LINE_ADDED',
  'LINE_UPDATED',
  'LINE_DELETED',
  'RECEIPT_UPLOADED',
  'RECEIPT_REMOVED',
  'CLAIM_SUBMITTED',
  'POLICY_EVALUATED',
  'CLAIM_AUTO_APPROVED',
  'CLAIM_AUTO_REJECTED',
  'CLAIM_ROUTED',
  'CLAIM_APPROVED',
  'CLAIM_SENT_BACK',
  'CLAIM_REJECTED',
  'COMMENT_ADDED',
  'SAMPLE_TAGGED',
  'SAMPLE_CLEARED',
  'SAMPLE_REJECTED',
  'SAMPLE_SENT_BACK',
  'DELEGATION_CREATED',
  'DELEGATION_REVOKED',
  'PAYOUT_BATCH_CREATED',
  'PAYOUT_BATCH_EXPORTED',
  'PAYOUT_BATCH_PAID',
  'CLAIM_IN_BATCH',
  'CLAIM_PAID',
  'POLICY_PUBLISHED',
  'USER_UPDATED',
];

export const ENTITY_TYPES = ['USER', 'CLAIM', 'LINE', 'RECEIPT', 'DELEGATION', 'PAYOUT_BATCH', 'POLICY'];
