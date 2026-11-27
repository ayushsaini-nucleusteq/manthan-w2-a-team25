/**
 * Error type thrown by every API function (mock and, later, http).
 *
 * status  HTTP status: 400 bad input, 401 signed out / expired, 403 demo login
 *         disabled, 404 not found or not yours, 409 version/state conflict,
 *         422 blocked by a business rule (see `details`), 500 server failure.
 * code    stable machine-readable code, e.g. 'VALIDATION_ERROR', 'SUBMIT_BLOCKED'.
 * details optional object: `{fields: {name: message}}` for 400 validation
 *         errors, `{blockers: [...]}` for a blocked submit, and so on.
 */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} [message]
   * @param {object|null} [details]
   */
  constructor(status, code, message, details = null) {
    super(message || code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }

  toJSON() {
    return { name: this.name, status: this.status, code: this.code, message: this.message, details: this.details };
  }
}

/** True for an ApiError (also across module copies, e.g. after HMR). */
export function isApiError(error) {
  return error instanceof ApiError || (Boolean(error) && error.name === 'ApiError' && typeof error.status === 'number');
}

/** 403 and 404 are both shown as "Not found" (US4-AC3). */
export function isNotFoundError(error) {
  return isApiError(error) && (error.status === 404 || error.status === 403);
}

/** 401: the session is missing or expired; the UI should send the user to sign in. */
export function isUnauthenticatedError(error) {
  return isApiError(error) && error.status === 401;
}

/** 409: someone changed the record, or it is in a state that doesn't allow the action. */
export function isConflictError(error) {
  return isApiError(error) && error.status === 409;
}

/** A user-facing message for any thrown value. */
export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (isApiError(error)) return error.message || fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Field errors from a 400 VALIDATION_ERROR, as `{field: message}` (empty object otherwise). */
export function fieldErrors(error) {
  return (isApiError(error) && error.details && error.details.fields) || {};
}
