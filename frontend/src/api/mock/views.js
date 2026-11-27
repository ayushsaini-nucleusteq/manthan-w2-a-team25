/**
 * Projections from stored records to the API shapes in the spec, including
 * privacy rules (cross-employee duplicate matches never expose ids; audit
 * details shown to employees lose other employees' claim references).
 */
import { toPaise } from '../../utils/money.js';
import {
  canViewClaim,
  coveredRoles,
  delegationStatus,
  isDelegationActive,
  isOversight,
  pendingStep,
  resolveActing,
  userById,
} from './access.js';
import { CATEGORIES } from './constants.js';
import { maskAccount } from './payoutCore.js';
import { currentPolicy, flagsFromFindings } from './policyEngine.js';
import { receiptUrl } from './receiptArt.js';
import { hoursBetween, isoDateIST } from './util.js';
import { isEditableStatus } from './claimCore.js';

export function departmentName(db, id) {
  return db.departments.find((d) => d.id === id)?.name ?? null;
}

function nameOf(db, id) {
  return userById(db, id)?.fullName ?? null;
}

const POOL_LABEL = { MANAGER: 'Manager pool', AUDITOR: 'Auditor pool', FINANCE_HEAD: 'Finance head pool' };

/* ------------------------------------------------------------------ users */

export function toUser(db, user) {
  const manager = userById(db, user.managerId);
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    employeeCode: user.employeeCode,
    departmentId: user.departmentId,
    departmentName: departmentName(db, user.departmentId),
    managerId: user.managerId,
    managerName: manager?.fullName ?? null,
    roles: [...user.roles],
    active: user.active,
    version: user.version,
  };
}

export function toUserSummary(db, user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    employeeCode: user.employeeCode,
    departmentId: user.departmentId,
    departmentName: departmentName(db, user.departmentId),
    roles: [...user.roles],
  };
}

/* ------------------------------------------------------------- policy */

export function toPolicy(db, version) {
  return {
    versionNo: version.versionNo,
    changeNote: version.changeNote,
    createdByName: nameOf(db, version.createdBy),
    createdAt: version.createdAt,
    receiptThreshold: version.receiptThreshold,
    weekendFlagEnabled: version.weekendFlagEnabled,
    overdueThresholdHours: version.overdueThresholdHours,
    autoApproveMaxTotal: version.autoApproveMaxTotal,
    auditorAboveTotal: version.auditorAboveTotal,
    financeHeadAboveTotal: version.financeHeadAboveTotal,
    samplePercent: version.samplePercent,
    submissionWindowDays: version.submissionWindowDays,
    rules: version.rules.map((r) => ({ ...r })),
    tier1Cities: [...version.tier1Cities],
    current: version.versionNo === currentPolicy(db).versionNo,
  };
}

export function categoryName(code) {
  return CATEGORIES.find((c) => c.code === code)?.name ?? code;
}

/* ----------------------------------------------------------- claim parts */

/** Finding for the API: a match on another employee's claim never exposes its number or line. */
export function toFinding(finding, ownerId) {
  const foreign = finding.matchedEmployeeId && finding.matchedEmployeeId !== ownerId;
  return {
    ruleCode: finding.ruleCode,
    ruleName: finding.ruleName,
    reasonCode: finding.reasonCode,
    outcome: finding.outcome,
    message: finding.message,
    limitType: finding.limitType,
    unit: finding.unit,
    limitValue: finding.limitValue,
    actualValue: finding.actualValue,
    excessValue: finding.excessValue,
    matchedClaimNumber: foreign ? null : finding.matchedClaimNumber ?? null,
    matchedLineNo: foreign ? null : finding.matchedLineNo ?? null,
  };
}

export function toReceipt(receipt) {
  if (!receipt) return null;
  return {
    id: receipt.id,
    fileName: receipt.fileName,
    contentType: receipt.contentType,
    sizeBytes: receipt.sizeBytes,
    sha256: receipt.sha256,
    url: receiptUrl(receipt),
    uploadedAt: receipt.uploadedAt,
  };
}

