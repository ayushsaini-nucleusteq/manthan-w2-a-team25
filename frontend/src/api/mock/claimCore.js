/**
 * Claim and line editing (drafts and sent-back claims), with the same
 * validation the server applies on save.
 */
import { fromPaise, parseMoneyInput, toPaise } from '../../utils/money.js';
import { ApiError } from '../errors.js';
import { CATEGORY_CODES, STATUS } from './constants.js';
import { appendAudit } from './events.js';
import { cleanText, isoDateIST, isValidIsoDate, newId, toIso } from './util.js';

const EDITABLE = new Set([STATUS.DRAFT, STATUS.SENT_BACK]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validationError(fields, message = 'Please correct the highlighted fields.') {
  return new ApiError(400, 'VALIDATION_ERROR', message, { fields });
}

function changesBetween(before, after, keys) {
  const changes = {};
  for (const key of keys) {
    if ((before[key] ?? null) !== (after[key] ?? null)) changes[key] = { from: before[key] ?? null, to: after[key] ?? null };
  }
  return changes;
}

export function isEditableStatus(status) {
  return EDITABLE.has(status);
}

export function assertEditable(claim) {
  if (!EDITABLE.has(claim.status)) {
    throw new ApiError(409, 'NOT_EDITABLE', 'Only draft or sent-back claims can be changed.');
  }
}

export function assertVersion(claim, version) {
  if (version !== undefined && version !== null && Number(version) !== claim.version) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'This claim was changed by someone else. Reload to see the latest version.', {
      currentVersion: claim.version,
    });
  }
}

function touch(claim, now) {
  claim.version += 1;
  claim.updatedAt = toIso(now);
}

export function recomputeTotal(claim) {
  claim.totalAmount = fromPaise(claim.lines.reduce((sum, l) => sum + toPaise(l.amount), 0));
}

/* ------------------------------------------------------------ claim header */

function normalizeHeader(input, base = {}) {
  const merged = { ...base, ...input };
  const values = {
    title: cleanText(merged.title),
    purpose: cleanText(merged.purpose) || null,
    tripStartDate: merged.tripStartDate || null,
    tripEndDate: merged.tripEndDate || null,
  };
  const fields = {};
  if (!values.title) fields.title = 'Enter a title for the claim.';
  else if (values.title.length > 150) fields.title = 'Keep the title under 150 characters.';
  if (values.purpose && values.purpose.length > 1000) fields.purpose = 'Keep the purpose under 1000 characters.';
  if (values.tripStartDate && !isValidIsoDate(values.tripStartDate)) fields.tripStartDate = 'Enter a valid start date.';
  if (values.tripEndDate && !isValidIsoDate(values.tripEndDate)) fields.tripEndDate = 'Enter a valid end date.';
  if (
    !fields.tripStartDate &&
    !fields.tripEndDate &&
    values.tripStartDate &&
    values.tripEndDate &&
    values.tripEndDate < values.tripStartDate
  ) {
    fields.tripEndDate = 'The trip end date must be on or after the start date.';
  }
  return { values, fields };
}

/** Creates a DRAFT claim. A client-generated id makes the call idempotent. */
export function createClaimCore(db, owner, input, now) {
  const { values, fields } = normalizeHeader(input ?? {});
  if (Object.keys(fields).length) throw validationError(fields);
  const clientId = input?.id ? String(input.id) : null;
  if (clientId) {
    if (!UUID_RE.test(clientId)) throw validationError({ id: 'The claim id must be a UUID.' });
    const existing = db.claims.find((c) => c.id === clientId);
    if (existing) {
      const same =
        existing.employeeId === owner.id &&
        existing.title === values.title &&
        existing.purpose === values.purpose &&
        existing.tripStartDate === values.tripStartDate &&
        existing.tripEndDate === values.tripEndDate;
      if (same) return existing;
      throw new ApiError(409, 'ID_CONFLICT', 'A different claim already uses this id.');
    }
  }
  db.seq.claim += 1;
  const year = new Date(now).getUTCFullYear();
  const claim = {
    id: clientId ?? newId(),
    claimNumber: `EXP-${year}-${String(db.seq.claim).padStart(6, '0')}`,
    employeeId: owner.id,
    departmentId: owner.departmentId,
    ...values,
    currency: 'INR',
    status: STATUS.DRAFT,
    totalAmount: '0.00',
    submissionNo: 0,
    policyVersionNo: null,
    policyOutcome: null,
    decisionReason: null,
    sampleAudit: false,
    sampleAuditStatus: null,
    sampledAt: null,
    sampleAuditedBy: null,
    sampleAuditedAt: null,
    payoutBatchId: null,
    submittedAt: null,
    decidedAt: null,
    paidAt: null,
    lastLinesHash: null,
    createdAt: toIso(now),
    updatedAt: toIso(now),
    version: 0,
    lines: [],
    steps: [],
    comments: [],
  };
  db.claims.push(claim);
  appendAudit(db, {
    now,
    actorId: owner.id,
    action: 'CLAIM_CREATED',
    entityType: 'CLAIM',
    entityId: claim.id,
    claimId: claim.id,
    toStatus: STATUS.DRAFT,
    details: { claimNumber: claim.claimNumber, title: claim.title },
  });
  return claim;
}

