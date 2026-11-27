/**
 * Append-only audit events and notifications.
 *
 * There is deliberately no function that updates or deletes an audit event
 * (US17-AC2): events are only ever pushed.
 */
import { newId, toIso } from './util.js';

/**
 * Appends one audit event.
 * @returns {object} the stored event
 */
export function appendAudit(
  db,
  {
    now,
    actorId = null,
    onBehalfOfId = null,
    action,
    entityType,
    entityId,
    claimId = null,
    fromStatus = null,
    toStatus = null,
    comment = null,
    details = null,
  },
) {
  db.seq.audit += 1;
  const event = {
    id: db.seq.audit,
    occurredAt: toIso(now),
    actorId,
    onBehalfOfId,
    action,
    entityType,
    entityId: String(entityId),
    claimId,
    fromStatus,
    toStatus,
    comment: comment || null,
    details: details ?? null,
  };
  db.auditEvents.push(event);
  return event;
}

/** Creates a notification for one recipient. */
export function notify(db, { now, recipientId, type, title, message, claimId = null, payoutBatchId = null }) {
  if (!recipientId) return null;
  const notification = {
    id: newId(),
    recipientId,
    type,
    title,
    message,
    claimId,
    payoutBatchId,
    createdAt: toIso(now),
    readAt: null,
  };
  db.notifications.push(notification);
  return notification;
}
