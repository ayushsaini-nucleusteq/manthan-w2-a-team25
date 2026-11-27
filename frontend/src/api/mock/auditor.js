/**
 * Auditor work (A1–A4): the review queue with filters, bulk actions with
 * per-row results, and sample audits. Sample-tagged claims appear only in
 * the sample-audit list, never in the queue.
 */
import { ApiError } from '../errors.js';
import { canViewClaim, pendingApprovalStep, pendingSampleStep, resolveActing, userById } from './access.js';
import { mutate, notFound, query, requireRole } from './runtime.js';
import { cleanText, normalizeKey } from './util.js';
import { amountInBand, toClaim, toClaimSummary, toInboxItem } from './views.js';
import { decideCore, sampleDecisionCore } from './workflow.js';

function textArg(value, key) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value[key];
  return value;
}

/**
 * Claims waiting for an auditor (pool, or named after a send-back), oldest first.
 * amountBand: ALL | 25K_50K | 50K_1L | 1L_PLUS. flag: WEEKEND | DUPLICATE | SOFT_LIMIT | OVERDUE | DELEGATED.
 * Mirrors `GET /api/auditor/queue?amountBand=&departmentId=&flag=&minAgeHours=`.
 * @returns {Promise<{items: object[], total: number}>}
 */
export async function getAuditorQueue({ amountBand = 'ALL', departmentId, flag, minAgeHours, q } = {}) {
  return query(({ db, user, now }) => {
    requireRole(user, ['AUDITOR']);
    const needle = normalizeKey(q);
    const minAge = Number(minAgeHours) || 0;
    const rows = [];
    let total = 0;
    for (const claim of db.claims) {
      const step = pendingApprovalStep(claim);
      if (!step || step.stepType !== 'AUDITOR') continue;
      const acting = resolveActing(db, user, claim, step, now);
      if (!acting.ok) continue;
      total += 1;
      const item = toInboxItem(db, claim, step, now, { onBehalfOfId: acting.onBehalfOfId });
      if (!amountInBand(claim.totalAmount, amountBand)) continue;
      if (departmentId && claim.departmentId !== departmentId) continue;
      if (flag && flag !== 'ALL' && !item.flags.includes(flag)) continue;
      if (minAge && (item.ageHours ?? 0) < minAge) continue;
      if (needle && !normalizeKey(`${item.claimNumber} ${item.title} ${item.employeeName} ${item.departmentName}`).includes(needle)) continue;
      rows.push(item);
    }
    rows.sort((a, b) => a.pendingSince.localeCompare(b.pendingSince));
    return { items: rows, total };
  });
}

function hasRouteFinding(claim) {
  return claim.lines.some((l) => (l.findings ?? []).some((f) => f.outcome === 'ROUTE'));
}

function bulk(claimIds, decision, comment) {
  return mutate(({ db, user, now }) => {
    requireRole(user, ['AUDITOR']);
    const ids = Array.isArray(claimIds) ? [...new Set(claimIds)] : [];
    if (!ids.length) throw new ApiError(400, 'VALIDATION_ERROR', 'Select at least one claim.', { fields: { claimIds: 'Select at least one claim.' } });
    const results = [];
    for (const claimId of ids) {
      const claim = db.claims.find((c) => c.id === claimId);
      try {
        if (!claim || !canViewClaim(db, user, claim, now)) throw notFound('Claim not found.');
        const step = pendingApprovalStep(claim);
        if (!step || step.stepType !== 'AUDITOR') throw new ApiError(409, 'NOT_PENDING', 'Not waiting for an auditor decision.');
        if (decision === 'APPROVE' && hasRouteFinding(claim)) {
          throw new ApiError(422, 'NEEDS_INDIVIDUAL_REVIEW', 'Needs individual review: has policy flags');
        }
        decideCore(db, claim, user, { decision, comment, now });
        results.push({ claimId, claimNumber: claim.claimNumber, ok: true, error: null, status: claim.status });
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        results.push({ claimId, claimNumber: claim?.claimNumber ?? null, ok: false, error: error.message, code: error.code, status: claim?.status ?? null });
      }
    }
    return {
      results,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
  });
}

/**
 * Approves several queue claims; rows with a ROUTE finding fail with
 * "Needs individual review: has policy flags". Per-row results.
 * Mirrors `POST /api/auditor/queue/bulk-approve`.
 * @param {string[]} claimIds
 * @returns {Promise<{results: {claimId, claimNumber, ok, error}[], succeeded: number, failed: number}>}
 */
export async function bulkApprove(claimIds) {
  return bulk(textArg(claimIds, 'claimIds'), 'APPROVE', null);
}

/**
 * Sends several queue claims back with one comment (required). Per-row results.
 * Mirrors `POST /api/auditor/queue/bulk-send-back`.
 * @param {string[]} claimIds
 * @param {string} comment
 */
export async function bulkSendBack(claimIds, comment) {
  const ids = textArg(claimIds, 'claimIds');
  const text = cleanText(comment ?? (claimIds && typeof claimIds === 'object' && !Array.isArray(claimIds) ? claimIds.comment : ''));
  if (!text) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Add a comment telling the employees what to fix.', { fields: { comment: 'Add a comment telling the employees what to fix.' } });
  }
  return bulk(ids, 'SEND_BACK', text);
}