export function toLine(line, ownerId) {
  return {
    id: line.id,
    lineNo: line.lineNo,
    category: line.category,
    categoryName: categoryName(line.category),
    amount: line.amount,
    expenseDate: line.expenseDate,
    vendor: line.vendor,
    notes: line.notes,
    city: line.city,
    nights: line.nights,
    receipt: toReceipt(line.receipt),
    policyOutcome: line.policyOutcome,
    findings: (line.findings ?? []).map((f) => toFinding(f, ownerId)),
    flags: line.flags ?? flagsFromFindings(line.findings),
    needsEvaluation: Boolean(line.needsEvaluation),
    evaluatedPolicyVersionNo: line.evaluatedPolicyVersionNo ?? null,
  };
}

export function stepAgeHours(step, now) {
  return step?.pendingSince ? hoursBetween(Date.parse(step.pendingSince), now) : null;
}

export function isStepOverdue(db, step, now) {
  if (!step || step.status !== 'PENDING' || !step.pendingSince) return false;
  return stepAgeHours(step, now) > currentPolicy(db).overdueThresholdHours;
}

export function toStep(db, step, now) {
  return {
    id: step.id,
    sequence: step.sequence,
    stepType: step.stepType,
    requiredRole: step.requiredRole,
    assigneeId: step.assigneeId,
    assigneeName: nameOf(db, step.assigneeId),
    poolLabel: step.assigneeId ? null : POOL_LABEL[step.requiredRole] ?? null,
    status: step.status,
    pendingSince: step.pendingSince,
    ageHours: step.status === 'PENDING' ? stepAgeHours(step, now) : null,
    overdue: isStepOverdue(db, step, now),
    actedByName: nameOf(db, step.actedBy),
    onBehalfOfName: nameOf(db, step.actedOnBehalfOf),
    actedAt: step.actedAt,
    comment: step.comment,
  };
}

/** Claim-level flags: line flags + SAMPLE + OVERDUE. */
export function claimFlags(db, claim, now) {
  const flags = new Set();
  for (const line of claim.lines) for (const f of line.flags ?? []) flags.add(f);
  if (claim.sampleAudit) flags.add('SAMPLE');
  const step = pendingStep(claim);
  if (step && isStepOverdue(db, step, now)) flags.add('OVERDUE');
  return [...flags];
}

function statusHistory(db, claim) {
  return db.auditEvents
    .filter((e) => e.claimId === claim.id && e.toStatus && e.entityType === 'CLAIM')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id - b.id)
    .map((e) => ({
      at: e.occurredAt,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      action: e.action,
      actorName: nameOf(db, e.actorId),
      onBehalfOfName: nameOf(db, e.onBehalfOfId),
      note: e.comment,
    }));
}

/**
 * Full Claim. `viewer` decides `editable` and `canAct`.
 */
