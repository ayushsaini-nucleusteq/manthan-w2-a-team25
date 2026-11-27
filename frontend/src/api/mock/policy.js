/**
 * Policy configuration (F4). Every publish inserts a new version; versions
 * are never edited. Publishing checks `basedOnVersionNo` (409 when stale).
 */
import { fromPaise, parseMoneyInput, toPaise } from '../../utils/money.js';
import { ApiError } from '../errors.js';
import { CATEGORY_CODES } from './constants.js';
import { appendAudit } from './events.js';
import { currentPolicy } from './policyEngine.js';
import { mutate, notFound, query, requireRole } from './runtime.js';
import { cleanText, normalizeKey, toIso } from './util.js';
import { toPolicy } from './views.js';

const MONEY_FIELDS = ['receiptThreshold', 'autoApproveMaxTotal', 'auditorAboveTotal', 'financeHeadAboveTotal'];
const INT_FIELDS = {
  overdueThresholdHours: [1, 720, 'Enter the overdue threshold in hours (1 to 720).'],
  samplePercent: [1, 100, 'Enter the sample percentage (1 to 100).'],
  submissionWindowDays: [1, 365, 'Enter the submission window in days (1 to 365).'],
};
const UNITS = ['PER_DAY', 'PER_NIGHT', 'PER_TRIP'];

/**
 * All versions, newest first (finance head and auditors).
 * Mirrors `GET /api/policy/versions`.
 */
export async function listPolicyVersions() {
  return query(({ db, user }) => {
    requireRole(user, ['FINANCE_HEAD', 'AUDITOR']);
    return [...db.policyVersions].sort((a, b) => b.versionNo - a.versionNo).map((v) => toPolicy(db, v));
  });
}

/**
 * One version by number (404 if it doesn't exist).
 * Mirrors `GET /api/policy/versions/{n}`.
 */
export async function getPolicyVersion(versionNo) {
  return query(({ db, user }) => {
    requireRole(user, ['FINANCE_HEAD', 'AUDITOR']);
    const version = db.policyVersions.find((v) => v.versionNo === Number(versionNo));
    if (!version) throw notFound('Policy version not found.');
    return toPolicy(db, version);
  });
}

function money(value) {
  if (value === null || value === undefined || value === '') return null;
  return parseMoneyInput(typeof value === 'number' ? String(value) : value);
}

function validateRules(rules, fields) {
  if (!Array.isArray(rules) || !rules.length) {
    fields.rules = 'Keep at least one spending rule.';
    return [];
  }
  const out = [];
  const codes = new Set();
  for (const rule of rules) {
    const code = cleanText(rule?.code).toUpperCase();
    const key = `rules.${code || out.length}`;
    if (!/^[A-Z0-9_]{2,50}$/.test(code)) fields[`${key}.code`] = 'Use 2–50 capital letters, digits or underscores.';
    else if (codes.has(code)) fields[`${key}.code`] = 'Each rule code must be unique.';
    codes.add(code);
    const category = cleanText(rule?.category).toUpperCase();
    if (!CATEGORY_CODES.includes(category)) fields[`${key}.category`] = 'Choose a category.';
    const unit = cleanText(rule?.unit).toUpperCase();
    if (!UNITS.includes(unit)) fields[`${key}.unit`] = 'Choose per day, per night or per trip.';
    const cityTier = category === 'HOTEL' ? cleanText(rule?.cityTier).toUpperCase() || 'OTHER' : null;
    if (cityTier && !['TIER1', 'OTHER'].includes(cityTier)) fields[`${key}.cityTier`] = 'Choose tier-1 or other cities.';
    const soft = money(rule?.softLimit);
    const hard = money(rule?.hardLimit);
    if (!soft || toPaise(soft) <= 0) fields[`${key}.softLimit`] = 'Enter a soft limit above ₹0.';
    if (!hard || toPaise(hard) <= 0) fields[`${key}.hardLimit`] = 'Enter a hard limit above ₹0.';
    else if (soft && toPaise(hard) < toPaise(soft)) fields[`${key}.hardLimit`] = 'The hard limit must be at least the soft limit.';
    out.push({
      code,
      name: cleanText(rule?.name) || code,
      category,
      unit,
      cityTier,
      softLimit: soft ?? rule?.softLimit,
      hardLimit: hard ?? rule?.hardLimit,
    });
  }
  return out;
}

