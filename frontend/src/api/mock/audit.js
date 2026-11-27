/**
 * Audit log (F6). Read-only by design: there is no function to edit or
 * delete an event (append-only trail, US17-AC2).
 */
import { AUDIT_ACTIONS, ENTITY_TYPES } from './constants.js';
import { query, requireRole } from './runtime.js';
import { istDateTimeMs, isValidIsoDate, normalizeKey, DAY_MS } from './util.js';
import { toAuditEvent } from './views.js';

/**
 * Filter options for the audit log screen (mock helper; the real client can
 * keep these as constants).
 * @returns {Promise<{actions: string[], entityTypes: string[]}>}
 */
export async function listAuditFilterOptions() {
  return { actions: [...AUDIT_ACTIONS], entityTypes: [...ENTITY_TYPES] };
}

/**
 * Events newest first, filtered and paged. Finance head and auditors.
 * `actorQ` matches the actor's name or employee code; `from`/`to` are IST dates.
 * Mirrors `GET /api/audit-events?claimId=&actorId=&action=&entityType=&from=&to=`.
 * @param {{claimId?: string, claimNumber?: string, actorId?: string, actorQ?: string, action?: string, entityType?: string, from?: string, to?: string, page?: number, pageSize?: number}} [params]
 * @returns {Promise<{items: object[], total: number, page: number, pageSize: number}>}
 */
export async function listAuditEvents({ claimId, claimNumber, actorId, actorQ, action, entityType, from, to, page = 1, pageSize = 50 } = {}) {
  return query(({ db, user }) => {
    requireRole(user, ['FINANCE_HEAD', 'AUDITOR']);
    const needle = normalizeKey(actorQ);
    const actorIds = needle
      ? new Set(db.users.filter((u) => normalizeKey(`${u.fullName} ${u.employeeCode}`).includes(needle)).map((u) => u.id))
      : null;
    const claimByNumber = claimNumber ? db.claims.find((c) => normalizeKey(c.claimNumber) === normalizeKey(claimNumber)) : null;
    const fromMs = isValidIsoDate(from) ? istDateTimeMs(from, 0) : null;
    const toMs = isValidIsoDate(to) ? istDateTimeMs(to, 0) + DAY_MS : null;
    const filtered = db.auditEvents.filter((e) => {
      if (claimId && e.claimId !== claimId) return false;
      if (claimNumber && e.claimId !== claimByNumber?.id) return false;
      if (actorId && e.actorId !== actorId) return false;
      if (actorIds && !actorIds.has(e.actorId)) return false;
      if (action && action !== 'ALL' && e.action !== action) return false;
      if (entityType && entityType !== 'ALL' && e.entityType !== entityType) return false;
      const at = Date.parse(e.occurredAt);
      if (fromMs !== null && at < fromMs) return false;
      if (toMs !== null && at >= toMs) return false;
      return true;
    });
    filtered.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id - a.id);
    const size = Math.min(200, Math.max(1, Number(pageSize) || 50));
    const current = Math.max(1, Number(page) || 1);
    const items = filtered.slice((current - 1) * size, current * size).map((e) => toAuditEvent(db, e, user));
    return { items, total: filtered.length, page: current, pageSize: size };
  });
}
