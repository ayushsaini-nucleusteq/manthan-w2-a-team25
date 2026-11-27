/**
 * Delegation (M4, F5). A delegate acts for the delegator while the
 * delegation is active (today within the inclusive dates, not revoked),
 * only for approver roles both hold, and never transitively.
 */
import { ApiError } from '../errors.js';
import { hasRole, userById } from './access.js';
import { APPROVER_ROLES } from './constants.js';
import { appendAudit } from './events.js';
import { mutate, notFound, query, requireRole } from './runtime.js';
import { cleanText, isoDateIST, isValidIsoDate, newId, normalizeKey, toIso } from './util.js';
import { toDelegation, toUserSummary } from './views.js';

/**
 * People the caller can hand approvals to: active managers, plus holders of
 * the caller's own approver roles (auditors, finance heads); never the caller.
 * Returns summaries without bank details.
 * Mirrors `GET /api/users?role=MANAGER` (M4 picker).
 * @param {{q?: string}} [params]
 */
export async function listDelegateCandidates({ q } = {}) {
  return query(({ db, user }) => {
    requireRole(user, APPROVER_ROLES);
    const roles = new Set(['MANAGER', ...APPROVER_ROLES.filter((r) => hasRole(user, r))]);
    const needle = normalizeKey(q);
    return db.users
      .filter((u) => u.active && u.id !== user.id && u.roles.some((r) => roles.has(r)))
      .filter((u) => !needle || normalizeKey(`${u.fullName} ${u.employeeCode} ${u.email}`).includes(needle))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map((u) => toUserSummary(db, u));
  });
}

/**
 * Delegations the caller gave, received, or (finance head only) all.
 * Mirrors `GET /api/delegations?scope=given|received|all`.
 * @param {{scope?: 'given'|'received'|'all'}} [params]
 */
export async function listDelegations({ scope = 'given' } = {}) {
  return query(({ db, user, now }) => {
    let list;
    if (scope === 'all') {
      requireRole(user, ['FINANCE_HEAD']);
      list = db.delegations;
    } else if (scope === 'received') {
      list = db.delegations.filter((d) => d.delegateId === user.id);
    } else {
      list = db.delegations.filter((d) => d.delegatorId === user.id);
    }
    return [...list].sort((a, b) => b.startsOn.localeCompare(a.startsOn) || b.createdAt.localeCompare(a.createdAt)).map((d) => toDelegation(db, d, now));
  });
}

/**
 * Creates a delegation from the caller. 400 on invalid input, 422 when the
 * delegate shares no approver role, 409 when it overlaps another delegation.
 * Mirrors `POST /api/delegations`.
 * @param {{delegateId: string, startsOn: string, endsOn: string, reason?: string}} input
 */
export async function createDelegation({ delegateId, startsOn, endsOn, reason } = {}) {
  return mutate(({ db, user, now }) => {
    requireRole(user, APPROVER_ROLES);
    const today = isoDateIST(now);
    const fields = {};
    const delegate = userById(db, delegateId);
    if (!delegateId) fields.delegateId = 'Choose who will approve while you are away.';
    else if (!delegate || !delegate.active) fields.delegateId = 'This person is not available. Choose someone else.';
    else if (delegate.id === user.id) fields.delegateId = "You can't delegate to yourself.";
    if (!isValidIsoDate(startsOn)) fields.startsOn = 'Enter the first day of your leave.';
    else if (startsOn < today) fields.startsOn = "The start date can't be in the past.";
    if (!isValidIsoDate(endsOn)) fields.endsOn = 'Enter the last day of your leave.';
    else if (isValidIsoDate(startsOn) && endsOn < startsOn) fields.endsOn = 'The end date must be on or after the start date.';
    const text = cleanText(reason) || null;
    if (text && text.length > 500) fields.reason = 'Keep the reason under 500 characters.';
    if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { fields });

    const shared = APPROVER_ROLES.filter((r) => hasRole(user, r) && hasRole(delegate, r));
    if (!shared.length) {
      throw new ApiError(422, 'NO_COMMON_ROLE', `${delegate.fullName} doesn't hold any of your approver roles, so they can't approve for you.`);
    }
    const overlap = db.delegations.find(
      (d) => d.delegatorId === user.id && !d.revokedAt && d.startsOn <= endsOn && startsOn <= d.endsOn,
    );
    if (overlap) {
      throw new ApiError(409, 'DELEGATION_OVERLAP', `You already have a delegation from ${overlap.startsOn} to ${overlap.endsOn}. Revoke it or pick other dates.`, {
        delegationId: overlap.id,
      });
    }
    const delegation = {
      id: newId(),
      delegatorId: user.id,
      delegateId: delegate.id,
      startsOn,
      endsOn,
      reason: text,
      createdAt: toIso(now),
      revokedAt: null,
    };
    db.delegations.push(delegation);
    appendAudit(db, {
      now,
      actorId: user.id,
      action: 'DELEGATION_CREATED',
      entityType: 'DELEGATION',
      entityId: delegation.id,
      details: { delegateName: delegate.fullName, startsOn, endsOn, coveredRoles: shared },
    });
    return toDelegation(db, delegation, now);
  });
}

/**
 * Revokes a delegation (the delegator or the finance head). 409 when it was
 * already revoked or has ended.
 * Mirrors `DELETE /api/delegations/{id}`.
 */
export async function revokeDelegation(id) {
  return mutate(({ db, user, now }) => {
    const delegation = db.delegations.find((d) => d.id === id);
    if (!delegation || (delegation.delegatorId !== user.id && !hasRole(user, 'FINANCE_HEAD'))) throw notFound('Delegation not found.');
    if (delegation.revokedAt) throw new ApiError(409, 'ALREADY_REVOKED', 'This delegation was already revoked.');
    if (delegation.endsOn < isoDateIST(now)) throw new ApiError(409, 'DELEGATION_ENDED', 'This delegation has already ended.');
    delegation.revokedAt = toIso(now);
    appendAudit(db, { now, actorId: user.id, action: 'DELEGATION_REVOKED', entityType: 'DELEGATION', entityId: delegation.id });
    return toDelegation(db, delegation, now);
  });
}
