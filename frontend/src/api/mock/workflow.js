/**
 * Claim workflow: submit (policy, auto-approve/reject, chain), approver
 * decisions, resubmit routing, sample-audit blocks and sample decisions.
 * Functions here mutate the db draft they are given; the request layer
 * commits it only when the whole operation succeeds.
 */
import { toPaise } from '../../utils/money.js';
import { ApiError } from '../errors.js';
import {
  pendingApprovalStep,
  pendingSampleStep,
  resolveActing,
  resolveManagerFor,
  stepActors,
  userById,
  hasRole,
} from './access.js';
import { STATUS, STEP_ORDER, STEP_STATUS_FOR_CLAIM } from './constants.js';
import { appendAudit, notify } from './events.js';
import {
  claimBlockers,
  claimTotalPaise,
  evaluateClaimLines,
  linesHash,
  policyAt,
  worstOutcome,
} from './policyEngine.js';
import { cleanText, inr, isoDateIST, newId, randomInt, toIso } from './util.js';

/* ----------------------------------------------------------------- helpers */

function touch(claim, now) {
  claim.version += 1;
  claim.updatedAt = toIso(now);
}

/** Changes status, bumps the version and writes one audit event with from/to. */
export function transition(db, claim, toStatus, { now, actorId = null, onBehalfOfId = null, action, comment = null, details = null }) {
  const fromStatus = claim.status;
  claim.status = toStatus;
  touch(claim, now);
  return appendAudit(db, {
    now,
    actorId,
    onBehalfOfId,
    action,
    entityType: 'CLAIM',
    entityId: claim.id,
    claimId: claim.id,
    fromStatus,
    toStatus,
    comment,
    details,
  });
}

export function addCommentRecord(claim, { now, authorId, authorRole, kind, text }) {
  const comment = { id: newId(), at: toIso(now), authorId, authorRole, kind, text };
  claim.comments.push(comment);
  return comment;
}

function ownerOf(db, claim) {
  return userById(db, claim.employeeId);
}

/** Finance head without a manager: chain is a single AUDITOR step, and auto-approvals are always sampled. */
export function isHeadWithoutManager(owner) {
  return hasRole(owner, 'FINANCE_HEAD') && !owner.managerId;
}

function requireText(text, field, message) {
  const value = cleanText(text);
  if (!value) throw new ApiError(400, 'VALIDATION_ERROR', message, { fields: { [field]: message } });
  if (value.length > 2000) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Keep it under 2000 characters.', { fields: { [field]: 'Keep it under 2000 characters.' } });
  }
  return value;
}

/* ------------------------------------------------------------------ chain */

/**
 * Steps a claim needs: MANAGER (owner's manager, or the finance-head pool
 * when there is none), + AUDITOR above auditorAboveTotal, + FINANCE_HEAD
 * above financeHeadAboveTotal. A finance head with no manager gets a single
 * AUDITOR step as the final approver.
 */
export function requiredSteps(db, owner, totalPaise, policy) {
  if (isHeadWithoutManager(owner)) return [{ stepType: 'AUDITOR', requiredRole: 'AUDITOR', assigneeId: null }];
  const manager = resolveManagerFor(db, owner.managerId, owner.id);
  const steps = [{ stepType: 'MANAGER', requiredRole: manager.requiredRole, assigneeId: manager.assigneeId }];
  if (totalPaise > toPaise(policy.auditorAboveTotal)) steps.push({ stepType: 'AUDITOR', requiredRole: 'AUDITOR', assigneeId: null });
  if (totalPaise > toPaise(policy.financeHeadAboveTotal)) {
    steps.push({ stepType: 'FINANCE_HEAD', requiredRole: 'FINANCE_HEAD', assigneeId: null });
  }
  return steps;
}

function blankStep(def) {
  return {
    id: newId(),
    sequence: 0,
    stepType: def.stepType,
    requiredRole: def.requiredRole,
    assigneeId: def.assigneeId ?? null,
    sentBackBy: null,
    status: 'WAITING',
    pendingSince: null,
    actedBy: null,
    actedOnBehalfOf: null,
    actedAt: null,
    comment: null,
  };
}

