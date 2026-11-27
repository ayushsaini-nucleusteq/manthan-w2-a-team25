package com.team25.backend.approvals;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.team25.backend.approvals.ApprovalRouting.ActAs;
import com.team25.backend.audit.AuditService;
import com.team25.backend.audit.AuditService.Entry;
import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.auth.UserDirectory.Ref;
import com.team25.backend.claims.ClaimApi.AuditEventView;
import com.team25.backend.claims.ClaimApi.ClaimSummary;
import com.team25.backend.claims.ClaimApi.Page;
import com.team25.backend.claims.ClaimRepository;
import com.team25.backend.claims.ClaimRepository.ClaimRow;
import com.team25.backend.claims.ClaimRepository.StepRow;
import com.team25.backend.claims.ClaimViews;
import com.team25.backend.domain.ClaimStatus;
import com.team25.backend.domain.Money;
import com.team25.backend.domain.StepType;
import com.team25.backend.notify.NotificationService;
import com.team25.backend.observability.ApprovalMetrics;
import com.team25.backend.policy.PolicyRepository;
import com.team25.backend.web.BadRequestException;
import com.team25.backend.web.ConflictException;
import com.team25.backend.web.ForbiddenException;

/**
 * Approver actions (M3 / A2 / A4) and the pending-work lists (M1 inbox, A1 queue). Nobody acts on their own claim;
 * flags never block approval (US6-AC2); every decision is audited (US5-AC4) and timed (US18).
 */
@Service
public class ApprovalService {

    public record InboxItem(UUID stepId, StepType stepType, String state, Instant pendingSince, Double ageHours,
            boolean overdue, boolean delegated, Ref onBehalfOf, MyAction myAction, ClaimSummary claim) {
    }

    public record MyAction(String action, Instant at) {
    }

    public record InboxFilter(String state, StepType stepType, UUID departmentId, BigDecimal minAmount,
            BigDecimal maxAmount, String q) {
    }

    /** A1 queue filters (US9-AC1: all combine with AND; flags are any-of). */
    public record QueueFilter(String amountBand, UUID departmentId, List<String> flags, Integer minAgeHours, String q) {
    }

    private final JdbcClient jdbc;
    private final ClaimRepository claims;
    private final ClaimViews views;
    private final ApprovalRouting routing;
    private final PolicyRepository policies;
    private final AuditService audit;
    private final NotificationService notifications;
    private final ApprovalMetrics metrics;

    public ApprovalService(JdbcClient jdbc, ClaimRepository claims, ClaimViews views, ApprovalRouting routing,
            PolicyRepository policies, AuditService audit, NotificationService notifications, ApprovalMetrics metrics) {
        this.jdbc = jdbc;
        this.claims = claims;
        this.views = views;
        this.routing = routing;
        this.policies = policies;
        this.audit = audit;
        this.notifications = notifications;
        this.metrics = metrics;
    }

    private record Acting(ClaimRow claim, StepRow step, ActAs as) {
    }

    /**
     * Common checks, in this order: visible (404), not own claim (403), right state (409), version if given (409),
     * a pending step of the expected kind (409), caller may act on it (403).
     */
    private Acting begin(AppPrincipal me, UUID claimId, Integer version, boolean sample, StepType requiredType) {
        ClaimRow c = claims.lock(claimId).orElseThrow(ClaimViews::notFound);
        if (!claims.canView(c, me)) {
            throw ClaimViews.notFound();
        }
        if (c.ownedBy(me.id())) {
            throw new ForbiddenException("You cannot act on your own claim");
        }
        if (sample) {
            if (c.status() != ClaimStatus.AUTO_APPROVED || !"PENDING".equals(c.sampleAuditStatus())) {
                throw new ConflictException("Claim has no pending sample audit");
            }
        } else if (!ClaimStatus.PENDING_CHAIN.contains(c.status())) {
            throw new ConflictException("Claim is not waiting for approval (status " + c.status() + ")");
        }
        if (version != null && c.version() != version) {
            throw new ConflictException("Claim was modified by another request (version " + c.version()
                    + ", you sent " + version + "); reload and retry");
        }
        StepRow step = claims.steps(claimId).stream()
                .filter(s -> "PENDING".equals(s.status()) && (s.stepType() == StepType.SAMPLE_AUDIT) == sample)
                .findFirst()
                .orElseThrow(() -> new ConflictException("Claim has no pending approval step"));
        if (requiredType != null && step.stepType() != requiredType) {
            throw new ConflictException("Claim is not waiting for an auditor (status " + c.status() + ")");
        }
        ActAs as = routing.actAs(step, me, c.employeeId())
                .orElseThrow(() -> new ForbiddenException("You are not the approver for this step"));
        return new Acting(c, step, as);
    }