export function updateClaimCore(db, claim, user, patch, now) {
  assertEditable(claim);
  assertVersion(claim, patch?.version);
  const allowed = {};
  for (const key of ['title', 'purpose', 'tripStartDate', 'tripEndDate']) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = patch[key];
  }
  const { values, fields } = normalizeHeader(allowed, claim);
  if (Object.keys(fields).length) throw validationError(fields);
  const changes = changesBetween(claim, values, Object.keys(values));
  if (!Object.keys(changes).length) return claim;
  Object.assign(claim, values);
  touch(claim, now);
  appendAudit(db, {
    now,
    actorId: user.id,
    action: 'CLAIM_UPDATED',
    entityType: 'CLAIM',
    entityId: claim.id,
    claimId: claim.id,
    details: { changes },
  });
  return claim;
}

export function deleteClaimCore(db, claim, user, now) {
  if (claim.status !== STATUS.DRAFT || claim.submissionNo > 0) {
    throw new ApiError(409, 'NOT_DELETABLE', 'Only drafts that were never submitted can be deleted.');
  }
  db.claims = db.claims.filter((c) => c.id !== claim.id);
  appendAudit(db, {
    now,
    actorId: user.id,
    action: 'CLAIM_DELETED',
    entityType: 'CLAIM',
    entityId: claim.id,
    claimId: claim.id,
    fromStatus: STATUS.DRAFT,
    details: { claimNumber: claim.claimNumber },
  });
}

/* ------------------------------------------------------------------- lines */

const LINE_KEYS = ['category', 'amount', 'expenseDate', 'vendor', 'notes', 'city', 'nights'];
const EVAL_KEYS = ['category', 'amount', 'expenseDate', 'vendor', 'city', 'nights'];

/**
 * Validates and normalises line input (merged over an existing line for a patch).
 * @returns {{values: object, fields: object}}
 */
export function normalizeLineInput(input, base = {}, now = Date.now()) {
  const merged = { ...base, ...input };
  const fields = {};
  const category = cleanText(merged.category).toUpperCase();
  if (!CATEGORY_CODES.includes(category)) fields.category = 'Choose a category.';

  const amount = parseMoneyInput(typeof merged.amount === 'number' ? String(merged.amount) : merged.amount);
  if (amount === null) fields.amount = 'Enter the amount, for example 1500 or 1500.50.';
  else if (toPaise(amount) <= 0) fields.amount = 'The amount must be more than ₹0.';

  const expenseDate = cleanText(merged.expenseDate);
  if (!isValidIsoDate(expenseDate)) fields.expenseDate = 'Enter the date of the expense.';
  else if (expenseDate > isoDateIST(now)) fields.expenseDate = "The expense date can't be in the future.";

  const vendor = cleanText(merged.vendor);
  if (!vendor) fields.vendor = 'Enter the vendor or merchant name.';
  else if (vendor.length > 150) fields.vendor = 'Keep the vendor under 150 characters.';

  const notes = cleanText(merged.notes) || null;
  if (notes && notes.length > 500) fields.notes = 'Keep notes under 500 characters.';

  let city = null;
  let nights = null;
  if (category === 'HOTEL') {
    city = cleanText(merged.city) || null;
    if (!city) fields.city = 'Enter the city of the hotel.';
    else if (city.length > 80) fields.city = 'Keep the city under 80 characters.';
    const n = Number(merged.nights);
    if (!Number.isInteger(n) || n < 1 || n > 60) fields.nights = 'Enter the number of nights (1 to 60).';
    else nights = n;
  }
  return {
    values: { category, amount: amount ?? merged.amount, expenseDate, vendor, notes, city, nights },
    fields,
  };
}

function findLine(claim, lineId) {
  const line = claim.lines.find((l) => l.id === lineId);
  if (!line) throw new ApiError(404, 'NOT_FOUND', 'Expense line not found.');
  return line;
}

function sameLineContent(line, values) {
  return LINE_KEYS.every((k) => (line[k] ?? null) === (values[k] ?? null));
}

