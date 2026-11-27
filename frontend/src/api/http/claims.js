/**
 * Employee claims (E1–E7) and the shared claim endpoints (comments, audit trail) against the backend.
 * Same function names, arguments and return shapes as ../mock/claims.js.
 *
 * Receipt previews: the backend serves receipt bytes at GET /api/claims/{id}/lines/{lineId}/receipt
 * behind the bearer token, which <img>/<iframe> cannot send. Pages read `line.receipt.url`
 * synchronously, so every mapped claim resolves its receipt URLs *at mapping time*: each receipt is
 * fetched once as a blob and turned into an object URL, cached by receipt id (a replaced receipt
 * gets a new id). Later reads of the same claim reuse the cache, so only new receipts cost a
 * request. A receipt that fails to load keeps `url: null` (pages show their placeholder) and is
 * retried on the next read. Uploads seed the cache with an object URL of the uploaded file itself.
 */
import { ApiError } from '../errors.js';
import { getSession } from '../session.js';
import { del, get, patch as httpPatch, post, put, request } from './client.js';
import { itemsOf, money, nameOf } from './common.js';
import { categoryName } from './reference.js';

/* ------------------------------------------------------------ vocabularies */

/** Backend reason codes → frontend flags (FLAG_META); others carry no flag, like the mock. */
const FLAG_BY_REASON = {
  WEEKEND_EXPENSE: 'WEEKEND',
  DUPLICATE: 'DUPLICATE',
  DUPLICATE_RECEIPT: 'DUPLICATE',
  SOFT_LIMIT_EXCEEDED: 'SOFT_LIMIT',
};

/** Backend ClaimComment.kind → frontend comment kind (COMMENT_KIND_LABEL). */
const COMMENT_KIND = {
  COMMENT: 'COMMENT',
  APPROVAL_NOTE: 'APPROVE_NOTE',
  SEND_BACK: 'SEND_BACK',
  REJECT_REASON: 'REJECT_REASON',
  RESUBMIT_REPLY: 'REPLY',
};

/** Backend LineError.code → frontend blocker code (SUBMIT_BLOCKER_LABEL). */
const BLOCKER_CODE = { EXPENSE_DATE_IN_FUTURE: 'FUTURE_DATE' };

/** Backend AuditAction → frontend audit action (AUDIT_ACTION_META). Unlisted actions pass through. */
const AUDIT_ACTION = {
  SUBMITTED: 'CLAIM_SUBMITTED',
  RESUBMITTED: 'CLAIM_SUBMITTED',
  ROUTED: 'CLAIM_ROUTED',
  STEPS_ADDED: 'CLAIM_ROUTED',
  AUTO_APPROVED: 'CLAIM_AUTO_APPROVED',
  AUTO_REJECTED: 'CLAIM_AUTO_REJECTED',
  APPROVED: 'CLAIM_APPROVED',
  REJECTED: 'CLAIM_REJECTED',
  SENT_BACK: 'CLAIM_SENT_BACK',
  COMMENTED: 'COMMENT_ADDED',
  LINE_REMOVED: 'LINE_DELETED',
  SAMPLE_AUDIT_SELECTED: 'SAMPLE_TAGGED',
  SAMPLE_AUDIT_CLEARED: 'SAMPLE_CLEARED',
  ADDED_TO_BATCH: 'CLAIM_IN_BATCH',
  PAYOUT_EXPORTED: 'PAYOUT_BATCH_EXPORTED',
  PAYOUT_PAID: 'PAYOUT_BATCH_PAID',
  POLICY_VERSION_CREATED: 'POLICY_PUBLISHED',
};

/** Status-history action derived from the target status (the backend StatusChange has none). */
const ACTION_BY_TO_STATUS = {
  DRAFT: 'CLAIM_CREATED',
  SUBMITTED: 'CLAIM_SUBMITTED',
  PENDING_MANAGER: 'CLAIM_ROUTED',
  PENDING_AUDITOR: 'CLAIM_ROUTED',
  PENDING_FINANCE_HEAD: 'CLAIM_ROUTED',
  AUTO_APPROVED: 'CLAIM_AUTO_APPROVED',
  AUTO_REJECTED: 'CLAIM_AUTO_REJECTED',
  APPROVED: 'CLAIM_APPROVED',
  REJECTED: 'CLAIM_REJECTED',
  SENT_BACK: 'CLAIM_SENT_BACK',
  IN_BATCH: 'CLAIM_IN_BATCH',
  PAID: 'CLAIM_PAID',
};

