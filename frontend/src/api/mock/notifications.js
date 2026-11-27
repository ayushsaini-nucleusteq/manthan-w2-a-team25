/** The signed-in user's notifications (S2). */
import { mutate, notFound, query } from './runtime.js';
import { toIso } from './util.js';
import { toNotification } from './views.js';

/**
 * Newest first, at most 100. `unread: true` returns only unread ones.
 * Mirrors `GET /api/notifications?unread=`.
 * @param {{unread?: boolean}} [params]
 * @returns {Promise<object[]>} Notification[]
 */
export async function listNotifications({ unread } = {}) {
  return query(({ db, user }) =>
    db.notifications
      .filter((n) => n.recipientId === user.id && (!unread || !n.readAt))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100)
      .map(toNotification),
  );
}

/**
 * Badge count.
 * Mirrors `GET /api/notifications/unread-count`.
 * @returns {Promise<{count: number}>}
 */
export async function unreadCount() {
  return query(({ db, user }) => ({ count: db.notifications.filter((n) => n.recipientId === user.id && !n.readAt).length }));
}

/**
 * Marks one notification read (404 if it isn't the caller's).
 * Mirrors `POST /api/notifications/{id}/read`.
 */
export async function markRead(id) {
  return mutate(({ db, user, now }) => {
    const notification = db.notifications.find((n) => n.id === id && n.recipientId === user.id);
    if (!notification) throw notFound('Notification not found.');
    if (!notification.readAt) notification.readAt = toIso(now);
    return toNotification(notification);
  });
}

/**
 * Marks all of the caller's notifications read.
 * Mirrors `POST /api/notifications/read-all`.
 * @returns {Promise<{updated: number}>}
 */
export async function markAllRead() {
  return mutate(({ db, user, now }) => {
    let updated = 0;
    for (const n of db.notifications) {
      if (n.recipientId === user.id && !n.readAt) {
        n.readAt = toIso(now);
        updated += 1;
      }
    }
    return { updated };
  });
}
