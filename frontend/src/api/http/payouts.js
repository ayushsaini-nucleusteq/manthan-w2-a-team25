/**
 * Payout batches (F2, F3) against the backend. Finance head only.
 * Backend PayoutBatch/PayoutBatchDetail/ClaimSummary → the shapes of mock/payouts.js (views.toBatch).
 */
import { sha256HexSync } from '../mock/sha256.js';
import { get, post, request } from './client.js';
import { itemsOf, money, nameOf } from './common.js';

const MAX_PAGES = 50;

/** Export results seen in this tab, so getBatch can show the file name and hash the backend does not return. */
const fileCache = new Map();

function maskAccount(account) {
  if (account === null || account === undefined) return null;
  const value = String(account);
  if (value.length <= 4) return value;
  return `${'X'.repeat(value.length - 4)}${value.slice(-4)}`;
}

/** Claim status implied by the batch status (the backend item has no claim status). */
const CLAIM_STATUS_BY_BATCH = { EXPORTED: 'IN_BATCH', PAID: 'PAID' };

function mapItem(item, batchStatus) {
  return {
    claimId: item?.claimId ?? item?.claim?.id ?? null,
    claimNumber: item?.claimNumber ?? item?.claim?.claimNumber ?? null,
    claimTitle: item?.claimTitle ?? item?.claim?.title ?? null,
    claimStatus: item?.claimStatus ?? item?.claim?.status ?? CLAIM_STATUS_BY_BATCH[batchStatus] ?? null,
    employeeName: nameOf(item?.employee) ?? item?.employeeName ?? null,
    employeeCode: item?.employeeCode ?? item?.employee?.employeeCode ?? null,
    departmentName: item?.departmentName ?? item?.department?.name ?? null,
    amount: money(item?.amount),
    bankAccountMasked: item?.bankAccountMasked ?? maskAccount(item?.bankAccountNumber),
    ifscCode: item?.ifscCode ?? null,
  };
}

/** Backend PayoutBatch(Detail) → frontend PayoutBatch. List rows have no items (`items: []`). */
export function mapBatch(b) {
  if (!b) return null;
  const cached = fileCache.get(b.id);
  const exported = Boolean(b.exportedAt) || b.status === 'EXPORTED' || b.status === 'PAID';
  return {
    id: b.id ?? null,
    batchNumber: b.batchNumber ?? null,
    status: b.status ?? null,
    claimCount: Number.isFinite(Number(b.claimCount)) ? Number(b.claimCount) : Array.isArray(b.items) ? b.items.length : 0,
    totalAmount: money(b.totalAmount),
    createdByName: nameOf(b.createdBy) ?? b.createdByName ?? null,
    createdAt: b.createdAt ?? null,
    exportedAt: b.exportedAt ?? null,
    fileName: b.fileName ?? cached?.fileName ?? (exported && b.batchNumber ? `${b.batchNumber}.csv` : null),
    fileSha256: b.fileSha256 ?? cached?.sha256 ?? null,
    paidAt: b.paidAt ?? null,
    paidByName: nameOf(b.paidBy) ?? b.paidByName ?? null,
    bankReference: b.bankReference ?? null,
    version: b.version ?? null,
    items: Array.isArray(b.items) ? b.items.map((item) => mapItem(item, b.status)) : [],
  };
}

function mapEligibleClaim(c) {
  return {
    id: c?.id ?? null,
    claimNumber: c?.claimNumber ?? null,
    title: c?.title ?? null,
    employeeId: c?.employee?.id ?? c?.employeeId ?? null,
    employeeName: nameOf(c?.employee) ?? c?.employeeName ?? null,
    employeeCode: c?.employee?.employeeCode ?? c?.employeeCode ?? null,
    departmentId: c?.department?.id ?? c?.departmentId ?? null,
    departmentName: c?.department?.name ?? c?.departmentName ?? null,
    status: c?.status ?? null,
    totalAmount: money(c?.totalAmount),
    lineCount: Number(c?.lineCount ?? 0),
    policyOutcome: c?.policyOutcome ?? null,
    submittedAt: c?.submittedAt ?? null,
    decidedAt: c?.decidedAt ?? null,
    createdAt: c?.createdAt ?? null,
    updatedAt: c?.updatedAt ?? null,
    flags: Array.isArray(c?.flags) ? [...c.flags] : [],
    sampleAudit: Boolean(c?.sampleAudit),
    sampleAuditStatus: c?.sampleAuditStatus ?? null,
    bankAccountMasked: c?.bankAccountMasked ?? maskAccount(c?.bankAccountNumber),
    ifscCode: c?.ifscCode ?? null,
  };
}

