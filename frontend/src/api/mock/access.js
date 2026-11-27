/**
 * Who may see and act on what: users, roles, delegations, approver
 * resolution, separation of duties and claim visibility.
 */
import { APPROVER_ROLES, STATUS } from './constants.js';
import { isoDateIST } from './util.js';

export function userById(db, id) {
  if (!id) return null;
  return db.users.find((u) => u.id === id) ?? null;
}

export function hasRole(user, role) {
  return Boolean(user) && user.roles.includes(role);
}

export function hasAnyRole(user, roles) {
  return Boolean(user) && roles.some((r) => user.roles.includes(r));
}

/** FINANCE_HEAD → F1, AUDITOR → A1, MANAGER → M1, else E1. */
export function homeScreenFor(user) {
  if (hasRole(user, 'FINANCE_HEAD')) return 'F1';
  if (hasRole(user, 'AUDITOR')) return 'A1';
  if (hasRole(user, 'MANAGER')) return 'M1';
  return 'E1';
}

/** Active = not revoked and today (IST) within the inclusive date range. */
export function isDelegationActive(delegation, today) {
  return !delegation.revokedAt && delegation.startsOn <= today && today <= delegation.endsOn;
}

export function delegationStatus(delegation, today) {
  if (delegation.revokedAt) return 'REVOKED';
  if (today < delegation.startsOn) return 'SCHEDULED';
  if (today > delegation.endsOn) return 'EXPIRED';
  return 'ACTIVE';
}

/** Approver roles held by both the delegator and the delegate. */
export function coveredRoles(db, delegation) {
  const delegator = userById(db, delegation.delegatorId);
  const delegate = userById(db, delegation.delegateId);
  return APPROVER_ROLES.filter((r) => hasRole(delegator, r) && hasRole(delegate, r));
}

/** The role a named manager-step assignee approves with. */
export function approverRoleOf(user) {
  if (hasRole(user, 'MANAGER')) return 'MANAGER';
  if (hasRole(user, 'FINANCE_HEAD')) return 'FINANCE_HEAD';
  if (hasRole(user, 'AUDITOR')) return 'AUDITOR';
  return 'MANAGER';
}

/**
 * Manager-step assignee for an owner: the owner's manager, walking up past
 * inactive managers. With nobody left → the finance-head pool.
 */
export function resolveManagerFor(db, startManagerId, excludeId) {
  const seen = new Set();
  let id = startManagerId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const manager = userById(db, id);
    if (!manager) break;
    if (manager.active && manager.id !== excludeId) {
      return { assigneeId: manager.id, requiredRole: approverRoleOf(manager) };
    }
    id = manager.managerId;
  }
  return { assigneeId: null, requiredRole: 'FINANCE_HEAD' };
}

/** People who already acted on another step of the claim (separation of duties). */
export function actedIds(claim, exceptStepId) {
  const ids = new Set();
  for (const step of claim.steps) {
    if (step.id === exceptStepId) continue;
    if (step.actedBy) ids.add(step.actedBy);
    if (step.actedOnBehalfOf) ids.add(step.actedOnBehalfOf);
  }
  return ids;
}

/**
 * Can `user` act on `step` of `claim` now?
 * @returns {{ok: true, onBehalfOfId: string|null} | {ok: false, status: number, code: string, message: string}}
 */