const STEP_STATUS_FOR_CLAIM = { MANAGER: 'PENDING_MANAGER', AUDITOR: 'PENDING_AUDITOR', FINANCE_HEAD: 'PENDING_FINANCE_HEAD' };
const POOL_LABEL = { MANAGER: 'Manager pool', AUDITOR: 'Auditor pool', FINANCE_HEAD: 'Finance head pool' };
const ACT_ACTIONS = ['APPROVE', 'REJECT', 'SEND_BACK', 'CLEAR_SAMPLE'];
const CLAIM_STATUSES = ['DRAFT', 'SUBMITTED', 'AUTO_APPROVED', 'AUTO_REJECTED', 'PENDING_MANAGER', 'PENDING_AUDITOR', 'PENDING_FINANCE_HEAD', 'SENT_BACK', 'REJECTED', 'APPROVED', 'IN_BATCH', 'PAID'];

/* ------------------------------------------------------------------ helpers */

const enc = encodeURIComponent;
const claimPath = (id) => `/api/claims/${enc(id)}`;
const linePath = (id, lineId) => `${claimPath(id)}/lines/${enc(lineId)}`;

function list(value) {
  return Array.isArray(value) ? value : [];
}

function hoursSince(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  return Math.round(((Date.now() - t) / 3600000) * 10) / 10;
}

function flagsFromFindings(findings) {
  const flags = new Set();
  for (const f of list(findings)) if (FLAG_BY_REASON[f?.reasonCode]) flags.add(FLAG_BY_REASON[f.reasonCode]);
  return [...flags];
}

/** Claim-level flags from the backend's reason codes (already frontend flags pass through). */
function flagsFromCodes(codes) {
  const flags = new Set();
  for (const c of list(codes)) {
    if (FLAG_BY_REASON[c]) flags.add(FLAG_BY_REASON[c]);
    else if (['WEEKEND', 'DUPLICATE', 'SOFT_LIMIT', 'SAMPLE', 'OVERDUE', 'DELEGATED'].includes(c)) flags.add(c);
  }
  return flags;
}

function mapBlocker(b) {
  return {
    lineId: b?.lineId ?? null,
    lineNo: b?.lineNo ?? null,
    field: b?.field ?? null,
    code: BLOCKER_CODE[b?.code] ?? b?.code ?? null,
    message: b?.message ?? '',
  };
}

function requiredRole(stepType) {
  return stepType === 'SAMPLE_AUDIT' ? 'AUDITOR' : stepType ?? null;
}

/** Frontend line input → backend ExpenseLineRequest (hotel fields only for HOTEL). */
function toLineRequest(input, { withId = false } = {}) {
  const src = input ?? {};
  const category = String(src.category ?? '').trim().toUpperCase();
  const body = {
    category,
    amount: money(typeof src.amount === 'string' ? src.amount.replace(/[,\s₹]/g, '') : src.amount),
    expenseDate: src.expenseDate ?? null,
    vendor: typeof src.vendor === 'string' ? src.vendor.trim() : src.vendor ?? null,
    notes: typeof src.notes === 'string' ? src.notes.trim() || null : src.notes ?? null,
  };
  if (category === 'HOTEL') {
    body.city = typeof src.city === 'string' ? src.city.trim() || null : src.city ?? null;
    body.nights = src.nights === '' || src.nights === null || src.nights === undefined ? null : Number(src.nights);
  }
  if (withId && src.id) body.id = src.id;
  return body;
}

/** Reads every page of a paginated list (Spring page or {items, totalPages}). */
async function fetchAllPages(path, query, size = 100, maxPages = 50) {
  const all = [];
  for (let page = 0; page < maxPages; page += 1) {
    const body = await get(path, { query: { ...query, page, size } });
    const items = itemsOf(body);
    all.push(...items);
    const totalPages = body?.totalPages;
    if (Array.isArray(body) || items.length < size || (typeof totalPages === 'number' && page + 1 >= totalPages)) {
      return { items: all, first: body };
    }
  }
  return { items: all, first: null };
}

/* ------------------------------------------------------------ receipt URLs */

/** receiptId → Promise<string|null> (object URL of the file). */
const receiptUrls = new Map();
/** `${claimId}/${lineId}` → receiptId, to revoke URLs of replaced or deleted receipts. */
const lineReceipt = new Map();

function revokeUrl(url) {
  try {
    if (url && String(url).startsWith('blob:')) globalThis.URL?.revokeObjectURL?.(url);
  } catch {
    // Nothing to clean up.
  }
}

function forgetReceipt(receiptId) {
  const pending = receiptUrls.get(receiptId);
  if (!pending) return;
  receiptUrls.delete(receiptId);
  pending.then(revokeUrl, () => {});
}

function trackLineReceipt(claimId, lineId, receiptId) {
  const key = `${claimId}/${lineId}`;
  const previous = lineReceipt.get(key);
  if (previous && previous !== receiptId) forgetReceipt(previous);
  if (receiptId) lineReceipt.set(key, receiptId);
  else lineReceipt.delete(key);
}