function resetStep(step, def) {
  Object.assign(step, {
    requiredRole: def.requiredRole,
    assigneeId: def.assigneeId ?? null,
    sentBackBy: null,
    status: 'WAITING',
    pendingSince: null,
    actedBy: null,
    actedOnBehalfOf: null,
    actedAt: null,
    comment: null,
  });
}

function resequence(claim) {
  claim.steps.sort((a, b) => STEP_ORDER[a.stepType] - STEP_ORDER[b.stepType]);
  claim.steps.forEach((s, i) => {
    s.sequence = i + 1;
  });
}

function notifyApprovers(db, claim, step, now) {
  const owner = ownerOf(db, claim);
  const sample = step.stepType === 'SAMPLE_AUDIT';
  for (const actor of stepActors(db, claim, step, now)) {
    const delegator = actor.onBehalfOfId ? userById(db, actor.onBehalfOfId) : null;
    notify(db, {
      now,
      recipientId: actor.userId,
      type: 'APPROVAL_WAITING',
      title: sample ? `Sample audit: ${claim.claimNumber}` : `Approval waiting: ${claim.claimNumber}`,
      message:
        `${owner?.fullName ?? 'An employee'} · "${claim.title}" · ${inr(claim.totalAmount)}.` +
        (delegator ? ` You are covering for ${delegator.fullName}.` : ''),
      claimId: claim.id,
    });
  }
}

/** Marks a step PENDING from now and notifies its approvers. */
function activateStep(db, claim, step, now) {
  step.status = 'PENDING';
  step.pendingSince = toIso(now);
  notifyApprovers(db, claim, step, now);
}

function startChainAtFirstStep(db, claim, owner, now, details) {
  const first = claim.steps.find((s) => s.status === 'WAITING');
  activateStep(db, claim, first, now);
  transition(db, claim, STEP_STATUS_FOR_CLAIM[first.stepType], {
    now,
    actorId: owner.id,
    action: 'CLAIM_ROUTED',
    details: { ...details, route: claim.steps.filter((s) => s.status !== 'CANCELLED').map((s) => s.stepType) },
  });
}

/** Builds (or rebuilds) the approval chain from MANAGER. */
function buildChain(db, claim, owner, policy, now, details) {
  const defs = requiredSteps(db, owner, claimTotalPaise(claim), policy);
  for (const step of claim.steps) {
    const def = defs.find((d) => d.stepType === step.stepType);
    if (def) resetStep(step, def);
    else step.status = 'CANCELLED';
  }
  for (const def of defs) {
    if (!claim.steps.some((s) => s.stepType === def.stepType)) claim.steps.push(blankStep(def));
  }
  resequence(claim);
  startChainAtFirstStep(db, claim, owner, now, details);
}

/** Appends later steps the (unchanged) total now requires; steps are never removed. */
function appendMissingSteps(db, claim, owner, policy) {
  const defs = requiredSteps(db, owner, claimTotalPaise(claim), policy);
  for (const def of defs) {
    if (!claim.steps.some((s) => s.stepType === def.stepType)) claim.steps.push(blankStep(def));
  }
  resequence(claim);
}

/** Who a sent-back step returns to: the person who sent it back, else their manager / the pool. */
function routeBackTo(db, claim, step) {
  const sender = userById(db, step.sentBackBy);
  if (sender?.active && sender.id !== claim.employeeId) {
    return { assigneeId: sender.id, requiredRole: step.requiredRole };
  }
  if (step.stepType === 'MANAGER') return resolveManagerFor(db, sender?.managerId ?? null, claim.employeeId);
  return { assigneeId: null, requiredRole: step.requiredRole };
}

/* --------------------------------------------------------- sample audits */

/**
 * Sample block: exactly one sampled claim in every block of 100 / percent
 * auto-approved claims, at a random position chosen when the block opens.
 * @returns {{sampled: boolean, blockNo: number, position: number}}
 */
