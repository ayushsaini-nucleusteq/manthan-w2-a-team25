/**
 * Approver inbox and decisions (M1–M3) against the Spring backend.
 * Same function names, arguments and return shapes as ../mock/approvals.js.
 *
 * Also exports the claim / inbox mappers (backend ClaimDetail, ClaimSummary, InboxItem →
 * frontend Claim, ClaimSummary, InboxItem) that ./auditor.js reuses. They are not page APIs.
 */
import { ApiError } from '../errors.js';
import { getSession } from '../session.js';
import { API_BASE_URL, get, post } from './client.js';
import { itemsOf, money, nameOf, totalOf } from './common.js';

/* ------------------------------------------------------------------ helpers */

const CATEGORY_NAMES = { MEALS: 'Meals', HOTEL: 'Hotel', LOCAL_CAB: 'Local cab', AIRFARE: 'Airfare', TRAIN: 'Train', OTHER: 'Other' };
const POOL_LABEL = { MANAGER: 'Manager pool', AUDITOR: 'Auditor pool', FINANCE_HEAD: 'Finance head pool' };
const COMMENT_KIND = { APPROVAL_NOTE: 'APPROVE_NOTE', RESUBMIT_REPLY: 'REPLY', SAMPLE_AUDIT_NOTE: 'APPROVE_NOTE' };
const ACT_ACTIONS = ['APPROVE', 'REJECT', 'SEND_BACK', 'CLEAR_SAMPLE'];
const HOUR_MS = 3600000;

/** Backend reason codes → frontend chip flags (WEEKEND, DUPLICATE, SOFT_LIMIT); anything else is dropped. */
const REASON_TO_FLAG = {
  WEEKEND_EXPENSE: 'WEEKEND',
  DUPLICATE: 'DUPLICATE',
  DUPLICATE_RECEIPT: 'DUPLICATE',
  SOFT_LIMIT_EXCEEDED: 'SOFT_LIMIT',
};

/** Distinct frontend flags from backend reason codes (or already-frontend flags). */
export function mapFlags(codes) {
  const out = new Set();
  for (const code of Array.isArray(codes) ? codes : []) {
    const flag = REASON_TO_FLAG[code] ?? (['WEEKEND', 'DUPLICATE', 'SOFT_LIMIT', 'SAMPLE', 'OVERDUE', 'DELEGATED'].includes(code) ? code : null);
    if (flag) out.add(flag);
  }
  return [...out];
}

function hoursSince(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  return Math.round(((Date.now() - t) / HOUR_MS) * 10) / 10;
}

