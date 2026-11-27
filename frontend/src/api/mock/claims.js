/**
 * Employee claims (E1–E7) and the shared claim endpoints (comments, audit trail).
 */
import { ApiError } from '../errors.js';
import { canViewClaim, hasRole, pendingStep, resolveActing, userById } from './access.js';
import {
  addLineCore,
  attachReceiptCore,
  createClaimCore,
  deleteClaimCore,
  deleteLineCore,
  normalizeLineInput,
  removeReceiptCore,
  updateClaimCore,
  updateLineCore,
} from './claimCore.js';
import { ALL_STATUSES, RECEIPT_MAX_BYTES, RECEIPT_TYPES } from './constants.js';
import { appendAudit } from './events.js';
import {
  claimBlockers,
  claimTotalPaise,
  evaluateClaimLines,
  evaluateLine,
  lineBlockers,
  policyAt,
  worstOutcome,
} from './policyEngine.js';
import { createObjectUrl, forgetObjectUrl, rememberObjectUrl } from './receiptArt.js';
import { latencySlice, mutate, notFound, query, sleep } from './runtime.js';
import { sha256Hex } from './sha256.js';
import { cleanText, isoDateIST, newId, normalizeKey, toIso } from './util.js';
import { toAuditEvent, toClaim, toClaimSummary, toFinding, toReceipt } from './views.js';
import { addCommentRecord, previewRoute, submitCore } from './workflow.js';
import { fromPaise } from '../../utils/money.js';

/** The caller's own claim, or 404 (also for someone else's claim). */
function ownClaim(db, user, claimId) {
  const claim = db.claims.find((c) => c.id === claimId);
  if (!claim || claim.employeeId !== user.id) throw notFound('Claim not found.');
  return claim;
}

function visibleClaim(db, user, claimId, now) {
  const claim = db.claims.find((c) => c.id === claimId);
  if (!claim || !canViewClaim(db, user, claim, now)) throw notFound('Claim not found.');
  return claim;
}

function statusFilter(status) {
  if (!status || status === 'ALL') return null;
  const list = Array.isArray(status) ? status : String(status).split(',');
  return new Set(list.map((s) => s.trim()).filter(Boolean));
}

/**
 * The caller's claims, newest change first, with counts per status.
 * Mirrors `GET /api/claims?scope=mine&status=&q=`.
 * @param {{status?: string|string[], q?: string}} [params]
 * @returns {Promise<{items: object[], statusCounts: Record<string, number>}>}
 */
export async function listMyClaims({ status, q } = {}) {
  return query(({ db, user, now }) => {
    const needle = normalizeKey(q);
    const mine = db.claims
      .filter((c) => c.employeeId === user.id)
      .filter((c) => !needle || normalizeKey(`${c.claimNumber} ${c.title} ${c.purpose ?? ''}`).includes(needle));
    const statusCounts = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0]));
    for (const c of mine) statusCounts[c.status] += 1;
    statusCounts.ALL = mine.length;
    const wanted = statusFilter(status);
    const items = mine
      .filter((c) => !wanted || wanted.has(c.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((c) => toClaimSummary(db, c, now));
    return { items, statusCounts };
  });
}

/**
 * A claim the caller may see (owner, approver, auditor, finance head); 404 otherwise.
 * Mirrors `GET /api/claims/{id}`.
 */
export async function getClaim(id) {
  return query(({ db, user, now }) => toClaim(db, visibleClaim(db, user, id, now), user, now));
}

/**
 * Creates a draft. An optional client-generated `id` makes retries safe.
 * Mirrors `POST /api/claims`.
 * @param {{id?: string, title: string, purpose?: string, tripStartDate?: string, tripEndDate?: string}} input
 */
export async function createClaim(input) {
  return mutate(({ db, user, now }) => toClaim(db, createClaimCore(db, user, input, now), user, now));
}

/**
 * Updates the header of a draft or sent-back claim (optional `version` check).
 * Mirrors `PATCH /api/claims/{id}`.
 */