export function addLineCore(db, claim, user, input, now) {
  assertEditable(claim);
  const { values, fields } = normalizeLineInput(input ?? {}, {}, now);
  if (Object.keys(fields).length) throw validationError(fields);
  const clientId = input?.id ? String(input.id) : null;
  if (clientId) {
    if (!UUID_RE.test(clientId)) throw validationError({ id: 'The line id must be a UUID.' });
    const existing = claim.lines.find((l) => l.id === clientId);
    if (existing) {
      if (sameLineContent(existing, values)) return existing;
      throw new ApiError(409, 'ID_CONFLICT', 'A different line already uses this id.');
    }
    if (db.claims.some((c) => c.id !== claim.id && c.lines.some((l) => l.id === clientId))) {
      throw new ApiError(409, 'ID_CONFLICT', 'A line on another claim already uses this id.');
    }
  }
  if (claim.lines.length >= 50) throw new ApiError(422, 'TOO_MANY_LINES', 'A claim can have at most 50 lines.');
  const lineNo = claim.lines.reduce((max, l) => Math.max(max, l.lineNo), 0) + 1;
  const line = {
    id: clientId ?? newId(),
    lineNo,
    ...values,
    receipt: null,
    policyOutcome: null,
    findings: [],
    flags: [],
    evaluatedPolicyVersionNo: null,
    evaluatedAt: null,
    needsEvaluation: true,
    createdAt: toIso(now),
    updatedAt: toIso(now),
  };
  claim.lines.push(line);
  recomputeTotal(claim);
  touch(claim, now);
  appendAudit(db, {
    now,
    actorId: user.id,
    action: 'LINE_ADDED',
    entityType: 'LINE',
    entityId: line.id,
    claimId: claim.id,
    details: { lineNo, category: values.category, amount: values.amount, expenseDate: values.expenseDate, vendor: values.vendor },
  });
  return line;
}

export function updateLineCore(db, claim, user, lineId, patch, now) {
  assertEditable(claim);
  assertVersion(claim, patch?.version);
  const line = findLine(claim, lineId);
  const input = {};
  for (const key of LINE_KEYS) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, key)) input[key] = patch[key];
  }
  const { values, fields } = normalizeLineInput(input, line, now);
  if (Object.keys(fields).length) throw validationError(fields);
  const changes = changesBetween(line, values, LINE_KEYS);
  if (!Object.keys(changes).length) return line;
  Object.assign(line, values, { updatedAt: toIso(now) });
  if (EVAL_KEYS.some((k) => k in changes)) {
    line.needsEvaluation = true;
    line.policyOutcome = null;
    line.findings = [];
    line.flags = [];
  }
  recomputeTotal(claim);
  touch(claim, now);
  appendAudit(db, {
    now,
    actorId: user.id,
    action: 'LINE_UPDATED',
    entityType: 'LINE',
    entityId: line.id,
    claimId: claim.id,
    details: { lineNo: line.lineNo, changes },
  });
  return line;
}

export function deleteLineCore(db, claim, user, lineId, now) {
  assertEditable(claim);
  const line = findLine(claim, lineId);
  claim.lines = claim.lines.filter((l) => l.id !== lineId);
  recomputeTotal(claim);
  touch(claim, now);
  appendAudit(db, {
    now,
    actorId: user.id,
    action: 'LINE_DELETED',
    entityType: 'LINE',
    entityId: line.id,
    claimId: claim.id,
    details: { lineNo: line.lineNo, category: line.category, amount: line.amount, vendor: line.vendor },
  });
}

/** Stores receipt metadata on a line (a retry with the same file is a no-op). */
export function attachReceiptCore(db, claim, user, lineId, receipt, now) {
  assertEditable(claim);
  const line = findLine(claim, lineId);
  if (line.receipt && line.receipt.sha256 === receipt.sha256 && line.receipt.fileName === receipt.fileName) {
    return { receipt: line.receipt, replaced: null };
  }
  const replaced = line.receipt;
  line.receipt = receipt;
  line.needsEvaluation = true;
  line.updatedAt = toIso(now);
  touch(claim, now);
  appendAudit(db, {
    now,
    actorId: user.id,
    action: 'RECEIPT_UPLOADED',
    entityType: 'RECEIPT',
    entityId: receipt.id,
    claimId: claim.id,
    details: { lineNo: line.lineNo, fileName: receipt.fileName, sizeBytes: receipt.sizeBytes, sha256: receipt.sha256, replacedReceiptId: replaced?.id ?? null },
  });
  return { receipt, replaced };
}

export function removeReceiptCore(db, claim, user, lineId, now) {
  assertEditable(claim);
  const line = findLine(claim, lineId);
  const removed = line.receipt;
  if (!removed) return null;
  line.receipt = null;
  line.needsEvaluation = true;
  line.updatedAt = toIso(now);
  touch(claim, now);
  appendAudit(db, {
    now,
    actorId: user.id,
    action: 'RECEIPT_REMOVED',
    entityType: 'RECEIPT',
    entityId: removed.id,
    claimId: claim.id,
    details: { lineNo: line.lineNo, fileName: removed.fileName },
  });
  return removed;
}
