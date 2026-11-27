/** User administration (F5). Finance head only. */
import { ApiError } from '../errors.js';
import { hasRole, resolveManagerFor, userById } from './access.js';
import { ROLES } from './constants.js';
import { appendAudit } from './events.js';
import { mutate, notFound, query, requireRole } from './runtime.js';
import { normalizeKey, toIso } from './util.js';
import { toUser } from './views.js';

/**
 * Users filtered by name/code/email, role and department, sorted by name.
 * Mirrors `GET /api/users`.
 * @param {{q?: string, role?: string, departmentId?: string, active?: boolean}} [params]
 */
export async function listUsers({ q, role, departmentId, active } = {}) {
  return query(({ db, user }) => {
    requireRole(user, ['FINANCE_HEAD']);
    const needle = normalizeKey(q);
    return db.users
      .filter((u) => !needle || normalizeKey(`${u.fullName} ${u.employeeCode} ${u.email}`).includes(needle))
      .filter((u) => !role || role === 'ALL' || u.roles.includes(role))
      .filter((u) => !departmentId || u.departmentId === departmentId)
      .filter((u) => active === undefined || active === null || u.active === Boolean(active))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map((u) => toUser(db, u));
  });
}

function wouldCycle(db, userId, managerId) {
  const seen = new Set();
  let id = managerId;
  while (id && !seen.has(id)) {
    if (id === userId) return true;
    seen.add(id);
    id = userById(db, id)?.managerId ?? null;
  }
  return false;
}

/** Pending steps named on a deactivated user move to their manager or the role pool. */
function rerouteNamedSteps(db, target) {
  for (const claim of db.claims) {
    for (const step of claim.steps) {
      if (step.status !== 'PENDING' || step.assigneeId !== target.id) continue;
      if (step.stepType === 'MANAGER') {
        const next = resolveManagerFor(db, target.managerId, claim.employeeId);
        step.assigneeId = next.assigneeId;
        step.requiredRole = next.requiredRole;
      } else {
        step.assigneeId = null;
      }
    }
  }
}

/**
 * Changes a user's manager, roles or active flag. 422 MANAGER_CYCLE when the
 * new manager reports (directly or not) to the user; 422 LAST_FINANCE_HEAD
 * when it would leave no active finance head. Audited.
 * Mirrors `PATCH /api/users/{id}`.
 * @param {string} id
 * @param {{managerId?: string|null, roles?: string[], active?: boolean, version?: number}} patch
 */
export async function updateUser(id, patch = {}) {
  return mutate(({ db, user, now }) => {
    requireRole(user, ['FINANCE_HEAD']);
    const target = userById(db, id);
    if (!target) throw notFound('User not found.');
    if (patch.version !== undefined && patch.version !== null && Number(patch.version) !== target.version) {
      throw new ApiError(409, 'VERSION_CONFLICT', 'This user was changed by someone else. Reload to see the latest version.');
    }
    const next = { managerId: target.managerId, roles: [...target.roles], active: target.active };
    const fields = {};

    if (Object.prototype.hasOwnProperty.call(patch, 'managerId')) {
      const managerId = patch.managerId || null;
      if (managerId) {
        const manager = userById(db, managerId);
        if (!manager) fields.managerId = 'Choose an existing user as the manager.';
        else if (managerId === target.id) fields.managerId = "A person can't be their own manager.";
        else if (!manager.active) fields.managerId = 'Choose an active user as the manager.';
        else if (wouldCycle(db, target.id, managerId)) {
          throw new ApiError(422, 'MANAGER_CYCLE', `${manager.fullName} reports to ${target.fullName}, so this would create a reporting loop.`);
        }
      }
      next.managerId = managerId;
    }
    if (patch.roles !== undefined) {
      if (!Array.isArray(patch.roles)) fields.roles = 'Choose at least one role.';
      else {
        const invalid = patch.roles.filter((r) => !ROLES.includes(r));
        if (invalid.length) fields.roles = `Unknown role: ${invalid.join(', ')}.`;
        next.roles = ROLES.filter((r) => r === 'EMPLOYEE' || patch.roles.includes(r));
      }
    }
    if (patch.active !== undefined) next.active = Boolean(patch.active);
    if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { fields });

    if (!next.active && target.id === user.id) {
      throw new ApiError(422, 'CANNOT_DEACTIVATE_SELF', "You can't deactivate your own account.");
    }
    const stillHead = next.active && next.roles.includes('FINANCE_HEAD');
    if (hasRole(target, 'FINANCE_HEAD') && target.active && !stillHead) {
      const others = db.users.filter((u) => u.id !== target.id && u.active && hasRole(u, 'FINANCE_HEAD'));
      if (!others.length) {
        throw new ApiError(422, 'LAST_FINANCE_HEAD', `${target.fullName} is the only active finance head. Make someone else finance head first.`);
      }
    }

    const changes = {};
    if (next.managerId !== target.managerId) {
      changes.managerId = { from: userById(db, target.managerId)?.fullName ?? null, to: userById(db, next.managerId)?.fullName ?? null };
    }
    if (next.roles.join() !== target.roles.join()) changes.roles = { from: target.roles, to: next.roles };
    if (next.active !== target.active) changes.active = { from: target.active, to: next.active };
    if (!Object.keys(changes).length) return toUser(db, target);

    Object.assign(target, next);
    target.version += 1;
    target.updatedAt = toIso(now);
    if (!target.active) rerouteNamedSteps(db, target);
    appendAudit(db, { now, actorId: user.id, action: 'USER_UPDATED', entityType: 'USER', entityId: target.id, details: { changes } });
    return toUser(db, target);
  });
}
