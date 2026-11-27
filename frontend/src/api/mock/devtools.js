/**
 * Demo tools (user menu → "Demo tools"). Not part of the backend contract;
 * these only exist in the mock.
 */
import { clearObjectUrls } from './receiptArt.js';
import { readFailRate, setLatencyOverride, sleep, writeFailRate } from './runtime.js';
import { resetDb } from './store.js';

/**
 * Throws all demo data away and seeds it again (ids stay the same, so the
 * current session keeps working). Mock only.
 * @returns {Promise<{ok: true}>}
 */
export async function resetMockData() {
  await sleep(300);
  clearObjectUrls();
  resetDb();
  return { ok: true };
}

/**
 * Makes a fraction of requests fail with a 500 (0 turns it off, 0.3 = 30 %). Mock only.
 * @param {number} rate 0–1
 * @returns {number} the stored rate
 */
export function setFailRate(rate) {
  return writeFailRate(rate);
}

/** Current simulated failure rate (0–1). Mock only. */
export function getFailRate() {
  return readFailRate();
}

/**
 * Test hook: fixed latency in ms (0 for none), a [min, max] range, or null
 * for the default 250–700 ms. Mock only.
 */
export function setLatency(value) {
  setLatencyOverride(value);
}
