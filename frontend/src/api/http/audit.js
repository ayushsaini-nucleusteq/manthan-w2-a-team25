/**
 * Audit log (F6) against the backend. Read-only (append-only trail).
 * Backend AuditEvent {id, occurredAt, actor, onBehalfOf, action, entityType, entityId, claimId, fromStatus,
 * toStatus, comment, details} → frontend audit event (mock views.toAuditEvent).
 */
import { get } from './client.js';
import { itemsOf, nameOf, totalOf } from './common.js';

/** Backend enums (openapi AuditAction / AuditEntityType). */
const AUDIT_ACTIONS = [
  'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'CLAIM_CREATED', 'CLAIM_UPDATED', 'CLAIM_DELETED', 'LINE_ADDED', 'LINE_UPDATED',
  'LINE_REMOVED', 'RECEIPT_UPLOADED', 'SUBMITTED', 'RESUBMITTED', 'POLICY_EVALUATED', 'AUTO_APPROVED', 'AUTO_REJECTED',
  'ROUTED', 'STEPS_ADDED', 'SAMPLE_AUDIT_SELECTED', 'SAMPLE_AUDIT_CLEARED', 'APPROVED', 'REJECTED', 'SENT_BACK',
  'COMMENTED', 'ADDED_TO_BATCH', 'PAYOUT_BATCH_CREATED', 'PAYOUT_EXPORTED', 'PAYOUT_PAID', 'DELEGATION_CREATED',
  'DELEGATION_REVOKED', 'POLICY_VERSION_CREATED', 'USER_UPDATED',
];
const ENTITY_TYPES = ['CLAIM', 'EXPENSE_LINE', 'PAYOUT_BATCH', 'DELEGATION', 'POLICY_VERSION', 'USER'];

const MAX_SIZE = 100; // backend page size limit
const MAX_ACTORS = 10; // actor-name search fans out to at most this many matching users
const IST = '+05:30';

/**
 * Filter options for the audit log screen. No endpoint: the backend's enum values, kept as constants.
 * @returns {Promise<{actions: string[], entityTypes: string[]}>}
 */
export async function listAuditFilterOptions() {
  return { actions: [...AUDIT_ACTIONS], entityTypes: [...ENTITY_TYPES] };
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** IST business date → UTC instant (start of day, or end of day for `to`). */
function istInstant(date, endOfDay) {
  if (!isIsoDate(date)) return undefined;
  const ms = Date.parse(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}${IST}`);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function mapEvent(e, claimNumbers) {
  const actorName = nameOf(e?.actor) ?? e?.actorName ?? null;
  const claimId = e?.claimId ?? null;
  return {
    id: e?.id ?? null,
    occurredAt: e?.occurredAt ?? null,
    actorId: e?.actor?.id ?? e?.actorId ?? null,
    actorName: actorName ?? (e?.actor || e?.actorId ? null : 'System'),
    onBehalfOfName: nameOf(e?.onBehalfOf) ?? e?.onBehalfOfName ?? null,
    action: e?.action ?? null,
    entityType: e?.entityType ?? null,
    entityId: e?.entityId ?? null,
    claimId,
    claimNumber: e?.claimNumber ?? (claimId ? claimNumbers.get(claimId) : null) ?? e?.details?.claimNumber ?? null,
    fromStatus: e?.fromStatus ?? null,
    toStatus: e?.toStatus ?? null,
    comment: e?.comment ?? null,
    details: e?.details ?? null,
  };
}

async function fetchPage(query, page, size) {
  const body = await get('/api/audit-events', { query: { ...query, page, size, sort: 'occurredAt,desc' } });
  const items = itemsOf(body);
  return { items, total: Number(totalOf(body, items)) || 0 };
}

/** First `limit` events (newest first) for one query, across backend pages. */
async function fetchHead(query, limit) {
  const items = [];
  let total = 0;
  for (let page = 0; items.length < limit; page += 1) {
    const res = await fetchPage(query, page, MAX_SIZE);
    total = res.total;
    items.push(...res.items);
    if (res.items.length < MAX_SIZE || items.length >= total) break;
  }
  return { items: items.slice(0, limit), total };
}

/**
 * Events newest first, filtered and paged (`page` is 1-based here, 0-based on the backend).
 * `claimNumber` is resolved with `GET /api/claims?scope=all&q=`; `actorQ` with `GET /api/users?q=`.
 * `GET /api/audit-events?claimId=&actorId=&action=&entityType=&from=&to=&page=&size=`.
 * @param {{claimId?: string, claimNumber?: string, actorId?: string, actorQ?: string, action?: string, entityType?: string, from?: string, to?: string, page?: number, pageSize?: number}} [params]
 * @returns {Promise<{items: object[], total: number, page: number, pageSize: number}>}
 */
export async function listAuditEvents({ claimId, claimNumber, actorId, actorQ, action, entityType, from, to, page = 1, pageSize = 50 } = {}) {
  const size = Math.min(MAX_SIZE, Math.max(1, Number(pageSize) || 50));
  const current = Math.max(1, Number(page) || 1);
  const empty = { items: [], total: 0, page: current, pageSize: size };
  const claimNumbers = new Map();

  let resolvedClaimId = claimId || undefined;
  if (!resolvedClaimId && claimNumber) {
    const body = await get('/api/claims', { query: { scope: 'all', q: String(claimNumber).trim(), page: 0, size: 20 } });
    const wanted = String(claimNumber).trim().toUpperCase();
    const match = itemsOf(body).find((c) => String(c?.claimNumber ?? '').toUpperCase() === wanted);
    if (!match) return empty;
    resolvedClaimId = match.id;
    claimNumbers.set(match.id, match.claimNumber);
  }

  let actorIds = actorId ? [actorId] : null;
  if (!actorIds && actorQ && String(actorQ).trim()) {
    const body = await get('/api/users', { query: { q: String(actorQ).trim().slice(0, 100), page: 0, size: MAX_ACTORS } });
    actorIds = itemsOf(body).map((u) => u?.id).filter(Boolean);
    if (!actorIds.length) return empty;
  }

  const query = {
    claimId: resolvedClaimId,
    action: action && action !== 'ALL' ? action : undefined,
    entityType: entityType && entityType !== 'ALL' ? entityType : undefined,
    from: istInstant(from, false),
    to: istInstant(to, true),
  };

  if (!actorIds || actorIds.length === 1) {
    const res = await fetchPage({ ...query, actorId: actorIds?.[0] }, current - 1, size);
    return { items: res.items.map((e) => mapEvent(e, claimNumbers)), total: res.total, page: current, pageSize: size };
  }

  // Several users match the actor search: the backend filters one actor at a time, so merge their newest events.
  const limit = current * size;
  const parts = await Promise.all(actorIds.map((id) => fetchHead({ ...query, actorId: id }, limit)));
  const merged = parts
    .flatMap((p) => p.items)
    .sort((a, b) => String(b.occurredAt ?? '').localeCompare(String(a.occurredAt ?? '')) || Number(b.id ?? 0) - Number(a.id ?? 0));
  const total = parts.reduce((s, p) => s + p.total, 0);
  return { items: merged.slice((current - 1) * size, limit).map((e) => mapEvent(e, claimNumbers)), total, page: current, pageSize: size };
}
