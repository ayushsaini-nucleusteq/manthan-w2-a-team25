/**
 * Auditor work (A1–A4) against the Spring backend: review queue, bulk actions with per-row
 * results, sample audits. Same function names, arguments and return shapes as ../mock/auditor.js.
 */
import { ApiError } from '../errors.js';
import { getSession } from '../session.js';
import { get, post } from './client.js';
import { itemsOf, nameOf } from './common.js';
import { countOf, fetchAllPages, fetchClaimRaw, mapClaim, mapClaimSummary, mapInboxItem, resolveVersion } from './approvals.js';

const QUEUE = '/api/auditor/queue';
const SAMPLES = '/api/auditor/sample-audits';

function textArg(value, key) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value[key];
  return value;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Frontend band → backend AmountBand plus the exact paise range to keep client-side. */
const BANDS = {
  '25K_50K': { backend: 'FROM_25K_TO_100K', min: 2500000, max: 5000000 },
  '50K_1L': { backend: 'FROM_25K_TO_100K', min: 5000000, max: 10000000 },
  '1L_PLUS': { backend: 'ABOVE_100K', min: 10000000, max: Infinity },
};

/** Frontend flag → backend ReasonCode list (server-side filter); OVERDUE/DELEGATED filter client-side. */
const FLAG_TO_REASONS = {
  WEEKEND: ['WEEKEND_EXPENSE'],
  DUPLICATE: ['DUPLICATE', 'DUPLICATE_RECEIPT'],
  SOFT_LIMIT: ['SOFT_LIMIT_EXCEEDED'],
};

function paise(amount) {
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function inBand(amount, band) {
  const b = BANDS[band];
  if (!b) return true;
  const p = paise(amount);
  return p > b.min && p <= b.max;
}

const STATUS_CODE = { 400: 'VALIDATION_ERROR', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'BUSINESS_RULE' };

/**
 * Claims waiting for an auditor, oldest first. amountBand: ALL | 25K_50K | 50K_1L | 1L_PLUS
 * (sent as FROM_25K_TO_100K / ABOVE_100K, narrowed client-side). flag: WEEKEND | DUPLICATE | SOFT_LIMIT
 * (sent as reason codes) | OVERDUE | DELEGATED (client-side). `total` = unfiltered queue size.
 * Endpoint: `GET /api/auditor/queue?amountBand=&departmentId=&flag=&minAgeHours=&q=`.
 * @returns {Promise<{items: object[], total: number}>}
 */
export async function getAuditorQueue({ amountBand = 'ALL', departmentId, flag, minAgeHours, q } = {}) {
  const query = {};
  if (BANDS[amountBand]) query.amountBand = BANDS[amountBand].backend;
  if (departmentId) query.departmentId = departmentId;
  if (flag && FLAG_TO_REASONS[flag]) query.flag = FLAG_TO_REASONS[flag];
  const minAge = Number(minAgeHours) || 0;
  if (minAge > 0) query.minAgeHours = Math.floor(minAge);
  const needle = typeof q === 'string' ? q.trim() : '';
  if (needle) query.q = needle;
  const filtered = Object.keys(query).length > 0 || flag === 'OVERDUE' || flag === 'DELEGATED';

  const [list, total] = await Promise.all([
    fetchAllPages(QUEUE, query),
    filtered ? countOf(QUEUE) : Promise.resolve(null),
  ]);
  let items = list.items.map(mapInboxItem);
  if (BANDS[amountBand]) items = items.filter((it) => inBand(it.totalAmount, amountBand));
  if (flag === 'OVERDUE' || flag === 'DELEGATED') items = items.filter((it) => it.flags.includes(flag));
  if (minAge) items = items.filter((it) => (it.ageHours ?? 0) >= minAge);
  items.sort((a, b) => String(a.pendingSince ?? '').localeCompare(String(b.pendingSince ?? '')));
  return { items, total: total ?? (Number(list.total) || items.length) };
}

/** claimId → claimNumber/status, from the queue (one request) and then GET /api/claims/{id} for the rest. */
async function lookupClaims(ids) {
  const known = new Map();
  try {
    const body = await get(QUEUE, { query: { page: 0, size: 100 } });
    for (const it of itemsOf(body)) {
      if (it?.claim?.id) known.set(it.claim.id, { claimNumber: it.claim.claimNumber ?? null, status: it.claim.status ?? null });
    }
  } catch {
    // Fall back to per-claim reads.
  }
  await Promise.all(
    ids
      .filter((id) => !known.has(id))
      .map((id) =>
        fetchClaimRaw(id)
          .then((c) => known.set(id, { claimNumber: c?.claimNumber ?? null, status: c?.status ?? null }))
          .catch(() => known.set(id, { claimNumber: null, status: null })),
      ),
  );
  return known;
}

function validIds(claimIds) {
  const ids = Array.isArray(claimIds) ? [...new Set(claimIds.filter(Boolean))] : [];
  if (!ids.length) throw new ApiError(400, 'VALIDATION_ERROR', 'Select at least one claim.', { fields: { claimIds: 'Select at least one claim.' } });
  return ids;
}

async function bulk(path, ids, comment) {
  const known = await lookupClaims(ids);
  const body = await post(path, comment ? { claimIds: ids, comment } : { claimIds: ids });
  const rows = Array.isArray(body?.results) ? body.results : [];
  const results = rows.map((r) => {
    const info = known.get(r?.claimId) ?? { claimNumber: null, status: null };
    const ok = r?.outcome ? r.outcome === 'SUCCEEDED' : Boolean(r?.ok);
    if (ok) return { claimId: r.claimId, claimNumber: info.claimNumber, ok: true, error: null, status: r.newStatus ?? null };
    const err = r?.error;
    const message = typeof err === 'string' ? err : err?.message ?? 'This claim could not be processed.';
    return {
      claimId: r?.claimId ?? null,
      claimNumber: info.claimNumber,
      ok: false,
      error: message,
      code: (typeof err === 'object' && err ? STATUS_CODE[err.status] ?? err.code : null) ?? 'HTTP_ERROR',
      status: r?.newStatus ?? info.status ?? null,
    };
  });
  return {
    results,
    succeeded: Number.isFinite(body?.succeeded) ? body.succeeded : results.filter((r) => r.ok).length,
    failed: Number.isFinite(body?.failed) ? body.failed : results.filter((r) => !r.ok).length,
  };
}

/**
 * Approves several queue claims; per-row results.
 * Endpoint: `POST /api/auditor/queue/bulk-approve` {claimIds}.
 * @param {string[]} claimIds
 * @returns {Promise<{results: {claimId, claimNumber, ok, error}[], succeeded: number, failed: number}>}
 */
export async function bulkApprove(claimIds) {
  return bulk(`${QUEUE}/bulk-approve`, validIds(textArg(claimIds, 'claimIds')), null);
}

/**
 * Sends several queue claims back with one comment (required). Per-row results.
 * Endpoint: `POST /api/auditor/queue/bulk-send-back` {claimIds, comment}.
 * @param {string[]} claimIds
 * @param {string} comment
 */
export async function bulkSendBack(claimIds, comment) {
  const ids = textArg(claimIds, 'claimIds');
  const text = cleanText(comment ?? (claimIds && typeof claimIds === 'object' && !Array.isArray(claimIds) ? claimIds.comment : ''));
  if (!text) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Add a comment telling the employees what to fix.', { fields: { comment: 'Add a comment telling the employees what to fix.' } });
  }
  return bulk(`${QUEUE}/bulk-send-back`, validIds(ids), text);
}