    // ------------------------------------------------------------------ chain steps (M3, A2, A3)

    @Transactional
    public void approve(AppPrincipal me, UUID claimId, Integer version, String comment) {
        approve(me, claimId, version, comment, null);
    }

    /** {@code requiredType} restricts which step may be approved (the A1 bulk bar only approves auditor steps). */
    @Transactional
    public ClaimStatus approve(AppPrincipal me, UUID claimId, Integer version, String comment, StepType requiredType) {
        Acting a = begin(me, claimId, version, false, requiredType);
        Instant now = Instant.now();
        markStep(a, "APPROVED", me, comment, now, false);
        Optional<StepRow> next = claims.steps(claimId).stream().filter(s -> "WAITING".equals(s.status())).findFirst();
        ClaimStatus to;
        if (next.isPresent()) {
            jdbc.sql("UPDATE approval_step SET status = 'PENDING', pending_since = :now WHERE id = :id")
                    .param("now", Timestamp.from(now)).param("id", next.get().id()).update();
            to = ClaimStatus.pendingFor(next.get().stepType());
            updateClaim(claimId, to, null, false, now);
        } else {
            to = ClaimStatus.APPROVED;
            updateClaim(claimId, to, null, true, now);
        }
        audit.record(Entry.claim(me.id(), claimId, "APPROVED").onBehalfOf(a.as().onBehalfOf())
                .status(a.claim().status(), to).comment(blankToNull(comment))
                .details(Map.of("stepId", a.step().id().toString(), "stepType", a.step().stepType().name())));
        ClaimRow after = claims.find(claimId).orElseThrow();
        if (next.isPresent()) {
            notifications.approvalWaiting(after, next.get().assigneeId(), next.get().requiredRole());
        } else {
            notifications.decided(after, "APPROVED", null);
        }
        return to;
    }

    @Transactional
    public void reject(AppPrincipal me, UUID claimId, int version, String reason) {
        Acting a = begin(me, claimId, version, false, null);
        Instant now = Instant.now();
        markStep(a, "REJECTED", me, reason, now, false);
        jdbc.sql("UPDATE approval_step SET status = 'CANCELLED' WHERE claim_id = :id AND status = 'WAITING'")
                .param("id", claimId).update();
        updateClaim(claimId, ClaimStatus.REJECTED, reason, true, now);
        audit.record(Entry.claim(me.id(), claimId, "REJECTED").onBehalfOf(a.as().onBehalfOf())
                .status(a.claim().status(), ClaimStatus.REJECTED).comment(reason)
                .details(Map.of("stepId", a.step().id().toString(), "stepType", a.step().stepType().name())));
        notifications.decided(claims.find(claimId).orElseThrow(), "REJECTED", reason);
    }

    @Transactional
    public void sendBack(AppPrincipal me, UUID claimId, int version, String comment) {
        sendBack(me, claimId, version, comment, null);
    }

    @Transactional
    public ClaimStatus sendBack(AppPrincipal me, UUID claimId, Integer version, String comment, StepType requiredType) {
        Acting a = begin(me, claimId, version, false, requiredType);
        Instant now = Instant.now();
        markStep(a, "SENT_BACK", me, comment, now, true);
        updateClaim(claimId, ClaimStatus.SENT_BACK, null, false, now);
        audit.record(Entry.claim(me.id(), claimId, "SENT_BACK").onBehalfOf(a.as().onBehalfOf())
                .status(a.claim().status(), ClaimStatus.SENT_BACK).comment(comment)
                .details(Map.of("stepId", a.step().id().toString(), "stepType", a.step().stepType().name())));
        notifications.sentBack(claims.find(claimId).orElseThrow(), comment);
        return ClaimStatus.SENT_BACK;
    }

    // ------------------------------------------------------------------ sample audit (A4, US11)

    /** Clears a sample audit: the claim stays AUTO_APPROVED and becomes payout-eligible; auditor and time stored. */
    @Transactional
    public void clearSample(AppPrincipal me, UUID claimId, int version, String comment) {
        Acting a = begin(me, claimId, version, true, null);
        Instant now = Instant.now();
        markStep(a, "APPROVED", me, comment, now, false);
        jdbc.sql("""
                UPDATE expense_claim SET sample_audit_status = 'CLEARED', sample_audited_by = :me, sample_audited_at = :now,
                       version = version + 1, updated_at = now()
                 WHERE id = :id""")
                .param("me", me.id()).param("now", Timestamp.from(now)).param("id", claimId).update();
        audit.record(Entry.claim(me.id(), claimId, "SAMPLE_AUDIT_CLEARED").onBehalfOf(a.as().onBehalfOf())
                .status(ClaimStatus.AUTO_APPROVED, ClaimStatus.AUTO_APPROVED).comment(blankToNull(comment))
                .details(Map.of("stepId", a.step().id().toString(), "stepType", StepType.SAMPLE_AUDIT.name())));
    }