function objectUrl(blob) {
  try {
    return globalThis.URL?.createObjectURL ? globalThis.URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

/** Object URL for a line's receipt, fetched once with the bearer token. */
function receiptUrlFor(claimId, lineId, receiptId) {
  const key = receiptId ?? `${claimId}/${lineId}`;
  let pending = receiptUrls.get(key);
  if (!pending) {
    pending = request('GET', `${linePath(claimId, lineId)}/receipt`, { responseType: 'blob' })
      .then((blob) => (blob ? objectUrl(blob) : null))
      .catch(() => {
        receiptUrls.delete(key); // retry on the next read
        return null;
      });
    receiptUrls.set(key, pending);
  }
  return pending;
}

/* ----------------------------------------------------------------- mappers */

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

/** Backend Receipt → frontend receipt; `url` is filled by resolveReceiptUrls(). */
function mapReceipt(r, url = null) {
  if (!r) return null;
  return {
    id: r.id ?? null,
    fileName: r.fileName ?? null,
    contentType: r.contentType ?? null,
    sizeBytes: r.sizeBytes ?? null,
    sha256: r.sha256 ?? null,
    url,
    uploadedAt: r.uploadedAt ?? null,
  };
}

function mapLine(l) {
  const findings = list(l?.findings).map(mapFinding);
  const policyOutcome = l?.policyOutcome ?? null;
  return {
    id: l?.id ?? null,
    lineNo: l?.lineNo ?? null,
    category: l?.category ?? null,
    categoryName: l?.categoryName ?? categoryName(l?.category),
    amount: money(l?.amount),
    expenseDate: l?.expenseDate ?? null,
    vendor: l?.vendor ?? null,
    notes: l?.notes ?? null,
    city: l?.city ?? null,
    nights: l?.nights ?? null,
    receipt: mapReceipt(l?.receipt),
    policyOutcome,
    findings,
    flags: Array.isArray(l?.flags) ? [...flagsFromCodes(l.flags)] : flagsFromFindings(l?.findings),
    needsEvaluation: l?.needsEvaluation ?? policyOutcome === null,
    evaluatedPolicyVersionNo: l?.policyVersionNo ?? l?.evaluatedPolicyVersionNo ?? null,
  };
}

function mapStep(s) {
  const role = requiredRole(s?.stepType);
  const assigneeId = s?.assignee?.id ?? s?.assigneeId ?? null;
  const assigneeName = nameOf(s?.assignee) ?? s?.assigneeName ?? null;
  const decided = s?.status && !['WAITING', 'PENDING'].includes(s.status);
  const status = s?.status ?? null;
  return {
    id: s?.id ?? null,
    sequence: s?.sequence ?? null,
    stepType: s?.stepType ?? null,
    requiredRole: role,
    assigneeId,
    assigneeName,
    poolLabel: assigneeId ? null : POOL_LABEL[role] ?? null,
    status,
    pendingSince: s?.pendingSince ?? null,
    ageHours: status === 'PENDING' ? s?.ageHours ?? hoursSince(s?.pendingSince) : null,
    overdue: Boolean(s?.overdue),
    actedByName: nameOf(s?.actedBy) ?? (decided ? s?.approverName ?? null : null),
    onBehalfOfName: nameOf(s?.onBehalfOf) ?? s?.onBehalfOfName ?? null,
    actedAt: s?.actedAt ?? s?.decidedAt ?? null,
    comment: s?.comment ?? null,
  };
}

function commentKind(kind, sampleAuditStatus) {
  if (kind === 'SAMPLE_AUDIT_NOTE') {
    return { CLEARED: 'APPROVE_NOTE', REJECTED: 'REJECT_REASON', SENT_BACK: 'SEND_BACK' }[sampleAuditStatus] ?? 'COMMENT';
  }
  return COMMENT_KIND[kind] ?? kind ?? 'COMMENT';
}

/** Role of a comment's author: the owner, else the role of a step they decided, else by kind. */
function commentRole(c, dto) {
  const authorId = c?.author?.id ?? null;
  if (c?.authorRole) return c.authorRole;
  if (c?.kind === 'RESUBMIT_REPLY' || (authorId && authorId === dto?.employee?.id)) return 'EMPLOYEE';
  if (c?.kind === 'SAMPLE_AUDIT_NOTE') return 'AUDITOR';
  const onBehalfId = c?.onBehalfOf?.id ?? null;
  const step = list(dto?.approvalSteps).find(
    (s) => (authorId && s?.actedBy?.id === authorId) || (onBehalfId && s?.assignee?.id === onBehalfId),
  );
  return step ? requiredRole(step.stepType) : null;
}

function mapComments(dto) {
  return list(dto?.comments).map((c, i) => ({
    id: c?.id ?? `${c?.at ?? ''}#${i}`,
    at: c?.at ?? null,
    authorName: nameOf(c?.author) ?? c?.authorName ?? null,
    authorRole: commentRole(c, dto),
    kind: commentKind(c?.kind, dto?.sampleAuditStatus),
    text: c?.text ?? '',
  }));
}

/** The note shown under a status change: the decision comment stored at the same instant. */
function statusNote(dto, change) {
  const wanted = { SENT_BACK: ['SEND_BACK', 'SAMPLE_AUDIT_NOTE'], REJECTED: ['REJECT_REASON', 'SAMPLE_AUDIT_NOTE'], APPROVED: ['APPROVAL_NOTE'] }[change?.toStatus];
  if (!wanted || !change?.at) return null;
  const hit = list(dto?.comments).find((c) => c?.at === change.at && wanted.includes(c?.kind));
  return hit?.text ?? null;
}

function mapStatusHistory(dto) {
  return list(dto?.statusHistory).map((h) => ({
    at: h?.at ?? null,
    fromStatus: h?.fromStatus ?? null,
    toStatus: h?.toStatus ?? null,
    action: h?.action ? AUDIT_ACTION[h.action] ?? h.action : ACTION_BY_TO_STATUS[h?.toStatus] ?? null,
    actorName: nameOf(h?.actor) ?? h?.actorName ?? null,
    onBehalfOfName: nameOf(h?.onBehalfOf) ?? h?.onBehalfOfName ?? null,
    note: h?.note ?? h?.comment ?? statusNote(dto, h),
  }));
}

/** Backend ClaimSummary → frontend ClaimSummary. */
export function mapClaimSummary(dto) {
  const flags = flagsFromCodes(dto?.flags);
  if (dto?.sampleAudit) flags.add('SAMPLE');
  return {
    id: dto?.id ?? null,
    claimNumber: dto?.claimNumber ?? null,
    title: dto?.title ?? '',
    employeeId: dto?.employee?.id ?? dto?.employeeId ?? null,
    employeeName: nameOf(dto?.employee) ?? dto?.employeeName ?? null,
    employeeCode: dto?.employee?.employeeCode ?? dto?.employeeCode ?? null,
    departmentId: dto?.department?.id ?? dto?.departmentId ?? null,
    departmentName: dto?.department?.name ?? dto?.departmentName ?? null,
    status: dto?.status ?? null,
    totalAmount: money(dto?.totalAmount),
    lineCount: dto?.lineCount ?? list(dto?.lines).length,
    policyOutcome: dto?.policyOutcome ?? null,
    submittedAt: dto?.submittedAt ?? null,
    decidedAt: dto?.decidedAt ?? null,
    createdAt: dto?.createdAt ?? null,
    updatedAt: dto?.updatedAt ?? null,
    flags: [...flags],
    sampleAudit: Boolean(dto?.sampleAudit),
    sampleAuditStatus: dto?.sampleAuditStatus ?? null,
  };
}

/**
 * Backend ClaimDetail → frontend Claim (receipt urls still null; see resolveReceiptUrls).
 * `editable`/`canAct` come from `editable` and `allowedActions`.
 */
export function mapClaimDetail(dto) {
  const lines = list(dto?.lines)
    .map(mapLine)
    .sort((a, b) => (a.lineNo ?? 0) - (b.lineNo ?? 0));
  const approvalSteps = list(dto?.approvalSteps)
    .map(mapStep)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const currentStep = approvalSteps.find((s) => s.status === 'PENDING') ?? null;
  const allowed = list(dto?.allowedActions);
  const canAct = ACT_ACTIONS.some((a) => allowed.includes(a));

  const flags = flagsFromCodes(dto?.flags);
  for (const l of lines) for (const f of l.flags) flags.add(f);
  if (dto?.sampleAudit) flags.add('SAMPLE');
  if (currentStep?.overdue) flags.add('OVERDUE');

  // The backend does not say who the caller acts for; infer it from the named assignee.
  let actingOnBehalfOfName = null;
  const viewerId = getSession()?.user?.id ?? null;
  if (canAct && currentStep?.assigneeId && viewerId && currentStep.assigneeId !== viewerId) {
    actingOnBehalfOfName = currentStep.assigneeName;
  }

  return {
    id: dto?.id ?? null,
    claimNumber: dto?.claimNumber ?? null,
    employeeId: dto?.employee?.id ?? dto?.employeeId ?? null,
    employeeName: nameOf(dto?.employee) ?? dto?.employeeName ?? null,
    employeeCode: dto?.employee?.employeeCode ?? dto?.employeeCode ?? null,
    departmentId: dto?.department?.id ?? dto?.departmentId ?? null,
    departmentName: dto?.department?.name ?? dto?.departmentName ?? null,
    title: dto?.title ?? '',
    purpose: dto?.purpose ?? null,
    tripStartDate: dto?.tripStartDate ?? null,
    tripEndDate: dto?.tripEndDate ?? null,
    currency: dto?.currency ?? 'INR',
    status: dto?.status ?? null,
    totalAmount: money(dto?.totalAmount),
    submissionNo: dto?.submissionNo ?? 0,
    policyVersionNo: dto?.policyVersionNo ?? null,
    policyOutcome: dto?.policyOutcome ?? null,
    decisionReason: dto?.decisionReason ?? null,
    sampleAudit: Boolean(dto?.sampleAudit),
    sampleAuditStatus: dto?.sampleAuditStatus ?? null,
    sampledAt: dto?.sampledAt ?? null,
    sampleAuditedByName: nameOf(dto?.sampleAuditedBy) ?? dto?.sampleAuditedByName ?? null,
    sampleAuditedAt: dto?.sampleAuditedAt ?? null,
    payoutBatchId: dto?.payoutBatch?.id ?? dto?.payoutBatchId ?? null,
    payoutBatchNumber: dto?.payoutBatch?.batchNumber ?? dto?.payoutBatchNumber ?? null,
    submittedAt: dto?.submittedAt ?? null,
    decidedAt: dto?.decidedAt ?? null,
    paidAt: dto?.paidAt ?? null,
    createdAt: dto?.createdAt ?? null,
    updatedAt: dto?.updatedAt ?? null,
    version: dto?.version ?? null,
    lines,
    approvalSteps,
    statusHistory: mapStatusHistory(dto),
    comments: mapComments(dto),
    flags: [...flags],
    currentStep,
    editable: dto?.editable ?? allowed.includes('EDIT'),
    canAct,
    actingOnBehalfOfName,
  };
}

/** Fills `receipt.url` on every line (blob object URLs, cached by receipt id). */
export async function resolveReceiptUrls(claim) {
  if (!claim?.id) return claim;
  await Promise.all(
    claim.lines.map(async (line) => {
      trackLineReceipt(claim.id, line.id, line.receipt?.id ?? null);
      if (line.receipt) line.receipt.url = await receiptUrlFor(claim.id, line.id, line.receipt.id);
    }),
  );
  return claim;
}

/** ClaimDetail DTO → Claim with receipt URLs. Exported for other http modules (approvals, auditor). */
export async function toClaim(dto) {
  return resolveReceiptUrls(mapClaimDetail(dto));
}

/** Backend AuditEvent → frontend audit event. */
export function mapAuditEvent(e) {
  let action = e?.action ?? null;
  const sampleStep = e?.details?.stepType === 'SAMPLE_AUDIT';
  if (action === 'SENT_BACK' && sampleStep) action = 'SAMPLE_SENT_BACK';
  else if (action === 'REJECTED' && sampleStep) action = 'SAMPLE_REJECTED';
  else action = AUDIT_ACTION[action] ?? action;
  return {
    id: e?.id ?? null,
    occurredAt: e?.occurredAt ?? null,
    actorId: e?.actor?.id ?? e?.actorId ?? null,
    actorName: nameOf(e?.actor) ?? e?.actorName ?? (e?.actor || e?.actorId ? null : 'System'),
    onBehalfOfName: nameOf(e?.onBehalfOf) ?? e?.onBehalfOfName ?? null,
    action,
    entityType: e?.entityType ?? null,
    entityId: e?.entityId ?? null,
    claimId: e?.claimId ?? null,
    claimNumber: e?.claimNumber ?? e?.details?.claimNumber ?? null,
    fromStatus: e?.fromStatus ?? null,
    toStatus: e?.toStatus ?? null,
    comment: e?.comment ?? null,
    details: e?.details ?? null,
  };
}

/** Current version of a claim, for requests that need optimistic locking. */
async function currentVersion(id) {
  const dto = await get(claimPath(id));
  return dto?.version ?? null;
}

/* -------------------------------------------------------------------- API */

/**
 * The caller's claims, newest change first, with counts per status.
 * GET /api/claims?scope=mine&status=&q= (all pages; `statusCounts` ignores the status filter).
 * @param {{status?: string|string[], q?: string}} [params]
 * @returns {Promise<{items: object[], statusCounts: Record<string, number>}>}
 */
export async function listMyClaims({ status, q } = {}) {
  let statuses = null;
  if (status && status !== 'ALL') {
    statuses = (Array.isArray(status) ? status : String(status).split(',')).map((s) => s.trim()).filter(Boolean);
  }
  const { items, first } = await fetchAllPages('/api/claims', {
    scope: 'mine',
    status: statuses?.length ? statuses : undefined,
    q: q ? String(q).trim() : undefined,
    sort: 'updatedAt,desc',
  });
  const statusCounts = Object.fromEntries(CLAIM_STATUSES.map((s) => [s, 0]));
  const counts = first?.statusCounts;
  if (counts && typeof counts === 'object') {
    for (const [k, v] of Object.entries(counts)) if (k !== 'ALL') statusCounts[k] = Number(v) || 0;
  } else {
    for (const c of items) if (c?.status) statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1;
  }
  statusCounts.ALL = Object.entries(statusCounts).reduce((sum, [, v]) => sum + v, 0);
  return { items: items.map(mapClaimSummary), statusCounts };
}

/**
 * A claim the caller may see; 404 otherwise.
 * GET /api/claims/{id}
 */
export async function getClaim(id) {
  return toClaim(await get(claimPath(id)));
}

/**
 * Creates a draft. An optional client-generated `id` makes retries safe.
 * POST /api/claims
 * @param {{id?: string, title: string, purpose?: string, tripStartDate?: string, tripEndDate?: string, lines?: object[]}} input
 */
export async function createClaim(input) {
  const src = input ?? {};
  const body = {
    title: typeof src.title === 'string' ? src.title.trim() : src.title,
    purpose: typeof src.purpose === 'string' ? src.purpose.trim() || null : src.purpose ?? null,
    tripStartDate: src.tripStartDate || null,
    tripEndDate: src.tripEndDate || null,
    currency: 'INR',
  };
  if (src.id) body.id = src.id;
  if (Array.isArray(src.lines) && src.lines.length) body.lines = src.lines.map((l) => toLineRequest(l, { withId: true }));
  return toClaim(await post('/api/claims', body));
}

/**
 * Updates the header of a draft or sent-back claim. Sends `patch.version` when given,
 * otherwise reads the current version first (the backend requires one).
 * PATCH /api/claims/{id}
 */
export async function updateClaim(id, patch) {
  const src = patch ?? {};
  const body = {};
  for (const key of ['title', 'purpose', 'tripStartDate', 'tripEndDate']) {
    if (!(key in src)) continue;
    const v = src[key];
    body[key] = typeof v === 'string' ? v.trim() || (key === 'title' ? '' : null) : v ?? null;
  }
  body.version = src.version ?? (await currentVersion(id));
  return toClaim(await httpPatch(claimPath(id), body));
}

/**
 * Deletes a draft that was never submitted (409 otherwise).
 * DELETE /api/claims/{id} (204)
 * @returns {Promise<{id: string, deleted: true}>}
 */
export async function deleteClaim(id) {
  await del(claimPath(id));
  for (const [key, receiptId] of lineReceipt) {
    if (key.startsWith(`${id}/`)) {
      forgetReceipt(receiptId);
      lineReceipt.delete(key);
    }
  }
  return { id, deleted: true };
}

/**
 * Adds a line (optional client `id`) and returns the claim with its new total.
 * POST /api/claims/{id}/lines
 */
export async function addLine(claimId, input) {
  return toClaim(await post(`${claimPath(claimId)}/lines`, toLineRequest(input, { withId: true })));
}

const LINE_FIELDS = ['category', 'amount', 'expenseDate', 'vendor', 'notes', 'city', 'nights'];

/**
 * Updates a line and returns the claim. PUT replaces the whole line, so a partial patch is
 * merged onto the saved line first.
 * PUT /api/claims/{id}/lines/{lineId}
 */
export async function updateLine(claimId, lineId, patch) {
  let values = { ...(patch ?? {}) };
  const partial = ['category', 'amount', 'expenseDate', 'vendor'].some((k) => !(k in values));
  if (partial) {
    const dto = await get(claimPath(claimId));
    const saved = list(dto?.lines).find((l) => l?.id === lineId);
    if (!saved) throw new ApiError(404, 'NOT_FOUND', 'Expense line not found.');
    const base = Object.fromEntries(LINE_FIELDS.map((k) => [k, saved[k] ?? null]));
    values = { ...base, ...values };
  }
  return toClaim(await put(linePath(claimId, lineId), toLineRequest(values)));
}

/**
 * Deletes a line and returns the claim.
 * DELETE /api/claims/{id}/lines/{lineId}
 */
export async function deleteLine(claimId, lineId) {
  const claim = await toClaim(await del(linePath(claimId, lineId)));
  trackLineReceipt(claimId, lineId, null);
  return claim;
}

const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const EXTENSION_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };

function fileType(file) {
  if (file.type) return file.type.toLowerCase();
  const ext = String(file.name ?? '').split('.').pop().toLowerCase();
  return EXTENSION_TYPES[ext] ?? '';
}

function reportProgress(onProgress, value) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(value);
  } catch {
    // A failing progress callback must not break the upload.
  }
}

