/**
 * Reference data against the backend: categories, departments and the current policy.
 * Same function names, arguments and return shapes as ../mock/reference.js.
 */
import { get } from './client.js';
import { money, nameOf } from './common.js';

/** Fallback names used until GET /api/expense-categories has been loaded once. */
const DEFAULT_CATEGORY_NAMES = {
  MEALS: 'Meals',
  HOTEL: 'Hotel',
  LOCAL_CAB: 'Local cab',
  AIRFARE: 'Airfare',
  TRAIN: 'Train',
  OTHER: 'Other',
};

const categoryNames = new Map(Object.entries(DEFAULT_CATEGORY_NAMES));

/** Display name of a category code (backend lines carry only the code). */
export function categoryName(code) {
  if (!code) return null;
  return categoryNames.get(code) ?? code;
}

/** Rule names are not in the backend's PolicyRule; derive a readable one from the code. */
const RULE_NAMES = {
  MEALS_DAILY: 'Meals per day',
  HOTEL_NIGHTLY_TIER1: 'Hotel per night (tier-1 city)',
  HOTEL_NIGHTLY_OTHER: 'Hotel per night (other city)',
  LOCAL_CAB_TRIP: 'Local cab per trip',
};

function ruleName(rule) {
  if (rule?.name) return rule.name;
  const code = rule?.code ?? '';
  if (RULE_NAMES[code]) return RULE_NAMES[code];
  const text = code.toLowerCase().replace(/_/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : null;
}

function mapRule(rule) {
  return {
    code: rule?.code ?? null,
    name: ruleName(rule),
    category: rule?.category ?? null,
    unit: rule?.unit ?? null,
    cityTier: rule?.cityTier ?? null,
    softLimit: money(rule?.softLimit),
    hardLimit: money(rule?.hardLimit),
  };
}

/**
 * Backend PolicyVersion ({versionNo, current, settings: {...}, rules, tier1Cities, createdBy})
 * → frontend Policy (flat settings, `createdByName`, `samplePercent`).
 * `submissionWindowDays` is not in the backend contract → null (pages fall back to their default).
 */
export function mapPolicy(p) {
  if (!p) return null;
  const s = p.settings ?? p;
  return {
    versionNo: p.versionNo ?? null,
    changeNote: p.changeNote ?? null,
    createdByName: nameOf(p.createdBy) ?? p.createdByName ?? null,
    createdAt: p.createdAt ?? null,
    receiptThreshold: money(s.receiptThreshold),
    weekendFlagEnabled: s.weekendFlagEnabled ?? null,
    overdueThresholdHours: s.overdueThresholdHours ?? null,
    autoApproveMaxTotal: money(s.autoApproveMaxTotal),
    auditorAboveTotal: money(s.auditorAboveTotal),
    financeHeadAboveTotal: money(s.financeHeadAboveTotal),
    samplePercent: s.sampleAuditPercent ?? s.samplePercent ?? null,
    submissionWindowDays: s.submissionWindowDays ?? null,
    rules: Array.isArray(p.rules) ? p.rules.map(mapRule) : [],
    tier1Cities: Array.isArray(p.tier1Cities) ? [...p.tier1Cities] : [],
    current: p.current ?? true,
  };
}

/**
 * Expense categories ({code, name, requiresHotelDetails, active}).
 * GET /api/expense-categories (plain array; every listed category is active).
 */
export async function listCategories() {
  const body = await get('/api/expense-categories');
  const list = Array.isArray(body) ? body : [];
  const out = list
    .filter((c) => c && c.code && c.active !== false)
    .map((c) => ({
      code: c.code,
      name: c.name ?? DEFAULT_CATEGORY_NAMES[c.code] ?? c.code,
      requiresHotelDetails: Boolean(c.requiresHotelDetails),
      active: c.active ?? true,
    }));
  for (const c of out) categoryNames.set(c.code, c.name);
  return out;
}

/**
 * Departments ({id, code, name}), sorted by name.
 * GET /api/departments
 */
export async function listDepartments() {
  const body = await get('/api/departments');
  const list = Array.isArray(body) ? body : [];
  return list
    .filter(Boolean)
    .map((d) => ({ id: d.id ?? null, code: d.code ?? null, name: d.name ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The policy version in force.
 * GET /api/policy/current
 */
export async function getCurrentPolicy() {
  return mapPolicy(await get('/api/policy/current'));
}
