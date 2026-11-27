/**
 * HTTP transport for the Spring Boot backend (docs/api/openapi.yaml on `develop`).
 *
 * - Base URL: `VITE_API_BASE_URL` (default http://localhost:8080; the backend's
 *   CORS allows http://localhost:5173 via FRONTEND_ORIGIN).
 * - Sends `Authorization: Bearer <token>` when the current session came from the backend.
 * - Turns the backend's single error shape {status, error, message, path, requestId, errors[]}
 *   into the frontend's ApiError(status, code, message, details).
 * - A network failure or timeout throws ApiError(0, 'BACKEND_UNAVAILABLE'), which the
 *   resilient layer (../resilient.js) uses to fall back to the mock API.
 */
import { ApiError } from '../errors.js';
import { getSession } from '../session.js';

function env(name) {
  try {
    return import.meta.env?.[name];
  } catch {
    return undefined;
  }
}

export const API_BASE_URL = String(env('VITE_API_BASE_URL') ?? 'http://localhost:8080').replace(/\/+$/, '');
const DEFAULT_TIMEOUT_MS = Number(env('VITE_API_TIMEOUT_MS')) || 12000;

const CODE_BY_STATUS = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'BUSINESS_RULE',
  500: 'SERVER_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

/** True when the error means "the backend could not be used" (not a business answer). */
export function isBackendUnavailable(error, method = 'GET') {
  if (!error || typeof error.status !== 'number') return false;
  if (error.status === 0) return true;
  if ([502, 503, 504].includes(error.status)) return true;
  // A 500 on a read is treated as "endpoint not working"; on a write it is a real failure.
  return error.status === 500 && method === 'GET';
}

function unavailable(message, cause) {
  const err = new ApiError(0, 'BACKEND_UNAVAILABLE', message || 'The server could not be reached.', { cause: String(cause ?? '') });
  return err;
}

function buildUrl(path, query) {
  const url = new URL(API_BASE_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '' || value === 'ALL') continue;
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, String(v)));
      else url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function toApiError(status, body, fallbackMessage) {
  const message = (body && typeof body.message === 'string' && body.message) || fallbackMessage || `Request failed (${status}).`;
  const details = {};
  if (body?.requestId) details.requestId = body.requestId;
  if (Array.isArray(body?.errors) && body.errors.length) {
    // 422 from submit: line-level blockers.
    details.blockers = body.errors.map((e) => ({
      lineId: e.lineId ?? null,
      lineNo: e.lineNo ?? null,
      field: e.field ?? null,
      code: e.code,
      message: e.message,
    }));
    const fields = {};
    for (const e of body.errors) if (e.field && !e.lineId) fields[e.field] = e.message;
    if (Object.keys(fields).length) details.fields = fields;
  }
  if (body?.fieldErrors && typeof body.fieldErrors === 'object') details.fields = { ...(details.fields || {}), ...body.fieldErrors };
  let code = CODE_BY_STATUS[status] || 'HTTP_ERROR';
  if (status === 422 && details.blockers) code = 'SUBMIT_BLOCKED';
  return new ApiError(status, code, message, Object.keys(details).length ? details : null);
}

/**
 * @param {string} method
 * @param {string} path   e.g. '/api/claims'
 * @param {{query?: object, body?: any, form?: FormData, auth?: boolean, timeoutMs?: number,
 *          responseType?: 'json'|'text'|'blob'|'response', headers?: object, signal?: AbortSignal}} [opts]
 */
export async function request(method, path, opts = {}) {
  const { query, body, form, auth = true, timeoutMs = DEFAULT_TIMEOUT_MS, responseType = 'json', headers = {} } = opts;
  const init = { method, headers: { Accept: 'application/json', ...headers } };
  if (auth) {
    const session = getSession();
    if (session?.token && session.source === 'http') init.headers.Authorization = `Bearer ${session.token}`;
  }
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (opts.signal) opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  init.signal = controller.signal;

  let res;
  try {
    res = await fetch(buildUrl(path, query), init);
  } catch (cause) {
    throw unavailable(controller.signal.aborted ? 'The server took too long to respond.' : 'The server could not be reached.', cause);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    throw toApiError(res.status, parsed, res.statusText);
  }

  if (responseType === 'response') return res;
  if (res.status === 204) return null;
  if (responseType === 'text') return res.text();
  if (responseType === 'blob') return res.blob();
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const get = (path, opts) => request('GET', path, opts);
export const post = (path, body, opts) => request('POST', path, { ...opts, body });
export const put = (path, body, opts) => request('PUT', path, { ...opts, body });
export const patch = (path, body, opts) => request('PATCH', path, { ...opts, body });
export const del = (path, opts) => request('DELETE', path, opts);

let probeCache = { at: 0, up: null, pending: null };

/**
 * Is the backend reachable? Uses the public actuator health endpoint, cached for 20 s.
 * @param {{force?: boolean}} [opts]
 */
export async function probeBackend({ force = false } = {}) {
  const now = Date.now();
  if (!force && probeCache.up !== null && now - probeCache.at < 20000) return probeCache.up;
  if (probeCache.pending) return probeCache.pending;
  probeCache.pending = (async () => {
    try {
      await request('GET', '/actuator/health', { auth: false, timeoutMs: 3000 });
      return true;
    } catch (error) {
      // Any HTTP answer (even 503 "DOWN") means the server process is there; only DOWN/unreachable counts as down.
      return Boolean(error && error.status && error.status < 500);
    }
  })().then((up) => {
    probeCache = { at: Date.now(), up, pending: null };
    return up;
  });
  return probeCache.pending;
}

/** Marks the backend as down after a failed call, so the next probe re-checks. */
export function markBackendDown() {
  probeCache = { at: Date.now(), up: false, pending: null };
}
