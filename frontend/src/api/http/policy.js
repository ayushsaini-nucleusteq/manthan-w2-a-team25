/**
 * Policy configuration (F4) against the backend.
 * Backend PolicyVersion {versionNo, current, changeNote, createdBy, createdAt, settings{...}, rules, tier1Cities}
 * → frontend PolicyVersion (flat settings, rule names, createdByName), same as mock/policy.js.
 */
import { get, post } from './client.js';
import { itemsOf, money, nameOf } from './common.js';

/** The backend has no submission window; the frontend default (utils/constants.js) is used. */
const DEFAULT_SUBMISSION_WINDOW_DAYS = 60;
const MAX_PAGES = 50;

const CATEGORY_NAMES = { MEALS: 'Meals', HOTEL: 'Hotel', LOCAL_CAB: 'Local cab', AIRFARE: 'Airfare', TRAIN: 'Train', OTHER: 'Other' };
const UNIT_LABELS = { PER_DAY: 'per day', PER_NIGHT: 'per night', PER_TRIP: 'per trip' };
const TIER_LABELS = { TIER1: 'tier-1 city', OTHER: 'other city' };

/** Display name for a rule (the backend has none): "Hotel per night (tier-1 city)". */
function ruleName(rule) {
  if (rule?.name) return rule.name;
  const category = CATEGORY_NAMES[rule?.category] ?? (rule?.category ? String(rule.category) : '');
  const unit = UNIT_LABELS[rule?.unit] ?? '';
  const tier = rule?.cityTier ? TIER_LABELS[rule.cityTier] ?? String(rule.cityTier) : null;
  const base = [category, unit].filter(Boolean).join(' ') || rule?.code || 'Rule';
  return tier ? `${base} (${tier})` : base;
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

function intOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Backend PolicyVersion (or PolicyVersionSummary) → frontend PolicyVersion.
 * Exported so other http modules (e.g. reference.getCurrentPolicy) can reuse it.
 */
export function mapPolicyVersion(v) {
  if (!v) return null;
  const s = v.settings ?? v;
  return {
    versionNo: intOrNull(v.versionNo),
    changeNote: v.changeNote ?? null,
    createdByName: nameOf(v.createdBy) ?? v.createdByName ?? null,
    createdAt: v.createdAt ?? null,
    receiptThreshold: money(s.receiptThreshold),
    weekendFlagEnabled: s.weekendFlagEnabled ?? null,
    overdueThresholdHours: intOrNull(s.overdueThresholdHours),
    autoApproveMaxTotal: money(s.autoApproveMaxTotal),
    auditorAboveTotal: money(s.auditorAboveTotal),
    financeHeadAboveTotal: money(s.financeHeadAboveTotal),
    samplePercent: intOrNull(s.sampleAuditPercent ?? s.samplePercent),
    submissionWindowDays: intOrNull(s.submissionWindowDays) ?? DEFAULT_SUBMISSION_WINDOW_DAYS,
    rules: Array.isArray(v.rules) ? v.rules.map(mapRule) : [],
    tier1Cities: Array.isArray(v.tier1Cities) ? [...v.tier1Cities] : [],
    current: Boolean(v.current),
  };
}

async function listSummaries() {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await get('/api/policy/versions', { query: { page, size: 100 } });
    const items = itemsOf(body);
    all.push(...items);
    const totalPages = Number(body?.totalPages);
    if (!items.length || !Number.isFinite(totalPages) || page + 1 >= totalPages) break;
  }
  return all;
}

/**
 * All versions, newest first, in full (rules and cities included).
 * `GET /api/policy/versions` (summaries) + `GET /api/policy/versions/{n}` per version.
 */