const DONE_STATUSES = ['CLEARED', 'REJECTED', 'SENT_BACK'];

function mapSampleRow(c) {
  const viewerId = getSession()?.user?.id ?? null;
  const summary = mapClaimSummary(c);
  return {
    ...summary,
    sampleAuditStatus: c?.sampleAuditStatus ?? null,
    sampledAt: c?.sampledAt ?? c?.decidedAt ?? c?.submittedAt ?? null,
    auditedByName: nameOf(c?.sampleAuditedBy),
    auditedAt: c?.sampleAuditedAt ?? null,
    canAct: c?.sampleAuditStatus === 'PENDING' && summary.employeeId !== viewerId,
  };
}

/**
 * Sampled auto-approved claims: PENDING (oldest first) or DONE = CLEARED + REJECTED + SENT_BACK (latest first).
 * Endpoint: `GET /api/auditor/sample-audits?status=PENDING|CLEARED|REJECTED|SENT_BACK`.
 * @returns {Promise<{items: object[], counts: {PENDING: number, DONE: number}}>}
 */
export async function listSampleAudits({ status = 'PENDING' } = {}) {
  if (status === 'DONE') {
    const [pending, ...lists] = await Promise.all([
      countOf(SAMPLES, { status: 'PENDING' }),
      ...DONE_STATUSES.map((s) => fetchAllPages(SAMPLES, { status: s })),
    ]);
    const items = lists
      .flatMap((l) => l.items)
      .map(mapSampleRow)
      .sort((a, b) => String(b.auditedAt ?? '').localeCompare(String(a.auditedAt ?? '')));
    const done = lists.reduce((n, l) => n + (Number(l.total) || l.items.length), 0);
    return { items, counts: { PENDING: pending, DONE: done } };
  }
  const [list, ...doneCounts] = await Promise.all([
    fetchAllPages(SAMPLES, { status: 'PENDING' }),
    ...DONE_STATUSES.map((s) => countOf(SAMPLES, { status: s })),
  ]);
  const items = list.items.map(mapSampleRow).sort((a, b) => String(a.sampledAt ?? '').localeCompare(String(b.sampledAt ?? '')));
  return { items, counts: { PENDING: Number(list.total) || items.length, DONE: doneCounts.reduce((a, b) => a + b, 0) } };
}

async function sampleAction(claimId, action, payload) {
  // The mock API has no version argument; read the current one (GET /api/claims/{id}).
  const version = await resolveVersion(claimId, payload?.version);
  const body = { version };
  if (payload?.comment !== undefined) body.comment = payload.comment;
  if (payload?.reason !== undefined) body.reason = payload.reason;
  return mapClaim(await post(`${SAMPLES}/${encodeURIComponent(claimId)}/${action}`, body));
}

/**
 * Clears a sample audit; the claim stays AUTO_APPROVED and becomes payable.
 * Endpoint: `POST /api/auditor/sample-audits/{id}/clear` {version, comment}.
 * @param {string} claimId
 * @param {{comment?: string, version?: number}|string} [body]
 */
export async function clearSample(claimId, body) {
  const text = cleanText(textArg(body, 'comment')) || null;
  return sampleAction(claimId, 'clear', { comment: text, version: body?.version });
}

/**
 * Rejects a sampled claim (reason required) → REJECTED.
 * Endpoint: `POST /api/auditor/sample-audits/{id}/reject` {version, reason}.
 */
export async function rejectSample(claimId, reason) {
  return sampleAction(claimId, 'reject', { reason: cleanText(textArg(reason, 'reason')), version: reason?.version });
}

/**
 * Sends a sampled claim back (comment required) → SENT_BACK.
 * Endpoint: `POST /api/auditor/sample-audits/{id}/send-back` {version, comment}.
 */
export async function sendBackSample(claimId, comment) {
  return sampleAction(claimId, 'send-back', { comment: cleanText(textArg(comment, 'comment')), version: comment?.version });
}