/**
 * Uploads (or replaces) a line's receipt as multipart field `file` (JPEG, PNG or PDF, at most
 * 5 MB; checked here too so the user gets the same messages as the mock). fetch has no upload
 * progress, so `onProgress` gets 0 before and 100 after. The preview URL is an object URL of
 * the uploaded file itself.
 * PUT /api/claims/{id}/lines/{lineId}/receipt
 * @param {string} claimId
 * @param {string} lineId
 * @param {File|Blob} file
 * @param {{onProgress?: (percent: number) => void}} [options]
 * @returns {Promise<{id, fileName, contentType, sizeBytes, sha256, url, uploadedAt}>}
 */
export async function uploadReceipt(claimId, lineId, file, { onProgress } = {}) {
  if (!file || typeof file.size !== 'number') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Choose a receipt file to upload.', { fields: { file: 'Choose a receipt file to upload.' } });
  }
  const contentType = fileType(file);
  if (!RECEIPT_TYPES.includes(contentType)) {
    throw new ApiError(400, 'UNSUPPORTED_FILE_TYPE', 'Upload a JPEG, PNG or PDF file.', { fields: { file: 'Upload a JPEG, PNG or PDF file.' } });
  }
  if (file.size > RECEIPT_MAX_BYTES) {
    throw new ApiError(400, 'FILE_TOO_LARGE', 'The file is larger than 5 MB. Upload a smaller photo or PDF.', { fields: { file: 'The file is larger than 5 MB.' } });
  }
  if (file.size === 0) {
    throw new ApiError(400, 'EMPTY_FILE', 'The file is empty. Choose another file.', { fields: { file: 'The file is empty.' } });
  }

  reportProgress(onProgress, 0);
  const form = new FormData();
  form.append('file', file, file.name || `receipt.${contentType.split('/')[1]}`);
  const dto = await request('PUT', `${linePath(claimId, lineId)}/receipt`, { form, timeoutMs: 60000 });
  const url = objectUrl(file);
  const receipt = mapReceipt(dto, url);
  if (receipt?.id) {
    trackLineReceipt(claimId, lineId, receipt.id);
    if (url) receiptUrls.set(receipt.id, Promise.resolve(url));
  }
  reportProgress(onProgress, 100);
  return receipt;
}

