package com.team25.backend.dashboard;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.team25.backend.domain.Money;
import com.team25.backend.domain.StepType;
import com.team25.backend.policy.PolicyRepository;
import com.team25.backend.web.BadRequestException;

/**
 * F1 dashboard (US16, US18-AC3). Spend counts lines of APPROVED / AUTO_APPROVED / IN_BATCH / PAID claims by expense
 * date; violations count findings of claims submitted in range; approval time is latest submit → final approval
 * for human-approved claims (auto-approved excluded); queues, oldest pending and the age alert are live.
 */
@Service
public class DashboardService {

    public record CategorySpend(String category, String amount, long lineCount) {
    }

    public record DepartmentSpend(UUID departmentId, String departmentName, String amount, long claimCount) {
    }

    public record MonthSpend(String month, String amount, long claimCount) {
    }

    public record ReasonCount(String reasonCode, String outcome, long count) {
    }

    public record Violations(long totalFindings, long autoRejectedClaims, long routedClaims, List<ReasonCount> byReason) {
    }

    public record ApprovalTime(long claimCount, Double averageHours) {
    }

    public record Queue(StepType stepType, long pending, long overdue) {
    }

    public record OldestPending(UUID claimId, String claimNumber, StepType stepType, Instant pendingSince, double ageHours) {
    }

    public record AgeAlert(int thresholdHours, boolean breached, Instant breachedSince) {
    }

    public record Dashboard(LocalDate from, LocalDate to, String totalSpend, List<CategorySpend> spendByCategory,
            List<DepartmentSpend> spendByDepartment, List<MonthSpend> spendByMonth, Violations policyViolations,
            ApprovalTime approvalTime, List<Queue> queues, OldestPending oldestPending, AgeAlert approvalAgeAlert) {
    }

    private static final String SPEND_FROM = " FROM expense_line l JOIN expense_claim c ON c.id = l.claim_id";
    private static final String SPEND_WHERE = " WHERE c.status IN ('APPROVED', 'AUTO_APPROVED', 'IN_BATCH', 'PAID')"
            + " AND l.expense_date BETWEEN :from AND :to";
    private static final String SPEND = SPEND_FROM + SPEND_WHERE;
    private static final String SUBMITTED_IN_RANGE =
            "c.submitted_at IS NOT NULL AND (c.submitted_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN :from AND :to";

    private final JdbcClient jdbc;
    private final PolicyRepository policies;

    public DashboardService(JdbcClient jdbc, PolicyRepository policies) {
        this.jdbc = jdbc;
        this.policies = policies;
    }