export async function updateClaim(id, patch) {
  return mutate(({ db, user, now }) => {
    const claim = ownClaim(db, user, id);
    return toClaim(db, updateClaimCore(db, claim, user, patch ?? {}, now), user, now);
  });
}

/**
 * Deletes a draft that was never submitted (409 otherwise).
 * Mirrors `DELETE /api/claims/{id}`.
 * @returns {Promise<{id: string, deleted: true}>}
 */
export async function deleteClaim(id) {
  return mutate(({ db, user, now }) => {
    const claim = ownClaim(db, user, id);
    for (const line of claim.lines) if (line.receipt) forgetObjectUrl(line.receipt.id);
    deleteClaimCore(db, claim, user, now);
    return { id, deleted: true };
  });
}

/**
 * Adds a line (optional client `id`) and returns the claim with its new total.
 * Mirrors `POST /api/claims/{id}/lines`.
 */
export async function addLine(claimId, input) {
  return mutate(({ db, user, now }) => {
    const claim = ownClaim(db, user, claimId);
    addLineCore(db, claim, user, input, now);
    return toClaim(db, claim, user, now);
  });
}

/**
 * Updates a line and returns the claim.
 * Mirrors `PUT /api/claims/{id}/lines/{lineId}`.
 */
export async function updateLine(claimId, lineId, patch) {
  return mutate(({ db, user, now }) => {
    const claim = ownClaim(db, user, claimId);
    updateLineCore(db, claim, user, lineId, patch ?? {}, now);
    return toClaim(db, claim, user, now);
  });
}

/**
 * Deletes a line and returns the claim.
 * Mirrors `DELETE /api/claims/{id}/lines/{lineId}`.
 */
export async function deleteLine(claimId, lineId) {
  const result = await mutate(({ db, user, now }) => {
    const claim = ownClaim(db, user, claimId);
    const receiptId = claim.lines.find((l) => l.id === lineId)?.receipt?.id ?? null;
    deleteLineCore(db, claim, user, lineId, now);
    return { claim: toClaim(db, claim, user, now), receiptId };
  });
  if (result.receiptId) forgetObjectUrl(result.receiptId);
  return result.claim;
}

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
 * Uploads a receipt (JPEG, PNG or PDF, at most 5 MB; 400 otherwise).
 * Computes the SHA-256 of the file bytes with crypto.subtle, simulates
 * progress 0–100 through `onProgress`, and keeps an object URL for the
 * preview. Uploading the same file again is a safe retry.
 * Mirrors `PUT /api/claims/{id}/lines/{lineId}/receipt`.
 * @param {string} claimId
 * @param {string} lineId
 * @param {File|Blob} file
 * @param {{onProgress?: (percent: number) => void}} [options]
 * @returns {Promise<{id, fileName, contentType, sizeBytes, sha256, url, uploadedAt}>}
 */
export async function uploadReceipt(claimId, lineId, file, { onProgress } = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') {
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
  const bytes = await file.arrayBuffer();
  for (const percent of [15, 35, 55, 75]) {
    await sleep(latencySlice(0.3));
    reportProgress(onProgress, percent);
  }
  const sha256 = await sha256Hex(bytes);
  reportProgress(onProgress, 90);

  const receiptId = newId();
  const url = createObjectUrl(file);
  let result;
  try {
    result = await mutate(({ db, user, now }) => {
      const claim = ownClaim(db, user, claimId);
      const { receipt, replaced } = attachReceiptCore(
        db,
        claim,
        user,
        lineId,
        {
          id: receiptId,
          fileName: String(file.name || `receipt.${contentType.split('/')[1]}`).slice(0, 255),
          contentType,
          sizeBytes: file.size,
          sha256,
          uploadedAt: toIso(now),
          uploadedBy: user.id,
          storageKey: `uploads/${claim.id}/${receiptId}`,
        },
        now,
      );
      return { receipt, replacedId: replaced?.id ?? null };
    });
  } catch (error) {
    if (url) globalThis.URL?.revokeObjectURL?.(url);
    throw error;
  }
  if (result.receipt.id === receiptId && url) rememberObjectUrl(receiptId, url);
  else if (url) globalThis.URL?.revokeObjectURL?.(url);
  if (result.replacedId) forgetObjectUrl(result.replacedId);
  reportProgress(onProgress, 100);
  return toReceipt(result.receipt);
}

