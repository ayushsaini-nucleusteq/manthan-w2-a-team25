/**
 * Money helpers.
 *
 * The backend sends every money value as a decimal string with two places
 * ("1500.00"). We never do floating-point maths on money: values are turned
 * into integer paise, added or compared as integers, and turned back into
 * strings. These helpers are shared by the UI and the mock API.
 */

/** Largest amount the backend accepts (numeric(12,2) → 10 integer digits). */
export const MAX_MONEY_PAISE = 999999999999;

const STRICT_RE = /^(-)?(\d+)(?:\.(\d*))?$/;
const INPUT_RE = /^(\d*)(?:\.(\d*))?$/;

function stripDecorations(text) {
  return String(text)
    .trim()
    .replace(/^(?:INR|Rs\.?)/i, '')
    .replace(/[\s,₹]/g, '');
}

/**
 * Converts a money string ("1500.00", "1,500.5", "₹ 2,000") or a number to
 * integer paise. Empty values (null, undefined, '') count as 0. Invalid input
 * returns NaN. A third decimal place is rounded half away from zero.
 * @param {string|number|null|undefined} value
 * @returns {number}
 */
export function toPaise(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return NaN;
    return toPaise(value.toFixed(6));
  }
  const match = STRICT_RE.exec(stripDecorations(value));
  if (!match) return NaN;
  const [, negative, whole, fraction = ''] = match;
  let paise = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  if (fraction.length > 2 && Number(fraction[2]) >= 5) paise += 1;
  if (!Number.isSafeInteger(paise)) return NaN;
  return negative && paise !== 0 ? -paise : paise;
}

/**
 * Converts integer paise to the backend's decimal string ("1500.00").
 * @param {number} paise
 * @returns {string}
 */
export function fromPaise(paise) {
  const value = Math.round(Number(paise));
  if (!Number.isFinite(value)) {
    throw new RangeError(`fromPaise expects an integer number of paise, got ${paise}`);
  }
  const negative = value < 0;
  const abs = Math.abs(value);
  const rupees = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${rupees}.${rest}`;
}

/**
 * Returns the canonical two-decimal string, or null when the input is invalid.
 * @param {string|number} value
 * @returns {string|null}
 */
export function normalizeMoney(value) {
  const paise = toPaise(value);
  return Number.isNaN(paise) ? null : fromPaise(paise);
}

/** True when the value is already a canonical money string such as "1500.00". */
export function isMoneyString(value) {
  return typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value);
}

function flatten(values) {
  return values.flat(Infinity);
}

/**
 * Adds any number of money values (strings or numbers, arrays allowed).
 * @returns {string}
 */
export function addMoney(...values) {
  let total = 0;
  for (const value of flatten(values)) {
    const paise = toPaise(value);
    if (Number.isNaN(paise)) throw new TypeError(`Invalid money value: ${value}`);
    total += paise;
  }
  return fromPaise(total);
}

/** a − b as a money string. */
export function subtractMoney(a, b) {
  const pa = toPaise(a);
  const pb = toPaise(b);
  if (Number.isNaN(pa) || Number.isNaN(pb)) throw new TypeError(`Invalid money value: ${a}, ${b}`);
  return fromPaise(pa - pb);
}

/**
 * Sums a list of money values, or a list of objects using `key`.
 * @param {Array} items
 * @param {string} [key]
 */
export function sumMoney(items, key) {
  const list = Array.isArray(items) ? items : [];
  return addMoney(...list.map((item) => (key ? item?.[key] : item)));
}

/**
 * Compares two money values: -1 when a < b, 0 when equal, 1 when a > b.
 * @returns {-1|0|1}
 */
export function compareMoney(a, b) {
  const pa = toPaise(a);
  const pb = toPaise(b);
  if (Number.isNaN(pa) || Number.isNaN(pb)) throw new TypeError(`Invalid money value: ${a}, ${b}`);
  if (pa === pb) return 0;
  return pa < pb ? -1 : 1;
}

/**
 * Parses what a user typed into an amount field. Accepts "1500", "1,500.5",
 * "₹ 1,20,000.00" and "1500." and returns the canonical string ("1500.50").
 * Returns null for empty, negative, malformed, too large, or more than two
 * decimal places.
 * @param {string} text
 * @returns {string|null}
 */
export function parseMoneyInput(text) {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') {
    if (!Number.isFinite(text) || text < 0) return null;
    return parseMoneyInput(String(text));
  }
  const cleaned = stripDecorations(text);
  if (cleaned === '' || cleaned === '.') return null;
  const match = INPUT_RE.exec(cleaned);
  if (!match) return null;
  const [, whole = '', fraction = ''] = match;
  if (fraction.length > 2) return null;
  if (whole.replace(/^0+/, '').length > 10) return null;
  const paise = Number(whole || '0') * 100 + Number(`${fraction}00`.slice(0, 2));
  if (!Number.isSafeInteger(paise) || paise > MAX_MONEY_PAISE) return null;
  return fromPaise(paise);
}

/** True when the value parses to an amount greater than zero. */
export function isPositiveMoney(value) {
  const paise = toPaise(value);
  return !Number.isNaN(paise) && paise > 0;
}