export function takeSampleSlot(db, policy) {
  const size = Math.max(1, Math.round(100 / Math.max(1, Number(policy.samplePercent) || 10)));
  let block = db.sampleBlock;
  if (!block || block.filled >= block.size) {
    block = { blockNo: (block?.blockNo ?? 0) + 1, size, targetPosition: randomInt(1, size), filled: 0 };
    db.sampleBlock = block;
  }
  block.filled += 1;
  return { sampled: block.filled === block.targetPosition, blockNo: block.blockNo, position: block.filled };
}

function tagForSample(db, claim, now, { forced, blockNo }) {
  claim.sampleAudit = true;
  claim.sampleAuditStatus = 'PENDING';
  claim.sampledAt = toIso(now);
  claim.sampleAuditedBy = null;
  claim.sampleAuditedAt = null;
  const step = blankStep({ stepType: 'SAMPLE_AUDIT', requiredRole: 'AUDITOR', assigneeId: null });
  claim.steps.push(step);
  resequence(claim);
  activateStep(db, claim, step, now);
  appendAudit(db, {
    now,
    action: 'SAMPLE_TAGGED',
    entityType: 'CLAIM',
    entityId: claim.id,
    claimId: claim.id,
    details: { forced, blockNo: blockNo ?? null },
  });
}

/* ------------------------------------------------------------------ submit */

function storeEvaluation(claim, results, policy, now) {
  for (const r of results) {
    if (!r.fresh) continue;
    r.line.policyOutcome = r.outcome;
    r.line.findings = r.findings;
    r.line.flags = r.flags;
    r.line.evaluatedPolicyVersionNo = policy.versionNo;
    r.line.evaluatedAt = toIso(now);
    r.line.needsEvaluation = false;
  }
}

function rejectionSummary(results) {
  const parts = [];
  for (const r of results) {
    for (const f of r.findings) {
      if (f.outcome === 'AUTO_REJECT') parts.push(`Line ${r.line.lineNo}: ${f.message}`);
    }
  }
  return `Rejected automatically by policy. ${parts.join(' ')}`.slice(0, 2000);
}

function cancelOpenSteps(claim) {
  for (const step of claim.steps) {
    if (step.status === 'WAITING' || step.status === 'PENDING' || step.status === 'SENT_BACK') step.status = 'CANCELLED';
  }
}

/**
 * Submits (or resubmits) a claim as its owner.
 * Throws 422 SUBMIT_BLOCKED with details.blockers when blocked.
 */
