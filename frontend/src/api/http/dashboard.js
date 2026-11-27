/**
 * Finance dashboard (F1) against the backend.
 * Backend Dashboard {from, to, totalSpend, spendBy*, policyViolations, approvalTime, queues[], oldestPending,
 * approvalAgeAlert{thresholdHours, breached, breachedSince}} → the shape of mock/dashboard.js.
 */
import { get } from './client.js';
import { money } from './common.js';

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const DEFAULT_RANGE_DAYS = 180;

const CATEGORIES = [
  { code: 'MEALS', name: 'Meals' },
  { code: 'HOTEL', name: 'Hotel' },
  { code: 'LOCAL_CAB', name: 'Local cab' },
  { code: 'AIRFARE', name: 'Airfare' },
  { code: 'TRAIN', name: 'Train' },
  { code: 'OTHER', name: 'Other' },
];
const REASON_LABELS = {
  WITHIN_LIMIT: 'Within limit',
  SOFT_LIMIT_EXCEEDED: 'Over soft limit',
  HARD_LIMIT_EXCEEDED: 'Over hard limit',
  DUPLICATE_RECEIPT: 'Duplicate receipt',
  DUPLICATE: 'Possible duplicate',
  WEEKEND_EXPENSE: 'Weekend expense',
  NO_POLICY_RULE: 'No policy rule',
};
const QUEUE_KEYS = { MANAGER: 'manager', AUDITOR: 'auditor', FINANCE_HEAD: 'financeHead', SAMPLE_AUDIT: 'sampleAudit' };

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function todayIST() {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return value !== null && value !== undefined && Number.isFinite(n) ? n : fallback;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function mapQueues(queues) {
  const out = { manager: 0, auditor: 0, financeHead: 0, sampleAudit: 0, total: 0 };
  if (Array.isArray(queues)) {
    for (const q of queues) {
      const key = QUEUE_KEYS[q?.stepType];
      if (key) out[key] += num(q?.pending);
    }
  } else if (queues && typeof queues === 'object') {
    for (const key of Object.values(QUEUE_KEYS)) out[key] = num(queues[key]);
  }
  out.total = out.manager + out.auditor + out.financeHead + out.sampleAudit;
  return out;
}

function mapByReason(byReason) {
  // The backend splits a reason by outcome; the frontend shows one row per reason.
  const counts = new Map();
  for (const r of arr(byReason)) {
    if (!r?.reasonCode || r.reasonCode === 'WITHIN_LIMIT') continue;
    counts.set(r.reasonCode, (counts.get(r.reasonCode) ?? 0) + num(r.count));
  }
  return [...counts.entries()]
    .map(([reasonCode, count]) => ({ reasonCode, label: REASON_LABELS[reasonCode] ?? reasonCode, count }))
    .sort((a, b) => b.count - a.count);
}

function mapSpendByCategory(rows) {
  const amounts = new Map(arr(rows).map((r) => [r?.category, money(r?.amount) ?? '0.00']));
  const known = CATEGORIES.map((c) => ({ category: c.code, categoryName: c.name, amount: amounts.get(c.code) ?? '0.00' }));
  const extra = arr(rows)
    .filter((r) => r?.category && !CATEGORIES.some((c) => c.code === r.category))
    .map((r) => ({ category: r.category, categoryName: r.categoryName ?? r.category, amount: money(r.amount) ?? '0.00' }));
  return [...known, ...extra];
}

/**
 * Dashboard for a date range (IST dates, default the last 180 days) and optional department.
 * `GET /api/dashboard?from=&to=&departmentId=` (from/to are required by the backend).
 * @param {{from?: string, to?: string, departmentId?: string}} [params]
 */
export async function getDashboard({ from, to, departmentId } = {}) {
  const rangeTo = isIsoDate(to) ? to : todayIST();
  const rangeFrom = isIsoDate(from) ? from : addDays(rangeTo, -DEFAULT_RANGE_DAYS);
  const d = (await get('/api/dashboard', { query: { from: rangeFrom, to: rangeTo, departmentId: departmentId || undefined } })) ?? {};

  const spendByDepartment = arr(d.spendByDepartment)
    .map((r) => ({ departmentId: r?.departmentId ?? r?.department?.id ?? null, departmentName: r?.departmentName ?? r?.department?.name ?? null, amount: money(r?.amount) ?? '0.00' }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));
  const byReason = mapByReason(d.policyViolations?.byReason);
  const violationsTotal = d.policyViolations?.totalFindings ?? byReason.reduce((s, r) => s + r.count, 0);

  const op = d.oldestPending;
  const oldestPending = op
    ? {
        claimId: op.claimId ?? null,
        claimNumber: op.claimNumber ?? null,
        stepType: op.stepType ?? null,
        assigneeName: op.assigneeName ?? op.assignee?.fullName ?? null,
        pendingSince: op.pendingSince ?? null,
        ageHours: op.ageHours ?? null,
      }
    : null;
  const alert = d.approvalAgeAlert ?? {};
  const active = Boolean(alert.breached ?? alert.active);

  const departmentName = departmentId ? spendByDepartment.find((r) => r.departmentId === departmentId)?.departmentName ?? null : null;

  return {
    range: { from: d.from ?? rangeFrom, to: d.to ?? rangeTo, departmentId: departmentId ?? null, departmentName },
    totals: {
      approvedSpend: money(d.totalSpend) ?? '0.00',
      // Not provided by the backend.
      pendingAmount: money(d.pendingAmount) ?? null,
      claimsSubmitted: d.claimsSubmitted ?? null,
    },
    spendByCategory: mapSpendByCategory(d.spendByCategory),
    spendByDepartment,
    spendByMonth: arr(d.spendByMonth).map((r) => ({ month: r?.month ?? null, amount: money(r?.amount) ?? '0.00' })),
    violations: { total: num(violationsTotal), byReason },
    avgApprovalHours: d.approvalTime?.averageHours ?? null,
    queues: mapQueues(d.queues),
    oldestPending,
    approvalAgeAlert: {
      active,
      thresholdHours: alert.thresholdHours ?? null,
      openedAt: active ? alert.breachedSince ?? alert.openedAt ?? null : null,
      claimNumber: active ? oldestPending?.claimNumber ?? null : null,
      ageHours: active ? oldestPending?.ageHours ?? null : null,
    },
  };
}
