/** Payout batches (F2, F3). Finance head only. */
import { userById } from './access.js';
import { createBatchCore, exportBatchCore, isPayoutEligible, markPaidCore, maskAccount } from './payoutCore.js';
import { mutate, notFound, query, requireRole } from './runtime.js';
import { toBatch, toClaimSummary } from './views.js';

function findBatch(db, id) {
  const batch = db.payoutBatches.find((b) => b.id === id || b.batchNumber === id);
  if (!batch) throw notFound('Payout batch not found.');
  return batch;
}

/**
 * Claims that can be paid: APPROVED, or AUTO_APPROVED with no pending sample
 * audit, not already in a batch. Oldest decision first.
 * Mirrors `GET /api/payouts/eligible-claims`.
 */
export async function listEligibleClaims() {
  return query(({ db, user, now }) => {
    requireRole(user, ['FINANCE_HEAD']);
    return db.claims
      .filter(isPayoutEligible)
      .sort((a, b) => (a.decidedAt ?? '').localeCompare(b.decidedAt ?? ''))
      .map((c) => {
        const owner = userById(db, c.employeeId);
        return {
          ...toClaimSummary(db, c, now),
          bankAccountMasked: maskAccount(owner?.bankAccountNumber),
          ifscCode: owner?.ifscCode ?? null,
        };
      });
  });
}

/**
 * Creates a batch and reserves its claims (a claim can be in only one
 * batch; 409 NOT_ELIGIBLE otherwise).
 * Mirrors `POST /api/payouts {claimIds}`.
 * @param {string[]} claimIds
 */
export async function createBatch(claimIds) {
  return mutate(({ db, user, now }) => {
    requireRole(user, ['FINANCE_HEAD']);
    const ids = Array.isArray(claimIds) ? claimIds : claimIds?.claimIds;
    return toBatch(db, createBatchCore(db, user, ids, now));
  });
}

/**
 * All batches, newest first.
 * Mirrors `GET /api/payouts`.
 */
export async function listBatches() {
  return query(({ db, user }) => {
    requireRole(user, ['FINANCE_HEAD']);
    return [...db.payoutBatches].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((b) => toBatch(db, b));
  });
}

/**
 * One batch with its items (masked bank accounts).
 * Mirrors `GET /api/payouts/{id}`.
 */
export async function getBatch(id) {
  return query(({ db, user }) => {
    requireRole(user, ['FINANCE_HEAD']);
    return toBatch(db, findBatch(db, id));
  });
}

/**
 * Bank file. The first export moves CREATED → EXPORTED and its claims to
 * IN_BATCH; exporting again returns the same file and hash.
 * Mirrors `GET /api/payouts/{id}/export`.
 * @returns {Promise<{fileName: string, csv: string, sha256: string, batch: object}>}
 */
export async function exportBatch(id) {
  return mutate(({ db, user, now }) => {
    requireRole(user, ['FINANCE_HEAD']);
    const batch = findBatch(db, id);
    const file = exportBatchCore(db, user, batch, now);
    return { ...file, batch: toBatch(db, batch) };
  });
}

/**
 * Marks an exported batch as paid (`confirm: true` required; 409 when
 * already paid). Claims → PAID and employees are notified.
 * Mirrors `POST /api/payouts/{id}/mark-paid {confirm: true}`.
 * @param {string} id
 * @param {{confirm: boolean, bankReference?: string, version?: number}} body
 */
export async function markPaid(id, body = {}) {
  return mutate(({ db, user, now }) => {
    requireRole(user, ['FINANCE_HEAD']);
    const batch = findBatch(db, id);
    return toBatch(db, markPaidCore(db, user, batch, body, now));
  });
}