async function fetchAll(path, query) {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await get(path, { query: { ...query, page, size: 100 } });
    const items = itemsOf(body);
    all.push(...items);
    const totalPages = Number(body?.totalPages);
    if (Array.isArray(body) || !items.length || !Number.isFinite(totalPages) || page + 1 >= totalPages) break;
  }
  return all;
}

/** Claims ready for payout, oldest decision first. `GET /api/payouts/eligible-claims` (all pages). */
export async function listEligibleClaims() {
  const rows = await fetchAll('/api/payouts/eligible-claims', { sort: 'decidedAt,asc' });
  return rows.map(mapEligibleClaim);
}

/** Creates a batch from the given claims. `POST /api/payouts {claimIds}`. */
export async function createBatch(claimIds) {
  const ids = Array.isArray(claimIds) ? claimIds : claimIds?.claimIds;
  return mapBatch(await post('/api/payouts', ids ? { claimIds: ids } : {}));
}

/** All batches, newest first (without items). `GET /api/payouts` (all pages). */
export async function listBatches() {
  const rows = await fetchAll('/api/payouts', { sort: 'createdAt,desc' });
  return rows.map(mapBatch).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}

/** One batch with its items (bank accounts masked here). `GET /api/payouts/{id}`. */
export async function getBatch(id) {
  return mapBatch(await get(`/api/payouts/${encodeURIComponent(id)}`));
}

function fileNameFrom(disposition) {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // fall through to the plain filename
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1].trim() : null;
}

function checksumFrom(headers) {
  const direct = headers.get('X-Checksum-SHA256') || headers.get('X-Content-SHA256') || headers.get('X-File-Sha256');
  if (direct && /^[0-9a-f]{64}$/i.test(direct.trim())) return direct.trim().toLowerCase();
  return null;
}

async function sha256Hex(text) {
  try {
    if (globalThis.crypto?.subtle) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // Not a secure context: use the pure-JS hash.
  }
  return sha256HexSync(text);
}

/**
 * Bank file. Downloads the CSV (first download moves the batch to EXPORTED), then reloads the batch.
 * `GET /api/payouts/{id}/export` (text/csv) + `GET /api/payouts/{id}`.
 * @returns {Promise<{fileName: string, csv: string, sha256: string, batch: object}>}
 */
export async function exportBatch(id) {
  const res = await request('GET', `/api/payouts/${encodeURIComponent(id)}/export`, {
    responseType: 'response',
    headers: { Accept: 'text/csv, text/plain, */*' },
  });
  const csv = await res.text();
  const sha256 = checksumFrom(res.headers) ?? (await sha256Hex(csv));
  const raw = await get(`/api/payouts/${encodeURIComponent(id)}`);
  const fileName = fileNameFrom(res.headers.get('Content-Disposition')) ?? `${raw?.batchNumber ?? id}.csv`;
  fileCache.set(raw?.id ?? id, { fileName, sha256 });
  if (raw?.id && raw.id !== id) fileCache.set(id, { fileName, sha256 });
  return { fileName, csv, sha256, batch: mapBatch(raw) };
}

/**
 * Marks an exported batch as paid. The backend requires `version`; when the caller has none it is read first.
 * `POST /api/payouts/{id}/mark-paid {version, confirm, bankReference, paidOn?}`.
 * @param {string} id
 * @param {{confirm: boolean, bankReference?: string, version?: number, paidOn?: string}} body
 */
export async function markPaid(id, body = {}) {
  let version = body.version;
  if (version === undefined || version === null) version = (await get(`/api/payouts/${encodeURIComponent(id)}`))?.version;
  const payload = {
    version,
    confirm: body.confirm === true,
    bankReference: typeof body.bankReference === 'string' ? body.bankReference.trim() : body.bankReference,
  };
  if (body.paidOn) payload.paidOn = body.paidOn;
  return mapBatch(await post(`/api/payouts/${encodeURIComponent(id)}/mark-paid`, payload));
}
