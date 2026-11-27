/**
 * Deterministic seed data (mulberry32(2026)).
 *
 * Claims are not written as finished rows: each one is created, filled and
 * submitted through the same workflow code the API uses, at past
 * timestamps, so findings, chains, sample blocks, audit events and
 * notifications are all consistent with the business rules.
 *
 * Bump SEED_VERSION whenever the seed changes; stored data with another
 * version is thrown away and reseeded.
 */
import { fromPaise, toPaise } from '../../utils/money.js';
import { pendingApprovalStep, stepActors, userById } from './access.js';
import { addLineCore, attachReceiptCore, createClaimCore, updateLineCore } from './claimCore.js';
import { CATEGORIES, OUT_OF_SCOPE_STATUSES, STATUS } from './constants.js';
import { appendAudit } from './events.js';
import { createBatchCore, exportBatchCore, isPayoutEligible, markPaidCore } from './payoutCore.js';
import {
  DAY_MS,
  HOUR_MS,
  addDays,
  createRng,
  isWeekend,
  isoDateIST,
  istDateTimeMs,
  toIso,
  withDeterministicSource,
} from './util.js';
import { decideCore, sampleDecisionCore, submitCore } from './workflow.js';

export const SEED_VERSION = '2026-11-27.3';

const TIER1 = ['Ahmedabad', 'Bengaluru', 'Chennai', 'Delhi', 'Hyderabad', 'Kolkata', 'Mumbai', 'Pune'];
const OTHER_CITIES = ['Jaipur', 'Kochi', 'Indore', 'Lucknow', 'Coimbatore', 'Bhubaneswar', 'Nagpur', 'Chandigarh', 'Mysuru', 'Visakhapatnam'];

const DEPARTMENTS = [
  ['ENG', 'Engineering'],
  ['SAL', 'Sales'],
  ['MKT', 'Marketing'],
  ['FIN', 'Finance'],
  ['HR', 'HR'],
  ['OPS', 'Operations'],
  ['CS', 'Customer Success'],
  ['LEG', 'Legal'],
];

const MANAGERS = {
  ENG: ['Ravi Kumar', 'manager@expenseflow.test'],
  SAL: ['Sabita Rao', 'manager2@expenseflow.test'],
  MKT: ['Neha Kapoor'],
  FIN: ['Suresh Pillai'],
  HR: ['Anita Desai'],
  OPS: ['Rajesh Verma'],
  CS: ['Deepa Krishnan'],
  LEG: ['Manoj Bhatt'],
};

/** Employees per department, Priya included in Engineering (48 in total). */
const HEADCOUNT = { ENG: 8, SAL: 8, MKT: 6, FIN: 4, HR: 4, OPS: 7, CS: 6, LEG: 4 };

const FIRST_NAMES = [
  'Aarav', 'Ananya', 'Rohan', 'Sneha', 'Karthik', 'Divya', 'Aditya', 'Pooja', 'Siddharth', 'Nisha', 'Varun', 'Shreya',
  'Rahul', 'Kavya', 'Manish', 'Ishita', 'Nikhil', 'Tanvi', 'Abhishek', 'Riya', 'Harish', 'Lakshmi', 'Gaurav', 'Swati',
  'Pranav', 'Meghna', 'Vivek', 'Anjali', 'Sandeep', 'Bhavna', 'Rakesh', 'Shalini', 'Amit', 'Nandini', 'Kunal', 'Aparna',
  'Tarun', 'Sunita', 'Imran', 'Farah', 'Joseph', 'Sara', 'Gurpreet', 'Harpreet', 'Arnav', 'Diya', 'Yash', 'Zoya',
];
const LAST_NAMES = [
  'Sharma', 'Reddy', 'Patel', 'Gupta', 'Menon', 'Das', 'Banerjee', 'Chatterjee', 'Singh', 'Mehta', 'Joshi', 'Kulkarni',
  'Bose', 'Agarwal', 'Malhotra', 'Saxena', 'Khan', 'Fernandes', 'Mishra', 'Chauhan', 'Bhatia', 'Ghosh', 'Hegde', 'Shetty',
];

const VENDORS = {
  MEALS: ['Spice Route Kitchen', 'Udupi Grand Cafe', 'Green Leaf Bistro', 'Coastal Curry House', 'Masala Junction', 'Annapoorna Meals', 'Tandoor Tales', 'The Filter Coffee House', 'Biryani Bay', 'Chaat Street Corner'],
  HOTEL: ['Lakeview Residency', 'Grand Orchid Suites', 'Harbour Inn', 'City Park Hotel', 'Silver Oak Stay', 'Palm Grove Business Hotel', 'Skyline Comfort Inn'],
  LOCAL_CAB: ['CityRide Cabs', 'MetroGo Taxi', 'QuickWheels', 'Airport Shuttle Co', 'GreenMile EV Cabs'],
  AIRFARE: ['SkyWays Air', 'BlueJet Airlines', 'AeroBharat', 'Horizon Air Travel Desk'],
  TRAIN: ['RailConnect Booking', 'Express Rail Travel Desk'],
  OTHER: ['TechSummit Conference Pass', 'Office Supplies Depot', 'PrintPoint Services', 'Courier Express', 'Workspace Day Pass'],
};