export function submitCore(db, claim, owner, { comment, now }) {
  if (claim.status !== STATUS.DRAFT && claim.status !== STATUS.SENT_BACK) {
    throw new ApiError(409, 'NOT_SUBMITTABLE', 'Only draft or sent-back claims can be submitted.');
  }
  const policy = policyAt(db, now);
  const blockers = claimBlockers(claim, policy, isoDateIST(now));
  if (blockers.length) {
    const lineNos = [...new Set(blockers.filter((b) => b.lineNo).map((b) => b.lineNo))];
    throw new ApiError(
      422,
      'SUBMIT_BLOCKED',
      lineNos.length ? `Fix line${lineNos.length > 1 ? 's' : ''} ${lineNos.join(', ')} before submitting.` : 'Complete the claim before submitting.',
      { blockers },
    );
  }

  const text = cleanText(comment);
  if (text.length > 2000) throw new ApiError(400, 'VALIDATION_ERROR', 'Keep the comment under 2000 characters.', { fields: { comment: 'Keep the comment under 2000 characters.' } });
  const wasSentBack = claim.status === STATUS.SENT_BACK;
  const firstSubmit = claim.submissionNo === 0;
  const sampleResubmit = wasSentBack && claim.sampleAudit && claim.sampleAuditStatus === 'SENT_BACK';
  const newHash = linesHash(claim);
  const linesChanged = !firstSubmit && claim.lastLinesHash !== newHash;

  if (text) addCommentRecord(claim, { now, authorId: owner.id, authorRole: 'EMPLOYEE', kind: wasSentBack ? 'REPLY' : 'COMMENT', text });
  claim.submissionNo += 1;
  claim.submittedAt = toIso(now);
  claim.departmentId = owner.departmentId;
  claim.policyVersionNo = policy.versionNo;
  claim.lastLinesHash = newHash;
  claim.decisionReason = null;
  transition(db, claim, STATUS.SUBMITTED, {
    now,
    actorId: owner.id,
    action: 'CLAIM_SUBMITTED',
    comment: text || null,
    details: { submissionNo: claim.submissionNo, totalAmount: claim.totalAmount, linesChanged: firstSubmit ? null : linesChanged },
  });

  const results = evaluateClaimLines(db, claim, policy);
  storeEvaluation(claim, results, policy, now);
  const outcome = worstOutcome(results.map((r) => r.outcome)) ?? 'AUTO_APPROVE';
  claim.policyOutcome = outcome;
  appendAudit(db, {
    now,
    actorId: owner.id,
    action: 'POLICY_EVALUATED',
    entityType: 'CLAIM',
    entityId: claim.id,
    claimId: claim.id,
    details: {
      policyVersionNo: policy.versionNo,
      claimOutcome: outcome,
      lines: results.map((r) => ({
        lineNo: r.line.lineNo,
        outcome: r.outcome,
        reevaluated: r.fresh,
        findings: r.findings.map((f) => ({
          reasonCode: f.reasonCode,
          outcome: f.outcome,
          limitValue: f.limitValue,
          actualValue: f.actualValue,
          ...(f.matchedClaimId
            ? {
                matchedClaimId: f.matchedClaimId,
                matchedClaimNumber: f.matchedClaimNumber,
                matchedLineNo: f.matchedLineNo,
                matchedEmployeeId: f.matchedEmployeeId,
              }
            : {}),
        })),
      })),
    },
  });

  const totalPaise = claimTotalPaise(claim);
  const clean = outcome === 'AUTO_APPROVE' && totalPaise <= toPaise(policy.autoApproveMaxTotal);

  if (outcome === 'AUTO_REJECT') {
    cancelOpenSteps(claim);
    if (claim.sampleAudit) {
      // A sample tag only lives on AUTO_APPROVED / SENT_BACK / REJECTED / IN_BATCH / PAID claims.
      claim.sampleAudit = false;
      claim.sampleAuditStatus = null;
    }
    claim.decisionReason = rejectionSummary(results);
    claim.decidedAt = toIso(now);
    transition(db, claim, STATUS.AUTO_REJECTED, {
      now,
      actorId: null,
      action: 'CLAIM_AUTO_REJECTED',
      comment: claim.decisionReason,
      details: { policyVersionNo: policy.versionNo },
    });
    notify(db, {
      now,
      recipientId: owner.id,
      type: 'CLAIM_DECIDED',
      title: `${claim.claimNumber} was rejected by policy`,
      message: claim.decisionReason,
      claimId: claim.id,
    });
    return claim;
  }

  if (sampleResubmit) {
    const step = claim.steps.find((s) => s.stepType === 'SAMPLE_AUDIT');
    if (clean && step) {
      const back = routeBackTo(db, claim, step);
      resetStep(step, { requiredRole: 'AUDITOR', assigneeId: back.assigneeId });
      claim.sampleAuditStatus = 'PENDING';
      claim.decidedAt = toIso(now);
      activateStep(db, claim, step, now);
      transition(db, claim, STATUS.AUTO_APPROVED, {
        now,
        action: 'CLAIM_AUTO_APPROVED',
        details: { sampleAudit: 'RETURNED_TO_AUDITOR', totalAmount: claim.totalAmount },
      });
      return claim;
    }
    if (step) step.status = 'CANCELLED';
    claim.sampleAudit = false;
    claim.sampleAuditStatus = null;
    buildChain(db, claim, owner, policy, now, { resubmit: 'SAMPLE_NO_LONGER_CLEAN' });
    return claim;
  }

  if (firstSubmit) {
    if (clean) {
      claim.decidedAt = toIso(now);
      transition(db, claim, STATUS.AUTO_APPROVED, {
        now,
        action: 'CLAIM_AUTO_APPROVED',
        details: { totalAmount: claim.totalAmount, autoApproveMaxTotal: policy.autoApproveMaxTotal },
      });
      if (isHeadWithoutManager(owner)) {
        tagForSample(db, claim, now, { forced: true });
      } else {
        const slot = takeSampleSlot(db, policy);
        if (slot.sampled) tagForSample(db, claim, now, { forced: false, blockNo: slot.blockNo });
      }
      notify(db, {
        now,
        recipientId: owner.id,
        type: 'CLAIM_DECIDED',
        title: `${claim.claimNumber} was auto-approved`,
        message: `"${claim.title}" for ${inr(claim.totalAmount)} is within policy and approved.`,
        claimId: claim.id,
      });
      return claim;
    }
    claim.steps = [];
    buildChain(db, claim, owner, policy, now, { resubmit: null });
    return claim;
  }

  // Resubmit after a send-back by an approver.
  const sentBackStep = claim.steps.find((s) => s.status === 'SENT_BACK' && s.stepType !== 'SAMPLE_AUDIT');
  if (linesChanged || !sentBackStep) {
    buildChain(db, claim, owner, policy, now, { resubmit: 'LINES_CHANGED' });
    return claim;
  }
  const back = routeBackTo(db, claim, sentBackStep);
  resetStep(sentBackStep, { requiredRole: back.requiredRole, assigneeId: back.assigneeId });
  appendMissingSteps(db, claim, owner, policy);
  activateStep(db, claim, sentBackStep, now);
  const assignee = userById(db, back.assigneeId);
  transition(db, claim, STEP_STATUS_FOR_CLAIM[sentBackStep.stepType], {
    now,
    actorId: owner.id,
    action: 'CLAIM_ROUTED',
    details: { resubmit: 'UNCHANGED', returnedTo: assignee?.fullName ?? `${sentBackStep.requiredRole} pool`, stepType: sentBackStep.stepType },
  });
  return claim;
}