/**
 * Receipt of a line on a claim the caller may see. The metadata comes from the claim
 * (GET /api/claims/{id}); the file is fetched as a blob for `url`.
 * GET /api/claims/{id}/lines/{lineId}/receipt
 */
export async function getReceipt(claimId, lineId) {
  const dto = await get(claimPath(claimId));
  const line = list(dto?.lines).find((l) => l?.id === lineId);
  if (!line?.receipt) throw new ApiError(404, 'NOT_FOUND', 'Receipt not found.');
  trackLineReceipt(claimId, lineId, line.receipt.id ?? null);
  const url = await receiptUrlFor(claimId, lineId, line.receipt.id);
  return mapReceipt(line.receipt, url);
}

function expectedStatusFor(outcome, steps) {
  if (!outcome) return null;
  if (outcome === 'AUTO_REJECT') return 'AUTO_REJECTED';
  if (steps.length) return STEP_STATUS_FOR_CLAIM[steps[0]] ?? null;
  return outcome === 'AUTO_APPROVE' ? 'AUTO_APPROVED' : null;
}

/**
 * Policy pre-check. With `line` (a draft line, optionally replacing `lineId`) it evaluates just
 * that line for live hints, using `hasReceipt` for the receipt blocker; without it, the whole
 * saved claim as a submit would (E6). A 400 for the draft line becomes `fieldErrors`, like the mock.
 * POST /api/claims/{id}/policy-preview `{line, lineId, hasReceipt}`
 * @returns {Promise<{lines: object[], claimOutcome: string|null, totalAmount: string, submitBlockers: object[], routePreview: string[], expectedStatus: string|null, policyVersionNo: number}>}
 */
