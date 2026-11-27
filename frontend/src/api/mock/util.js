/**
 * Small helpers shared by the mock back end: random numbers, ids, business
 * dates (Asia/Kolkata), key normalisation, cloning and display formatting.
 */
import { toPaise } from '../../utils/money.js';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
const IST_OFFSET_MS = 330 * 60 * 1000;

/* ------------------------------------------------------------------ random */

/** mulberry32: tiny deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatUuid(bytes) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Seeded random helper used by the seed so the data is identical on every load. */
export function createRng(seed) {
  const next = mulberry32(seed);
  const rng = {
    next,
    /** Integer in [min, max], inclusive. */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(p) {
      return next() < p;
    },
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    shuffle(list) {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    hex(length) {
      let out = '';
      while (out.length < length) out += Math.floor(next() * 0x100000000).toString(16).padStart(8, '0');
      return out.slice(0, length);
    },
    uuid() {
      const bytes = new Uint8Array(16);
      for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(next() * 256);
      return formatUuid(bytes);
    },
  };
  return rng;
}

function cryptoObject() {
  return globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function' ? globalThis.crypto : null;
}

/** Random UUID v4. crypto.randomUUID only exists in secure contexts, so fall back to getRandomValues. */
export function randomUuid() {
  const c = cryptoObject();
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return formatUuid(bytes);
}

/** Unbiased secure integer in [min, max] using crypto.getRandomValues (rejection sampling). */
export function secureRandomInt(min, max) {
  const range = max - min + 1;
  const c = cryptoObject();
  if (!c || range <= 1) return min + Math.floor(Math.random() * Math.max(range, 1));
  const limit = Math.floor(0x100000000 / range) * range;
  const buffer = new Uint32Array(1);
  do {
    c.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return min + (buffer[0] % range);
}

let idFactory = randomUuid;
let intFactory = secureRandomInt;

/** New entity id: random at runtime, deterministic while the seed runs. */
export function newId() {
  return idFactory();
}

/**
 * Random integer in [min, max] for business randomness (the sample-audit
 * position). Uses crypto.getRandomValues at runtime and the seeded PRNG
 * while the seed runs.
 */
export function randomInt(min, max) {
  return intFactory(min, max);
}

/** Runs fn with ids and random integers drawn from a deterministic rng. */
export function withDeterministicSource(rng, fn) {
  const previousId = idFactory;
  const previousInt = intFactory;
  idFactory = () => rng.uuid();
  intFactory = (min, max) => rng.int(min, max);
  try {
    return fn();
  } finally {
    idFactory = previousId;
    intFactory = previousInt;
  }
}

/* ------------------------------------------------------------------- dates */

export function toIso(ms) {
  return new Date(ms).toISOString();
}

/** Business date (YYYY-MM-DD) in Asia/Kolkata for an instant. */
export function isoDateIST(ms) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Instant of a business date at a given IST hour. */
export function istDateTimeMs(isoDate, hour = 9, minute = 0) {
  return Date.parse(`${isoDate}T00:00:00Z`) - IST_OFFSET_MS + hour * HOUR_MS + minute * 60000;
}

export function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export function isWeekend(isoDate) {
  const d = dayOfWeek(isoDate);
  return d === 0 || d === 6;
}

export function hoursBetween(fromMs, toMs) {
  return Math.round(((toMs - fromMs) / HOUR_MS) * 10) / 10;
}

/* ---------------------------------------------------------------- strings */

/** lower(trim(x)) with inner whitespace collapsed (vendor_key, city_key). */
export function normalizeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function deepClone(value) {
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/* ------------------------------------------------------------ formatting */

const inrFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "₹1,20,000.00" for messages written by the mock. */
export function inr(value) {
  return inrFormatter.format(toPaise(value) / 100);
}

/** "27 Nov 2026" for a business date. */
export function displayDate(isoDate) {
  if (!isValidIsoDate(isoDate)) return String(isoDate ?? '');
  return dateFormatter.format(new Date(`${isoDate}T00:00:00Z`));
}

/** FNV-1a 32-bit hash as hex; used for the lines hash and stable picks. */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
