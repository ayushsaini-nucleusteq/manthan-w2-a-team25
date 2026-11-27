/**
 * Finance dashboard (F1): spend, violations, approval speed, queues and the
 * oldest-pending alert. The alert is active while the oldest pending
 * approval is older than overdueThresholdHours; its `openedAt` is stored so
 * it stays the same for the whole breach.
 */
import { fromPaise, toPaise } from '../../utils/money.js';
import { userById } from './access.js';
import { CATEGORIES, REASON_LABELS, STATUS } from './constants.js';
import { currentPolicy } from './policyEngine.js';
import { mutate, requireRole } from './runtime.js';
import { addDays, HOUR_MS, hoursBetween, isoDateIST, isValidIsoDate, toIso } from './util.js';
import { departmentName } from './views.js';

const SPEND_STATUSES = new Set([STATUS.APPROVED, STATUS.AUTO_APPROVED, STATUS.IN_BATCH, STATUS.PAID]);
const HUMAN_DECIDED = new Set([STATUS.APPROVED, STATUS.IN_BATCH, STATUS.PAID, STATUS.REJECTED]);
const POOL_LABEL = { MANAGER: 'Manager pool', AUDITOR: 'Auditor pool', FINANCE_HEAD: 'Finance head pool' };

function monthsBetween(from, to) {
  const months = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (months.length > 60) break;
  }
  return months;
}

function oldestPendingStep(db, now, departmentId) {
  let oldest = null;
  for (const claim of db.claims) {
    if (departmentId && claim.departmentId !== departmentId) continue;
    for (const step of claim.steps) {
      if (step.status !== 'PENDING' || step.stepType === 'SAMPLE_AUDIT' || !step.pendingSince) continue;
      if (!oldest || step.pendingSince < oldest.step.pendingSince) oldest = { claim, step };
    }
  }
  if (!oldest) return null;
  const { claim, step } = oldest;
  return {
    claimId: claim.id,
    claimNumber: claim.claimNumber,
    stepType: step.stepType,
    assigneeName: userById(db, step.assigneeId)?.fullName ?? POOL_LABEL[step.requiredRole] ?? null,
    pendingSince: step.pendingSince,
    ageHours: hoursBetween(Date.parse(step.pendingSince), now),
  };
}

/**
 * Dashboard for a date range (submission date, IST) and optional department.
 * Defaults to the last 180 days. Finance head only.
 * Mirrors `GET /api/dashboard?from=&to=&departmentId=`.
 * @param {{from?: string, to?: string, departmentId?: string}} [params]
 */