const CLIENTS = ['Northwind Retail', 'Bluepeak Logistics', 'Greenfield Pharma', 'Orbit Telecom', 'Sunrise Foods', 'Crestline Motors', 'Riverstone Bank', 'Apex Textiles'];
const SMALL_TITLES = ['Client visit – {city}', 'Customer workshop in {city}', 'Local client meetings', 'Vendor review meeting', 'Site visit – {city}', 'Recruitment drive – {city}', 'Team offsite logistics', 'Partner demo in {city}'];
const BIG_TITLES = ['Quarterly business review – {city}', 'Sales conference – {city}', 'Partner summit in {city}', 'Product launch roadshow', 'Annual kickoff travel – {city}', 'Leadership training – {city}'];
const SEND_BACK_COMMENTS = [
  'Please attach the hotel invoice with the GST details.',
  "The cab receipt doesn't match the amount on line 2. Please check.",
  'Split the team dinner by attendee and add their names in the notes.',
  'The airfare is higher than the travel desk quote. Please add a justification.',
  "Please correct the trip dates; they don't match the expense dates.",
];
const REJECT_REASONS = [
  'Personal travel is not reimbursable under the travel policy.',
  'This conference was not pre-approved by the department.',
  'Already reimbursed through the corporate card statement.',
  'Alcohol and entertainment are not covered by the policy.',
];
const REPLIES = ['Added the invoice and corrected the amount.', 'Attached the missing receipts as requested.', 'Updated the notes with the attendee names.'];
const APPROVE_NOTES = ['Approved. Thanks for the detailed notes.', 'Looks good.', 'Approved as discussed in the review.'];

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function policyRules(cabHard) {
  return [
    { code: 'MEALS_DAILY', name: 'Meals per day', category: 'MEALS', unit: 'PER_DAY', cityTier: null, softLimit: '1500.00', hardLimit: '3000.00' },
    { code: 'HOTEL_NIGHTLY_TIER1', name: 'Hotel per night (tier-1 city)', category: 'HOTEL', unit: 'PER_NIGHT', cityTier: 'TIER1', softLimit: '6000.00', hardLimit: '12000.00' },
    { code: 'HOTEL_NIGHTLY_OTHER', name: 'Hotel per night (other city)', category: 'HOTEL', unit: 'PER_NIGHT', cityTier: 'OTHER', softLimit: '4000.00', hardLimit: '8000.00' },
    { code: 'LOCAL_CAB_TRIP', name: 'Local cab per trip', category: 'LOCAL_CAB', unit: 'PER_TRIP', cityTier: null, softLimit: '2000.00', hardLimit: cabHard },
  ];
}

function policyVersion(versionNo, { createdAt, createdBy, changeNote, cabHard }) {
  return {
    versionNo,
    changeNote,
    createdBy,
    createdAt,
    receiptThreshold: '500.00',
    weekendFlagEnabled: true,
    overdueThresholdHours: 48,
    autoApproveMaxTotal: '25000.00',
    auditorAboveTotal: '25000.00',
    financeHeadAboveTotal: '100000.00',
    samplePercent: 10,
    submissionWindowDays: 60,
    rules: policyRules(cabHard),
    tier1Cities: [...TIER1],
  };
}

/** Builds a fresh database for "now". Deterministic apart from the timestamps. */
export function buildSeed(nowMs) {
  const rng = createRng(2026);
  const now = Math.floor(nowMs / 60000) * 60000;
  return withDeterministicSource(rng, () => generate(rng, now));
}