    @Transactional(readOnly = true)
    public Dashboard dashboard(LocalDate from, LocalDate to, UUID departmentId) {
        if (to.isBefore(from)) {
            throw new BadRequestException("Validation failed: to: must not be before from");
        }
        if (ChronoUnit.DAYS.between(from, to) > 365) {
            throw new BadRequestException("Validation failed: the range can be at most 366 days");
        }
        Map<String, Object> p = new HashMap<>();
        p.put("from", from);
        p.put("to", to);
        String dept = "";
        if (departmentId != null) {
            dept = " AND c.department_id = :dept";
            p.put("dept", departmentId);
        }

        List<CategorySpend> byCategory = q("SELECT l.category, sum(l.amount) AS amount, count(*) AS n" + SPEND + dept
                + " GROUP BY l.category ORDER BY amount DESC", p)
                .query((rs, i) -> new CategorySpend(rs.getString("category"), money(rs.getBigDecimal("amount")), rs.getLong("n")))
                .list();
        List<DepartmentSpend> byDept = q("SELECT d.id, d.name, sum(l.amount) AS amount, count(DISTINCT c.id) AS n"
                + SPEND_FROM + " JOIN department d ON d.id = c.department_id" + SPEND_WHERE + dept
                + " GROUP BY d.id, d.name ORDER BY amount DESC", p)
                .query((rs, i) -> new DepartmentSpend(rs.getObject("id", UUID.class), rs.getString("name"),
                        money(rs.getBigDecimal("amount")), rs.getLong("n")))
                .list();
        List<MonthSpend> byMonth = q("SELECT to_char(l.expense_date, 'YYYY-MM') AS month, sum(l.amount) AS amount,"
                + " count(DISTINCT c.id) AS n" + SPEND + dept + " GROUP BY month ORDER BY month", p)
                .query((rs, i) -> new MonthSpend(rs.getString("month"), money(rs.getBigDecimal("amount")), rs.getLong("n")))
                .list();
        BigDecimal total = q("SELECT COALESCE(sum(l.amount), 0)" + SPEND + dept, p).query(BigDecimal.class).single();

        List<ReasonCount> byReason = q("""
                SELECT f.reason_code, f.outcome, count(*) AS n
                  FROM policy_finding f JOIN expense_claim c ON c.id = f.claim_id
                 WHERE f.reason_code <> 'WITHIN_LIMIT' AND """ + " " + SUBMITTED_IN_RANGE + dept
                + " GROUP BY f.reason_code, f.outcome ORDER BY n DESC, f.reason_code", p)
                .query((rs, i) -> new ReasonCount(rs.getString("reason_code"), rs.getString("outcome"), rs.getLong("n")))
                .list();
        Map<String, Object> claimsRow = q("""
                SELECT count(*) FILTER (WHERE c.status = 'AUTO_REJECTED') AS rejected,
                       count(*) FILTER (WHERE c.policy_outcome = 'ROUTE') AS routed
                  FROM expense_claim c WHERE """ + " " + SUBMITTED_IN_RANGE + dept, p).query().singleRow();
        Violations violations = new Violations(byReason.stream().mapToLong(ReasonCount::count).sum(),
                ((Number) claimsRow.get("rejected")).longValue(), ((Number) claimsRow.get("routed")).longValue(), byReason);

        Map<String, Object> time = q("""
                SELECT count(*) AS n, avg(EXTRACT(EPOCH FROM c.decided_at - c.submitted_at)) / 3600.0 AS hours
                  FROM expense_claim c
                 WHERE c.policy_outcome = 'ROUTE' AND c.status IN ('APPROVED', 'IN_BATCH', 'PAID')
                   AND (c.decided_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN :from AND :to""" + dept, p).query().singleRow();
        Number hours = (Number) time.get("hours");
        ApprovalTime approvalTime = new ApprovalTime(((Number) time.get("n")).longValue(),
                hours == null ? null : Math.round(hours.doubleValue() * 10) / 10.0);

        int threshold = policies.current().overdueThresholdHours();
        Map<String, Object> live = new HashMap<>(p);
        live.put("hours", threshold);
        Map<StepType, Queue> queues = new EnumMap<>(StepType.class);
        for (StepType t : StepType.values()) {
            queues.put(t, new Queue(t, 0, 0));
        }
        q("""
                SELECT s.step_type, count(*) AS n,
                       count(*) FILTER (WHERE s.pending_since < now() - make_interval(hours => :hours)) AS overdue
                  FROM approval_step s JOIN expense_claim c ON c.id = s.claim_id
                 WHERE s.status = 'PENDING'""" + dept + " GROUP BY s.step_type", live)
                .query(rs -> {
                    StepType t = StepType.valueOf(rs.getString("step_type"));
                    queues.put(t, new Queue(t, rs.getLong("n"), rs.getLong("overdue")));
                });
        Instant now = Instant.now();
        OldestPending oldest = q("""
                SELECT c.id, c.claim_number, s.step_type, s.pending_since
                  FROM approval_step s JOIN expense_claim c ON c.id = s.claim_id
                 WHERE s.status = 'PENDING'""" + dept + " ORDER BY s.pending_since ASC, s.id LIMIT 1", p)
                .query((rs, i) -> {
                    Instant since = rs.getTimestamp("pending_since").toInstant();
                    return new OldestPending(rs.getObject("id", UUID.class), rs.getString("claim_number"),
                            StepType.valueOf(rs.getString("step_type")), since,
                            Math.round(Duration.between(since, now).toMinutes() / 6.0) / 10.0);
                })
                .optional().orElse(null);
        boolean breached = oldest != null && oldest.ageHours() >= threshold;
        AgeAlert alert = new AgeAlert(threshold, breached,
                breached ? oldest.pendingSince().plus(Duration.ofHours(threshold)) : null);

        return new Dashboard(from, to, money(total), byCategory, byDept, byMonth, violations, approvalTime,
                new ArrayList<>(queues.values()), oldest, alert);
    }

    private org.springframework.jdbc.core.simple.JdbcClient.StatementSpec q(String sql, Map<String, Object> params) {
        var spec = jdbc.sql(sql);
        for (var e : params.entrySet()) {
            if (sql.contains(":" + e.getKey())) {
                spec = spec.param(e.getKey(), e.getValue());
            }
        }
        return spec;
    }

    private static String money(BigDecimal v) {
        return Money.format(v == null ? BigDecimal.ZERO : v);
    }
}
