/**
 * Policy engine (mirrors the backend's evaluation rules).
 *
 * Per line: limit rule (meals per day across in-scope lines, hotel per night
 * by city tier, cab per trip; categories without a rule ROUTE with
 * NO_POLICY_RULE), duplicate receipt by SHA-256 (any employee, AUTO_REJECT),
 * duplicate entry (same employee + vendor key + amount + date, ROUTE) and the
 * weekend flag (ROUTE). The line outcome is its worst finding; the claim
 * outcome is its worst line. Submit blockers are never findings.
 */
import { fromPaise, toPaise } from '../../utils/money.js';
import { OUT_OF_SCOPE_STATUSES, OUTCOME_RANK, CATEGORY_CODES } from './constants.js';
import { daysBetween, displayDate, fnv1a, inr, isValidIsoDate, isWeekend, normalizeKey } from './util.js';

const UNIT_TEXT = { PER_DAY: 'per day', PER_NIGHT: 'per night', PER_TRIP: 'per trip' };

/** Policy version in force at an instant (latest version created at or before it). */
export function policyAt(db, atMs) {
  let best = null;
  let oldest = null;
  for (const version of db.policyVersions) {
    if (!oldest || version.versionNo < oldest.versionNo) oldest = version;
    if (Date.parse(version.createdAt) <= atMs && (!best || version.versionNo > best.versionNo)) best = version;
  }
  return best ?? oldest;
}

/** Current version = highest version number. */
export function currentPolicy(db) {
  return db.policyVersions.reduce((best, v) => (!best || v.versionNo > best.versionNo ? v : best), null);
}

export function isTier1City(policy, city) {
  const key = normalizeKey(city);
  return Boolean(key) && policy.tier1Cities.some((c) => normalizeKey(c) === key);
}

/** The limit rule that applies to a line, or null (→ NO_POLICY_RULE). */
export function ruleForLine(policy, line) {
  if (line.category === 'HOTEL') {
    const tier = isTier1City(policy, line.city) ? 'TIER1' : 'OTHER';
    return (
      policy.rules.find((r) => r.category === 'HOTEL' && (r.cityTier ?? 'OTHER') === tier) ??
      policy.rules.find((r) => r.category === 'HOTEL') ??
      null
    );
  }
  return policy.rules.find((r) => r.category === line.category) ?? null;
}

/**
 * Lines in scope for duplicate and meals checks: lines of other claims in
 * SUBMITTED or a later status (SENT_BACK included; not DRAFT, AUTO_REJECTED,
 * REJECTED), plus earlier lines (lower line_no) of the claim being evaluated.
 */
function scopeEntries(db, claim, line) {
  const entries = [];
  for (const other of db.claims) {
    if (other.id === claim.id || OUT_OF_SCOPE_STATUSES.has(other.status)) continue;
    for (const l of other.lines) entries.push({ claim: other, line: l });
  }
  for (const l of claim.lines) {
    if (l.id !== line.id && l.lineNo < line.lineNo) entries.push({ claim, line: l });
  }
  return entries;
}

function baseFinding(fields) {
  return {
    ruleCode: null,
    ruleName: null,
    reasonCode: null,
    outcome: 'AUTO_APPROVE',
    message: '',
    limitType: null,
    unit: null,
    limitValue: null,
    actualValue: null,
    excessValue: null,
    matchedClaimId: null,
    matchedClaimNumber: null,
    matchedLineId: null,
    matchedLineNo: null,
    matchedEmployeeId: null,
    ...fields,
  };
}

function describeValue(line, rule, actualPaise) {
  if (rule.unit === 'PER_DAY') return `Meals on ${displayDate(line.expenseDate)} total ${inr(fromPaise(actualPaise))}`;
  if (rule.unit === 'PER_NIGHT') {
    const nights = Number(line.nights) || 1;
    return `Hotel in ${line.city || 'this city'} costs ${inr(fromPaise(actualPaise))} per night (${inr(line.amount)} for ${nights} night${nights === 1 ? '' : 's'})`;
  }
  return `This trip costs ${inr(fromPaise(actualPaise))}`;
}