    /** Rejects a sampled claim: final, with the reason; auditor and time stored. */
    @Transactional
    public void rejectSample(AppPrincipal me, UUID claimId, int version, String reason) {
        Acting a = begin(me, claimId, version, true, null);
        Instant now = Instant.now();
        markStep(a, "REJECTED", me, reason, now, false);
        jdbc.sql("""
                UPDATE expense_claim SET status = 'REJECTED', decision_reason = :reason, decided_at = :now,
                       sample_audit_status = 'REJECTED', sample_audited_by = :me, sample_audited_at = :now,
                       version = version + 1, updated_at = now()
                 WHERE id = :id""")
                .param("reason", reason).param("me", me.id()).param("now", Timestamp.from(now)).param("id", claimId)
                .update();
        audit.record(Entry.claim(me.id(), claimId, "REJECTED").onBehalfOf(a.as().onBehalfOf())
                .status(ClaimStatus.AUTO_APPROVED, ClaimStatus.REJECTED).comment(reason)
                .details(Map.of("stepId", a.step().id().toString(), "stepType", StepType.SAMPLE_AUDIT.name())));
        notifications.decided(claims.find(claimId).orElseThrow(), "REJECTED", reason);
    }

    /** Sends a sampled claim back; resubmit returns it to this auditor if still clean (D5). */
    @Transactional
    public void sendBackSample(AppPrincipal me, UUID claimId, int version, String comment) {
        Acting a = begin(me, claimId, version, true, null);
        Instant now = Instant.now();
        markStep(a, "SENT_BACK", me, comment, now, true);
        jdbc.sql("""
                UPDATE expense_claim SET status = 'SENT_BACK', sample_audit_status = 'SENT_BACK', sample_audited_by = :me,
                       sample_audited_at = :now, version = version + 1, updated_at = now()
                 WHERE id = :id""")
                .param("me", me.id()).param("now", Timestamp.from(now)).param("id", claimId).update();
        audit.record(Entry.claim(me.id(), claimId, "SENT_BACK").onBehalfOf(a.as().onBehalfOf())
                .status(ClaimStatus.AUTO_APPROVED, ClaimStatus.SENT_BACK).comment(comment)
                .details(Map.of("stepId", a.step().id().toString(), "stepType", StepType.SAMPLE_AUDIT.name())));
        notifications.sentBack(claims.find(claimId).orElseThrow(), comment);
    }

    // ------------------------------------------------------------------ comments

    /** Any viewer may comment on a non-draft claim; a delegate commenting on a delegated step is "on behalf of". */
    @Transactional
    public AuditEventView comment(AppPrincipal me, UUID claimId, String text) {
        ClaimRow c = views.visible(claimId, me);
        if (c.status() == ClaimStatus.DRAFT) {
            throw new ConflictException("Comments are added once the claim is submitted");
        }
        UUID onBehalfOf = claims.steps(claimId).stream().filter(s -> "PENDING".equals(s.status())).findFirst()
                .flatMap(s -> routing.actAs(s, me, c.employeeId())).map(ActAs::onBehalfOf).orElse(null);
        audit.record(Entry.claim(me.id(), claimId, "COMMENTED").onBehalfOf(onBehalfOf).status(c.status(), c.status())
                .comment(text.strip()));
        var row = claims.audit(claimId, (int) Math.max(0, claims.countAudit(claimId) - 1), 1).get(0);
        return new AuditEventView(row.id(), row.occurredAt(), row.actor(), row.onBehalfOf(), row.action(),
                row.entityType(), row.entityId(), row.claimId(), row.fromStatus(), row.toStatus(), row.comment(),
                row.details());
    }