export async function policyPreview(claimId, { line, lineId, hasReceipt } = {}) {
  const path = `${claimPath(claimId)}/policy-preview`;
  if (line) {
    let body;
    try {
      body = await post(path, { line: toLineRequest(line), lineId: lineId ?? null, hasReceipt: Boolean(hasReceipt) });
    } catch (error) {
      if (error?.status !== 400) throw error;
      return {
        lines: [{ lineId: lineId ?? null, lineNo: null, outcome: null, findings: [], flags: [] }],
        claimOutcome: null,
        totalAmount: null,
        submitBlockers: [],
        routePreview: [],
        expectedStatus: null,
        policyVersionNo: null,
        fieldErrors: error.details?.fields ?? {},
      };
    }
    const lineResult = body?.line ?? null;
    const claim = body?.claim ?? {};
    const steps = list(claim.projectedSteps);
    const saved = lineId ? list(claim.lines).find((l) => l?.lineId === lineId) : null;
    return {
      lines: [
        {
          lineId: lineId ?? null,
          lineNo: lineResult?.lineNo ?? saved?.lineNo ?? null,
          outcome: lineResult?.outcome ?? null,
          findings: list(lineResult?.findings).map(mapFinding),
          flags: flagsFromFindings(lineResult?.findings),
        },
      ],
      claimOutcome: claim.outcome ?? null,
      totalAmount: money(claim.totalAmount),
      submitBlockers: list(lineResult?.submitBlockers).map(mapBlocker),
      routePreview: steps,
      expectedStatus: expectedStatusFor(claim.outcome, steps),
      policyVersionNo: body?.policyVersionNo ?? null,
      fieldErrors: {},
    };
  }

  // Whole claim: LineEvaluation has no lineNo, so read the claim alongside for line numbers.
  const [body, dto] = await Promise.all([post(path, {}), get(claimPath(claimId)).catch(() => null)]);
  const lineNos = new Map(list(dto?.lines).map((l) => [l?.id, l?.lineNo ?? null]));
  const claim = body?.claim ?? {};
  const steps = list(claim.projectedSteps);
  const evaluations = list(claim.lines);
  const claimOutcome = evaluations.length ? claim.outcome ?? null : null;
  return {
    lines: evaluations
      .map((l) => ({
        lineId: l?.lineId ?? null,
        lineNo: l?.lineNo ?? lineNos.get(l?.lineId) ?? null,
        outcome: l?.outcome ?? null,
        findings: list(l?.findings).map(mapFinding),
        flags: flagsFromFindings(l?.findings),
      }))
      .sort((a, b) => (a.lineNo ?? 0) - (b.lineNo ?? 0)),
    claimOutcome,
    totalAmount: money(claim.totalAmount ?? dto?.totalAmount) ?? '0.00',
    submitBlockers: list(body?.submitBlockers).map(mapBlocker),
    routePreview: claimOutcome ? steps : [],
    expectedStatus: expectedStatusFor(claimOutcome, steps),
    policyVersionNo: body?.policyVersionNo ?? null,
  };
}