function generate(rng, now) {
  const today = isoDateIST(now);
  const db = {
    meta: { seedVersion: SEED_VERSION, seededAt: toIso(now), schema: 1, seedWarnings: [] },
    seq: { claim: 120, batch: 0, audit: 0 },
    departments: [],
    users: [],
    categories: CATEGORIES.map((c) => ({ ...c })),
    policyVersions: [],
    claims: [],
    delegations: [],
    notifications: [],
    payoutBatches: [],
    auditEvents: [],
    sampleBlock: null,
    alertState: null,
  };

  /* ------------------------------------------------------- departments */
  const dept = {};
  for (const [code, name] of DEPARTMENTS) {
    const d = { id: rng.uuid(), code, name };
    db.departments.push(d);
    dept[code] = d;
  }

  /* ------------------------------------------------------------- users */
  let codeSeq = 1000;
  const usedEmails = new Set();
  const createdAt = toIso(now - 400 * DAY_MS);
  const ifscPrefixes = ['EFBK', 'NBNK', 'CTYB', 'SBNK', 'UNBK'];
  function addUser({ fullName, email, deptCode, roles, managerId = null }) {
    codeSeq += 1;
    let mail = email ?? `${slug(fullName).replace(/-/g, '.')}@expenseflow.test`;
    while (usedEmails.has(mail)) mail = mail.replace('@', `${rng.int(1, 9)}@`);
    usedEmails.add(mail);
    const user = {
      id: rng.uuid(),
      email: mail,
      fullName,
      employeeCode: `EF${codeSeq}`,
      departmentId: dept[deptCode].id,
      managerId,
      roles,
      active: true,
      bankAccountNumber: `${rng.int(1, 9)}${rng.hex(11).replace(/[a-f]/g, () => String(rng.int(0, 9)))}`,
      ifscCode: `${rng.pick(ifscPrefixes)}0${rng.hex(6).toUpperCase()}`,
      version: 0,
      createdAt,
      updatedAt: createdAt,
    };
    db.users.push(user);
    return user;
  }

  const head = addUser({ fullName: 'Vikram Shah', email: 'head@expenseflow.test', deptCode: 'FIN', roles: ['EMPLOYEE', 'FINANCE_HEAD'] });
  const auditors = [
    addUser({ fullName: 'Meera Iyer', email: 'auditor@expenseflow.test', deptCode: 'FIN', roles: ['EMPLOYEE', 'AUDITOR'], managerId: head.id }),
    addUser({ fullName: 'Arjun Menon', deptCode: 'FIN', roles: ['EMPLOYEE', 'AUDITOR'], managerId: head.id }),
    addUser({ fullName: 'Kavita Joshi', deptCode: 'FIN', roles: ['EMPLOYEE', 'AUDITOR'], managerId: head.id }),
  ];
  const managers = {};
  for (const [code] of DEPARTMENTS) {
    const [fullName, email] = MANAGERS[code];
    managers[code] = addUser({ fullName, email, deptCode: code, roles: ['EMPLOYEE', 'MANAGER'], managerId: head.id });
  }
  const priya = addUser({ fullName: 'Priya Nair', email: 'employee@expenseflow.test', deptCode: 'ENG', roles: ['EMPLOYEE'], managerId: managers.ENG.id });
  const employeesByDept = { ENG: [priya] };
  const firstNames = rng.shuffle(FIRST_NAMES);
  let nameIndex = 0;
  for (const [code] of DEPARTMENTS) {
    employeesByDept[code] = employeesByDept[code] ?? [];
    while (employeesByDept[code].length < HEADCOUNT[code]) {
      const fullName = `${firstNames[nameIndex % firstNames.length]} ${rng.pick(LAST_NAMES)}`;
      nameIndex += 1;
      employeesByDept[code].push(addUser({ fullName, deptCode: code, roles: ['EMPLOYEE'], managerId: managers[code].id }));
    }
  }
  const leaver = employeesByDept.OPS[employeesByDept.OPS.length - 1];
  const plainEmployees = Object.values(employeesByDept).flat().filter((u) => u.id !== priya.id && u.id !== leaver.id);
  const managerList = Object.values(managers);

  /* ---------------------------------------------------------- policies */
  db.policyVersions.push(
    policyVersion(1, { createdAt: toIso(now - 200 * DAY_MS), createdBy: null, changeNote: 'Initial policy', cabHard: '4000.00' }),
  );
  const v2At = now - 61 * DAY_MS;
  db.policyVersions.push(
    policyVersion(2, {
      createdAt: toIso(v2At),
      createdBy: head.id,
      changeNote: 'Raised the local cab hard limit from ₹4,000 to ₹5,000 per trip for longer airport runs.',
      cabHard: '5000.00',
    }),
  );
  appendAudit(db, {
    now: v2At,
    actorId: head.id,
    action: 'POLICY_PUBLISHED',
    entityType: 'POLICY',
    entityId: '2',
    details: { versionNo: 2, basedOnVersionNo: 1, changes: { 'LOCAL_CAB_TRIP.hardLimit': { from: '4000.00', to: '5000.00' } } },
  });

  /* ------------------------------------------------------- delegations */
  function addDelegation(delegator, delegate, startsOn, endsOn, reason, createdMs, revokedMs = null) {
    const d = {
      id: rng.uuid(),
      delegatorId: delegator.id,
      delegateId: delegate.id,
      startsOn,
      endsOn,
      reason,
      createdAt: toIso(createdMs),
      revokedAt: revokedMs ? toIso(revokedMs) : null,
    };
    db.delegations.push(d);
    appendAudit(db, {
      now: createdMs,
      actorId: delegator.id,
      action: 'DELEGATION_CREATED',
      entityType: 'DELEGATION',
      entityId: d.id,
      details: { delegateName: delegate.fullName, startsOn, endsOn },
    });
    if (revokedMs) {
      appendAudit(db, { now: revokedMs, actorId: delegator.id, action: 'DELEGATION_REVOKED', entityType: 'DELEGATION', entityId: d.id });
    }
  }
  addDelegation(managers.MKT, managers.OPS, addDays(today, -50), addDays(today, -45), 'Family function', now - 52 * DAY_MS);
  addDelegation(managers.CS, managers.ENG, addDays(today, -20), addDays(today, -15), 'Customer onsite in Singapore', now - 22 * DAY_MS, now - 18 * DAY_MS);
  addDelegation(managers.SAL, managers.ENG, addDays(today, -1), addDays(today, 5), 'Annual leave', now - 2 * DAY_MS);

  /* ------------------------------------------------------------- timing */
  const latest = () => now - rng.int(8, 90) * 60000;
  function atDaysAgo(days) {
    const day = addDays(today, -Math.floor(days));
    const ms = istDateTimeMs(day, rng.int(9, 19), rng.int(0, 59));
    return Math.min(ms, latest());
  }
  function atHoursAgo(hours) {
    return now - Math.round(hours * HOUR_MS) - rng.int(0, 50) * 60000;
  }
  function later(ms, minH, maxH) {
    const target = ms + rng.int(minH * 60, maxH * 60) * 60000;
    return Math.max(ms + 60000, Math.min(target, latest()));
  }

  /* ----------------------------------------------------- line builders */
  const mealsUsed = new Map();
  function mealsRoom(ownerId, date) {
    return 140000 - (mealsUsed.get(`${ownerId}|${date}`) ?? 0);
  }
  function recordMeals(ownerId, date, amount) {
    const key = `${ownerId}|${date}`;
    mealsUsed.set(key, (mealsUsed.get(key) ?? 0) + toPaise(amount));
  }
  function money(min, max) {
    return fromPaise(rng.int(min, max) * 100 + (rng.chance(0.3) ? rng.pick([50, 20, 75, 40]) : 0));
  }
  function pickDate(ctx, { weekend = false, minBack = 1, maxBack = 24 } = {}) {
    let date = addDays(ctx.createDay, -rng.int(minBack, maxBack));
    if (weekend) {
      while (!isWeekend(date)) date = addDays(date, -1);
    } else {
      while (isWeekend(date)) date = addDays(date, -1);
    }
    return date;
  }
  function mealLine(ctx, { min = 250, max = 1100, weekend = false } = {}) {
    for (let i = 0; i < 25; i += 1) {
      const amount = money(min, max);
      const date = pickDate(ctx, { weekend });
      if (toPaise(amount) <= mealsRoom(ctx.owner.id, date)) {
        recordMeals(ctx.owner.id, date, amount);
        return { category: 'MEALS', amount, expenseDate: date, vendor: rng.pick(VENDORS.MEALS), notes: rng.chance(0.4) ? 'Working lunch with the client team' : null };
      }
    }
    return null;
  }
  function cabLine(ctx, min = 180, max = 1800) {
    return { category: 'LOCAL_CAB', amount: money(min, max), expenseDate: pickDate(ctx), vendor: rng.pick(VENDORS.LOCAL_CAB), notes: rng.chance(0.5) ? 'Airport to client office' : null };
  }
  function hotelLine(ctx, { tier1 = rng.chance(0.6), nightsMin = 1, nightsMax = 2, perMin, perMax } = {}) {
    const city = tier1 ? ctx.city1 : ctx.city2;
    const nights = rng.int(nightsMin, nightsMax);
    const per = rng.int(perMin ?? (tier1 ? 3200 : 2400), perMax ?? (tier1 ? 5600 : 3800));
    return { category: 'HOTEL', amount: fromPaise(per * nights * 100), expenseDate: pickDate(ctx, { minBack: 2 }), vendor: rng.pick(VENDORS.HOTEL), notes: null, city, nights };
  }
  function simpleLine(ctx, category, min, max, notes = null) {
    return { category, amount: money(min, max), expenseDate: pickDate(ctx), vendor: rng.pick(VENDORS[category]), notes };
  }
  function cleanLines(ctx, count = rng.int(1, 3)) {
    const lines = [];
    let hotelUsed = false;
    for (let i = 0; i < count; i += 1) {
      const kind = rng.pick(['MEALS', 'LOCAL_CAB', 'HOTEL', 'MEALS', 'LOCAL_CAB']);
      if (kind === 'HOTEL' && !hotelUsed) {
        hotelUsed = true;
        lines.push(hotelLine(ctx));
      } else if (kind === 'MEALS') {
        const meal = mealLine(ctx);
        lines.push(meal ?? cabLine(ctx));
      } else {
        lines.push(cabLine(ctx));
      }
    }
    return lines;
  }

  /** In-scope lines (with receipts) from claims already processed. */
  function scopedLines(filter) {
    const out = [];
    for (const claim of db.claims) {
      if (OUT_OF_SCOPE_STATUSES.has(claim.status)) continue;
      for (const line of claim.lines) if (filter(claim, line)) out.push({ claim, line });
    }
    return out;
  }

  /** Builds the lines of a claim for a profile. */
  function buildLines(profile, ctx) {
    switch (profile) {
      case 'clean':
        return cleanLines(ctx);
      case 'empty':
        return [];
      case 'noReceipt': {
        const lines = cleanLines(ctx, 1);
        lines.push({ ...simpleLine(ctx, 'OTHER', 900, 2400, 'Printing of workshop material'), noReceipt: true });
        return lines;
      }
      case 'noRule': {
        const lines = cleanLines(ctx, rng.int(1, 2));
        const which = rng.pick(['TRAIN', 'OTHER', 'AIRFARE']);
        if (which === 'AIRFARE') lines.push(simpleLine(ctx, 'AIRFARE', 3500, 11000, 'Return flight booked by the travel desk'));
        else if (which === 'TRAIN') lines.push(simpleLine(ctx, 'TRAIN', 600, 3200, '2AC return ticket'));
        else lines.push(simpleLine(ctx, 'OTHER', 400, 2500, 'Printing and courier'));
        return lines;
      }
      case 'weekend': {
        const lines = cleanLines(ctx, rng.int(1, 2));
        const meal = mealLine(ctx, { weekend: true, min: 300, max: 900 });
        lines.push(meal ?? { ...cabLine(ctx), expenseDate: pickDate(ctx, { weekend: true }) });
        return lines;
      }
      case 'soft': {
        const lines = cleanLines(ctx, rng.int(1, 2));
        const which = rng.pick(['MEALS', 'LOCAL_CAB', 'HOTEL']);
        if (which === 'MEALS') lines.push(mealLine(ctx, { min: 1650, max: 2700 }) ?? cabLine(ctx, 2200, 3600));
        else if (which === 'LOCAL_CAB') lines.push(cabLine(ctx, 2200, 3600));
        else lines.push(hotelLine(ctx, { tier1: true, nightsMin: 1, nightsMax: 1, perMin: 6300, perMax: 10500 }));
        return lines;
      }
      case 'route':
        return buildLines(rng.pick(['noRule', 'weekend', 'soft', 'noRule']), ctx);
      case 'midClean': {
        const lines = [hotelLine(ctx, { tier1: true, nightsMin: 6, nightsMax: 8, perMin: 4700, perMax: 5800 })];
        lines.push(cabLine(ctx, 400, 1500), cabLine(ctx, 400, 1500));
        const meal = mealLine(ctx, { min: 400, max: 900 });
        if (meal) lines.push(meal);
        return lines;
      }
      case 'midRoute': {
        const lines = [simpleLine(ctx, 'AIRFARE', 9000, 26000, 'Return flight'), hotelLine(ctx, { tier1: rng.chance(0.7), nightsMin: 3, nightsMax: 6 })];
        const meal = mealLine(ctx, { min: 400, max: 1000 });
        if (meal) lines.push(meal);
        const total = lines.reduce((s, l) => s + toPaise(l.amount), 0);
        if (total <= 2600000) lines.push(simpleLine(ctx, 'OTHER', 8000, 15000, 'Conference registration'));
        return lines;
      }
      case 'large': {
        const lines = [
          simpleLine(ctx, 'AIRFARE', 22000, 34000, 'Return flight with date change'),
          hotelLine(ctx, { tier1: true, nightsMin: 5, nightsMax: 7, perMin: 4500, perMax: 5800 }),
          simpleLine(ctx, 'OTHER', 9000, 15000, 'Trade fair stall share'),
        ];
        const meal = mealLine(ctx, { min: 400, max: 900 });
        if (meal) lines.push(meal);
        return lines;
      }
      case 'big': {
        const lines = [
          simpleLine(ctx, 'AIRFARE', 48000, 72000, 'International return flight'),
          hotelLine(ctx, { tier1: true, nightsMin: 8, nightsMax: 10, perMin: 4800, perMax: 5900 }),
          simpleLine(ctx, 'OTHER', 12000, 20000, 'Conference registration'),
        ];
        const total = lines.reduce((s, l) => s + toPaise(l.amount), 0);
        if (total <= 10100000) lines.push(simpleLine(ctx, 'OTHER', 15000, 22000, 'Workshop fee'));
        return lines;
      }
      case 'hard': {
        const lines = cleanLines(ctx, rng.int(1, 2));
        const which = rng.pick(['HOTEL', 'LOCAL_CAB', 'MEALS']);
        if (which === 'HOTEL') lines.push(hotelLine(ctx, { tier1: true, nightsMin: 1, nightsMax: 1, perMin: 12600, perMax: 16000 }));
        else if (which === 'LOCAL_CAB') lines.push(cabLine(ctx, 5300, 6800));
        else lines.push(mealLine(ctx, { min: 3200, max: 4200 }) ?? cabLine(ctx, 5300, 6800));
        return lines;
      }
      case 'dupReceiptForeign':
      case 'dupReceiptOwn': {
        const own = profile === 'dupReceiptOwn';
        const sources = scopedLines((c, l) => Boolean(l.receipt) && (own ? c.employeeId === ctx.owner.id : c.employeeId !== ctx.owner.id) && l.expenseDate <= ctx.createDay && l.expenseDate >= addDays(ctx.createDay, -50));
        if (!sources.length) return cleanLines(ctx);
        const source = rng.pick(sources);
        const lines = cleanLines(ctx, 1);
        lines.push({
          category: source.line.category,
          amount: source.line.amount,
          expenseDate: source.line.expenseDate,
          vendor: source.line.vendor,
          notes: null,
          city: source.line.city,
          nights: source.line.nights,
          copyReceipt: source.line.receipt,
        });
        return lines;
      }
      case 'dupEntry': {
        const sources = scopedLines((c, l) => c.employeeId === ctx.owner.id && l.category !== 'MEALS' && l.expenseDate <= ctx.createDay && l.expenseDate >= addDays(ctx.createDay, -50));
        if (!sources.length) return buildLines('weekend', ctx);
        const source = rng.pick(sources);
        const lines = cleanLines(ctx, 1);
        lines.push({
          category: source.line.category,
          amount: source.line.amount,
          expenseDate: source.line.expenseDate,
          vendor: `  ${source.line.vendor.toUpperCase()} `,
          notes: 'Second visit the same day',
          city: source.line.city,
          nights: source.line.nights,
        });
        return lines;
      }
      default:
        return cleanLines(ctx);
    }
  }

  function makeReceipt(line, owner, ms) {
    const vendorSlug = slug(line.vendor).slice(0, 24) || 'receipt';
    return {
      id: rng.uuid(),
      fileName: `scan-${vendorSlug}-${line.expenseDate}.svg`,
      contentType: 'image/svg+xml',
      sizeBytes: rng.int(38000, 240000),
      sha256: rng.hex(64),
      uploadedAt: toIso(ms),
      uploadedBy: owner.id,
      storageKey: `seed/${rng.hex(16)}`,
      art: { vendor: line.vendor, date: line.expenseDate, amount: line.amount, category: line.category, nights: line.nights ?? null, city: line.city ?? null, seedKey: rng.hex(8) },
    };
  }

  function copyReceipt(receipt, owner, ms) {
    return { ...receipt, id: rng.uuid(), uploadedAt: toIso(ms), uploadedBy: owner.id, storageKey: `seed/${rng.hex(16)}`, fileName: `IMG_${receipt.art?.date?.replace(/-/g, '') ?? 'scan'}.svg` };
  }

  /* --------------------------------------------------------------- plans */
  const plans = [];
  const warnings = db.meta.seedWarnings;
  function plan(owner, path, profile, when, extra = {}) {
    plans.push({ owner, path, profile, when, ...extra });
  }
  const days = (d) => atDaysAgo(d);
  const hours = (h) => atHoursAgo(h);
  const anyOf = (list) => () => rng.pick(list);
  /** Picks, at run time, an owner who already has recent in-scope lines matching `predicate`. */
  function ownerWithRecentLines(pool, predicate) {
    return (when) => {
      const day = isoDateIST(when);
      const from = addDays(day, -45);
      const candidates = pool.filter((u) =>
        db.claims.some(
          (c) =>
            c.employeeId === u.id &&
            !OUT_OF_SCOPE_STATUSES.has(c.status) &&
            c.lines.some((l) => predicate(l) && l.expenseDate >= from && l.expenseDate < addDays(day, -1)),
        ),
      );
      return rng.pick(candidates.length ? candidates : pool);
    };
  }

  // Priya Nair (employee@): at least one claim in every status.
  plan(priya, 'draft', 'noReceipt', hours(20), { title: 'Bengaluru customer workshop' });
  plan(priya, 'draft', 'empty', hours(3), { title: 'Pune sprint planning trip' });
  plan(priya, 'auto', 'clean', days(34));
  plan(priya, 'auto', 'clean', days(9));
  plan(priya, 'pendingManager', 'weekend', hours(70), { title: 'Hackathon weekend support' });
  plan(priya, 'pendingManager', 'dupEntry', hours(26));
  plan(priya, 'resubmitted', 'soft', days(6), { changeLines: false });
  plan(priya, 'pendingAuditor', 'midRoute', days(5));
  plan(priya, 'pendingHead', 'big', days(8), { title: 'Global engineering summit – Mumbai' });
  plan(priya, 'sentBack', 'soft', days(3));
  plan(priya, 'rejected', 'noRule', days(27));
  plan(priya, 'autoRejected', 'hard', days(19));
  plan(priya, 'autoRejected', 'dupReceiptForeign', days(4));
  plan(priya, 'approved', 'noRule', days(12));
  plan(priya, 'approved', 'midClean', days(24));
  plan(priya, 'approved', 'noRule', days(15), { batch: 'EXPORTED' });
  plan(priya, 'approved', 'noRule', days(55), { batch: 'PAID' });

  // Vikram Shah (head@): no manager → auditor is the final approver; auto-approvals are always sampled.
  plan(head, 'auto', 'clean', days(40));
  plan(head, 'auto', 'clean', days(16));
  plan(head, 'auto', 'clean', days(2));
  plan(head, 'pendingManager', 'noRule', hours(30), { title: 'Board meeting travel – Delhi' });
  plan(head, 'approved', 'noRule', days(70));

  // Ravi's direct inbox (Engineering), some overdue.
  const engOthers = employeesByDept.ENG.filter((u) => u.id !== priya.id);
  [70, 55, 8, 100, 30, 5, 140].forEach((h, i) => {
    plan(engOthers[i % engOthers.length], 'pendingManager', rng.pick(['route', 'soft', 'weekend', 'noRule']), hours(h));
  });
  // Sabita's inbox (Sales): shown to Ravi as delegated items.
  [20, 64, 9, 110].forEach((h, i) => {
    plan(employeesByDept.SAL[i], 'pendingManager', rng.pick(['route', 'soft', 'noRule']), hours(h));
  });
  // Other departments.
  for (const [i, code] of ['MKT', 'FIN', 'HR', 'OPS', 'CS', 'LEG', 'OPS', 'MKT'].entries()) {
    plan(rng.pick(employeesByDept[code].filter((u) => u.id !== leaver.id)), 'pendingManager', 'route', hours([12, 75, 30, 52, 6, 90, 40, 18][i]));
  }
  // Managers and an auditor waiting for the finance head (manager step).
  plan(managers.SAL, 'pendingManager', 'noRule', hours(28));
  plan(managers.MKT, 'pendingManager', 'soft', hours(60));
  plan(auditors[0], 'pendingManager', 'noRule', hours(14));
  plan(anyOf(plainEmployees), 'resubmitted', 'noRule', days(5), { changeLines: true });

  // Auditor queue: bands 25K–50K, 50K–1L and 1L+ across departments.
  const queueDepts = ['SAL', 'MKT', 'OPS', 'CS', 'LEG', 'HR', 'FIN', 'SAL', 'OPS', 'MKT', 'CS', 'ENG'];
  const queueProfiles = ['midClean', 'midRoute', 'midClean', 'large', 'midClean', 'midRoute', 'midClean', 'big', 'large', 'midClean', 'big', 'large'];
  queueDepts.forEach((code, i) => {
    const pool = employeesByDept[code].filter((u) => u.id !== priya.id && u.id !== leaver.id);
    plan(rng.pick(pool), 'pendingAuditor', queueProfiles[i], days(1 + (i % 9)));
  });
  plan(rng.pick(employeesByDept.SAL), 'pendingHead', 'big', days(6));
  plan(rng.pick(employeesByDept.OPS.filter((u) => u.id !== leaver.id)), 'pendingHead', 'big', days(9));

  // Sent back, rejected and auto-rejected.
  for (let i = 0; i < 4; i += 1) plan(anyOf(plainEmployees), 'sentBack', 'route', days(1 + i * 2));
  for (let i = 0; i < 2; i += 1) plan(anyOf(plainEmployees), 'sentBack', 'midRoute', days(3 + i * 3), { atStep: 'AUDITOR' });
  for (let i = 0; i < 4; i += 1) plan(anyOf(plainEmployees), 'rejected', 'route', days(rng.int(8, 160)));
  for (let i = 0; i < 2; i += 1) plan(anyOf(plainEmployees), 'rejected', 'midRoute', days(rng.int(10, 120)), { atStep: 'AUDITOR' });
  for (let i = 0; i < 5; i += 1) plan(anyOf(plainEmployees), 'autoRejected', 'hard', days(rng.int(3, 170)));
  for (let i = 0; i < 2; i += 1) plan(anyOf(plainEmployees), 'autoRejected', 'dupReceiptForeign', days(rng.int(3, 90)));
  for (let i = 0; i < 2; i += 1) plan(ownerWithRecentLines(plainEmployees, (l) => Boolean(l.receipt)), 'autoRejected', 'dupReceiptOwn', days(rng.int(3, 60)));

  // Approved history (≤ 25k mostly, some mid and big).
  const approvedOwners = [...plainEmployees, ...plainEmployees, ...managerList, ...auditors];
  for (let i = 0; i < 35; i += 1) plan(anyOf(approvedOwners), 'approved', 'route', days(rng.int(3, 175)));
  for (let i = 0; i < 7; i += 1) plan(anyOf(plainEmployees), 'approved', rng.pick(['midClean', 'midRoute']), days(rng.int(5, 170)));
  for (let i = 0; i < 3; i += 1) plan(anyOf(plainEmployees), 'approved', 'big', days(rng.int(20, 160)));
  plan(leaver, 'approved', 'noRule', days(150));
  plan(leaver, 'approved', 'noRule', days(120));

  // Auto-approved history (feeds the sample blocks).
  const autoOwners = [...plainEmployees, ...plainEmployees, ...plainEmployees, ...managerList, ...auditors];
  for (let i = 0; i < 83; i += 1) plan(anyOf(autoOwners), 'auto', 'clean', days(rng.int(1, 178)));

  // Drafts.
  for (let i = 0; i < 10; i += 1) plan(anyOf(plainEmployees), 'draft', rng.pick(['clean', 'noReceipt', 'route']), days(rng.int(0, 12)));

  /* ----------------------------------------------------------- runner */
  const tracked = { batchPaid: [], batchExported: [] };

  function actorFor(claim, step, at) {
    if (step.assigneeId) return userById(db, step.assigneeId);
    const candidates = stepActors(db, claim, step, at).map((a) => userById(db, a.userId));
    return candidates.length ? rng.pick(candidates) : null;
  }

  function runPlan(p) {
    const owner = typeof p.owner === 'function' ? p.owner(p.when) : p.owner;
    const submitMs = p.when;
    const createMs = p.path === 'draft' ? submitMs : submitMs - rng.int(1, 18) * HOUR_MS;
    const ctx = {
      owner,
      createDay: isoDateIST(createMs),
      city1: rng.pick(TIER1),
      city2: rng.pick(OTHER_CITIES),
    };
    const specs = buildLines(p.profile, ctx).filter(Boolean);
    const big = ['midClean', 'midRoute', 'big'].includes(p.profile);
    const title = p.title ?? rng.pick(big ? BIG_TITLES : SMALL_TITLES).replace('{city}', ctx.city1);
    const dates = specs.map((s) => s.expenseDate).sort();
    const claim = createClaimCore(
      db,
      owner,
      {
        title,
        purpose: `Met ${rng.pick(CLIENTS)} to discuss ${rng.pick(['the renewal', 'the rollout plan', 'next quarter priorities', 'an escalation', 'the pilot results'])}.`,
        tripStartDate: dates[0] ?? null,
        tripEndDate: dates[dates.length - 1] ?? null,
      },
      createMs,
    );
    specs.forEach((spec, i) => {
      const at = createMs + (i + 1) * 60000;
      const { copyReceipt: source, noReceipt, ...input } = spec;
      const line = addLineCore(db, claim, owner, input, at);
      if (noReceipt) return;
      if (source) attachReceiptCore(db, claim, owner, line.id, copyReceipt(source, owner, at), at);
      else if (toPaise(line.amount) > 50000 || rng.chance(0.6)) attachReceiptCore(db, claim, owner, line.id, makeReceipt(line, owner, at), at);
    });
    if (p.path === 'draft') return claim;

    let t = submitMs;
    submitCore(db, claim, owner, { comment: rng.chance(0.2) ? 'Submitted with all receipts attached.' : null, now: t });

    const act = (decision, text, minH = 2, maxH = 30) => {
      const step = pendingApprovalStep(claim);
      if (!step) return false;
      t = later(t, minH, maxH);
      const actor = actorFor(claim, step, t);
      if (!actor) return false;
      decideCore(db, claim, actor, { decision, comment: text, now: t });
      return true;
    };
    const approveUntil = (stepType) => {
      let guard = 0;
      while (pendingApprovalStep(claim) && pendingApprovalStep(claim).stepType !== stepType && guard < 5) {
        act('APPROVE', rng.chance(0.25) ? rng.pick(APPROVE_NOTES) : null);
        guard += 1;
      }
    };

    switch (p.path) {
      case 'pendingAuditor':
        approveUntil('AUDITOR');
        break;
      case 'pendingHead':
        approveUntil('FINANCE_HEAD');
        break;
      case 'approved': {
        let guard = 0;
        while (pendingApprovalStep(claim) && guard < 5) {
          act('APPROVE', rng.chance(0.25) ? rng.pick(APPROVE_NOTES) : null, 2, 36);
          guard += 1;
        }
        break;
      }
      case 'sentBack':
        approveUntil(p.atStep ?? 'MANAGER');
        act('SEND_BACK', rng.pick(SEND_BACK_COMMENTS));
        break;
      case 'rejected':
        approveUntil(p.atStep ?? 'MANAGER');
        act('REJECT', rng.pick(REJECT_REASONS));
        break;
      case 'resubmitted': {
        act('SEND_BACK', rng.pick(SEND_BACK_COMMENTS), 2, 20);
        if (claim.status === STATUS.SENT_BACK) {
          t = later(t, 2, 20);
          if (p.changeLines && claim.lines.length) {
            const line = claim.lines[claim.lines.length - 1];
            updateLineCore(db, claim, owner, line.id, { amount: fromPaise(Math.max(10000, toPaise(line.amount) - 25000)) }, t);
          }
          submitCore(db, claim, owner, { comment: rng.pick(REPLIES), now: t });
        }
        break;
      }
      default:
        break;
    }

    const expected = {
      auto: [STATUS.AUTO_APPROVED],
      pendingManager: [STATUS.PENDING_MANAGER, STATUS.PENDING_AUDITOR],
      resubmitted: [STATUS.PENDING_MANAGER, STATUS.PENDING_AUDITOR],
      pendingAuditor: [STATUS.PENDING_AUDITOR],
      pendingHead: [STATUS.PENDING_FINANCE_HEAD],
      approved: [STATUS.APPROVED],
      sentBack: [STATUS.SENT_BACK],
      rejected: [STATUS.REJECTED],
      autoRejected: [STATUS.AUTO_REJECTED],
    }[p.path];
    if (expected && !expected.includes(claim.status)) {
      warnings.push(`${claim.claimNumber} (${owner.fullName}) ${p.path}/${p.profile} ended as ${claim.status}`);
    }
    if (p.batch === 'PAID') tracked.batchPaid.push(claim.id);
    if (p.batch === 'EXPORTED') tracked.batchExported.push(claim.id);
    return claim;
  }

  plans.sort((a, b) => a.when - b.when);
  for (const p of plans) {
    try {
      runPlan(p);
    } catch (error) {
      if (error?.name !== 'ApiError') throw error;
      warnings.push(`plan ${p.path}/${p.profile} failed: ${error.message}`);
    }
  }

  /* ---------------------------------------------- resolve older samples */
  const sampled = db.claims
    .filter((c) => c.sampleAudit && c.sampleAuditStatus === 'PENDING')
    .sort((a, b) => b.sampledAt.localeCompare(a.sampledAt));
  const olderSamples = sampled.slice(7);
  olderSamples.forEach((claim, i) => {
    const decision = i === 0 ? 'SEND_BACK' : i === 1 ? 'REJECT' : 'CLEAR';
    const auditor = rng.pick(auditors.filter((a) => a.id !== claim.employeeId));
    const at = later(Date.parse(claim.sampledAt), 20, 90);
    const text =
      decision === 'SEND_BACK'
        ? 'Sample audit: the meal receipt is unreadable. Please upload a clearer copy.'
        : decision === 'REJECT'
          ? 'Sample audit: the receipt belongs to a personal purchase.'
          : rng.chance(0.4)
            ? 'Receipts verified.'
            : null;
    sampleDecisionCore(db, claim, auditor, { decision, text, now: at });
  });

  /* -------------------------------------------------------------- payouts */
  function eligibleAt(ms) {
    return db.claims
      .filter(
        (c) =>
          isPayoutEligible(c) &&
          c.decidedAt &&
          Date.parse(c.decidedAt) < ms - DAY_MS &&
          (!c.sampleAudit || (c.sampleAuditedAt && Date.parse(c.sampleAuditedAt) < ms)),
      )
      .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
  }
  function runBatch(createdMs, forced, max, paid) {
    const ids = new Set(forced.filter((id) => eligibleAt(createdMs).some((c) => c.id === id)));
    for (const c of eligibleAt(createdMs)) {
      if (ids.size >= max) break;
      ids.add(c.id);
    }
    if (!ids.size) return;
    const batch = createBatchCore(db, head, [...ids], createdMs);
    exportBatchCore(db, head, batch, createdMs + 2 * HOUR_MS);
    if (paid) markPaidCore(db, head, batch, { confirm: true, bankReference: `UTR${rng.int(100000, 999999)}${rng.int(100000, 999999)}` }, createdMs + 2 * DAY_MS);
  }
  runBatch(now - 40 * DAY_MS, tracked.batchPaid, 45, true);
  runBatch(now - 4 * DAY_MS, tracked.batchExported, 14, false);

  /* ------------------------------------------------------- sign-in history */
  for (const persona of [priya, managers.ENG, auditors[0], head, managers.SAL]) {
    for (let i = 0; i < 3; i += 1) {
      appendAudit(db, { now: atHoursAgo(rng.int(4, 24 * 14)), actorId: persona.id, action: 'LOGIN', entityType: 'USER', entityId: persona.id, details: { method: 'DEMO_PICKER' } });
    }
  }

  /* ------------------------------------------------------------ finishing */
  leaver.active = false;
  leaver.version += 1;
  leaver.updatedAt = toIso(now - 30 * DAY_MS);
  appendAudit(db, {
    now: now - 30 * DAY_MS,
    actorId: head.id,
    action: 'USER_UPDATED',
    entityType: 'USER',
    entityId: leaver.id,
    details: { changes: { active: { from: true, to: false } } },
  });

  const threeDaysAgo = now - 3 * DAY_MS;
  for (const n of db.notifications) {
    if (Date.parse(n.createdAt) < threeDaysAgo) n.readAt = toIso(Date.parse(n.createdAt) + HOUR_MS);
  }
  db.notifications.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Audit ids follow time order (they were written out of order by the plans).
  db.auditEvents.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id - b.id);
  db.auditEvents.forEach((e, i) => {
    e.id = i + 1;
  });
  db.seq.audit = db.auditEvents.length;
  return db;
}