export function resolveActing(db, user, claim, step, now) {
  if (!user?.active) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Claim not found.' };
  if (claim.employeeId === user.id) {
    return { ok: false, status: 409, code: 'OWN_CLAIM', message: "You can't act on your own claim." };
  }
  let eligible = false;
  let onBehalfOfId = null;
  if (step.assigneeId) {
    if (step.assigneeId === user.id) {
      eligible = true;
    } else {
      const today = isoDateIST(now);
      const delegator = userById(db, step.assigneeId);
      const delegation = db.delegations.find(
        (d) => d.delegatorId === step.assigneeId && d.delegateId === user.id && isDelegationActive(d, today),
      );
      if (
        delegation &&
        delegator &&
        hasRole(user, step.requiredRole) &&
        hasRole(delegator, step.requiredRole) &&
        delegator.id !== claim.employeeId
      ) {
        eligible = true;
        onBehalfOfId = delegator.id;
      }
    }
  } else if (hasRole(user, step.requiredRole)) {
    eligible = true;
  }
  if (!eligible) {
    return { ok: false, status: 409, code: 'NOT_ASSIGNEE', message: 'This claim is not waiting for your decision.' };
  }
  const acted = actedIds(claim, step.id);
  if (acted.has(user.id) || (onBehalfOfId && acted.has(onBehalfOfId))) {
    return { ok: false, status: 409, code: 'ALREADY_ACTED', message: 'You already acted on this claim.' };
  }
  return { ok: true, onBehalfOfId };
}

/**
 * Everyone who can act on a pending step: the named assignee plus their
 * active delegates, or every active holder of the pool role except the
 * owner and anyone who already acted on the claim.
 * @returns {{userId: string, onBehalfOfId: string|null}[]}
 */
export function stepActors(db, claim, step, now) {
  const actors = [];
  const acted = actedIds(claim, step.id);
  if (step.assigneeId) {
    const assignee = userById(db, step.assigneeId);
    if (assignee?.active && assignee.id !== claim.employeeId) actors.push({ userId: assignee.id, onBehalfOfId: null });
    const today = isoDateIST(now);
    for (const d of db.delegations) {
      if (d.delegatorId !== step.assigneeId || !isDelegationActive(d, today)) continue;
      const delegate = userById(db, d.delegateId);
      if (
        delegate?.active &&
        delegate.id !== claim.employeeId &&
        hasRole(delegate, step.requiredRole) &&
        hasRole(assignee, step.requiredRole) &&
        !acted.has(delegate.id)
      ) {
        actors.push({ userId: delegate.id, onBehalfOfId: step.assigneeId });
      }
    }
  } else {
    for (const u of db.users) {
      if (u.active && u.id !== claim.employeeId && hasRole(u, step.requiredRole) && !acted.has(u.id)) {
        actors.push({ userId: u.id, onBehalfOfId: null });
      }
    }
  }
  return actors;
}

/** The pending approval step (not the sample audit), or null. */
export function pendingApprovalStep(claim) {
  return claim.steps.find((s) => s.status === 'PENDING' && s.stepType !== 'SAMPLE_AUDIT') ?? null;
}

export function pendingSampleStep(claim) {
  return claim.steps.find((s) => s.status === 'PENDING' && s.stepType === 'SAMPLE_AUDIT') ?? null;
}

/** Any pending step (approval or sample audit). */
export function pendingStep(claim) {
  return claim.steps.find((s) => s.status === 'PENDING') ?? null;
}

/**
 * Claim visibility (anything not visible is a 404):
 * - the owner;
 * - never anyone else for a never-submitted draft;
 * - auditors and the finance head (oversight roles);
 * - anyone named on, acting on, or delegated for a step of the claim.
 */
export function canViewClaim(db, user, claim, now) {
  if (!user || !claim) return false;
  if (claim.employeeId === user.id) return true;
  if (claim.status === STATUS.DRAFT && claim.submissionNo === 0) return false;
  if (hasAnyRole(user, ['AUDITOR', 'FINANCE_HEAD'])) return true;
  for (const step of claim.steps) {
    if ([step.assigneeId, step.actedBy, step.actedOnBehalfOf, step.sentBackBy].includes(user.id)) return true;
  }
  const step = pendingStep(claim);
  if (step && resolveActing(db, user, claim, step, now).ok) return true;
  return false;
}

/** True for users who may read audit data of anyone (F6). */
export function isOversight(user) {
  return hasAnyRole(user, ['AUDITOR', 'FINANCE_HEAD']);
}