export function toClaim(db, claim, viewer, now) {
  const owner = userById(db, claim.employeeId);
  const step = pendingStep(claim);
  const acting = step && viewer ? resolveActing(db, viewer, claim, step, now) : null;
  const batch = claim.payoutBatchId ? db.payoutBatches.find((b) => b.id === claim.payoutBatchId) : null;
  return {
    id: claim.id,
    claimNumber: claim.claimNumber,
    employeeId: claim.employeeId,
    employeeName: owner?.fullName ?? null,
    employeeCode: owner?.employeeCode ?? null,
    departmentId: claim.departmentId,
    departmentName: departmentName(db, claim.departmentId),
    title: claim.title,
    purpose: claim.purpose,
    tripStartDate: claim.tripStartDate,
    tripEndDate: claim.tripEndDate,
    currency: claim.currency,
    status: claim.status,
    totalAmount: claim.totalAmount,
    submissionNo: claim.submissionNo,
    policyVersionNo: claim.policyVersionNo,
    policyOutcome: claim.policyOutcome,
    decisionReason: claim.decisionReason,
    sampleAudit: claim.sampleAudit,
    sampleAuditStatus: claim.sampleAuditStatus,
    sampledAt: claim.sampledAt,
    sampleAuditedByName: nameOf(db, claim.sampleAuditedBy),
    sampleAuditedAt: claim.sampleAuditedAt,
    payoutBatchId: claim.payoutBatchId,
    payoutBatchNumber: batch?.batchNumber ?? null,
    submittedAt: claim.submittedAt,
    decidedAt: claim.decidedAt,
    paidAt: claim.paidAt,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
    version: claim.version,
    lines: [...claim.lines].sort((a, b) => a.lineNo - b.lineNo).map((l) => toLine(l, claim.employeeId)),
    approvalSteps: [...claim.steps].sort((a, b) => a.sequence - b.sequence).map((s) => toStep(db, s, now)),
    statusHistory: statusHistory(db, claim),
    comments: claim.comments.map((c) => ({
      id: c.id,
      at: c.at,
      authorName: nameOf(db, c.authorId),
      authorRole: c.authorRole,
      kind: c.kind,
      text: c.text,
    })),
    flags: claimFlags(db, claim, now),
    currentStep: step ? toStep(db, step, now) : null,
    editable: Boolean(viewer) && viewer.id === claim.employeeId && isEditableStatus(claim.status),
    canAct: Boolean(acting?.ok),
    actingOnBehalfOfName: acting?.ok ? nameOf(db, acting.onBehalfOfId) : null,
  };
}

export function toClaimSummary(db, claim, now) {
  const owner = userById(db, claim.employeeId);
  return {
    id: claim.id,
    claimNumber: claim.claimNumber,
    title: claim.title,
    employeeId: claim.employeeId,
    employeeName: owner?.fullName ?? null,
    employeeCode: owner?.employeeCode ?? null,
    departmentId: claim.departmentId,
    departmentName: departmentName(db, claim.departmentId),
    status: claim.status,
    totalAmount: claim.totalAmount,
    lineCount: claim.lines.length,
    policyOutcome: claim.policyOutcome,
    submittedAt: claim.submittedAt,
    decidedAt: claim.decidedAt,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
    flags: claimFlags(db, claim, now),
    sampleAudit: claim.sampleAudit,
    sampleAuditStatus: claim.sampleAuditStatus,
  };
}

/** Inbox / queue row for a step. */
export function toInboxItem(db, claim, step, now, { onBehalfOfId = null, decision = null, decidedAt = null } = {}) {
  const owner = userById(db, claim.employeeId);
  const overdue = step.status === 'PENDING' && isStepOverdue(db, step, now);
  const flags = new Set(claimFlags(db, claim, now));
  if (!overdue) flags.delete('OVERDUE');
  if (onBehalfOfId) flags.add('DELEGATED');
  return {
    claimId: claim.id,
    claimNumber: claim.claimNumber,
    title: claim.title,
    employeeName: owner?.fullName ?? null,
    employeeCode: owner?.employeeCode ?? null,
    departmentId: claim.departmentId,
    departmentName: departmentName(db, claim.departmentId),
    totalAmount: claim.totalAmount,
    lineCount: claim.lines.length,
    stepId: step.id,
    stepType: step.stepType,
    pendingSince: step.pendingSince,
    ageHours: step.status === 'PENDING' ? stepAgeHours(step, now) : null,
    overdue,
    delegated: Boolean(onBehalfOfId),
    onBehalfOfName: nameOf(db, onBehalfOfId),
    flags: [...flags],
    status: claim.status,
    policyOutcome: claim.policyOutcome,
    submittedAt: claim.submittedAt,
    decision,
    decidedAt,
    version: claim.version,
  };
}

/* ------------------------------------------------------------- delegation */

export function toDelegation(db, d, now) {
  const today = isoDateIST(now);
  return {
    id: d.id,
    delegatorId: d.delegatorId,
    delegatorName: nameOf(db, d.delegatorId),
    delegateId: d.delegateId,
    delegateName: nameOf(db, d.delegateId),
    startsOn: d.startsOn,
    endsOn: d.endsOn,
    reason: d.reason,
    active: isDelegationActive(d, today),
    status: delegationStatus(d, today),
    coveredRoles: coveredRoles(db, d),
    revokedAt: d.revokedAt,
    createdAt: d.createdAt,
  };
}

