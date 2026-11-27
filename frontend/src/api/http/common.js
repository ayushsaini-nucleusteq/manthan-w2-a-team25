/**
 * Shared mappers from backend DTOs (openapi.yaml) to the frontend shapes in FRONTEND_SPEC.md §4.
 * Mappers are defensive: missing fields become null, never throw.
 */

/** Money stays a 2-decimal string ("1500.00"), whatever the backend sends. */
export function money(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value) ? value : n.toFixed(2);
}

/** CurrentUser / UserSummary / UserRef → frontend User. */
export function mapUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email ?? null,
    fullName: u.fullName ?? u.name ?? '',
    employeeCode: u.employeeCode ?? null,
    departmentId: u.department?.id ?? u.departmentId ?? null,
    departmentName: u.department?.name ?? u.departmentName ?? null,
    managerId: u.manager?.id ?? u.managerId ?? null,
    managerName: u.manager?.fullName ?? u.managerName ?? null,
    roles: Array.isArray(u.roles) ? [...u.roles] : ['EMPLOYEE'],
    active: u.active ?? true,
  };
}

/** Name of a user reference ({id, fullName}) or a plain string. */
export function nameOf(ref) {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  return ref.fullName ?? ref.name ?? null;
}

/** Spring-style page {content, totalElements} or a plain array → array. */
export function itemsOf(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  return body.items ?? body.content ?? body.data ?? [];
}

export function totalOf(body, items) {
  return body?.total ?? body?.totalElements ?? body?.totalItems ?? items.length;
}
