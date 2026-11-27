/**
 * S1 sign-in (backend contract). There are no passwords: when demo login is
 * enabled the user picks a person and gets an 8-hour token carrying all of
 * their roles. The in-app role switch only changes which screens show.
 */
import { ApiError } from '../errors.js';
import { clearSession, setSession } from '../session.js';
import { homeScreenFor, userById } from './access.js';
import { appendAudit } from './events.js';
import { issueToken, mutate, query } from './runtime.js';
import { normalizeKey } from './util.js';
import { departmentName, toUser } from './views.js';

function readEnv(name) {
  try {
    const env = import.meta.env;
    return env ? env[name] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Mirrors the server's DEMO_LOGIN_ENABLED flag via VITE_DEMO_LOGIN_ENABLED
 * (default true; "false", "0", "no" and "off" disable it).
 * @returns {boolean}
 */
export function isDemoLoginEnabled() {
  const raw = readEnv('VITE_DEMO_LOGIN_ENABLED');
  if (raw === undefined || raw === null || raw === '') return true;
  return !['false', '0', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

function assertDemoLogin() {
  if (!isDemoLoginEnabled()) {
    throw new ApiError(403, 'DEMO_LOGIN_DISABLED', 'Demo sign-in is turned off on this server.');
  }
}

/**
 * Public user picker: active users only, matched case-insensitively on name
 * or employee code, sorted by name, at most 50.
 * Mirrors `GET /api/auth/users?q=` (public, no token).
 * @param {{q?: string}} [params]
 * @returns {Promise<{id: string, fullName: string, email: string, employeeCode: string, departmentName: string, roles: string[]}[]>}
 */
export async function listLoginUsers({ q } = {}) {
  assertDemoLogin();
  return query(
    ({ db }) => {
      const needle = normalizeKey(q);
      return db.users
        .filter((u) => u.active)
        .filter((u) => !needle || normalizeKey(u.fullName).includes(needle) || normalizeKey(u.employeeCode).includes(needle))
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .slice(0, 50)
        .map((u) => ({
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          employeeCode: u.employeeCode,
          departmentName: departmentName(db, u.departmentId),
          roles: [...u.roles],
        }));
    },
    { auth: false },
  );
}

/**
 * Signs in as the picked user and stores the session (session.js).
 * 404 for an unknown or inactive user. Writes a LOGIN audit event.
 * Mirrors `POST /api/auth/login {userId}`.
 * @param {string} userId
 * @returns {Promise<{token: string, user: object, expiresAt: string, homeScreen: 'F1'|'A1'|'M1'|'E1'}>}
 */
export async function login(userId) {
  assertDemoLogin();
  const session = await mutate(
    ({ db, now }) => {
      const user = userById(db, typeof userId === 'object' && userId ? userId.userId : userId);
      if (!user || !user.active) throw new ApiError(404, 'NOT_FOUND', 'We could not find that user. Pick someone from the list.');
      const { token, expiresAt } = issueToken(user, now);
      appendAudit(db, { now, actorId: user.id, action: 'LOGIN', entityType: 'USER', entityId: user.id, details: { method: 'DEMO_PICKER' } });
      return { token, user: toUser(db, user), expiresAt, homeScreen: homeScreenFor(user) };
    },
    { auth: false },
  );
  setSession(session);
  return session;
}

/**
 * The signed-in user with their home screen (highest role).
 * Mirrors `GET /api/auth/me`.
 * @returns {Promise<object>} User & {homeScreen}
 */
export async function me() {
  return query(({ db, user }) => ({ ...toUser(db, user), homeScreen: homeScreenFor(user) }));
}

/**
 * Client-side only: forgets the token. (The backend has no logout endpoint;
 * the JWT simply expires.)
 */
export async function logout() {
  clearSession();
}