/* ----------------------------------------------------------- notifications */

export function toNotification(n) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    claimId: n.claimId,
    payoutBatchId: n.payoutBatchId,
    createdAt: n.createdAt,
    readAt: n.readAt,
  };
}

/* ---------------------------------------------------------------- payouts */

export function toBatch(db, batch) {
  return {
    id: batch.id,
    batchNumber: batch.batchNumber,
    status: batch.status,
    claimCount: batch.claimCount,
    totalAmount: batch.totalAmount,
    createdByName: nameOf(db, batch.createdBy),
    createdAt: batch.createdAt,
    exportedAt: batch.exportedAt,
    fileName: batch.fileName,
    fileSha256: batch.fileSha256,
    paidAt: batch.paidAt,
    paidByName: nameOf(db, batch.paidBy),
    bankReference: batch.bankReference,
    version: batch.version,
    items: batch.items.map((item) => {
      const claim = db.claims.find((c) => c.id === item.claimId);
      const employee = userById(db, item.employeeId);
      return {
        claimId: item.claimId,
        claimNumber: claim?.claimNumber ?? null,
        claimTitle: claim?.title ?? null,
        claimStatus: claim?.status ?? null,
        employeeName: employee?.fullName ?? null,
        employeeCode: employee?.employeeCode ?? null,
        departmentName: departmentName(db, claim?.departmentId ?? employee?.departmentId),
        amount: item.amount,
        bankAccountMasked: maskAccount(item.bankAccountNumber),
        ifscCode: item.ifscCode,
      };
    }),
  };
}

/* ------------------------------------------------------------------ audit */

const MATCH_KEYS = ['matchedClaimId', 'matchedClaimNumber', 'matchedLineId', 'matchedLineNo'];

/**
 * Removes references to other employees' claims from audit details.
 * `ownerId` is the employee viewing their own trail.
 */
function stripForeignMatches(value, db, ownerId) {
  if (Array.isArray(value)) return value.map((v) => stripForeignMatches(v, db, ownerId));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  const foreign =
    'matchedClaimId' in value &&
    value.matchedClaimId &&
    (value.matchedEmployeeId ?? db.claims.find((c) => c.id === value.matchedClaimId)?.employeeId) !== ownerId;
  for (const [key, inner] of Object.entries(value)) {
    if (key === 'matchedEmployeeId') continue;
    if (foreign && MATCH_KEYS.includes(key)) continue;
    out[key] = stripForeignMatches(inner, db, ownerId);
  }
  return out;
}

export function toAuditEvent(db, event, viewer) {
  const claim = event.claimId ? db.claims.find((c) => c.id === event.claimId) : null;
  const oversight = isOversight(viewer);
  let details = event.details;
  // Non-oversight viewers (the owner, their approvers) only see matches on the claim owner's own claims.
  if (details && !oversight) details = stripForeignMatches(details, db, claim?.employeeId ?? viewer?.id);
  return {
    id: event.id,
    occurredAt: event.occurredAt,
    actorId: event.actorId,
    actorName: nameOf(db, event.actorId) ?? (event.actorId ? null : 'System'),
    onBehalfOfName: nameOf(db, event.onBehalfOfId),
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    claimId: event.claimId,
    claimNumber: claim?.claimNumber ?? event.details?.claimNumber ?? null,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    comment: event.comment,
    details,
  };
}

/* --------------------------------------------------------------- helpers */

export function findVisibleClaim(db, user, claimId, now) {
  const claim = db.claims.find((c) => c.id === claimId);
  if (!claim || !canViewClaim(db, user, claim, now)) return null;
  return claim;
}

export function amountInBand(totalAmount, band) {
  const paise = toPaise(totalAmount);
  switch (band) {
    case '25K_50K':
      return paise > 2500000 && paise <= 5000000;
    case '50K_1L':
      return paise > 5000000 && paise <= 10000000;
    case '1L_PLUS':
      return paise > 10000000;
    default:
      return true;
  }
}