function limitFinding(db, claim, line, policy, entries) {
  const rule = ruleForLine(policy, line);
  const amountPaise = toPaise(line.amount);
  if (!rule) {
    return baseFinding({
      ruleCode: 'NO_POLICY_RULE',
      ruleName: 'No policy rule',
      reasonCode: 'NO_POLICY_RULE',
      outcome: 'ROUTE',
      message: `There is no spending limit for ${line.category ? line.category.toLowerCase().replace('_', ' ') : 'this category'}, so a person must approve it.`,
      actualValue: fromPaise(amountPaise),
    });
  }
  let actualPaise = amountPaise;
  if (rule.unit === 'PER_DAY') {
    for (const entry of entries) {
      if (
        entry.claim.employeeId === claim.employeeId &&
        entry.line.category === line.category &&
        entry.line.expenseDate === line.expenseDate
      ) {
        actualPaise += toPaise(entry.line.amount);
      }
    }
  } else if (rule.unit === 'PER_NIGHT') {
    const nights = Math.max(1, Number(line.nights) || 1);
    actualPaise = Math.round(amountPaise / nights);
  }
  const softPaise = toPaise(rule.softLimit);
  const hardPaise = toPaise(rule.hardLimit);
  const unitText = UNIT_TEXT[rule.unit] ?? '';
  const valueText = describeValue(line, rule, actualPaise);
  const common = { ruleCode: rule.code, ruleName: rule.name, unit: rule.unit, actualValue: fromPaise(actualPaise) };
  if (actualPaise > hardPaise) {
    return baseFinding({
      ...common,
      reasonCode: 'HARD_LIMIT_EXCEEDED',
      outcome: 'AUTO_REJECT',
      limitType: 'HARD',
      limitValue: fromPaise(hardPaise),
      excessValue: fromPaise(actualPaise - hardPaise),
      message: `${valueText}: ${inr(fromPaise(actualPaise - hardPaise))} over the ${inr(rule.hardLimit)} hard limit ${unitText}. Rejected automatically.`,
    });
  }
  if (actualPaise > softPaise) {
    return baseFinding({
      ...common,
      reasonCode: 'SOFT_LIMIT_EXCEEDED',
      outcome: 'ROUTE',
      limitType: 'SOFT',
      limitValue: fromPaise(softPaise),
      excessValue: fromPaise(actualPaise - softPaise),
      message: `${valueText}: ${inr(fromPaise(actualPaise - softPaise))} over the ${inr(rule.softLimit)} limit ${unitText}. Needs approval.`,
    });
  }
  return baseFinding({
    ...common,
    reasonCode: 'WITHIN_LIMIT',
    outcome: 'AUTO_APPROVE',
    limitType: 'SOFT',
    limitValue: fromPaise(softPaise),
    excessValue: '0.00',
    message: `${valueText}, within the ${inr(rule.softLimit)} limit ${unitText}.`,
  });
}

/**
 * Evaluates one line (stored or draft) against a policy version.
 * The line needs a `lineNo`; a draft line gets the next number.
 * @returns {{outcome: string, findings: object[], flags: string[]}}
 */
export function evaluateLine(db, claim, line, policy) {
  const entries = scopeEntries(db, claim, line);
  const findings = [limitFinding(db, claim, line, policy, entries)];

  const sha = line.receipt?.sha256;
  if (sha) {
    const match = entries.find((e) => e.line.receipt?.sha256 === sha);
    if (match) {
      const sameEmployee = match.claim.employeeId === claim.employeeId;
      findings.push(
        baseFinding({
          ruleCode: 'DUPLICATE_RECEIPT',
          ruleName: 'Duplicate receipt',
          reasonCode: 'DUPLICATE_RECEIPT',
          outcome: 'AUTO_REJECT',
          actualValue: fromPaise(toPaise(line.amount)),
          message: sameEmployee
            ? `The same receipt file is already on line ${match.line.lineNo} of ${match.claim.claimNumber}.`
            : "This receipt file matches a receipt on another employee's claim.",
          matchedClaimId: match.claim.id,
          matchedClaimNumber: match.claim.claimNumber,
          matchedLineId: match.line.id,
          matchedLineNo: match.line.lineNo,
          matchedEmployeeId: match.claim.employeeId,
        }),
      );
    }
  }

  const vendorKey = normalizeKey(line.vendor);
  const amountPaise = toPaise(line.amount);
  if (vendorKey) {
    const match = entries.find(
      (e) =>
        e.claim.employeeId === claim.employeeId &&
        normalizeKey(e.line.vendor) === vendorKey &&
        toPaise(e.line.amount) === amountPaise &&
        e.line.expenseDate === line.expenseDate,
    );
    if (match) {
      findings.push(
        baseFinding({
          ruleCode: 'DUPLICATE',
          ruleName: 'Possible duplicate entry',
          reasonCode: 'DUPLICATE',
          outcome: 'ROUTE',
          actualValue: fromPaise(amountPaise),
          message: `Same vendor, amount and date as line ${match.line.lineNo} of ${match.claim.claimNumber}.`,
          matchedClaimId: match.claim.id,
          matchedClaimNumber: match.claim.claimNumber,
          matchedLineId: match.line.id,
          matchedLineNo: match.line.lineNo,
          matchedEmployeeId: match.claim.employeeId,
        }),
      );
    }
  }

  if (policy.weekendFlagEnabled && isValidIsoDate(line.expenseDate) && isWeekend(line.expenseDate)) {
    findings.push(
      baseFinding({
        ruleCode: 'WEEKEND',
        ruleName: 'Weekend expense',
        reasonCode: 'WEEKEND_EXPENSE',
        outcome: 'ROUTE',
        actualValue: fromPaise(amountPaise),
        message: `${displayDate(line.expenseDate)} is a weekend, so a person must approve it.`,
      }),
    );
  }

  return { outcome: worstOutcome(findings.map((f) => f.outcome)), findings, flags: flagsFromFindings(findings) };
}