    private void markStep(Acting a, String status, AppPrincipal me, String comment, Instant now, boolean sentBack) {
        UUID sender = a.as().onBehalfOf() != null ? a.as().onBehalfOf() : me.id();
        // Compare-and-set: the claim row is already locked (FOR UPDATE), and the step must still be PENDING, so
        // two concurrent decisions can never both land (the loser gets 409).
        int updated = jdbc.sql("""
                UPDATE approval_step SET status = :status, acted_by = :me, acted_on_behalf_of = :obo, acted_at = :now,
                       comment = :comment, sent_back_by = CASE WHEN :sentBack THEN :sender ELSE sent_back_by END
                 WHERE id = :id AND status = 'PENDING'""")
                .param("status", status).param("me", me.id()).param("obo", a.as().onBehalfOf())
                .param("now", Timestamp.from(now)).param("comment", blankToNull(comment)).param("sentBack", sentBack)
                .param("sender", sender).param("id", a.step().id())
                .update();
        if (updated != 1) {
            throw new ConflictException("This approval step was already decided; reload the claim");
        }
        if (a.step().pendingSince() != null) {
            metrics.recordDecision(a.step().stepType(), status, Duration.between(a.step().pendingSince(), now));
        }
    }

    private void updateClaim(UUID claimId, ClaimStatus status, String reason, boolean decided, Instant now) {
        jdbc.sql("""
                UPDATE expense_claim SET status = :status, decision_reason = COALESCE(:reason, decision_reason),
                       decided_at = CASE WHEN :decided THEN :now ELSE decided_at END,
                       version = version + 1, updated_at = now()
                 WHERE id = :id""")
                .param("status", status.name()).param("reason", reason).param("decided", decided)
                .param("now", Timestamp.from(now)).param("id", claimId).update();
    }

    // ------------------------------------------------------------------ inbox (M1) and auditor queue (A1)

    /** Steps the caller can act on now: assigned to them, their role's pool, or delegated to them. */
    private static final String CAN_ACT = """
            (s.assignee_id = :me
             OR (s.assignee_id IS NULL AND s.required_role IN (:roles))
             OR (s.assignee_id IS NOT NULL AND s.required_role IN (:roles) AND EXISTS (
                   SELECT 1 FROM delegation d WHERE d.delegator_id = s.assignee_id AND d.delegate_id = :me
                      AND d.revoked_at IS NULL AND""" + DelegationRepository.TODAY + "BETWEEN d.starts_on AND d.ends_on)))";

    @Transactional(readOnly = true)
    public Page<InboxItem> inbox(AppPrincipal me, InboxFilter f, int page, int size) {
        if (f.minAmount() != null && f.maxAmount() != null && f.maxAmount().compareTo(f.minAmount()) < 0) {
            throw new BadRequestException("Validation failed: maxAmount: must not be below minAmount");
        }
        String state = f.state() == null ? "PENDING" : f.state();
        Query q = new Query(me);
        String order;
        switch (state) {
            case "PENDING", "OVERDUE" -> {
                q.pendingChainFor();
                if ("OVERDUE".equals(state)) {
                    q.where("s.pending_since < now() - make_interval(hours => :hours)");
                    q.param("hours", policies.current().overdueThresholdHours());
                }
                order = "s.pending_since ASC, s.id";
            }
            case "SENT_BACK" -> {
                q.where("s.status = 'SENT_BACK'");
                q.where("c.status = 'SENT_BACK'");
                q.where("(s.acted_by = :me OR s.sent_back_by = :me)");
                order = "s.acted_at DESC, s.id";
            }
            case "DECIDED" -> {
                q.where("s.status IN ('APPROVED', 'REJECTED')");
                q.where("(s.acted_by = :me OR s.acted_on_behalf_of = :me)");
                order = "s.acted_at DESC, s.id";
            }
            default -> throw new BadRequestException("Invalid value for parameter 'state'");
        }
        if (f.stepType() != null) {
            q.where("s.step_type = :stepType").param("stepType", f.stepType().name());
        }
        q.common(f.departmentId(), f.minAmount(), f.maxAmount(), f.q());
        return page(me, q, order, page, size);
    }

    /** A1: pending AUDITOR steps the caller can act on, oldest first; sample-tagged claims never appear (US11-AC2). */
    @Transactional(readOnly = true)
    public Page<InboxItem> auditorQueue(AppPrincipal me, QueueFilter f, int page, int size) {
        Query q = new Query(me);
        q.pendingChainFor();
        q.where("s.step_type = 'AUDITOR'");
        if (f.amountBand() != null) {
            switch (f.amountBand()) {
                case "UP_TO_25K" -> q.where("c.total_amount <= 25000");
                case "FROM_25K_TO_100K" -> q.where("c.total_amount > 25000 AND c.total_amount <= 100000");
                case "ABOVE_100K" -> q.where("c.total_amount > 100000");
                default -> throw new BadRequestException("Invalid value for parameter 'amountBand'");
            }
        }
        if (f.flags() != null && !f.flags().isEmpty()) {
            q.where("EXISTS (SELECT 1 FROM policy_finding pf WHERE pf.claim_id = c.id AND pf.reason_code IN (:flags))")
                    .param("flags", f.flags());
        }
        if (f.minAgeHours() != null) {
            q.where("s.pending_since <= now() - make_interval(hours => :minAge)").param("minAge", f.minAgeHours());
        }
        q.common(f.departmentId(), null, null, f.q());
        return page(me, q, "s.pending_since ASC, s.id", page, size);
    }

