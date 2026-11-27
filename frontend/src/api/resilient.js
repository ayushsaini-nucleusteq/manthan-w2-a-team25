/**
 * Real API first, mock API as backup.
 *
 * Each session records where it came from (`session.source`: 'http' | 'mock'):
 * - Signed in against the backend → every call goes to ./http/*.js.
 * - Backend unreachable at sign-in → the demo picker signs in to the mock, and every call uses ./mock/*.js.
 * - Backend stops answering mid-session (network error, timeout, 502/503/504, or 500 on a read)
 *   → that call and the rest of the session switch to mock data as the same persona role,
 *   and subscribers (the shell banner) are told why.
 * Business answers from the backend (400, 401, 403, 404, 409, 422) are passed through, never masked.
 */
import { ApiError } from './errors.js';
import { getSession, setSession } from './session.js';
import { isBackendUnavailable, markBackendDown } from './http/client.js';

const READ_LIKE = /^(get|list|me$|unreadCount|policyPreview)/;

let status = { mode: 'unknown', reason: null, since: null };
const listeners = new Set();

/** @returns {{mode: 'unknown'|'http'|'mock', reason: string|null, since: string|null}} */
export function getBackendStatus() {
  return status;
}

export function subscribeBackendStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setBackendStatus(mode, reason = null) {
  if (status.mode === mode && status.reason === reason) return;
  status = { mode, reason, since: new Date().toISOString() };
  for (const l of listeners) {
    try {
      l(status);
    } catch {
      // ignore listener failures
    }
  }
}

let mockAuthModule = null;
/** Registered by index.js so this module stays free of import cycles. */
export function registerMockAuth(mod) {
  mockAuthModule = mod;
}

const HOME_ROLE = { F1: 'FINANCE_HEAD', A1: 'AUDITOR', M1: 'MANAGER', E1: 'EMPLOYEE' };
const ROLE_RANK = ['FINANCE_HEAD', 'AUDITOR', 'MANAGER', 'EMPLOYEE'];

let switching = null;
/** Replaces a backend session with a mock session for the same email, or a demo persona with the same top role. */
async function ensureMockSession() {
  const current = getSession();
  if (!current || current.source !== 'http' || !mockAuthModule) return;
  if (!switching) {
    switching = (async () => {
      const users = await mockAuthModule.listLoginUsers({ q: '' });
      const email = current.user?.email?.toLowerCase();
      const topRole = HOME_ROLE[current.homeScreen] || ROLE_RANK.find((r) => current.user?.roles?.includes(r)) || 'EMPLOYEE';
      const top = (u) => ROLE_RANK.find((r) => u.roles?.includes(r)) || 'EMPLOYEE';
      const match =
        users.find((u) => u.email?.toLowerCase() === email) ||
        users.find((u) => top(u) === topRole && /@expenseflow\.test$/.test(u.email || '') && /^(employee|manager|auditor|head)@/.test(u.email || '')) ||
        users.find((u) => top(u) === topRole) ||
        users[0];
      const mockSession = await mockAuthModule.login(match.id);
      setSession({ ...mockSession, source: 'mock', fallbackFrom: current.user?.email ?? null });
    })().finally(() => {
      switching = null;
    });
  }
  await switching;
}

/**
 * Builds one API namespace that prefers the http module and falls back to the mock module.
 * @param {string} name     namespace name, for messages
 * @param {object} httpMod  ./http/<module>.js (may be partial)
 * @param {object} mockMod  ./mock/<module>.js
 */
export function resilient(name, httpMod, mockMod) {
  const out = {};
  const keys = new Set([...Object.keys(mockMod || {}), ...Object.keys(httpMod || {})]);
  for (const key of keys) {
    const mockFn = mockMod?.[key];
    const httpFn = httpMod?.[key];
    if (typeof mockFn !== 'function' && typeof httpFn !== 'function') {
      out[key] = mockFn ?? httpFn;
      continue;
    }
    const method = READ_LIKE.test(key) ? 'GET' : 'POST';
    out[key] = async (...args) => {
      const session = getSession();
      if (session?.source !== 'http') {
        if (typeof mockFn === 'function') return mockFn(...args);
        throw new ApiError(501, 'NOT_AVAILABLE', 'This action needs the server, which is not connected.');
      }
      if (typeof httpFn !== 'function') {
        // No adapter for this endpoint yet: serve it from the mock as a backup.
        if (typeof mockFn !== 'function') throw new ApiError(501, 'NOT_AVAILABLE', 'This action is not available yet.');
        await ensureMockSession();
        setBackendStatus('mock', `${name}.${key}: no server adapter yet`);
        return mockFn(...args);
      }
      try {
        const result = await httpFn(...args);
        if (status.mode !== 'http') setBackendStatus('http');
        return result;
      } catch (error) {
        if (!isBackendUnavailable(error, method) || typeof mockFn !== 'function') throw error;
        markBackendDown();
        await ensureMockSession();
        setBackendStatus('mock', `${name}.${key}: ${error.message}`);
        return mockFn(...args);
      }
    };
  }
  return out;
}