/**
 * Receipt of a line on a claim the caller may see.
 * Mirrors `GET /api/claims/{id}/lines/{lineId}/receipt`.
 */
export async function getReceipt(claimId, lineId) {
  return query(({ db, user, now }) => {
    const claim = visibleClaim(db, user, claimId, now);
    const line = claim.lines.find((l) => l.id === lineId);
    if (!line?.receipt) throw notFound('Receipt not found.');
    return toReceipt(line.receipt);
  });
}

/**
 * Removes a line's receipt and returns the claim.
 * Mirrors `DELETE /api/claims/{id}/lines/{lineId}/receipt` (not in the published endpoint map;
 * the real client can replace the receipt with PUT instead).
 */
export async function removeReceipt(claimId, lineId) {
  const result = await mutate(({ db, user, now }) => {
    const claim = ownClaim(db, user, claimId);
    const removed = removeReceiptCore(db, claim, user, lineId, now);
    return { claim: toClaim(db, claim, user, now), removedId: removed?.id ?? null };
  });
  if (result.removedId) forgetObjectUrl(result.removedId);
  return result.claim;
}

function previewLine(line, result, ownerId) {
  return {
    lineId: line.id,
    lineNo: line.lineNo,
    outcome: result.outcome,
    findings: result.findings.map((f) => toFinding(f, ownerId)),
    flags: result.flags,
  };
}

/**
 * Policy pre-check. With `line` (a draft line, optionally replacing
 * `lineId`) it evaluates just that line for live hints, using `hasReceipt`
 * for the receipt blocker; without it, it evaluates the whole claim as a
 * submit would (E6).
 * Mirrors `POST /api/claims/{id}/policy-preview` `{line, lineId, hasReceipt}`.
 * @returns {Promise<{lines: object[], claimOutcome: string|null, totalAmount: string, submitBlockers: object[], routePreview: string[], expectedStatus: string|null, policyVersionNo: number}>}
 */
export async function policyPreview(claimId, { line, lineId, hasReceipt } = {}) {
  return query(({ db, user, now }) => {
    const claim = ownClaim(db, user, claimId);
    const policy = policyAt(db, now);
    const today = isoDateIST(now);

    if (line) {
      const existing = lineId ? claim.lines.find((l) => l.id === lineId) : null;
      if (lineId && !existing) throw notFound('Expense line not found.');
      const { values, fields } = normalizeLineInput(line, existing ?? {}, now);
      const draft = {
        ...(existing ?? {}),
        ...values,
        id: existing?.id ?? '__draft__',
        lineNo: existing?.lineNo ?? claim.lines.reduce((m, l) => Math.max(m, l.lineNo), 0) + 1,
        receipt: existing?.receipt ?? null,
        needsEvaluation: true,
      };
      const temp = { ...claim, lines: [...claim.lines.filter((l) => l.id !== draft.id), draft] };
      const receiptKnown = hasReceipt === undefined ? Boolean(existing?.receipt) : Boolean(hasReceipt);
      const blockers = lineBlockers(draft, policy, today, receiptKnown);
      const evaluable = !fields.category && !fields.amount && !fields.expenseDate && !fields.city && !fields.nights;
      const totalPaise = claimTotalPaise({ lines: temp.lines.filter((l) => l.id !== draft.id || evaluable) });
      if (!evaluable) {
        return {
          lines: [{ lineId: existing?.id ?? null, lineNo: draft.lineNo, outcome: null, findings: [], flags: [] }],
          claimOutcome: null,
          totalAmount: fromPaise(totalPaise),
          submitBlockers: blockers,
          routePreview: [],
          expectedStatus: null,
          policyVersionNo: policy.versionNo,
          fieldErrors: fields,
        };
      }
      const result = evaluateLine(db, temp, draft, policy);
      const others = evaluateClaimLines(db, temp, policy).filter((r) => r.line.id !== draft.id);
      const claimOutcome = worstOutcome([result.outcome, ...others.map((r) => r.outcome)]);
      const route = previewRoute(db, temp, user, policy, claimOutcome, totalPaise);
      return {
        lines: [{ ...previewLine(draft, result, claim.employeeId), lineId: existing?.id ?? null }],
        claimOutcome,
        totalAmount: fromPaise(totalPaise),
        submitBlockers: blockers,
        routePreview: route.routePreview,
        expectedStatus: route.expectedStatus,
        policyVersionNo: policy.versionNo,
        fieldErrors: fields,
      };
    }

    const results = evaluateClaimLines(db, claim, policy);
    const claimOutcome = results.length ? worstOutcome(results.map((r) => r.outcome)) : null;
    const totalPaise = claimTotalPaise(claim);
    const route = claimOutcome ? previewRoute(db, claim, user, policy, claimOutcome, totalPaise) : { routePreview: [], expectedStatus: null };
    return {
      lines: results.map((r) => previewLine(r.line, r, claim.employeeId)),
      claimOutcome,
      totalAmount: fromPaise(totalPaise),
      submitBlockers: claimBlockers(claim, policy, today),
      routePreview: route.routePreview,
      expectedStatus: route.expectedStatus,
      policyVersionNo: policy.versionNo,
    };
  });
}