/* --------------------------------------------------------------- decisions */

/**
 * Approver decision on the pending approval step.
 * @param {'APPROVE'|'SEND_BACK'|'REJECT'} decision
 */
export function decideCore(db, claim, user, { decision, comment, version, now }) {
  if (version !== undefined && version !== null && Number(version) !== claim.version) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'This claim was changed by someone else. Reload to see the latest version.', {
      currentVersion: claim.version,
    });
  }
  const step = pendingApprovalStep(claim);
  if (!step) throw new ApiError(409, 'NOT_PENDING', 'This claim is not waiting for an approval decision.');
  let text = cleanText(comment);
  if (decision === 'SEND_BACK') text = requireText(comment, 'comment', 'Add a comment telling the employee what to fix.');
  if (decision === 'REJECT') text = requireText(comment, 'reason', 'Add the reason for rejecting this claim.');
  if (text.length > 2000) throw new ApiError(400, 'VALIDATION_ERROR', 'Keep the comment under 2000 characters.', { fields: { comment: 'Keep the comment under 2000 characters.' } });

  const acting = resolveActing(db, user, claim, step, now);
  if (!acting.ok) throw new ApiError(acting.status, acting.code, acting.message);
  const onBehalfOfId = acting.onBehalfOfId;
  const owner = ownerOf(db, claim);

  step.actedBy = user.id;
  step.actedOnBehalfOf = onBehalfOfId;
  step.actedAt = toIso(now);
  step.comment = text || null;
  const stepDetails = { stepType: step.stepType, sequence: step.sequence };

  if (decision === 'APPROVE') {
    step.status = 'APPROVED';
    if (text) addCommentRecord(claim, { now, authorId: user.id, authorRole: step.requiredRole, kind: 'APPROVE_NOTE', text });
    const next = claim.steps.find((s) => s.status === 'WAITING');
    if (next) {
      activateStep(db, claim, next, now);
      transition(db, claim, STEP_STATUS_FOR_CLAIM[next.stepType], {
        now,
        actorId: user.id,
        onBehalfOfId,
        action: 'CLAIM_APPROVED',
        comment: text || null,
        details: { ...stepDetails, nextStep: next.stepType },
      });
    } else {
      claim.decidedAt = toIso(now);
      transition(db, claim, STATUS.APPROVED, {
        now,
        actorId: user.id,
        onBehalfOfId,
        action: 'CLAIM_APPROVED',
        comment: text || null,
        details: { ...stepDetails, final: true },
      });
      notify(db, {
        now,
        recipientId: owner?.id,
        type: 'CLAIM_DECIDED',
        title: `${claim.claimNumber} was approved`,
        message: `"${claim.title}" for ${inr(claim.totalAmount)} is approved and will be paid in the next payout batch.`,
        claimId: claim.id,
      });
    }
    return claim;
  }

  if (decision === 'SEND_BACK') {
    step.status = 'SENT_BACK';
    step.sentBackBy = onBehalfOfId ?? user.id;
    addCommentRecord(claim, { now, authorId: user.id, authorRole: step.requiredRole, kind: 'SEND_BACK', text });
    transition(db, claim, STATUS.SENT_BACK, { now, actorId: user.id, onBehalfOfId, action: 'CLAIM_SENT_BACK', comment: text, details: stepDetails });
    notify(db, {
      now,
      recipientId: owner?.id,
      type: 'SENT_BACK',
      title: `${claim.claimNumber} was sent back to you`,
      message: `${userById(db, user.id)?.fullName ?? 'Your approver'}: ${text}`,
      claimId: claim.id,
    });
    return claim;
  }

  if (decision === 'REJECT') {
    step.status = 'REJECTED';
    for (const s of claim.steps) if (s.status === 'WAITING') s.status = 'CANCELLED';
    addCommentRecord(claim, { now, authorId: user.id, authorRole: step.requiredRole, kind: 'REJECT_REASON', text });
    claim.decisionReason = text;
    claim.decidedAt = toIso(now);
    transition(db, claim, STATUS.REJECTED, { now, actorId: user.id, onBehalfOfId, action: 'CLAIM_REJECTED', comment: text, details: stepDetails });
    notify(db, {
      now,
      recipientId: owner?.id,
      type: 'CLAIM_DECIDED',
      title: `${claim.claimNumber} was rejected`,
      message: text,
      claimId: claim.id,
    });
    return claim;
  }
  throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown decision.');
}