/**
 * Sampled auto-approved claims: PENDING (oldest first) or DONE (latest first).
 * Mirrors `GET /api/auditor/sample-audits?status=PENDING|DONE`.
 * @returns {Promise<{items: object[], counts: {PENDING: number, DONE: number}}>}
 */
export async function listSampleAudits({ status = 'PENDING' } = {}) {
  return query(({ db, user, now }) => {
    requireRole(user, ['AUDITOR']);
    const pending = [];
    const done = [];
    for (const claim of db.claims) {
      if (!claim.sampleAudit || claim.employeeId === user.id) continue;
      if (claim.sampleAuditStatus === 'PENDING') pending.push(claim);
      else if (claim.sampleAuditStatus) done.push(claim);
    }
    const project = (claim) => {
      const step = pendingSampleStep(claim);
      return {
        ...toClaimSummary(db, claim, now),
        sampleAuditStatus: claim.sampleAuditStatus,
        sampledAt: claim.sampledAt,
        auditedByName: userById(db, claim.sampleAuditedBy)?.fullName ?? null,
        auditedAt: claim.sampleAuditedAt,
        canAct: Boolean(step && resolveActing(db, user, claim, step, now).ok),
      };
    };
    const items =
      status === 'DONE'
        ? done.sort((a, b) => (b.sampleAuditedAt ?? '').localeCompare(a.sampleAuditedAt ?? '')).map(project)
        : pending.sort((a, b) => a.sampledAt.localeCompare(b.sampledAt)).map(project);
    return { items, counts: { PENDING: pending.length, DONE: done.length } };
  });
}

function sampleAction(claimId, decision, text) {
  return mutate(({ db, user, now }) => {
    requireRole(user, ['AUDITOR']);
    const claim = db.claims.find((c) => c.id === claimId);
    if (!claim || !canViewClaim(db, user, claim, now) || !claim.sampleAudit) throw notFound('Claim not found.');
    sampleDecisionCore(db, claim, user, { decision, text, now });
    return toClaim(db, claim, user, now);
  });
}

/**
 * Clears a sample audit; the claim stays AUTO_APPROVED and becomes payable.
 * Mirrors `POST /api/auditor/sample-audits/{id}/clear`.
 * @param {string} claimId
 * @param {{comment?: string}} [body]
 */
export async function clearSample(claimId, body) {
  return sampleAction(claimId, 'CLEAR', textArg(body, 'comment'));
}

/**
 * Rejects a sampled claim (reason required) → REJECTED.
 * Mirrors `POST /api/auditor/sample-audits/{id}/reject`.
 */
export async function rejectSample(claimId, reason) {
  return sampleAction(claimId, 'REJECT', textArg(reason, 'reason'));
}

/**
 * Sends a sampled claim back (comment required) → SENT_BACK.
 * Mirrors `POST /api/auditor/sample-audits/{id}/send-back`.
 */
export async function sendBackSample(claimId, comment) {
  return sampleAction(claimId, 'SEND_BACK', textArg(comment, 'comment'));
}
