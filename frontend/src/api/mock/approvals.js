/**
 * Approver inbox and decisions (M1–M3). Managers and the finance head use
 * the same inbox; auditors use the queue in auditor.js.
 */
import { canViewClaim, hasAnyRole, pendingApprovalStep, resolveActing } from './access.js';
import { APPROVER_ROLES, STATUS } from './constants.js';
import { mutate, notFound, query, requireRole } from './runtime.js';
import { isStepOverdue, toClaim, toInboxItem } from './views.js';
import { decideCore } from './workflow.js';

const INBOX_STEP_TYPES = new Set(['MANAGER', 'FINANCE_HEAD']);
const STATES = ['PENDING', 'OVERDUE', 'SENT_BACK', 'DECIDED'];

function pendingFor(db, user, now) {
  const rows = [];
  for (const claim of db.claims) {
    const step = pendingApprovalStep(claim);
    if (!step || !INBOX_STEP_TYPES.has(step.stepType)) continue;
    const acting = resolveActing(db, user, claim, step, now);
    if (acting.ok) rows.push({ claim, step, onBehalfOfId: acting.onBehalfOfId });
  }
  return rows.sort((a, b) => a.step.pendingSince.localeCompare(b.step.pendingSince));
}

function sentBackBy(db, user) {
  const rows = [];
  for (const claim of db.claims) {
    if (claim.status !== STATUS.SENT_BACK) continue;
    const step = claim.steps.find((s) => s.status === 'SENT_BACK' && s.stepType !== 'SAMPLE_AUDIT');
    if (step && (step.actedBy === user.id || step.sentBackBy === user.id)) rows.push({ claim, step });
  }
  return rows.sort((a, b) => b.step.actedAt.localeCompare(a.step.actedAt));
}

function decidedBy(db, user) {
  const rows = [];
  for (const claim of db.claims) {
    for (const step of claim.steps) {
      if (step.stepType === 'SAMPLE_AUDIT' || step.actedBy !== user.id) continue;
      if (step.status === 'APPROVED' || step.status === 'REJECTED') rows.push({ claim, step });
    }
  }
  return rows.sort((a, b) => b.step.actedAt.localeCompare(a.step.actedAt)).slice(0, 200);
}

/**
 * Approver inbox. PENDING and OVERDUE are oldest first; SENT_BACK and
 * DECIDED newest first. Items carry `overdue`, `delegated` and `onBehalfOfName`.
 * Mirrors `GET /api/approvals/inbox?state=PENDING|OVERDUE|SENT_BACK|DECIDED`.
 * @param {{state?: 'PENDING'|'OVERDUE'|'SENT_BACK'|'DECIDED'}} [params]
 * @returns {Promise<{items: object[], counts: {PENDING: number, OVERDUE: number, SENT_BACK: number, DECIDED: number}}>}
 */
export async function getInbox({ state = 'PENDING' } = {}) {
  return query(({ db, user, now }) => {
    requireRole(user, ['MANAGER', 'FINANCE_HEAD']);
    const wanted = STATES.includes(state) ? state : 'PENDING';
    const pending = pendingFor(db, user, now);
    const overdue = pending.filter((r) => isStepOverdue(db, r.step, now));
    const sent = sentBackBy(db, user);
    const decided = decidedBy(db, user);
    const counts = { PENDING: pending.length, OVERDUE: overdue.length, SENT_BACK: sent.length, DECIDED: decided.length };
    let items;
    if (wanted === 'PENDING' || wanted === 'OVERDUE') {
      items = (wanted === 'PENDING' ? pending : overdue).map((r) => toInboxItem(db, r.claim, r.step, now, { onBehalfOfId: r.onBehalfOfId }));
    } else {
      items = (wanted === 'SENT_BACK' ? sent : decided).map((r) =>
        toInboxItem(db, r.claim, r.step, now, { onBehalfOfId: r.step.actedOnBehalfOf, decision: r.step.status, decidedAt: r.step.actedAt }),
      );
    }
    return { items, counts };
  });
}

/**
 * A claim for review by an approver, auditor or the finance head (not the
 * owner). `canAct` tells whether the caller can decide now.
 * Mirrors `GET /api/claims/{id}` (M2/A2).
 */
export async function getReviewClaim(claimId) {
  return query(({ db, user, now }) => {
    const claim = db.claims.find((c) => c.id === claimId);
    if (!claim || claim.employeeId === user.id || !hasAnyRole(user, APPROVER_ROLES) || !canViewClaim(db, user, claim, now)) {
      throw notFound('Claim not found.');
    }
    return toClaim(db, claim, user, now);
  });
}

function decide(claimId, decision, text, version) {
  return mutate(({ db, user, now }) => {
    const claim = db.claims.find((c) => c.id === claimId);
    if (!claim || !canViewClaim(db, user, claim, now)) throw notFound('Claim not found.');
    decideCore(db, claim, user, { decision, comment: text, version, now });
    return toClaim(db, claim, user, now);
  });
}

/**
 * Approves the current step (moves to the next step or APPROVED).
 * 409 on a stale `version`, when not the approver, or after acting on an earlier step.
 * Mirrors `POST /api/claims/{id}/approve`.
 * @param {string} claimId
 * @param {{comment?: string, version?: number}} [body]
 */
export async function approve(claimId, { comment, version } = {}) {
  return decide(claimId, 'APPROVE', comment, version);
}

/**
 * Sends the claim back to the employee (comment required, else 400).
 * Mirrors `POST /api/claims/{id}/send-back`.
 * @param {string} claimId
 * @param {{comment: string, version?: number}} body
 */
export async function sendBack(claimId, { comment, version } = {}) {
  return decide(claimId, 'SEND_BACK', comment, version);
}

/**
 * Rejects the claim (reason required, else 400). Final.
 * Mirrors `POST /api/claims/{id}/reject`.
 * @param {string} claimId
 * @param {{reason: string, version?: number}} body
 */
export async function reject(claimId, { reason, version } = {}) {
  return decide(claimId, 'REJECT', reason, version);
}