export function worstOutcome(outcomes) {
  let worst = null;
  for (const outcome of outcomes) {
    if (!outcome) continue;
    if (worst === null || OUTCOME_RANK[outcome] > OUTCOME_RANK[worst]) worst = outcome;
  }
  return worst;
}

export function flagsFromFindings(findings) {
  const flags = new Set();
  for (const f of findings ?? []) {
    if (f.reasonCode === 'WEEKEND_EXPENSE') flags.add('WEEKEND');
    if (f.reasonCode === 'DUPLICATE' || f.reasonCode === 'DUPLICATE_RECEIPT') flags.add('DUPLICATE');
    if (f.reasonCode === 'SOFT_LIMIT_EXCEEDED') flags.add('SOFT_LIMIT');
  }
  return [...flags];
}

/** Missing required fields for a line, as human labels. */
export function missingLineFields(line) {
  const missing = [];
  if (!line.category || !CATEGORY_CODES.includes(line.category)) missing.push('category');
  if (!(toPaise(line.amount) > 0)) missing.push('amount');
  if (!isValidIsoDate(line.expenseDate)) missing.push('date');
  if (!String(line.vendor ?? '').trim()) missing.push('vendor');
  if (line.category === 'HOTEL') {
    if (!String(line.city ?? '').trim()) missing.push('city');
    if (!(Number(line.nights) >= 1)) missing.push('nights');
  }
  return missing;
}

/**
 * Submit blockers for one line (422 at submit; never findings).
 * @param {object} line
 * @param {object} policy
 * @param {string} today business date (IST)
 * @param {boolean} [hasReceipt] override for draft-line previews
 */
export function lineBlockers(line, policy, today, hasReceipt = Boolean(line.receipt)) {
  const blockers = [];
  const ref = { lineId: line.id ?? null, lineNo: line.lineNo ?? null };
  const label = line.lineNo ? `Line ${line.lineNo}` : 'This line';
  const missing = missingLineFields(line);
  if (missing.length) {
    blockers.push({ ...ref, code: 'MISSING_FIELDS', message: `${label}: add the ${missing.join(', ')}.` });
  }
  if (isValidIsoDate(line.expenseDate)) {
    if (line.expenseDate > today) {
      blockers.push({ ...ref, code: 'FUTURE_DATE', message: `${label}: the date ${displayDate(line.expenseDate)} is in the future.` });
    } else if (daysBetween(line.expenseDate, today) > policy.submissionWindowDays) {
      blockers.push({
        ...ref,
        code: 'TOO_OLD',
        message: `${label}: expenses older than ${policy.submissionWindowDays} days can't be claimed (dated ${displayDate(line.expenseDate)}).`,
      });
    }
  }
  if (toPaise(line.amount) > toPaise(policy.receiptThreshold) && !hasReceipt) {
    blockers.push({
      ...ref,
      code: 'RECEIPT_REQUIRED',
      message: `${label}: attach a receipt (required above ${inr(policy.receiptThreshold)}).`,
    });
  }
  return blockers;
}

/** All submit blockers for a claim. */
export function claimBlockers(claim, policy, today) {
  const blockers = [];
  if (!String(claim.title ?? '').trim()) {
    blockers.push({ lineId: null, lineNo: null, code: 'MISSING_FIELDS', message: 'Add a claim title.' });
  }
  if (!claim.lines.length) {
    blockers.push({ lineId: null, lineNo: null, code: 'MISSING_FIELDS', message: 'Add at least one expense line.' });
  }
  for (const line of [...claim.lines].sort((a, b) => a.lineNo - b.lineNo)) {
    blockers.push(...lineBlockers(line, policy, today));
  }
  return blockers;
}

/**
 * Lines hash used for resubmit routing: changes when amount, category,
 * date, vendor, city or nights change, or lines are added or removed.
 */
export function linesHash(claim) {
  const parts = [...claim.lines]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => [l.id, l.category, String(toPaise(l.amount)), l.expenseDate, normalizeKey(l.vendor), normalizeKey(l.city), l.nights ?? ''].join('|'));
  return fnv1a(parts.join('\n'));
}

/** Sum of line amounts in paise. */
export function claimTotalPaise(claim) {
  return claim.lines.reduce((sum, l) => sum + toPaise(l.amount), 0);
}

/**
 * Evaluates lines in line order the way submit does: lines flagged
 * needsEvaluation get fresh results, the others keep their stored findings.
 * Each fresh result is visible to later lines (meals day total).
 * Returns per-line results without touching the claim.
 */
export function evaluateClaimLines(db, claim, policy, { forceAll = false } = {}) {
  const ordered = [...claim.lines].sort((a, b) => a.lineNo - b.lineNo);
  return ordered.map((line) => {
    if (!forceAll && !line.needsEvaluation && line.policyOutcome) {
      return { line, outcome: line.policyOutcome, findings: line.findings, flags: line.flags ?? flagsFromFindings(line.findings), fresh: false };
    }
    const result = evaluateLine(db, claim, line, policy);
    return { line, ...result, fresh: true };
  });
}