    /** Small WHERE builder shared by the inbox and the queue. */
    private static final class Query {
        final List<String> where = new ArrayList<>();
        final Map<String, Object> params = new HashMap<>();

        Query(AppPrincipal me) {
            params.put("me", me.id());
            params.put("roles", me.roles().stream().map(Enum::name).toList());
        }

        Query where(String sql) {
            where.add(sql);
            return this;
        }

        Query param(String name, Object value) {
            params.put(name, value);
            return this;
        }

        /** Pending chain steps (never sample audits) the caller may act on, never on their own claims. */
        void pendingChainFor() {
            where("s.status = 'PENDING'");
            where("s.step_type <> 'SAMPLE_AUDIT'");
            where("c.status IN ('PENDING_MANAGER', 'PENDING_AUDITOR', 'PENDING_FINANCE_HEAD')");
            where("c.employee_id <> :me");
            where(CAN_ACT);
        }

        void common(UUID departmentId, BigDecimal min, BigDecimal max, String q) {
            if (departmentId != null) {
                where("c.department_id = :dept").param("dept", departmentId);
            }
            if (min != null) {
                where("c.total_amount >= :minAmount").param("minAmount", min);
            }
            if (max != null) {
                where("c.total_amount <= :maxAmount").param("maxAmount", max);
            }
            if (q != null && !q.isBlank()) {
                where("(c.claim_number ILIKE :q OR c.title ILIKE :q)").param("q", ClaimRepository.like(q));
            }
        }
    }

    private Page<InboxItem> page(AppPrincipal me, Query q, String order, int page, int size) {
        int overdueHours = policies.current().overdueThresholdHours();
        String from = " FROM approval_step s JOIN expense_claim c ON c.id = s.claim_id"
                + " LEFT JOIN app_user a ON a.id = s.assignee_id WHERE " + String.join(" AND ", q.where);

        var countSpec = jdbc.sql("SELECT count(*)" + from);
        for (var e : q.params.entrySet()) {
            countSpec = countSpec.param(e.getKey(), e.getValue());
        }
        long total = countSpec.query(Long.class).single();

        record Row(UUID stepId, UUID claimId, StepType type, UUID assigneeId, String assigneeName, Instant pendingSince,
                String status, Instant actedAt) {
        }
        var spec = jdbc.sql("SELECT s.id, s.claim_id, s.step_type, s.assignee_id, a.full_name AS a_name, s.pending_since,"
                + " s.status, s.acted_at" + from + " ORDER BY " + order + " OFFSET :offset LIMIT :limit");
        for (var e : q.params.entrySet()) {
            spec = spec.param(e.getKey(), e.getValue());
        }
        List<Row> rows = spec.param("offset", page * size).param("limit", size)
                .query((rs, i) -> new Row(rs.getObject("id", UUID.class), rs.getObject("claim_id", UUID.class),
                        StepType.valueOf(rs.getString("step_type")), rs.getObject("assignee_id", UUID.class),
                        rs.getString("a_name"), ts(rs.getTimestamp("pending_since")), rs.getString("status"),
                        ts(rs.getTimestamp("acted_at"))))
                .list();
        List<ClaimSummary> summaries = claims.summaries(rows.stream().map(Row::claimId).toList());
        Instant now = Instant.now();
        List<InboxItem> items = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            Row r = rows.get(i);
            boolean pending = "PENDING".equals(r.status());
            Double age = pending && r.pendingSince() != null
                    ? Math.round(Duration.between(r.pendingSince(), now).toMinutes() / 6.0) / 10.0
                    : null;
            boolean delegated = pending && r.assigneeId() != null && !r.assigneeId().equals(me.id());
            items.add(new InboxItem(r.stepId(), r.type(), pending ? "PENDING" : r.status().equals("SENT_BACK") ? "SENT_BACK" : "DECIDED",
                    r.pendingSince(), age, age != null && age >= overdueHours, delegated,
                    delegated ? new Ref(r.assigneeId(), r.assigneeName()) : null,
                    pending ? null : new MyAction(r.status(), r.actedAt()), summaries.get(i)));
        }
        return Page.of(items, page, size, total);
    }

    private static Instant ts(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }

    static BigDecimal money(String value) {
        return value == null ? null : Money.parse(value);
    }
}
