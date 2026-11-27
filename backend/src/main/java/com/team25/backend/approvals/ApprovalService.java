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
import com.team25.backend.policy.PolicyRepository;
import com.team25.backend.web.BadRequestException;
import com.team25.backend.web.ConflictException;
import com.team25.backend.web.ForbiddenException;

/**
 * Approver actions on the current chain step (M3 / A2) and the approver inbox (M1). Nobody acts on their own
 * claim; flags never block approval (US6-AC2); every decision is audited (US5-AC4).
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

    private final JdbcClient jdbc;
    private final ClaimRepository claims;
    private final ClaimViews views;
    private final ApprovalRouting routing;
    private final PolicyRepository policies;
    private final AuditService audit;
    private final NotificationService notifications;

    public ApprovalService(JdbcClient jdbc, ClaimRepository claims, ClaimViews views, ApprovalRouting routing,
            PolicyRepository policies, AuditService audit, NotificationService notifications) {
        this.jdbc = jdbc;
        this.claims = claims;
        this.views = views;
        this.routing = routing;
        this.policies = policies;
        this.audit = audit;
        this.notifications = notifications;
    }

    private record Acting(ClaimRow claim, StepRow step, ActAs as) {
    }

    /** Common checks: visible (404), not own claim (403), pending chain status (409), version (409), may act (403). */
    private Acting begin(AppPrincipal me, UUID claimId, int version) {
        ClaimRow c = claims.lock(claimId).orElseThrow(ClaimViews::notFound);
        if (!claims.canView(c, me)) {
            throw ClaimViews.notFound();
        }
        if (c.ownedBy(me.id())) {
            throw new ForbiddenException("You cannot act on your own claim");
        }
        if (!ClaimStatus.PENDING_CHAIN.contains(c.status())) {
            throw new ConflictException("Claim is not waiting for approval (status " + c.status() + ")");
        }
        if (c.version() != version) {
            throw new ConflictException("Claim was modified by another request (version " + c.version()
                    + ", you sent " + version + "); reload and retry");
        }
        StepRow step = claims.steps(claimId).stream()
                .filter(s -> "PENDING".equals(s.status()) && s.stepType() != StepType.SAMPLE_AUDIT)
                .findFirst()
                .orElseThrow(() -> new ConflictException("Claim has no pending approval step"));
        ActAs as = routing.actAs(step, me, c.employeeId())
                .orElseThrow(() -> new ForbiddenException("You are not the approver for this step"));
        return new Acting(c, step, as);
    }

    @Transactional
    public void approve(AppPrincipal me, UUID claimId, int version, String comment) {
        Acting a = begin(me, claimId, version);
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
    }

    @Transactional
    public void reject(AppPrincipal me, UUID claimId, int version, String reason) {
        Acting a = begin(me, claimId, version);
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
        Acting a = begin(me, claimId, version);
        Instant now = Instant.now();
        markStep(a, "SENT_BACK", me, comment, now, true);
        updateClaim(claimId, ClaimStatus.SENT_BACK, null, false, now);
        audit.record(Entry.claim(me.id(), claimId, "SENT_BACK").onBehalfOf(a.as().onBehalfOf())
                .status(a.claim().status(), ClaimStatus.SENT_BACK).comment(comment)
                .details(Map.of("stepId", a.step().id().toString(), "stepType", a.step().stepType().name())));
        notifications.sentBack(claims.find(claimId).orElseThrow(), comment);
    }

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
        jdbc.sql("""
                UPDATE approval_step SET status = :status, acted_by = :me, acted_on_behalf_of = :obo, acted_at = :now,
                       comment = :comment, sent_back_by = CASE WHEN :sentBack THEN :sender ELSE sent_back_by END
                 WHERE id = :id""")
                .param("status", status).param("me", me.id()).param("obo", a.as().onBehalfOf())
                .param("now", Timestamp.from(now)).param("comment", blankToNull(comment)).param("sentBack", sentBack)
                .param("sender", sender).param("id", a.step().id())
                .update();
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

    // ------------------------------------------------------------------ inbox (M1)

    @Transactional(readOnly = true)
    public Page<InboxItem> inbox(AppPrincipal me, InboxFilter f, int page, int size) {
        if (f.minAmount() != null && f.maxAmount() != null && f.maxAmount().compareTo(f.minAmount()) < 0) {
            throw new BadRequestException("Validation failed: maxAmount: must not be below minAmount");
        }
        int overdueHours = policies.current().overdueThresholdHours();
        String state = f.state() == null ? "PENDING" : f.state();
        Map<String, Object> params = new HashMap<>();
        params.put("me", me.id());
        params.put("roles", me.roles().stream().map(Enum::name).toList());
        params.put("hours", overdueHours);
        List<String> where = new ArrayList<>();
        String order;
        switch (state) {
            case "PENDING", "OVERDUE" -> {
                where.add("s.status = 'PENDING'");
                where.add("s.step_type <> 'SAMPLE_AUDIT'");
                where.add("c.status IN ('PENDING_MANAGER', 'PENDING_AUDITOR', 'PENDING_FINANCE_HEAD')");
                where.add("c.employee_id <> :me");
                where.add("""
                        (s.assignee_id = :me
                         OR (s.assignee_id IS NULL AND s.required_role IN (:roles))
                         OR (s.assignee_id IS NOT NULL AND s.required_role IN (:roles) AND EXISTS (
                               SELECT 1 FROM delegation d WHERE d.delegator_id = s.assignee_id AND d.delegate_id = :me
                                  AND d.revoked_at IS NULL AND """ + DelegationRepository.TODAY + " BETWEEN d.starts_on AND d.ends_on)))");
                if ("OVERDUE".equals(state)) {
                    where.add("s.pending_since < now() - make_interval(hours => :hours)");
                }
                order = "s.pending_since ASC, s.id";
            }
            case "SENT_BACK" -> {
                where.add("s.status = 'SENT_BACK'");
                where.add("c.status = 'SENT_BACK'");
                where.add("(s.acted_by = :me OR s.sent_back_by = :me)");
                order = "s.acted_at DESC, s.id";
            }
            case "DECIDED" -> {
                where.add("s.status IN ('APPROVED', 'REJECTED')");
                where.add("(s.acted_by = :me OR s.acted_on_behalf_of = :me)");
                order = "s.acted_at DESC, s.id";
            }
            default -> throw new BadRequestException("Invalid value for parameter 'state'");
        }
        if (f.stepType() != null) {
            where.add("s.step_type = :stepType");
            params.put("stepType", f.stepType().name());
        }
        if (f.departmentId() != null) {
            where.add("c.department_id = :dept");
            params.put("dept", f.departmentId());
        }
        if (f.minAmount() != null) {
            where.add("c.total_amount >= :minAmount");
            params.put("minAmount", f.minAmount());
        }
        if (f.maxAmount() != null) {
            where.add("c.total_amount <= :maxAmount");
            params.put("maxAmount", f.maxAmount());
        }
        if (f.q() != null && !f.q().isBlank()) {
            where.add("(c.claim_number ILIKE :q OR c.title ILIKE :q)");
            params.put("q", ClaimRepository.like(f.q()));
        }
        String from = " FROM approval_step s JOIN expense_claim c ON c.id = s.claim_id WHERE " + String.join(" AND ", where);

        var countSpec = jdbc.sql("SELECT count(*)" + from);
        for (var e : params.entrySet()) {
            countSpec = countSpec.param(e.getKey(), e.getValue());
        }
        long total = countSpec.query(Long.class).single();

        record Row(UUID stepId, UUID claimId, StepType type, UUID assigneeId, String assigneeName, Instant pendingSince,
                String status, Instant actedAt) {
        }
        var spec = jdbc.sql("SELECT s.id, s.claim_id, s.step_type, s.assignee_id, a.full_name AS a_name, s.pending_since,"
                + " s.status, s.acted_at" + from.replace(" WHERE ", " LEFT JOIN app_user a ON a.id = s.assignee_id WHERE ")
                + " ORDER BY " + order + " OFFSET :offset LIMIT :limit");
        for (var e : params.entrySet()) {
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