/**
 * Auditor decision on a sampled auto-approved claim (A4).
 * @param {'CLEAR'|'REJECT'|'SEND_BACK'} decision
 */
export function sampleDecisionCore(db, claim, user, { decision, text: rawText, now }) {
  if (!claim.sampleAudit || claim.sampleAuditStatus !== 'PENDING' || claim.status !== STATUS.AUTO_APPROVED) {
    throw new ApiError(409, 'SAMPLE_NOT_PENDING', 'This claim has no pending sample audit.');
  }
  const step = pendingSampleStep(claim);
  if (!step) throw new ApiError(409, 'SAMPLE_NOT_PENDING', 'This claim has no pending sample audit.');
  let text = cleanText(rawText);
  if (decision === 'REJECT') text = requireText(rawText, 'reason', 'Add the reason for rejecting this claim.');
  if (decision === 'SEND_BACK') text = requireText(rawText, 'comment', 'Add a comment telling the employee what to fix.');
  const acting = resolveActing(db, user, claim, step, now);
  if (!acting.ok) throw new ApiError(acting.status, acting.code, acting.message);
  const owner = ownerOf(db, claim);

  step.actedBy = user.id;
  step.actedOnBehalfOf = acting.onBehalfOfId;
  step.actedAt = toIso(now);
  step.comment = text || null;
  claim.sampleAuditedBy = user.id;
  claim.sampleAuditedAt = toIso(now);

  if (decision === 'CLEAR') {
    step.status = 'APPROVED';
    claim.sampleAuditStatus = 'CLEARED';
    if (text) addCommentRecord(claim, { now, authorId: user.id, authorRole: 'AUDITOR', kind: 'APPROVE_NOTE', text });
    touch(claim, now);
    appendAudit(db, {
      now,
      actorId: user.id,
      onBehalfOfId: acting.onBehalfOfId,
      action: 'SAMPLE_CLEARED',
      entityType: 'CLAIM',
      entityId: claim.id,
      claimId: claim.id,
      comment: text || null,
      details: { sampleAuditStatus: 'CLEARED' },
    });
    return claim;
  }
  if (decision === 'REJECT') {
    step.status = 'REJECTED';
    claim.sampleAuditStatus = 'REJECTED';
    claim.decisionReason = text;
    claim.decidedAt = toIso(now);
    addCommentRecord(claim, { now, authorId: user.id, authorRole: 'AUDITOR', kind: 'REJECT_REASON', text });
    transition(db, claim, STATUS.REJECTED, { now, actorId: user.id, onBehalfOfId: acting.onBehalfOfId, action: 'SAMPLE_REJECTED', comment: text, details: { sampleAuditStatus: 'REJECTED' } });
    notify(db, { now, recipientId: owner?.id, type: 'CLAIM_DECIDED', title: `${claim.claimNumber} was rejected in a sample audit`, message: text, claimId: claim.id });
    return claim;
  }
  if (decision === 'SEND_BACK') {
    step.status = 'SENT_BACK';
    step.sentBackBy = acting.onBehalfOfId ?? user.id;
    claim.sampleAuditStatus = 'SENT_BACK';
    addCommentRecord(claim, { now, authorId: user.id, authorRole: 'AUDITOR', kind: 'SEND_BACK', text });
    transition(db, claim, STATUS.SENT_BACK, { now, actorId: user.id, onBehalfOfId: acting.onBehalfOfId, action: 'SAMPLE_SENT_BACK', comment: text, details: { sampleAuditStatus: 'SENT_BACK' } });
    notify(db, { now, recipientId: owner?.id, type: 'SENT_BACK', title: `${claim.claimNumber} was sent back after a sample audit`, message: text, claimId: claim.id });
    return claim;
  }
  throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown decision.');
}

