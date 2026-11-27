/**
 * Payout batches: eligibility, one batch per claim, mock bank CSV
 * (H/D/T rows with a control total), idempotent export and mark-paid.
 */
import { fromPaise, toPaise } from '../../utils/money.js';
import { ApiError } from '../errors.js';
import { userById } from './access.js';
import { STATUS } from './constants.js';
import { appendAudit, notify } from './events.js';
import { sha256HexSync } from './sha256.js';
import { inr, isoDateIST, newId, toIso } from './util.js';
import { transition } from './workflow.js';

export const CSV_HEADER = 'RECORD_TYPE,BATCH_NO,CLAIM_NO,EMPLOYEE_CODE,EMPLOYEE_NAME,ACCOUNT_NO,IFSC,AMOUNT,NARRATION';

/**
 * APPROVED, or AUTO_APPROVED with no pending (uncleared) sample audit,
 * and not already reserved by a batch.
 */
export function isPayoutEligible(claim) {
  if (claim.payoutBatchId) return false;
  if (claim.status === STATUS.APPROVED) return true;
  if (claim.status === STATUS.AUTO_APPROVED) return !claim.sampleAudit || claim.sampleAuditStatus === 'CLEARED';
  return false;
}

export function maskAccount(account) {
  const value = String(account ?? '');
  if (value.length <= 4) return value;
  return `${'X'.repeat(value.length - 4)}${value.slice(-4)}`;
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

/** Builds the mock bank file for a batch. Amounts have 2 decimals and no grouping. */
export function buildBatchCsv(db, batch) {
  const rows = [CSV_HEADER];
  rows.push(csvRow(['H', batch.batchNumber, '', '', '', '', '', '', `ExpenseFlow reimbursements ${isoDateIST(Date.parse(batch.createdAt))}`]));
  let total = 0;
  for (const item of batch.items) {
    const claim = db.claims.find((c) => c.id === item.claimId);
    const employee = userById(db, item.employeeId);
    total += toPaise(item.amount);
    rows.push(
      csvRow([
        'D',
        batch.batchNumber,
        claim?.claimNumber ?? '',
        employee?.employeeCode ?? '',
        employee?.fullName ?? '',
        item.bankAccountNumber,
        item.ifscCode,
        fromPaise(toPaise(item.amount)),
        `Expense reimbursement ${claim?.claimNumber ?? ''}`.trim(),
      ]),
    );
  }
  rows.push(csvRow(['T', batch.batchNumber, '', '', '', '', '', fromPaise(total), `COUNT=${batch.items.length}`]));
  return `${rows.join('\r\n')}\r\n`;
}

export function createBatchCore(db, user, claimIds, now) {
  const ids = Array.isArray(claimIds) ? [...new Set(claimIds.map(String))] : [];
  if (!ids.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Select at least one approved claim.', { fields: { claimIds: 'Select at least one approved claim.' } });
  }
  const claims = [];
  const notEligible = [];
  for (const id of ids) {
    const claim = db.claims.find((c) => c.id === id);
    if (!claim || !isPayoutEligible(claim)) notEligible.push(claim ? claim.claimNumber : id);
    else claims.push(claim);
  }
  if (notEligible.length) {
    throw new ApiError(409, 'NOT_ELIGIBLE', `These claims can't be paid now: ${notEligible.join(', ')}. Reload the list and try again.`, {
      claimNumbers: notEligible,
    });
  }
  const missingBank = claims.filter((c) => {
    const owner = userById(db, c.employeeId);
    return !owner?.bankAccountNumber || !owner?.ifscCode;
  });
  if (missingBank.length) {
    throw new ApiError(422, 'MISSING_BANK_DETAILS', `Bank details are missing for ${missingBank.map((c) => c.claimNumber).join(', ')}.`, {
      claimNumbers: missingBank.map((c) => c.claimNumber),
    });
  }
  db.seq.batch += 1;
  const year = new Date(now).getUTCFullYear();
  const total = claims.reduce((sum, c) => sum + toPaise(c.totalAmount), 0);
  const batch = {
    id: newId(),
    batchNumber: `PAY-${year}-${String(db.seq.batch).padStart(4, '0')}`,
    status: 'CREATED',
    claimCount: claims.length,
    totalAmount: fromPaise(total),
    createdBy: user.id,
    createdAt: toIso(now),
    exportedAt: null,
    fileName: null,
    fileSha256: null,
    csv: null,
    paidAt: null,
    paidBy: null,
    bankReference: null,
    version: 0,
    items: claims.map((c) => {
      const owner = userById(db, c.employeeId);
      return {
        claimId: c.id,
        employeeId: c.employeeId,
        amount: c.totalAmount,
        bankAccountNumber: owner.bankAccountNumber,
        ifscCode: owner.ifscCode,
      };
    }),
  };
  for (const claim of claims) {
    claim.payoutBatchId = batch.id;
    claim.version += 1;
    claim.updatedAt = toIso(now);
  }
  db.payoutBatches.push(batch);
  appendAudit(db, {
    now,
    actorId: user.id,
    action: 'PAYOUT_BATCH_CREATED',
    entityType: 'PAYOUT_BATCH',
    entityId: batch.id,
    details: { batchNumber: batch.batchNumber, claimCount: batch.claimCount, totalAmount: batch.totalAmount, claimNumbers: claims.map((c) => c.claimNumber) },
  });
  return batch;
}

/** First export: CREATED → EXPORTED and claims → IN_BATCH. A re-export returns the same file. */
export function exportBatchCore(db, user, batch, now) {
  if (batch.status === 'CREATED') {
    const csv = buildBatchCsv(db, batch);
    batch.csv = csv;
    batch.fileName = `${batch.batchNumber}.csv`;
    batch.fileSha256 = sha256HexSync(csv);
    batch.status = 'EXPORTED';
    batch.exportedAt = toIso(now);
    batch.version += 1;
    for (const item of batch.items) {
      const claim = db.claims.find((c) => c.id === item.claimId);
      if (claim && (claim.status === STATUS.APPROVED || claim.status === STATUS.AUTO_APPROVED)) {
        transition(db, claim, STATUS.IN_BATCH, {
          now,
          actorId: user.id,
          action: 'CLAIM_IN_BATCH',
          details: { batchNumber: batch.batchNumber },
        });
      }
    }
    appendAudit(db, {
      now,
      actorId: user.id,
      action: 'PAYOUT_BATCH_EXPORTED',
      entityType: 'PAYOUT_BATCH',
      entityId: batch.id,
      fromStatus: 'CREATED',
      toStatus: 'EXPORTED',
      details: { batchNumber: batch.batchNumber, fileSha256: batch.fileSha256, claimCount: batch.claimCount, totalAmount: batch.totalAmount },
    });
  }
  return { fileName: batch.fileName, csv: batch.csv, sha256: batch.fileSha256 };
}

export function markPaidCore(db, user, batch, { confirm, bankReference, version } = {}, now) {
  if (confirm !== true) {
    throw new ApiError(400, 'CONFIRMATION_REQUIRED', 'Confirm that the bank has paid this batch.', { fields: { confirm: 'Tick the confirmation box.' } });
  }
  if (batch.status === 'PAID') throw new ApiError(409, 'ALREADY_PAID', `${batch.batchNumber} is already marked as paid.`);
  if (batch.status !== 'EXPORTED') throw new ApiError(409, 'NOT_EXPORTED', 'Export the bank file before marking the batch as paid.');
  if (version !== undefined && version !== null && Number(version) !== batch.version) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'This batch was changed by someone else. Reload to see the latest version.');
  }
  const reference = String(bankReference ?? '').trim();
  if (reference.length > 64) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Keep the bank reference under 64 characters.', { fields: { bankReference: 'Keep the bank reference under 64 characters.' } });
  }
  batch.status = 'PAID';
  batch.paidAt = toIso(now);
  batch.paidBy = user.id;
  batch.bankReference = reference || `UTR${String(now).slice(-10)}${batch.batchNumber.slice(-4)}`;
  batch.version += 1;
  for (const item of batch.items) {
    const claim = db.claims.find((c) => c.id === item.claimId);
    if (!claim || claim.status !== STATUS.IN_BATCH) continue;
    claim.paidAt = toIso(now);
    transition(db, claim, STATUS.PAID, { now, actorId: user.id, action: 'CLAIM_PAID', details: { batchNumber: batch.batchNumber, bankReference: batch.bankReference } });
    notify(db, {
      now,
      recipientId: claim.employeeId,
      type: 'PAYOUT_DONE',
      title: `${claim.claimNumber} has been paid`,
      message: `${inr(item.amount)} was sent to your account ending ${String(item.bankAccountNumber).slice(-4)} (${batch.batchNumber}).`,
      claimId: claim.id,
      payoutBatchId: batch.id,
    });
  }
  appendAudit(db, {
    now,
    actorId: user.id,
    action: 'PAYOUT_BATCH_PAID',
    entityType: 'PAYOUT_BATCH',
    entityId: batch.id,
    fromStatus: 'EXPORTED',
    toStatus: 'PAID',
    details: { batchNumber: batch.batchNumber, bankReference: batch.bankReference, totalAmount: batch.totalAmount },
  });
  return batch;
}
