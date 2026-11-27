/**
 * Auth against the backend. POST /api/auth/login {email, password} → {accessToken, expiresIn, user};
 * GET /api/auth/me; POST /api/auth/logout (audited, 204).
 */
import { clearSession, getSession, setSession } from '../session.js';
import { get, post } from './client.js';
import { mapUser } from './common.js';

/**
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{token, user, expiresAt, homeScreen, source: 'http'}>}
 */
export async function loginWithPassword(email, password) {
  const body = await post('/api/auth/login', { email, password }, { auth: false });
  const expiresIn = Number(body?.expiresIn) || 8 * 3600;
  const session = {
    token: body.accessToken,
    user: mapUser(body.user),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    homeScreen: body.user?.homeScreen ?? 'E1',
    source: 'http',
  };
  setSession(session);
  return session;
}

/** GET /api/auth/me → User & {homeScreen}. */
export async function me() {
  const u = await get('/api/auth/me');
  return { ...mapUser(u), homeScreen: u?.homeScreen ?? 'E1' };
}

/** POST /api/auth/logout (best effort), then forget the token. */
export async function logout() {
  try {
    if (getSession()?.source === 'http') await post('/api/auth/logout', undefined, { timeoutMs: 4000 });
  } catch {
    // The token is discarded either way.
  } finally {
    clearSession();
  }
}