/**
 * Submits (or resubmits with a reply `comment`). 422 SUBMIT_BLOCKED with
 * `details.blockers` naming the lines when blocked.
 * Mirrors `POST /api/claims/{id}/submit`.
 * @param {string} id
 * @param {{comment?: string, version?: number}} [options]
 */
export async function submitClaim(id, { comment, version } = {}) {
  return mutate(({ db, user, now }) => {
    const claim = ownClaim(db, user, id);
    if (version !== undefined && version !== null && Number(version) !== claim.version) {
      throw new ApiError(409, 'VERSION_CONFLICT', 'This claim was changed in another window. Reload to see the latest version.');
    }
    submitCore(db, claim, user, { comment, now });
    return toClaim(db, claim, user, now);
  });
}

/**
 * Adds a comment to a claim the caller may see.
 * Mirrors `POST /api/claims/{id}/comments`.
 */
export async function addComment(id, text) {
  return mutate(({ db, user, now }) => {
    const claim = visibleClaim(db, user, id, now);
    const body = cleanText(typeof text === 'object' && text ? text.text : text);
    if (!body) throw new ApiError(400, 'VALIDATION_ERROR', 'Write a comment first.', { fields: { text: 'Write a comment first.' } });
    if (body.length > 2000) throw new ApiError(400, 'VALIDATION_ERROR', 'Keep the comment under 2000 characters.', { fields: { text: 'Keep the comment under 2000 characters.' } });
    let authorRole = 'EMPLOYEE';
    if (claim.employeeId !== user.id) {
      const step = pendingStep(claim);
      if (step && resolveActing(db, user, claim, step, now).ok) authorRole = step.requiredRole;
      else authorRole = ['FINANCE_HEAD', 'AUDITOR', 'MANAGER'].find((r) => hasRole(user, r)) ?? 'EMPLOYEE';
    }
    addCommentRecord(claim, { now, authorId: user.id, authorRole, kind: 'COMMENT', text: body });
    claim.updatedAt = toIso(now);
    appendAudit(db, { now, actorId: user.id, action: 'COMMENT_ADDED', entityType: 'CLAIM', entityId: claim.id, claimId: claim.id, comment: body });
    return toClaim(db, claim, user, now);
  });
}

/**
 * Append-only history of a claim (owner, approvers, auditors, finance head).
 * Employees never see other employees' claim references in the details.
 * Mirrors `GET /api/claims/{id}/audit-trail`.
 */
export async function getAuditTrail(claimId) {
  return query(({ db, user, now }) => {
    const claim = visibleClaim(db, user, claimId, now);
    return db.auditEvents
      .filter((e) => e.claimId === claim.id)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id - b.id)
      .map((e) => toAuditEvent(db, e, userById(db, user.id)));
  });
}