/**
 * Submits (or resubmits with a reply `comment`). 422 → ApiError SUBMIT_BLOCKED with
 * `details.blockers` [{lineId, lineNo, field, code, message}] naming the lines.
 * Reads the current version first when `version` is not given (the backend requires one).
 * POST /api/claims/{id}/submit
 * @param {string} id
 * @param {{comment?: string, version?: number}} [options]
 */
export async function submitClaim(id, { comment, version } = {}) {
  const body = { version: version ?? (await currentVersion(id)) };
  const text = typeof comment === 'string' ? comment.trim() : '';
  if (text) body.comment = text;
  try {
    return await toClaim(await post(`${claimPath(id)}/submit`, body));
  } catch (error) {
    if (error?.status === 422) {
      const blockers = list(error.details?.blockers).map(mapBlocker);
      throw new ApiError(422, 'SUBMIT_BLOCKED', error.message, { ...(error.details ?? {}), blockers });
    }
    throw error;
  }
}

/**
 * Adds a comment to a claim the caller may see, then returns the refreshed claim
 * (the endpoint answers with the stored audit event).
 * POST /api/claims/{id}/comments `{comment}`, then GET /api/claims/{id}
 */
export async function addComment(id, text) {
  const raw = typeof text === 'object' && text ? text.text : text;
  const body = String(raw ?? '').trim();
  if (!body) throw new ApiError(400, 'VALIDATION_ERROR', 'Write a comment first.', { fields: { text: 'Write a comment first.' } });
  if (body.length > 2000) throw new ApiError(400, 'VALIDATION_ERROR', 'Keep the comment under 2000 characters.', { fields: { text: 'Keep the comment under 2000 characters.' } });
  try {
    await post(`${claimPath(id)}/comments`, { comment: body });
  } catch (error) {
    if (error?.status === 400 && error.details?.fields?.comment && !error.details.fields.text) {
      error.details.fields.text = error.details.fields.comment;
    }
    throw error;
  }
  return getClaim(id);
}

/**
 * Append-only history of a claim, oldest first (all pages).
 * GET /api/claims/{id}/audit-trail
 */
export async function getAuditTrail(claimId) {
  const { items } = await fetchAllPages(`${claimPath(claimId)}/audit-trail`, {}, 100);
  return items.map(mapAuditEvent);
}
