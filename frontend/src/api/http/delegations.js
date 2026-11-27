/**
 * Delegation (M4, F5) against the Spring backend.
 * Same function names, arguments and return shapes as ../mock/delegations.js.
 */
import { getSession } from '../session.js';
import { del, get, post } from './client.js';
import { itemsOf, nameOf } from './common.js';

const APPROVER_ROLES = ['MANAGER', 'AUDITOR', 'FINANCE_HEAD'];
const IST_OFFSET_MS = 330 * 60000;

function todayIST() {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function sessionUser() {
  return getSession()?.user ?? null;
}

/** UserSummary without bank details (mock views.toUserSummary). */
function mapUserSummary(u) {
  return {
    id: u?.id,
    fullName: u?.fullName ?? u?.name ?? '',
    email: u?.email ?? null,
    employeeCode: u?.employeeCode ?? null,
    departmentId: u?.department?.id ?? u?.departmentId ?? null,
    departmentName: u?.department?.name ?? u?.departmentName ?? null,
    roles: Array.isArray(u?.roles) ? [...u.roles] : ['EMPLOYEE'],
  };
}

/** Backend Delegation → frontend Delegation (mock views.toDelegation). */
function mapDelegation(d) {
  const today = todayIST();
  const revokedAt = d?.revokedAt ?? null;
  const startsOn = d?.startsOn ?? null;
  const endsOn = d?.endsOn ?? null;
  let status = 'ACTIVE';
  if (revokedAt) status = 'REVOKED';
  else if (startsOn && today < startsOn) status = 'SCHEDULED';
  else if (endsOn && today > endsOn) status = 'EXPIRED';
  return {
    id: d?.id,
    delegatorId: d?.delegator?.id ?? d?.delegatorId ?? null,
    delegatorName: nameOf(d?.delegator) ?? d?.delegatorName ?? null,
    delegateId: d?.delegate?.id ?? d?.delegateId ?? null,
    delegateName: nameOf(d?.delegate) ?? d?.delegateName ?? null,
    startsOn,
    endsOn,
    reason: d?.reason ?? null,
    active: typeof d?.active === 'boolean' ? d.active : status === 'ACTIVE',
    status,
    coveredRoles: Array.isArray(d?.roles) ? [...d.roles] : Array.isArray(d?.coveredRoles) ? [...d.coveredRoles] : [],
    revokedAt,
    createdAt: d?.createdAt ?? null,
  };
}

async function allDelegations(scope) {
  const out = [];
  for (let page = 0; page < 10; page += 1) {
    const body = await get('/api/delegations', { query: { scope, page, size: 100 } });
    const chunk = itemsOf(body);
    out.push(...chunk);
    if (!chunk.length || page + 1 >= (Number(body?.totalPages) || 1)) break;
  }
  return out;
}

/**
 * People the caller can hand approvals to: active managers, plus holders of the caller's own
 * approver roles; never the caller. One request per role, merged by id, sorted by name.
 * Endpoint: `GET /api/users?role=MANAGER&active=true&q=` (and `role=AUDITOR|FINANCE_HEAD` for those roles).
 * @param {{q?: string}} [params]
 */
export async function listDelegateCandidates({ q } = {}) {
  const me = sessionUser();
  const myRoles = Array.isArray(me?.roles) ? me.roles : [];
  const roles = ['MANAGER', ...APPROVER_ROLES.filter((r) => r !== 'MANAGER' && myRoles.includes(r))];
  const needle = typeof q === 'string' && q.trim() ? q.trim() : undefined;
  const pages = await Promise.all(roles.map((role) => get('/api/users', { query: { role, active: true, q: needle, size: 100 } })));
  const byId = new Map();
  for (const body of pages) {
    for (const u of itemsOf(body)) {
      if (!u?.id || u.id === me?.id || u.active === false) continue;
      if (!byId.has(u.id)) byId.set(u.id, mapUserSummary(u));
    }
  }
  return [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/**
 * Delegations the caller gave, received, or (finance head only) all. Newest start first.
 * Endpoint: `GET /api/delegations?scope=given|received|all`.
 * @param {{scope?: 'given'|'received'|'all'}} [params]
 */
export async function listDelegations({ scope = 'given' } = {}) {
  const wanted = ['given', 'received', 'all'].includes(scope) ? scope : 'given';
  const list = (await allDelegations(wanted)).map(mapDelegation);
  return list.sort(
    (a, b) => String(b.startsOn ?? '').localeCompare(String(a.startsOn ?? '')) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
  );
}

/**
 * Creates a delegation from the caller (400 invalid, 404 unknown delegate, 409 overlap).
 * Endpoint: `POST /api/delegations` {delegateId, startsOn, endsOn, reason}.
 * @param {{delegateId: string, startsOn: string, endsOn: string, reason?: string}} input
 */
export async function createDelegation({ delegateId, startsOn, endsOn, reason } = {}) {
  const text = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
  return mapDelegation(await post('/api/delegations', { delegateId, startsOn, endsOn, reason: text }));
}

/**
 * Revokes a delegation (the delegator or the finance head; 409 if already revoked or ended).
 * The endpoint answers 204, so the updated row is read back from `GET /api/delegations`.
 * Endpoint: `DELETE /api/delegations/{id}`.
 */
export async function revokeDelegation(id) {
  await del(`/api/delegations/${encodeURIComponent(id)}`);
  const me = sessionUser();
  const scopes = ['given', ...(Array.isArray(me?.roles) && me.roles.includes('FINANCE_HEAD') ? ['all'] : [])];
  for (const scope of scopes) {
    try {
      const found = (await allDelegations(scope)).find((d) => d?.id === id);
      if (found) return mapDelegation(found);
    } catch {
      // Try the next scope, then fall back below.
    }
  }
  return { ...mapDelegation({ id, revokedAt: new Date().toISOString() }), active: false, status: 'REVOKED' };
}