export async function listPolicyVersions() {
  const summaries = await listSummaries();
  const full = await Promise.all(
    summaries.map(async (summary) => {
      if (summary?.settings && summary?.rules) return mapPolicyVersion(summary);
      try {
        const detail = await get(`/api/policy/versions/${encodeURIComponent(summary.versionNo)}`);
        return mapPolicyVersion({ ...detail, current: detail?.current ?? summary.current });
      } catch {
        // Keep the history row even if one detail call fails.
        return mapPolicyVersion(summary);
      }
    }),
  );
  return full.filter(Boolean).sort((a, b) => (b.versionNo ?? 0) - (a.versionNo ?? 0));
}

/** One version by number. `GET /api/policy/versions/{versionNo}`. */
export async function getPolicyVersion(versionNo) {
  return mapPolicyVersion(await get(`/api/policy/versions/${encodeURIComponent(versionNo)}`));
}

function pick(fields, key, fallback) {
  return fields[key] === undefined ? fallback : fields[key];
}

/**
 * Publishes a new version. The backend wants the complete configuration, so fields left out are taken
 * from version `basedOnVersionNo` (as the mock keeps current values); the backend returns 409 when stale.
 * `POST /api/policy/versions {basedOnVersionNo, changeNote, settings, rules, tier1Cities}`.
 */
export async function publishPolicyVersion({ basedOnVersionNo, changeNote, ...fields } = {}) {
  const needsBase = ['receiptThreshold', 'weekendFlagEnabled', 'overdueThresholdHours', 'autoApproveMaxTotal', 'auditorAboveTotal', 'financeHeadAboveTotal', 'samplePercent', 'rules', 'tier1Cities'].some(
    (key) => fields[key] === undefined,
  );
  const base = needsBase && basedOnVersionNo ? await getPolicyVersion(basedOnVersionNo) : null;
  const b = base ?? {};
  const rules = pick(fields, 'rules', b.rules ?? []);
  const sample = pick(fields, 'samplePercent', b.samplePercent);
  const body = {
    basedOnVersionNo: intOrNull(basedOnVersionNo),
    changeNote: typeof changeNote === 'string' ? changeNote.trim() : changeNote,
    settings: {
      receiptThreshold: money(pick(fields, 'receiptThreshold', b.receiptThreshold)),
      weekendFlagEnabled: Boolean(pick(fields, 'weekendFlagEnabled', b.weekendFlagEnabled)),
      overdueThresholdHours: intOrNull(pick(fields, 'overdueThresholdHours', b.overdueThresholdHours)),
      autoApproveMaxTotal: money(pick(fields, 'autoApproveMaxTotal', b.autoApproveMaxTotal)),
      auditorAboveTotal: money(pick(fields, 'auditorAboveTotal', b.auditorAboveTotal)),
      financeHeadAboveTotal: money(pick(fields, 'financeHeadAboveTotal', b.financeHeadAboveTotal)),
      sampleAuditPercent: intOrNull(sample),
    },
    rules: (Array.isArray(rules) ? rules : []).map((r) => ({
      code: typeof r?.code === 'string' ? r.code.trim().toUpperCase() : r?.code,
      category: r?.category ?? null,
      unit: r?.unit ?? null,
      cityTier: r?.cityTier ?? null,
      softLimit: money(r?.softLimit),
      hardLimit: money(r?.hardLimit),
    })),
    tier1Cities: pick(fields, 'tier1Cities', b.tier1Cities ?? []),
  };
  const created = await post('/api/policy/versions', body);
  const mapped = mapPolicyVersion(created);
  // Frontend-only fields the backend does not store: keep what the caller sent.
  if (mapped && fields.submissionWindowDays !== undefined) mapped.submissionWindowDays = intOrNull(fields.submissionWindowDays) ?? mapped.submissionWindowDays;
  if (mapped && Array.isArray(fields.rules)) {
    const names = new Map(fields.rules.filter((r) => r?.code && r?.name).map((r) => [String(r.code).toUpperCase(), r.name]));
    mapped.rules = mapped.rules.map((r) => (names.has(r.code) ? { ...r, name: names.get(r.code) } : r));
  }
  return mapped;
}
