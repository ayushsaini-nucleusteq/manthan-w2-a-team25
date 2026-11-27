/**
 * Request pipeline for the mock API: simulated latency (250–700 ms),
 * failure injection (localStorage 'expenseflow.mock.failRate', 0–1),
 * bearer-token authentication against the session, and copy-on-write
 * transactions so callers never hold references into the store.
 */
import { ApiError } from '../errors.js';
import { clearSession, getSession } from '../session.js';
import { hasAnyRole, userById } from './access.js';
import { getDb, transact } from './store.js';
import { deepClone } from './util.js';

export const FAIL_RATE_KEY = 'expenseflow.mock.failRate';
const SESSION_HOURS = 8;

let latencyOverride = null;

/**
 * Test hook: a number (fixed ms, 0 for none), a [min, max] pair, or null
 * for the default 250–700 ms.
 */
export function setLatencyOverride(value) {
  latencyOverride = value;
}

function latencyMs() {
  if (typeof latencyOverride === 'number') return Math.max(0, latencyOverride);
  if (Array.isArray(latencyOverride)) {
    const [min, max] = latencyOverride;
    return min + Math.random() * Math.max(0, max - min);
  }
  return 250 + Math.random() * 450;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random fraction of the normal latency, for multi-stage progress simulation. */
export function latencySlice(fraction) {
  return latencyMs() * fraction;
}

export function readFailRate() {
  try {
    const raw = globalThis.localStorage?.getItem(FAIL_RATE_KEY);
    const value = raw === null || raw === undefined ? 0 : Number.parseFloat(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  } catch {
    return 0;
  }
}

export function writeFailRate(rate) {
  const value = Math.min(1, Math.max(0, Number(rate) || 0));
  try {
    if (value === 0) globalThis.localStorage?.removeItem(FAIL_RATE_KEY);
    else globalThis.localStorage?.setItem(FAIL_RATE_KEY, String(value));
  } catch {
    // Storage blocked: failure injection is simply unavailable.
  }
  return value;
}

async function preflight() {
  const ms = latencyMs();
  if (ms > 0) await sleep(ms);
  const rate = readFailRate();
  if (rate > 0 && Math.random() < rate) {
    throw new ApiError(500, 'SIMULATED_FAILURE', 'The server could not complete the request (simulated failure). Please try again.');
  }
}

/* ------------------------------------------------------------------ tokens */

function base64UrlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** A JWT-shaped (unsigned) token carrying all of the user's roles. */
export function issueToken(user, now) {
  const exp = now + SESSION_HOURS * 3600 * 1000;
  const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({ sub: user.id, roles: user.roles, iat: Math.floor(now / 1000), exp: Math.floor(exp / 1000) }));
  return { token: `${header}.${payload}.mock`, expiresAt: new Date(exp).toISOString() };
}

function decodeToken(token) {
  try {
    const [, payload] = String(token).split('.');
    return JSON.parse(base64UrlDecode(payload));
  } catch {
    return null;
  }
}

function authenticate(db, now) {
  const session = getSession();
  if (!session?.token) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  const claims = decodeToken(session.token);
  if (!claims?.sub || !claims.exp) {
    clearSession();
    throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  }
  if (claims.exp * 1000 <= now) {
    clearSession();
    throw new ApiError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }
  const user = userById(db, claims.sub);
  if (!user || !user.active) {
    clearSession();
    throw new ApiError(401, 'UNAUTHENTICATED', 'Your account is no longer active. Please sign in again.');
  }
  return user;
}

/* ---------------------------------------------------------------- pipeline */

/**
 * Read-only request.
 * @param {(ctx: {db: object, user: object|null, now: number}) => any} fn
 */
export async function query(fn, { auth = true } = {}) {
  await preflight();
  const db = getDb();
  const now = Date.now();
  const user = auth ? authenticate(db, now) : null;
  return deepClone(fn({ db, user, now }));
}

/**
 * Write request: runs against a draft copy and commits only on success.
 * @param {(ctx: {db: object, user: object|null, now: number}) => any} fn
 */
export async function mutate(fn, { auth = true, skipPreflight = false } = {}) {
  if (!skipPreflight) await preflight();
  const now = Date.now();
  const result = transact((db) => {
    const user = auth ? authenticate(db, now) : null;
    return fn({ db, user, now });
  });
  return deepClone(result);
}

/** Role gate: anyone without one of the roles gets "Not found". */
export function requireRole(user, roles, message = 'Not found.') {
  if (!hasAnyRole(user, roles)) throw new ApiError(404, 'NOT_FOUND', message);
}

export function notFound(message = 'Not found.') {
  return new ApiError(404, 'NOT_FOUND', message);
}

/** Simulated latency + failure check without touching the store (used by uploads). */
export async function simulateNetwork() {
  await preflight();
}