function diff(base, next) {
  const changes = {};
  for (const key of [...MONEY_FIELDS, ...Object.keys(INT_FIELDS), 'weekendFlagEnabled']) {
    if (base[key] !== next[key]) changes[key] = { from: base[key], to: next[key] };
  }
  const baseRules = new Map(base.rules.map((r) => [r.code, r]));
  const nextRules = new Map(next.rules.map((r) => [r.code, r]));
  for (const [code, rule] of nextRules) {
    const old = baseRules.get(code);
    if (!old) {
      changes[`${code}`] = { from: null, to: `${rule.softLimit} / ${rule.hardLimit}` };
      continue;
    }
    for (const k of ['softLimit', 'hardLimit', 'name', 'category', 'unit', 'cityTier']) {
      if (old[k] !== rule[k]) changes[`${code}.${k}`] = { from: old[k], to: rule[k] };
    }
  }
  for (const code of baseRules.keys()) if (!nextRules.has(code)) changes[code] = { from: 'rule', to: null };
  const baseCities = new Set(base.tier1Cities.map(normalizeKey));
  const nextCities = new Set(next.tier1Cities.map(normalizeKey));
  const added = next.tier1Cities.filter((c) => !baseCities.has(normalizeKey(c)));
  const removed = base.tier1Cities.filter((c) => !nextCities.has(normalizeKey(c)));
  if (added.length || removed.length) changes.tier1Cities = { added, removed };
  return changes;
}

/**
 * Publishes a new version based on `basedOnVersionNo` (409 when another
 * version was published meanwhile). Fields left out keep their current
 * values. `changeNote` is required.
 * Mirrors `POST /api/policy/versions`.
 */
export async function publishPolicyVersion({ basedOnVersionNo, changeNote, ...fields } = {}) {
  return mutate(({ db, user, now }) => {
    requireRole(user, ['FINANCE_HEAD']);
    const base = currentPolicy(db);
    if (Number(basedOnVersionNo) !== base.versionNo) {
      throw new ApiError(409, 'STALE_POLICY_VERSION', `Version ${base.versionNo} was published while you were editing. Reload and apply your changes again.`, {
        currentVersionNo: base.versionNo,
      });
    }
    const errors = {};
    const note = cleanText(changeNote);
    if (!note) errors.changeNote = 'Describe what changed and why.';
    else if (note.length > 500) errors.changeNote = 'Keep the change note under 500 characters.';

    const next = { ...base, rules: base.rules.map((r) => ({ ...r })), tier1Cities: [...base.tier1Cities] };
    for (const key of MONEY_FIELDS) {
      if (fields[key] === undefined) continue;
      const value = money(fields[key]);
      if (!value || (key !== 'autoApproveMaxTotal' && toPaise(value) <= 0)) errors[key] = 'Enter an amount above ₹0.';
      else next[key] = value;
    }
    for (const [key, [min, max, message]] of Object.entries(INT_FIELDS)) {
      if (fields[key] === undefined) continue;
      const value = Number(fields[key]);
      if (!Number.isInteger(value) || value < min || value > max) errors[key] = message;
      else next[key] = value;
    }
    if (fields.weekendFlagEnabled !== undefined) next.weekendFlagEnabled = Boolean(fields.weekendFlagEnabled);
    if (fields.rules !== undefined) next.rules = validateRules(fields.rules, errors);
    if (fields.tier1Cities !== undefined) {
      const seen = new Set();
      const cities = [];
      for (const city of Array.isArray(fields.tier1Cities) ? fields.tier1Cities : []) {
        const name = cleanText(city);
        if (!name) continue;
        if (name.length > 80) errors.tier1Cities = 'Keep each city name under 80 characters.';
        if (!seen.has(normalizeKey(name))) cities.push(name);
        seen.add(normalizeKey(name));
      }
      if (!cities.length) errors.tier1Cities = 'Keep at least one tier-1 city.';
      next.tier1Cities = cities.sort((a, b) => a.localeCompare(b));
    }
    if (!errors.financeHeadAboveTotal && !errors.auditorAboveTotal && toPaise(next.financeHeadAboveTotal) < toPaise(next.auditorAboveTotal)) {
      errors.financeHeadAboveTotal = 'The finance-head threshold must be at least the auditor threshold.';
    }
    if (Object.keys(errors).length) throw new ApiError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { fields: errors });

    const changes = diff(base, next);
    if (!Object.keys(changes).length) throw new ApiError(422, 'NO_CHANGES', 'Nothing has changed compared with the current version.');
    const version = {
      ...next,
      versionNo: base.versionNo + 1,
      changeNote: note,
      createdBy: user.id,
      createdAt: toIso(now),
    };
    for (const key of MONEY_FIELDS) version[key] = fromPaise(toPaise(version[key]));
    db.policyVersions.push(version);
    appendAudit(db, {
      now,
      actorId: user.id,
      action: 'POLICY_PUBLISHED',
      entityType: 'POLICY',
      entityId: String(version.versionNo),
      comment: note,
      details: { versionNo: version.versionNo, basedOnVersionNo: base.versionNo, changes },
    });
    return toPolicy(db, version);
  });
}
