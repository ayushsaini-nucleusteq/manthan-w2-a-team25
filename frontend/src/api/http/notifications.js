/**
 * The signed-in user's notifications (S2) against the Spring backend.
 * Same function names, arguments and return shapes as ../mock/notifications.js.
 */
import { get, post } from './client.js';
import { itemsOf } from './common.js';

/** Backend Notification → frontend Notification (mock views.toNotification). */
function mapNotification(n) {
  return {
    id: n?.id,
    type: n?.type ?? null,
    title: n?.title ?? '',
    message: n?.message ?? '',
    claimId: n?.claimId ?? null,
    payoutBatchId: n?.payoutBatchId ?? null,
    createdAt: n?.createdAt ?? null,
    readAt: n?.readAt ?? (n?.read ? n?.createdAt ?? null : null),
  };
}

/**
 * Newest first, at most 100. `unread: true` returns only unread ones.
 * Endpoint: `GET /api/notifications?unread=&size=100`.
 * @param {{unread?: boolean}} [params]
 * @returns {Promise<object[]>} Notification[]
 */
export async function listNotifications({ unread } = {}) {
  const body = await get('/api/notifications', { query: { unread: unread ? true : undefined, page: 0, size: 100 } });
  return itemsOf(body)
    .map(mapNotification)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .slice(0, 100);
}

/**
 * Badge count.
 * Endpoint: `GET /api/notifications/unread-count` ({unread} → {count}).
 * @returns {Promise<{count: number}>}
 */
export async function unreadCount() {
  const body = await get('/api/notifications/unread-count');
  return { count: Number(body?.unread ?? body?.count) || 0 };
}

/**
 * Marks one notification read (404 if it isn't the caller's).
 * Endpoint: `POST /api/notifications/{id}/read`.
 */
export async function markRead(id) {
  return mapNotification(await post(`/api/notifications/${encodeURIComponent(id)}/read`));
}

/**
 * Marks all of the caller's notifications read.
 * Endpoint: `POST /api/notifications/read-all`.
 * @returns {Promise<{updated: number}>}
 */
export async function markAllRead() {
  const body = await post('/api/notifications/read-all');
  return { updated: Number(body?.updated) || 0 };
}
