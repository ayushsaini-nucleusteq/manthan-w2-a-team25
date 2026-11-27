/**
 * Session storage for the signed-in user's token.
 *
 * Session shape: { token, user, expiresAt, homeScreen }.
 * Kept in sessionStorage (per tab, cleared when the tab closes) with an
 * in-memory fallback when storage is blocked (private mode, sandboxed frames).
 * Both the mock and a future http client read the token from here.
 */

const SESSION_KEY = 'expenseflow.session';

let memorySession = null;
const listeners = new Set();

function storage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function emit(session) {
  for (const listener of listeners) {
    try {
      listener(session);
    } catch {
      // A failing listener must not break the others.
    }
  }
}

/** @returns {{token: string, user: object, expiresAt: string, homeScreen?: string}|null} */
export function getSession() {
  const store = storage();
  if (store) {
    try {
      const raw = store.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw);
      return memorySession;
    } catch {
      return memorySession;
    }
  }
  return memorySession;
}

/** Stores the session returned by login(). */
export function setSession(session) {
  memorySession = session ?? null;
  const store = storage();
  if (store) {
    try {
      if (session) store.setItem(SESSION_KEY, JSON.stringify(session));
      else store.removeItem(SESSION_KEY);
    } catch {
      // Storage full or blocked: the in-memory copy still works for this tab.
    }
  }
  emit(memorySession);
}

/** Removes the session (logout, expired token). */
export function clearSession() {
  setSession(null);
}

/** The bearer token, or null when signed out. */
export function getToken() {
  return getSession()?.token ?? null;
}

/** True when there is no session or it has passed `expiresAt`. */
export function isSessionExpired(session = getSession(), now = Date.now()) {
  if (!session?.expiresAt) return true;
  return Date.parse(session.expiresAt) <= now;
}

/**
 * Subscribes to session changes made through this module (login, logout,
 * expiry detected by the API). Returns an unsubscribe function.
 */
export function subscribeSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
