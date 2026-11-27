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
export * as authApi from './mock/auth.js';
export * as claimsApi from './mock/claims.js';
export * as approvalsApi from './mock/approvals.js';
export * as delegationsApi from './mock/delegations.js';
export * as auditorApi from './mock/auditor.js';
export * as referenceApi from './mock/reference.js';
export * as policyApi from './mock/policy.js';
export * as dashboardApi from './mock/dashboard.js';
export * as payoutsApi from './mock/payouts.js';
export * as usersApi from './mock/users.js';
export * as notificationsApi from './mock/notifications.js';
export * as auditApi from './mock/audit.js';
export * as devtoolsApi from './mock/devtools.js';

export { ApiError, isApiError, isNotFoundError, isUnauthenticatedError, isConflictError, errorMessage, fieldErrors } from './errors.js';
export { getSession, setSession, clearSession, getToken, isSessionExpired, subscribeSession } from './session.js';
