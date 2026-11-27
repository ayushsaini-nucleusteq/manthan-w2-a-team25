package com.team25.backend.approvals;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.claims.ClaimRepository.StepRow;
import com.team25.backend.domain.Role;
import com.team25.backend.domain.StepType;
import com.team25.backend.policy.PolicyVersion;

/**
 * Who gets each approval step, who may act on it, and where a resubmitted claim goes. Delegation is resolved
 * when someone acts (not stored on the step), so a delegation that starts or ends later applies automatically.
 */
@Component
public class ApprovalRouting {

    /** Assignee null = role pool. */
    public record Assignment(UUID assigneeId, Role requiredRole) {
    }

    /** How the caller may act on a step; {@code onBehalfOf} is the delegator when acting as delegate. */
    public record ActAs(UUID onBehalfOf) {
    }

    private record UserState(UUID managerId, boolean active) {
    }

    private final JdbcClient jdbc;
    private final DelegationRepository delegations;

    public ApprovalRouting(JdbcClient jdbc, DelegationRepository delegations) {
        this.jdbc = jdbc;
        this.delegations = delegations;
    }

    /** MANAGER step: the owner's first active manager up the hierarchy; none → finance-head pool (decision D6). */
    public Assignment managerStepFor(UUID ownerId) {
        Optional<UUID> manager = firstActiveManagerAbove(ownerId, ownerId);
        return manager.map(id -> new Assignment(id, Role.MANAGER)).orElseGet(() -> new Assignment(null, Role.FINANCE_HEAD));
    }

    /**
     * Creates the chain for a claim from {@code startSeq}: MANAGER (pending now), then AUDITOR if total is above
     * the auditor threshold, then FINANCE_HEAD if above the head threshold (strictly greater: 25000 / 100000 exactly
     * do not add the step, US8-AC2 / US12-AC2).
     */
    public List<StepType> createChain(UUID claimId, UUID ownerId, BigDecimal total, PolicyVersion policy, int startSeq,
            Instant now) {
        List<StepType> created = new ArrayList<>();
        Assignment manager = managerStepFor(ownerId);
        insertStep(claimId, startSeq, StepType.MANAGER, manager, "PENDING", now);
        created.add(StepType.MANAGER);
        created.addAll(appendMissing(claimId, total, policy, Set.of(StepType.MANAGER), startSeq + 1));
        return created;
    }

    /** Appends AUDITOR / FINANCE_HEAD steps the total now requires but the claim doesn't have (as WAITING). */
    public List<StepType> appendMissing(UUID claimId, BigDecimal total, PolicyVersion policy, Set<StepType> existing,
            int nextSeq) {
        List<StepType> added = new ArrayList<>();
        Set<StepType> have = new HashSet<>(existing);
        int seq = nextSeq;
        if (total.compareTo(policy.auditorAboveTotal()) > 0 && !have.contains(StepType.AUDITOR)) {
            insertStep(claimId, seq++, StepType.AUDITOR, new Assignment(null, Role.AUDITOR), "WAITING", null);
            added.add(StepType.AUDITOR);
        }
        if (total.compareTo(policy.financeHeadAboveTotal()) > 0 && !have.contains(StepType.FINANCE_HEAD)) {
            insertStep(claimId, seq, StepType.FINANCE_HEAD, new Assignment(null, Role.FINANCE_HEAD), "WAITING", null);
            added.add(StepType.FINANCE_HEAD);
        }
        return added;
    }

    public void insertStep(UUID claimId, int sequence, StepType type, Assignment who, String status, Instant pendingSince) {
        jdbc.sql("""
                INSERT INTO approval_step (claim_id, sequence, step_type, required_role, assignee_id, status, pending_since)
                VALUES (:claim, :seq, :type, :role, :assignee, :status, :since)""")
                .param("claim", claimId).param("seq", sequence).param("type", type.name())
                .param("role", who.requiredRole().name()).param("assignee", who.assigneeId())
                .param("status", status).param("since", pendingSince == null ? null : Timestamp.from(pendingSince))
                .update();
    }

    /**
     * Whether {@code me} may act on {@code step} of a claim owned by {@code ownerId}. Never the owner. A named
     * step: the assignee, or their active delegate holding the step's role. A pool step: any holder of the role.
     */
    public Optional<ActAs> actAs(StepRow step, AppPrincipal me, UUID ownerId) {
        if (me.id().equals(ownerId)) {
            return Optional.empty();
        }
        if (step.assigneeId() == null) {
            return me.has(step.requiredRole()) ? Optional.of(new ActAs(null)) : Optional.empty();
        }
        if (step.assigneeId().equals(me.id())) {
            return Optional.of(new ActAs(null));
        }
        return delegations.canActFor(step.assigneeId(), me.id(), step.requiredRole().name())
                ? Optional.of(new ActAs(step.assigneeId()))
                : Optional.empty();
    }

    /**
     * Assignee for a step that sent the claim back, at resubmit time (decision D4): the person who sent it back
     * if still active; otherwise a manager-role step goes to their first active manager (or the finance-head pool),
     * and auditor / finance-head / sample-audit steps go to the role pool.
     */
    public Assignment returnAssignment(StepRow step, UUID ownerId) {
        UUID sender = step.sentBackBy();
        if (sender != null && isActive(sender) && !sender.equals(ownerId)) {
            return new Assignment(sender, step.requiredRole());
        }
        if (step.requiredRole() == Role.MANAGER && sender != null) {
            return firstActiveManagerAbove(sender, ownerId)
                    .map(id -> new Assignment(id, Role.MANAGER))
                    .orElseGet(() -> new Assignment(null, Role.FINANCE_HEAD));
        }
        return new Assignment(null, step.requiredRole());
    }

    private Optional<UUID> firstActiveManagerAbove(UUID userId, UUID ownerId) {
        Set<UUID> seen = new HashSet<>();
        UUID current = state(userId).map(UserState::managerId).orElse(null);
        while (current != null && seen.add(current)) {
            Optional<UserState> s = state(current);
            if (s.isPresent() && s.get().active() && !current.equals(ownerId)) {
                return Optional.of(current);
            }
            current = s.map(UserState::managerId).orElse(null);
        }
        return Optional.empty();
    }

    private boolean isActive(UUID userId) {
        return state(userId).map(UserState::active).orElse(false);
    }

    private Optional<UserState> state(UUID userId) {
        return jdbc.sql("SELECT manager_id, active FROM app_user WHERE id = :id").param("id", userId)
                .query((rs, i) -> new UserState(rs.getObject("manager_id", UUID.class), rs.getBoolean("active")))
                .optional();
    }
}
