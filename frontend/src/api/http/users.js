/**
 * User administration (F5) against the backend.
 * Backend User {id, employeeCode, fullName, email, roles, department, manager, active, version} → frontend User.
 */
import { ApiError } from '../errors.js';
import { get, patch as httpPatch } from './client.js';
import { itemsOf, mapUser } from './common.js';

const MAX_PAGES = 50;

/** Backend User → frontend User (mock views.toUser, including `version`). */
export function mapAdminUser(u) {
  const base = mapUser(u);
  if (!base) return null;
  return { ...base, version: u.version ?? null };
}

/**
 * Users filtered by name/code/email, role, department and active flag, sorted by name.
 * `GET /api/users?q=&role=&departmentId=&active=` (all pages).
 * @param {{q?: string, role?: string, departmentId?: string, active?: boolean}} [params]
 */
export async function listUsers({ q, role, departmentId, active } = {}) {
  const query = {
    q: typeof q === 'string' ? q.trim().slice(0, 100) || undefined : undefined,
    role: role && role !== 'ALL' ? role : undefined,
    departmentId: departmentId || undefined,
    active: active === undefined || active === null ? undefined : Boolean(active),
    sort: 'fullName,asc',
  };
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await get('/api/users', { query: { ...query, page, size: 100 } });
    const items = itemsOf(body);
    all.push(...items);
    const totalPages = Number(body?.totalPages);
    if (Array.isArray(body) || !items.length || !Number.isFinite(totalPages) || page + 1 >= totalPages) break;
  }
  return all
    .map(mapAdminUser)
    .filter(Boolean)
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
}

/**
 * Changes a user's manager, roles or active flag; only fields present are sent. The backend requires
 * `version`, so when the caller has none it is read from the user list first.
 * `PATCH /api/users/{id} {version, managerId?, roles?, active?}`.
 * @param {string} id
 * @param {{managerId?: string|null, roles?: string[], active?: boolean, version?: number}} patch
 */
export async function updateUser(id, patch = {}) {
  let version = patch.version;
  if (version === undefined || version === null) {
    const all = await listUsers({});
    const found = all.find((u) => u.id === id);
    if (!found) throw new ApiError(404, 'NOT_FOUND', 'User not found.');
    version = found.version;
  }
  const body = { version };
  if (Object.prototype.hasOwnProperty.call(patch, 'managerId')) body.managerId = patch.managerId || null;
  if (patch.roles !== undefined) {
    const roles = Array.isArray(patch.roles) ? [...new Set(patch.roles)] : patch.roles;
    body.roles = Array.isArray(roles) && !roles.includes('EMPLOYEE') ? ['EMPLOYEE', ...roles] : roles;
  }
  if (patch.active !== undefined) body.active = Boolean(patch.active);
  return mapAdminUser(await httpPatch(`/api/users/${encodeURIComponent(id)}`, body));
}