/* ----------------------------------------------------------------- preview */

/**
 * Route the claim would take if submitted now (empty for auto-approve or
 * auto-reject), plus the status it would land in.
 */
export function previewRoute(db, claim, owner, policy, outcome, totalPaise) {
  if (outcome === 'AUTO_REJECT') return { routePreview: [], expectedStatus: STATUS.AUTO_REJECTED };
  const firstSubmit = claim.submissionNo === 0;
  const clean = outcome === 'AUTO_APPROVE' && totalPaise <= toPaise(policy.autoApproveMaxTotal);
  const sampleResubmit = claim.status === STATUS.SENT_BACK && claim.sampleAudit && claim.sampleAuditStatus === 'SENT_BACK';
  if ((firstSubmit || sampleResubmit) && clean) return { routePreview: [], expectedStatus: STATUS.AUTO_APPROVED };
  const defs = requiredSteps(db, owner, totalPaise, policy).map((d) => d.stepType);
  if (!firstSubmit && claim.status === STATUS.SENT_BACK && !sampleResubmit && claim.lastLinesHash === linesHash(claim)) {
    const sentBack = claim.steps.find((s) => s.status === 'SENT_BACK' && s.stepType !== 'SAMPLE_AUDIT');
    if (sentBack) {
      const remaining = claim.steps
        .filter((s) => s.stepType !== 'SAMPLE_AUDIT' && s.status !== 'CANCELLED' && STEP_ORDER[s.stepType] >= STEP_ORDER[sentBack.stepType])
        .map((s) => s.stepType);
      for (const t of defs) if (!remaining.includes(t) && STEP_ORDER[t] > STEP_ORDER[sentBack.stepType]) remaining.push(t);
      return { routePreview: remaining, expectedStatus: STEP_STATUS_FOR_CLAIM[sentBack.stepType] };
    }
  }
  return { routePreview: defs, expectedStatus: STEP_STATUS_FOR_CLAIM[defs[0]] };
}
