/**
 * API entry point. Pages import namespaces from here:
 *
 *   import { claimsApi, isApiError } from '../../api';
 *   const claim = await claimsApi.getClaim(id);
 *
 * Every function is async and throws ApiError (status 400/401/403/404/409/
 * 422/500, `code`, `details`). Money values are decimal strings ("1500.00").
 *
 * ── Swapping to the real backend ────────────────────────────────────────
 * Today each namespace re-exports a mock module from ./mock/*.js that keeps
 * its data in localStorage. To use the Spring backend:
 *   1. Add src/api/http.js with a small `request(method, path, {query, body})`
 *      helper that prefixes `import.meta.env.VITE_API_BASE_URL`, sends
 *      `Authorization: Bearer ${getToken()}` from ./session.js, and turns
 *      non-2xx responses into `new ApiError(status, body.code, body.message, body.details)`.
 *   2. Add src/api/http/<module>.js files exporting the same function names
 *      and arguments as the mock modules; each mock function's JSDoc names the
 *      endpoint it mirrors (e.g. claims.getClaim → GET /api/claims/{id}).
 *   3. Point the exports below at ./http/*.js (or choose per module with
 *      `import.meta.env.VITE_USE_MOCK_API`). Pages don't change.
 *   devtoolsApi stays mock-only.
 */
import * as mockAuth from './mock/auth.js';
import * as mockClaims from './mock/claims.js';
import * as mockApprovals from './mock/approvals.js';
import * as mockDelegations from './mock/delegations.js';
import * as mockAuditor from './mock/auditor.js';
import * as mockReference from './mock/reference.js';
import * as mockPolicy from './mock/policy.js';
import * as mockDashboard from './mock/dashboard.js';
import * as mockPayouts from './mock/payouts.js';
import * as mockUsers from './mock/users.js';
import * as mockNotifications from './mock/notifications.js';
import * as mockAudit from './mock/audit.js';
import * as httpAuth from './http/auth.js';
import { isBackendUnavailable, markBackendDown, probeBackend } from './http/client.js';
import { registerMockAuth, resilient, setBackendStatus } from './resilient.js';
import { getSession, setSession } from './session.js';

// Real endpoint adapters: every ./http/<module>.js that exists is used; a module without one
// (or a function it does not implement) is served from the mock, so pages never break.
const HTTP = import.meta.glob('./http/*.js', { eager: true });
const httpModule = (name) => HTTP[`./http/${name}.js`] || {};

registerMockAuth(mockAuth);

export const claimsApi = resilient('claims', httpModule('claims'), mockClaims);
export const approvalsApi = resilient('approvals', httpModule('approvals'), mockApprovals);
export const delegationsApi = resilient('delegations', httpModule('delegations'), mockDelegations);
export const auditorApi = resilient('auditor', httpModule('auditor'), mockAuditor);
export const referenceApi = resilient('reference', httpModule('reference'), mockReference);
export const policyApi = resilient('policy', httpModule('policy'), mockPolicy);
export const dashboardApi = resilient('dashboard', httpModule('dashboard'), mockDashboard);
export const payoutsApi = resilient('payouts', httpModule('payouts'), mockPayouts);
export const usersApi = resilient('users', httpModule('users'), mockUsers);
export const notificationsApi = resilient('notifications', httpModule('notifications'), mockNotifications);
export const auditApi = resilient('audit', httpModule('audit'), mockAudit);
export * as devtoolsApi from './mock/devtools.js';

const resilientMe = resilient('auth', { me: httpAuth.me }, { me: mockAuth.me }).me;

/** Sign-in: email + password against the backend, or the demo picker over mock data. */
export const authApi = {
  probeBackend,
  isDemoLoginEnabled: mockAuth.isDemoLoginEnabled,
  listLoginUsers: (args) => mockAuth.listLoginUsers(args),
  async login(userId) {
    const session = { ...(await mockAuth.login(userId)), source: 'mock' };
    setSession(session);
    setBackendStatus('mock', 'Demo sign-in');
    return session;
  },
  async loginWithPassword(email, password) {
    try {
      const session = await httpAuth.loginWithPassword(email, password);
      setBackendStatus('http');
      return session;
    } catch (error) {
      if (isBackendUnavailable(error, 'POST')) markBackendDown();
      throw error;
    }
  },
  me: resilientMe,
  logout: () => (getSession()?.source === 'http' ? httpAuth.logout() : mockAuth.logout()),
};

export { getBackendStatus, subscribeBackendStatus } from './resilient.js';

export { ApiError, isApiError, isNotFoundError, isUnauthenticatedError, isConflictError, errorMessage, fieldErrors } from './errors.js';
export { getSession, setSession, clearSession, getToken, isSessionExpired, subscribeSession } from './session.js';