function currentUserId() {
  return getSession()?.user?.id ?? null;
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Reads every page (size 100) of a paginated list; stops after `maxPages`. */
export async function fetchAllPages(path, query = {}, maxPages = 10) {
  const items = [];
  let page = 0;
  let total;
  for (;;) {
    const body = await get(path, { query: { ...query, page, size: 100 } });
    const chunk = itemsOf(body);
    items.push(...chunk);
    total = totalOf(body, items);
    const totalPages = Number(body?.totalPages) || 1;
    page += 1;
    if (page >= totalPages || page >= maxPages || !chunk.length) break;
  }
  return { items, total };
}

/** totalItems of a list without reading it (size=1). */
export async function countOf(path, query = {}) {
  const body = await get(path, { query: { ...query, page: 0, size: 1 } });
  return Number(totalOf(body, itemsOf(body))) || 0;
}

/* -------------------------------------------------------------- claim parts */

function mapFinding(f) {
  return {
    ruleCode: f?.ruleCode ?? null,
    ruleName: f?.ruleName ?? null,
    reasonCode: f?.reasonCode ?? null,
    outcome: f?.outcome ?? null,
    message: f?.message ?? '',
    limitType: f?.limitType ?? null,
    unit: f?.unit ?? null,
    limitValue: money(f?.limit ?? f?.limitValue),
    actualValue: money(f?.actual ?? f?.actualValue),
    excessValue: money(f?.excess ?? f?.excessValue),
    matchedClaimNumber: f?.matchedClaimNumber ?? null,
    matchedLineNo: f?.matchedLineNo ?? null,
  };
}

function mapReceipt(r, claimId, lineId) {
  if (!r) return null;
  return {
    id: r.id,
    fileName: r.fileName ?? null,
    contentType: r.contentType ?? null,
    sizeBytes: r.sizeBytes ?? null,
    sha256: r.sha256 ?? null,
    // Bearer-protected: <img src> cannot send the token, pages need a blob fetch for previews.
    url: r.url ?? (claimId && lineId ? `${API_BASE_URL}/api/claims/${claimId}/lines/${lineId}/receipt` : null),
    uploadedAt: r.uploadedAt ?? null,
  };
}

function mapLine(l, claimId) {
  const findings = Array.isArray(l?.findings) ? l.findings.map(mapFinding) : [];
  return {
    id: l?.id,
    lineNo: l?.lineNo ?? null,
    category: l?.category ?? null,
    categoryName: l?.categoryName ?? CATEGORY_NAMES[l?.category] ?? l?.category ?? null,
    amount: money(l?.amount),
    expenseDate: l?.expenseDate ?? null,
    vendor: l?.vendor ?? null,
    notes: l?.notes ?? null,
    city: l?.city ?? null,
    nights: l?.nights ?? null,
    receipt: mapReceipt(l?.receipt, claimId, l?.id),
    policyOutcome: l?.policyOutcome ?? null,
    findings,
    flags: mapFlags(Array.isArray(l?.flags) ? l.flags : findings.map((f) => f.reasonCode)),
    needsEvaluation: Boolean(l?.needsEvaluation),
    evaluatedPolicyVersionNo: l?.policyVersionNo ?? l?.evaluatedPolicyVersionNo ?? null,
  };
}

function mapStep(s) {
  const requiredRole = s?.requiredRole ?? (s?.stepType === 'SAMPLE_AUDIT' ? 'AUDITOR' : s?.stepType ?? null);
  const assigneeId = s?.assignee?.id ?? s?.assigneeId ?? null;
  return {
    id: s?.id,
    sequence: s?.sequence ?? null,
    stepType: s?.stepType ?? null,
    requiredRole,
    assigneeId,
    assigneeName: nameOf(s?.assignee) ?? s?.assigneeName ?? null,
    poolLabel: assigneeId ? null : POOL_LABEL[requiredRole] ?? null,
    status: s?.status ?? null,
    pendingSince: s?.pendingSince ?? null,
    ageHours: s?.status === 'PENDING' ? s?.ageHours ?? hoursSince(s?.pendingSince) : null,
    overdue: Boolean(s?.overdue),
    actedByName: nameOf(s?.actedBy) ?? (s?.decidedAt ? s?.approverName ?? null : null),
    onBehalfOfName: s?.onBehalfOfName ?? nameOf(s?.onBehalfOf),
    actedAt: s?.actedAt ?? s?.decidedAt ?? null,
    comment: s?.comment ?? null,
  };
}

function mapHistory(h) {
  return {
    at: h?.at ?? null,
    fromStatus: h?.fromStatus ?? null,
    toStatus: h?.toStatus ?? null,
    action: h?.action ?? null,
    actorName: nameOf(h?.actor) ?? h?.actorName ?? null,
    onBehalfOfName: nameOf(h?.onBehalfOf) ?? h?.onBehalfOfName ?? null,
    note: h?.note ?? h?.comment ?? null,
  };
}

function mapComment(c, index) {
  return {
    id: c?.id ?? `c${index + 1}`,
    at: c?.at ?? null,
    authorName: nameOf(c?.author) ?? c?.authorName ?? null,
    authorRole: c?.authorRole ?? null,
    kind: COMMENT_KIND[c?.kind] ?? c?.kind ?? 'COMMENT',
    text: c?.text ?? '',
  };
}

/** Backend ClaimDetail → frontend Claim (same keys as mock views.toClaim). */
export function mapClaim(c) {
  if (!c) return null;
  const steps = (Array.isArray(c.approvalSteps) ? c.approvalSteps : []).map(mapStep).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const currentStep = steps.find((s) => s.status === 'PENDING') ?? null;
  const allowed = Array.isArray(c.allowedActions) ? c.allowedActions : [];
  const canAct = allowed.some((a) => ACT_ACTIONS.includes(a));
  const viewerId = currentUserId();
  const flags = new Set(mapFlags(c.flags));
  if (c.sampleAudit) flags.add('SAMPLE');
  if (currentStep?.overdue) flags.add('OVERDUE');
  const lines = (Array.isArray(c.lines) ? c.lines : []).map((l) => mapLine(l, c.id)).sort((a, b) => (a.lineNo ?? 0) - (b.lineNo ?? 0));
  return {
    id: c.id,
    claimNumber: c.claimNumber ?? null,
    employeeId: c.employee?.id ?? c.employeeId ?? null,
    employeeName: nameOf(c.employee) ?? c.employeeName ?? null,
    employeeCode: c.employee?.employeeCode ?? c.employeeCode ?? null,
    departmentId: c.department?.id ?? c.departmentId ?? null,
    departmentName: c.department?.name ?? c.departmentName ?? null,
    title: c.title ?? '',
    purpose: c.purpose ?? null,
    tripStartDate: c.tripStartDate ?? null,
    tripEndDate: c.tripEndDate ?? null,
    currency: c.currency ?? 'INR',
    status: c.status ?? null,
    totalAmount: money(c.totalAmount) ?? '0.00',
    submissionNo: c.submissionNo ?? 0,
    policyVersionNo: c.policyVersionNo ?? null,
    policyOutcome: c.policyOutcome ?? null,
    decisionReason: c.decisionReason ?? null,
    sampleAudit: Boolean(c.sampleAudit),
    sampleAuditStatus: c.sampleAuditStatus ?? null,
    sampledAt: c.sampledAt ?? (c.sampleAudit ? c.decidedAt ?? null : null),
    sampleAuditedByName: nameOf(c.sampleAuditedBy) ?? c.sampleAuditedByName ?? null,
    sampleAuditedAt: c.sampleAuditedAt ?? null,
    payoutBatchId: c.payoutBatchId ?? c.payoutBatch?.id ?? null,
    payoutBatchNumber: c.payoutBatchNumber ?? c.payoutBatch?.batchNumber ?? null,
    submittedAt: c.submittedAt ?? null,
    decidedAt: c.decidedAt ?? null,
    paidAt: c.paidAt ?? null,
    createdAt: c.createdAt ?? null,
    updatedAt: c.updatedAt ?? null,
    version: isNum(c.version) ? c.version : null,
    lines,
    approvalSteps: steps,
    statusHistory: (Array.isArray(c.statusHistory) ? c.statusHistory : []).map(mapHistory),
    comments: (Array.isArray(c.comments) ? c.comments : []).map(mapComment),
    flags: [...flags],
    currentStep,
    editable: Boolean(c.editable),
    canAct,
    // Backend does not say on whose behalf the caller would act; a named step for someone else implies delegation.
    actingOnBehalfOfName:
      canAct && currentStep?.assigneeId && viewerId && currentStep.assigneeId !== viewerId ? currentStep.assigneeName : null,
  };
}

/** Backend ClaimSummary → frontend ClaimSummary (same keys as mock views.toClaimSummary). */
export function mapClaimSummary(c) {
  const flags = new Set(mapFlags(c?.flags));
  if (c?.sampleAudit) flags.add('SAMPLE');
  return {
    id: c?.id,
    claimNumber: c?.claimNumber ?? null,
    title: c?.title ?? '',
    employeeId: c?.employee?.id ?? c?.employeeId ?? null,
    employeeName: nameOf(c?.employee) ?? c?.employeeName ?? null,
    employeeCode: c?.employee?.employeeCode ?? c?.employeeCode ?? null,
    departmentId: c?.department?.id ?? c?.departmentId ?? null,
    departmentName: c?.department?.name ?? c?.departmentName ?? null,
    status: c?.status ?? null,
    totalAmount: money(c?.totalAmount) ?? '0.00',
    lineCount: c?.lineCount ?? 0,
    policyOutcome: c?.policyOutcome ?? null,
    submittedAt: c?.submittedAt ?? null,
    decidedAt: c?.decidedAt ?? null,
    createdAt: c?.createdAt ?? null,
    updatedAt: c?.updatedAt ?? null,
    flags: [...flags],
    sampleAudit: Boolean(c?.sampleAudit),
    sampleAuditStatus: c?.sampleAuditStatus ?? null,
  };
}

/** Backend InboxItem ({stepId, ..., claim: ClaimSummary}) → frontend InboxItem (mock views.toInboxItem). */
export function mapInboxItem(it) {
  const claim = it?.claim ?? {};
  const overdue = Boolean(it?.overdue) && (it?.state ?? 'PENDING') === 'PENDING';
  const delegated = Boolean(it?.delegated);
  const flags = new Set(mapFlags(claim.flags));
  if (claim.sampleAudit) flags.add('SAMPLE');
  if (overdue) flags.add('OVERDUE');
  if (delegated) flags.add('DELEGATED');
  return {
    claimId: claim.id ?? it?.claimId ?? null,
    claimNumber: claim.claimNumber ?? null,
    title: claim.title ?? '',
    employeeName: nameOf(claim.employee) ?? null,
    employeeCode: claim.employee?.employeeCode ?? null,
    departmentId: claim.department?.id ?? null,
    departmentName: claim.department?.name ?? null,
    totalAmount: money(claim.totalAmount) ?? '0.00',
    lineCount: claim.lineCount ?? 0,
    stepId: it?.stepId ?? null,
    stepType: it?.stepType ?? null,
    pendingSince: it?.pendingSince ?? null,
    ageHours: isNum(it?.ageHours) ? it.ageHours : (it?.state ?? 'PENDING') === 'PENDING' ? hoursSince(it?.pendingSince) : null,
    overdue,
    delegated,
    onBehalfOfName: nameOf(it?.onBehalfOf),
    flags: [...flags],
    status: claim.status ?? null,
    policyOutcome: claim.policyOutcome ?? null,
    submittedAt: claim.submittedAt ?? null,
    decision: it?.myAction?.action ?? null,
    decidedAt: it?.myAction?.at ?? null,
    // ClaimSummary carries no version; approve() reads it from the claim when it is missing.
    version: isNum(claim.version) ? claim.version : null,
  };
}

/** Raw GET /api/claims/{id}. */
export function fetchClaimRaw(claimId) {
  return get(`/api/claims/${encodeURIComponent(claimId)}`);
}

/** The version to send: the caller's, else the claim's current one (GET /api/claims/{id}). */
export async function resolveVersion(claimId, version) {
  if (isNum(version)) return version;
  const raw = await fetchClaimRaw(claimId);
  return isNum(raw?.version) ? raw.version : 0;
}

/* ---------------------------------------------------------------------- API */

const STATES = ['PENDING', 'OVERDUE', 'SENT_BACK', 'DECIDED'];
const INBOX = '/api/approvals/inbox';

/**
 * Approver inbox. PENDING and OVERDUE are oldest first; SENT_BACK and DECIDED newest first.
 * `counts` come from one size=1 request per other state (totalItems).
 * Endpoint: `GET /api/approvals/inbox?state=PENDING|OVERDUE|SENT_BACK|DECIDED`.
 * @param {{state?: 'PENDING'|'OVERDUE'|'SENT_BACK'|'DECIDED'}} [params]
 * @returns {Promise<{items: object[], counts: {PENDING: number, OVERDUE: number, SENT_BACK: number, DECIDED: number}}>}
 */
export async function getInbox({ state = 'PENDING' } = {}) {
  const wanted = STATES.includes(state) ? state : 'PENDING';
  const [list, ...others] = await Promise.all([
    fetchAllPages(INBOX, { state: wanted }, wanted === 'DECIDED' ? 2 : 10),
    ...STATES.filter((s) => s !== wanted).map((s) => countOf(INBOX, { state: s }).then((n) => [s, n])),
  ]);
  const counts = { PENDING: 0, OVERDUE: 0, SENT_BACK: 0, DECIDED: 0, ...Object.fromEntries(others) };
  counts[wanted] = Number(list.total) || list.items.length;
  const items = list.items.map(mapInboxItem);
  if (wanted === 'DECIDED') return { items: items.slice(0, 200), counts };
  return { items, counts };
}

/**
 * A claim for review by an approver, auditor or the finance head (not the owner: 404).
 * Endpoint: `GET /api/claims/{id}`.
 */
export async function getReviewClaim(claimId) {
  const claim = mapClaim(await fetchClaimRaw(claimId));
  const viewerId = currentUserId();
  if (!claim || (viewerId && claim.employeeId === viewerId)) throw new ApiError(404, 'NOT_FOUND', 'Claim not found.');
  return claim;
}

/**
 * Approves the current step. 409 on a stale `version`.
 * Endpoint: `POST /api/claims/{id}/approve` {version, comment}.
 * @param {string} claimId
 * @param {{comment?: string, version?: number}} [body]
 */
export async function approve(claimId, { comment, version } = {}) {
  const v = await resolveVersion(claimId, version);
  const text = typeof comment === 'string' && comment.trim() ? comment.trim() : null;
  return mapClaim(await post(`/api/claims/${encodeURIComponent(claimId)}/approve`, { version: v, comment: text }));
}

/**
 * Sends the claim back to the employee (comment required, else 400).
 * Endpoint: `POST /api/claims/{id}/send-back` {version, comment}.
 * @param {string} claimId
 * @param {{comment: string, version?: number}} body
 */
export async function sendBack(claimId, { comment, version } = {}) {
  const v = await resolveVersion(claimId, version);
  return mapClaim(await post(`/api/claims/${encodeURIComponent(claimId)}/send-back`, { version: v, comment: comment ?? '' }));
}

/**
 * Rejects the claim (reason required, else 400). Final.
 * Endpoint: `POST /api/claims/{id}/reject` {version, reason}.
 * @param {string} claimId
 * @param {{reason: string, version?: number}} body
 */
export async function reject(claimId, { reason, version } = {}) {
  const v = await resolveVersion(claimId, version);
  return mapClaim(await post(`/api/claims/${encodeURIComponent(claimId)}/reject`, { version: v, reason: reason ?? '' }));
}