export async function getDashboard({ from, to, departmentId } = {}) {
  return mutate(({ db, user, now }) => {
    requireRole(user, ['FINANCE_HEAD']);
    const today = isoDateIST(now);
    const rangeTo = isValidIsoDate(to) ? to : today;
    const rangeFrom = isValidIsoDate(from) ? from : addDays(rangeTo, -180);
    const policy = currentPolicy(db);

    const inRange = db.claims.filter((c) => {
      if (!c.submittedAt) return false;
      if (departmentId && c.departmentId !== departmentId) return false;
      const day = isoDateIST(Date.parse(c.submittedAt));
      return day >= rangeFrom && day <= rangeTo;
    });

    const byCategory = new Map(CATEGORIES.map((c) => [c.code, 0]));
    const byDepartment = new Map(db.departments.map((d) => [d.id, 0]));
    const months = monthsBetween(rangeFrom, rangeTo);
    const byMonth = new Map(months.map((m) => [m, 0]));
    let approvedSpend = 0;
    let pendingAmount = 0;
    for (const claim of inRange) {
      if (claim.status.startsWith('PENDING_')) pendingAmount += toPaise(claim.totalAmount);
      if (!SPEND_STATUSES.has(claim.status)) continue;
      const total = toPaise(claim.totalAmount);
      approvedSpend += total;
      byDepartment.set(claim.departmentId, (byDepartment.get(claim.departmentId) ?? 0) + total);
      const month = isoDateIST(Date.parse(claim.submittedAt)).slice(0, 7);
      if (byMonth.has(month)) byMonth.set(month, byMonth.get(month) + total);
      for (const line of claim.lines) byCategory.set(line.category, (byCategory.get(line.category) ?? 0) + toPaise(line.amount));
    }

    const reasonCounts = new Map();
    for (const claim of inRange) {
      for (const line of claim.lines) {
        for (const f of line.findings ?? []) {
          if (f.reasonCode === 'WITHIN_LIMIT') continue;
          reasonCounts.set(f.reasonCode, (reasonCounts.get(f.reasonCode) ?? 0) + 1);
        }
      }
    }
    const byReason = [...reasonCounts.entries()]
      .map(([reasonCode, count]) => ({ reasonCode, label: REASON_LABELS[reasonCode] ?? reasonCode, count }))
      .sort((a, b) => b.count - a.count);

    const durations = inRange
      .filter((c) => HUMAN_DECIDED.has(c.status) && c.decidedAt && c.steps.some((s) => s.stepType !== 'SAMPLE_AUDIT'))
      .map((c) => (Date.parse(c.decidedAt) - Date.parse(c.submittedAt)) / HOUR_MS)
      .filter((h) => h >= 0);
    const avgApprovalHours = durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null;

    const queues = { manager: 0, auditor: 0, financeHead: 0, sampleAudit: 0, total: 0 };
    for (const claim of db.claims) {
      if (departmentId && claim.departmentId !== departmentId) continue;
      for (const step of claim.steps) {
        if (step.status !== 'PENDING') continue;
        if (step.stepType === 'MANAGER') queues.manager += 1;
        else if (step.stepType === 'AUDITOR') queues.auditor += 1;
        else if (step.stepType === 'FINANCE_HEAD') queues.financeHead += 1;
        else if (step.stepType === 'SAMPLE_AUDIT') queues.sampleAudit += 1;
      }
    }
    queues.total = queues.manager + queues.auditor + queues.financeHead + queues.sampleAudit;

    // The alert is organisation-wide; the department filter only narrows the "oldest pending" card.
    const globalOldest = oldestPendingStep(db, now, null);
    const threshold = policy.overdueThresholdHours;
    const active = Boolean(globalOldest && globalOldest.ageHours > threshold);
    if (active) {
      if (!db.alertState?.openedAt) {
        db.alertState = { openedAt: toIso(Date.parse(globalOldest.pendingSince) + threshold * HOUR_MS), claimId: globalOldest.claimId };
      }
    } else if (db.alertState) {
      db.alertState = null;
    }

    return {
      range: { from: rangeFrom, to: rangeTo, departmentId: departmentId ?? null, departmentName: departmentId ? departmentName(db, departmentId) : null },
      totals: { approvedSpend: fromPaise(approvedSpend), pendingAmount: fromPaise(pendingAmount), claimsSubmitted: inRange.length },
      spendByCategory: CATEGORIES.map((c) => ({ category: c.code, categoryName: c.name, amount: fromPaise(byCategory.get(c.code) ?? 0) })),
      spendByDepartment: db.departments
        .map((d) => ({ departmentId: d.id, departmentName: d.name, amount: fromPaise(byDepartment.get(d.id) ?? 0) }))
        .filter((d) => !departmentId || d.departmentId === departmentId)
        .sort((a, b) => toPaise(b.amount) - toPaise(a.amount)),
      spendByMonth: months.map((month) => ({ month, amount: fromPaise(byMonth.get(month) ?? 0) })),
      violations: { total: byReason.reduce((s, r) => s + r.count, 0), byReason },
      avgApprovalHours,
      queues,
      oldestPending: oldestPendingStep(db, now, departmentId || null),
      approvalAgeAlert: {
        active,
        thresholdHours: threshold,
        openedAt: active ? db.alertState.openedAt : null,
        claimNumber: active ? globalOldest.claimNumber : null,
        ageHours: active ? globalOldest.ageHours : null,
      },
    };
  });
}
