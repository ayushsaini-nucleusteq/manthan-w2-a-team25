/** Reference data: categories, departments and the current policy. */
import { currentPolicy } from './policyEngine.js';
import { query } from './runtime.js';
import { toPolicy } from './views.js';

/**
 * Expense categories ({code, name, requiresHotelDetails, active}).
 * Mirrors `GET /api/expense-categories`.
 */
export async function listCategories() {
  return query(({ db }) => db.categories.filter((c) => c.active).map((c) => ({ ...c })));
}

/**
 * Departments ({id, code, name}), sorted by name.
 * Mirrors `GET /api/departments`.
 */
export async function listDepartments() {
  return query(({ db }) => [...db.departments].sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ ...d })));
}

/**
 * The policy version in force (highest version number).
 * Mirrors `GET /api/policy/current`.
 */
export async function getCurrentPolicy() {
  return query(({ db }) => toPolicy(db, currentPolicy(db)));
}
