package com.team25.backend.claims;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.team25.backend.approvals.DelegationRepository;
import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.auth.UserDirectory.Dept;
import com.team25.backend.auth.UserDirectory.Ref;
import com.team25.backend.claims.ClaimApi.ClaimSummary;
import com.team25.backend.domain.ClaimStatus;
import com.team25.backend.domain.Money;
import com.team25.backend.domain.PolicyOutcome;
import com.team25.backend.domain.Role;
import com.team25.backend.domain.StepType;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** SQL read model for claims, lines, steps and the claim's audit rows, plus the claim visibility check. */
@Repository
public class ClaimRepository {

    public record ClaimRow(UUID id, String claimNumber, String title, ClaimStatus status, UUID employeeId,
            String employeeName, Dept department, LocalDate tripStartDate, LocalDate tripEndDate, String currency,
            BigDecimal totalAmount, int lineCount, PolicyOutcome policyOutcome, List<String> flags, boolean sampleAudit,
            String sampleAuditStatus, Ref sampleAuditedBy, Instant sampleAuditedAt, Instant submittedAt,
            Instant decidedAt, Instant updatedAt, String purpose, int submissionNo, UUID policyVersionId,
            Integer policyVersionNo, String decisionReason, int version, Instant createdAt) {

        public ClaimSummary summary() {
            return new ClaimSummary(id, claimNumber, title, status, new Ref(employeeId, employeeName), department,
                    tripStartDate, tripEndDate, currency, Money.format(totalAmount), lineCount, policyOutcome, flags,
                    sampleAudit, sampleAuditStatus, sampleAuditedBy, sampleAuditedAt, submittedAt, decidedAt, updatedAt);
        }

        public boolean ownedBy(UUID userId) {
            return employeeId.equals(userId);
        }
    }

    public record ReceiptRow(UUID id, String fileName, String contentType, int sizeBytes, String sha256,
            Instant uploadedAt, String storageKey) {
    }

    public record LineRow(UUID id, UUID claimId, UUID employeeId, int lineNo, String category, BigDecimal amount,
            LocalDate expenseDate, String vendor, String vendorKey, String notes, String city, Integer nights,
            PolicyOutcome policyOutcome, UUID evaluatedPolicyVersionId, Integer evaluatedPolicyVersionNo,
            Instant evaluatedAt, boolean needsEvaluation, Instant createdAt, ReceiptRow receipt) {
    }

    public record StepRow(UUID id, UUID claimId, int sequence, StepType stepType, Role requiredRole, UUID assigneeId,
            String assigneeName, String status, Instant pendingSince, UUID sentBackBy, UUID actedBy,
            String actedByName, UUID onBehalfOf, String onBehalfOfName, Instant actedAt, String comment) {
    }

    public record AuditRow(long id, Instant occurredAt, Ref actor, Ref onBehalfOf, String action, String entityType,
            String entityId, UUID claimId, String fromStatus, String toStatus, String comment, Map<String, Object> details) {
    }

    static final String SUMMARY_SELECT = """
            SELECT c.id, c.claim_number, c.title, c.status, c.employee_id, u.full_name AS emp_name,
                   d.id AS dept_id, d.code AS dept_code, d.name AS dept_name,
                   c.trip_start_date, c.trip_end_date, c.currency, c.total_amount,
                   (SELECT count(*) FROM expense_line l WHERE l.claim_id = c.id) AS line_count,
                   c.policy_outcome,
                   ARRAY(SELECT DISTINCT f.reason_code FROM policy_finding f
                          WHERE f.claim_id = c.id AND f.reason_code <> 'WITHIN_LIMIT' ORDER BY 1) AS flags,
                   c.sample_audit, c.sample_audit_status, c.sample_audited_by, sa.full_name AS sa_name, c.sample_audited_at,
                   c.submitted_at, c.decided_at, c.updated_at, c.purpose, c.submission_no, c.policy_version_id,
                   pv.version_no AS pv_no, c.decision_reason, c.version, c.created_at
              FROM expense_claim c
              JOIN app_user u ON u.id = c.employee_id
              JOIN department d ON d.id = c.department_id
              LEFT JOIN app_user sa ON sa.id = c.sample_audited_by
              LEFT JOIN policy_version pv ON pv.id = c.policy_version_id
            """;

    private final JdbcClient jdbc;
    private final JsonMapper json;

    public ClaimRepository(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public Optional<ClaimRow> find(UUID id) {
        return jdbc.sql(SUMMARY_SELECT + " WHERE c.id = :id").param("id", id).query(ClaimRepository::mapClaim).optional();
    }

    /** Locks the claim row for the rest of the transaction (all state changes go through this). */
    public Optional<ClaimRow> lock(UUID id) {
        boolean exists = jdbc.sql("SELECT id FROM expense_claim WHERE id = :id FOR UPDATE").param("id", id)
                .query(UUID.class).optional().isPresent();
        return exists ? find(id) : Optional.empty();
    }

    public List<ClaimSummary> summaries(List<UUID> ids) {
        if (ids.isEmpty()) {
            return List.of();
        }
        Map<UUID, ClaimSummary> byId = new java.util.HashMap<>();
        jdbc.sql(SUMMARY_SELECT + " WHERE c.id IN (:ids)").param("ids", ids)
                .query(ClaimRepository::mapClaim).list()
                .forEach(r -> byId.put(r.id(), r.summary()));
        return ids.stream().map(byId::get).toList();
    }

    /**
     * Who may see a claim: the owner, AUDITOR and FINANCE_HEAD, anyone who holds/held a step on it, and anyone
     * who can currently act on its pending step (role pool, or active delegate of the assignee).
     */
    public boolean canView(ClaimRow claim, AppPrincipal me) {
        if (claim.ownedBy(me.id()) || me.hasAny(Role.AUDITOR, Role.FINANCE_HEAD)) {
            return true;
        }
        return jdbc.sql("""
                SELECT EXISTS (
                  SELECT 1 FROM approval_step s
                   WHERE s.claim_id = :claim
                     AND (s.assignee_id = :me OR s.acted_by = :me OR s.acted_on_behalf_of = :me OR s.sent_back_by = :me
                          OR (s.status = 'PENDING' AND s.assignee_id IS NULL
                              AND EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = :me AND r.role = s.required_role))
                          OR (s.status = 'PENDING' AND s.assignee_id IS NOT NULL
                              AND EXISTS (SELECT 1 FROM delegation d
                                           WHERE d.delegator_id = s.assignee_id AND d.delegate_id = :me AND d.revoked_at IS NULL
                                             AND """ + DelegationRepository.TODAY + " BETWEEN d.starts_on AND d.ends_on"
                + " AND EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = :me AND r.role = s.required_role)))))")
                .param("claim", claim.id()).param("me", me.id())
                .query(Boolean.class).single();
    }

    public List<LineRow> lines(UUID claimId) {
        return jdbc.sql("""
                SELECT l.*, pv.version_no AS pv_no,
                       r.id AS r_id, r.file_name, r.content_type, r.size_bytes, r.sha256, r.uploaded_at, r.storage_key
                  FROM expense_line l
                  LEFT JOIN receipt r ON r.line_id = l.id
                  LEFT JOIN policy_version pv ON pv.id = l.evaluated_policy_version_id
                 WHERE l.claim_id = :claim
                 ORDER BY l.line_no""")
                .param("claim", claimId)
                .query(ClaimRepository::mapLine).list();
    }

    public Optional<LineRow> line(UUID claimId, UUID lineId) {
        return lines(claimId).stream().filter(l -> l.id().equals(lineId)).findFirst();
    }

    public List<StepRow> steps(UUID claimId) {
        return jdbc.sql("""
                SELECT s.*, a.full_name AS a_name, b.full_name AS b_name, o.full_name AS o_name
                  FROM approval_step s
                  LEFT JOIN app_user a ON a.id = s.assignee_id
                  LEFT JOIN app_user b ON b.id = s.acted_by
                  LEFT JOIN app_user o ON o.id = s.acted_on_behalf_of
                 WHERE s.claim_id = :claim
                 ORDER BY s.sequence""")
                .param("claim", claimId)
                .query((rs, i) -> new StepRow(rs.getObject("id", UUID.class), rs.getObject("claim_id", UUID.class),
                        rs.getInt("sequence"), StepType.valueOf(rs.getString("step_type")),
                        Role.valueOf(rs.getString("required_role")), rs.getObject("assignee_id", UUID.class),
                        rs.getString("a_name"), rs.getString("status"), instant(rs, "pending_since"),
                        rs.getObject("sent_back_by", UUID.class), rs.getObject("acted_by", UUID.class),
                        rs.getString("b_name"), rs.getObject("acted_on_behalf_of", UUID.class), rs.getString("o_name"),
                        instant(rs, "acted_at"), rs.getString("comment")))
                .list();
    }

    public long countAudit(UUID claimId) {
        return jdbc.sql("SELECT count(*) FROM audit_event WHERE claim_id = :claim").param("claim", claimId)
                .query(Long.class).single();
    }

    public List<AuditRow> audit(UUID claimId, int offset, int limit) {
        return jdbc.sql("""
                SELECT e.*, a.full_name AS a_name, o.full_name AS o_name
                  FROM audit_event e
                  LEFT JOIN app_user a ON a.id = e.actor_id
                  LEFT JOIN app_user o ON o.id = e.on_behalf_of_id
                 WHERE e.claim_id = :claim
                 ORDER BY e.occurred_at, e.id
                 OFFSET :offset LIMIT :limit""")
                .param("claim", claimId).param("offset", offset).param("limit", limit)
                .query(this::mapAudit).list();
    }

    // ------------------------------------------------------------------ list with filters and status counts

    public record ListFilter(UUID ownerId, List<ClaimStatus> statuses, UUID employeeId, UUID departmentId, String q) {
    }

    public List<ClaimSummary> list(ListFilter f, String orderBy, int page, int size) {
        Where w = where(f, true);
        var spec = jdbc.sql(SUMMARY_SELECT + w.sql + " ORDER BY " + orderBy + ", c.id OFFSET :offset LIMIT :limit");
        for (var e : w.params.entrySet()) {
            spec = spec.param(e.getKey(), e.getValue());
        }
        return spec.param("offset", page * size).param("limit", size)
                .query(ClaimRepository::mapClaim).list().stream().map(ClaimRow::summary).toList();
    }

    public long count(ListFilter f) {
        Where w = where(f, true);
        var spec = jdbc.sql("SELECT count(*) FROM expense_claim c" + w.sql);
        for (var e : w.params.entrySet()) {
            spec = spec.param(e.getKey(), e.getValue());
        }
        return spec.query(Long.class).single();
    }

    /** Counts per status for the same filters except {@code status}, so chips stay stable. */
    public Map<ClaimStatus, Long> statusCounts(ListFilter f) {
        Where w = where(f, false);
        Map<ClaimStatus, Long> counts = new java.util.EnumMap<>(ClaimStatus.class);
        for (ClaimStatus s : ClaimStatus.values()) {
            counts.put(s, 0L);
        }
        var spec = jdbc.sql("SELECT c.status, count(*) AS n FROM expense_claim c" + w.sql + " GROUP BY c.status");
        for (var e : w.params.entrySet()) {
            spec = spec.param(e.getKey(), e.getValue());
        }
        spec.query(rs -> {
            counts.put(ClaimStatus.valueOf(rs.getString("status")), rs.getLong("n"));
        });
        return counts;
    }

    /** Claim summaries matching a server-built WHERE (never user text; user values go through {@code params}). */
    public List<ClaimSummary> listWhere(List<String> where, Map<String, Object> params, String orderBy, int page, int size) {
        String sql = SUMMARY_SELECT + (where.isEmpty() ? "" : " WHERE " + String.join(" AND ", where))
                + " ORDER BY " + orderBy + ", c.id OFFSET :offset LIMIT :limit";
        var spec = jdbc.sql(sql);
        for (var e : params.entrySet()) {
            spec = spec.param(e.getKey(), e.getValue());
        }
        return spec.param("offset", page * size).param("limit", size)
                .query(ClaimRepository::mapClaim).list().stream().map(ClaimRow::summary).toList();
    }

    public long countWhere(List<String> where, Map<String, Object> params) {
        var spec = jdbc.sql("SELECT count(*) FROM expense_claim c" + (where.isEmpty() ? "" : " WHERE " + String.join(" AND ", where)));
        for (var e : params.entrySet()) {
            spec = spec.param(e.getKey(), e.getValue());
        }
        return spec.query(Long.class).single();
    }

    private record Where(String sql, Map<String, Object> params) {
    }

    private static Where where(ListFilter f, boolean withStatus) {
        List<String> parts = new ArrayList<>();
        Map<String, Object> params = new java.util.HashMap<>();
        if (f.ownerId() != null) {
            parts.add("c.employee_id = :owner");
            params.put("owner", f.ownerId());
        }
        if (f.employeeId() != null) {
            parts.add("c.employee_id = :emp");
            params.put("emp", f.employeeId());
        }
        if (f.departmentId() != null) {
            parts.add("c.department_id = :dept");
            params.put("dept", f.departmentId());
        }
        if (withStatus && f.statuses() != null && !f.statuses().isEmpty()) {
            parts.add("c.status IN (:statuses)");
            params.put("statuses", f.statuses().stream().map(Enum::name).toList());
        }
        if (f.q() != null && !f.q().isBlank()) {
            parts.add("(c.claim_number ILIKE :q OR c.title ILIKE :q)");
            params.put("q", like(f.q()));
        }
        return new Where(parts.isEmpty() ? "" : " WHERE " + String.join(" AND ", parts), params);
    }

    /** Escapes LIKE wildcards in user input and wraps it for a contains-match. */
    public static String like(String q) {
        return "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
    }

    // ------------------------------------------------------------------ mapping

    static ClaimRow mapClaim(ResultSet rs, int row) throws SQLException {
        UUID saId = rs.getObject("sample_audited_by", UUID.class);
        String outcome = rs.getString("policy_outcome");
        int pvNo = rs.getInt("pv_no");
        return new ClaimRow(rs.getObject("id", UUID.class), rs.getString("claim_number"), rs.getString("title"),
                ClaimStatus.valueOf(rs.getString("status")), rs.getObject("employee_id", UUID.class),
                rs.getString("emp_name"),
                new Dept(rs.getObject("dept_id", UUID.class), rs.getString("dept_code"), rs.getString("dept_name")),
                rs.getObject("trip_start_date", LocalDate.class), rs.getObject("trip_end_date", LocalDate.class),
                rs.getString("currency"), rs.getBigDecimal("total_amount"), rs.getInt("line_count"),
                outcome == null ? null : PolicyOutcome.valueOf(outcome),
                List.of((String[]) rs.getArray("flags").getArray()),
                rs.getBoolean("sample_audit"), rs.getString("sample_audit_status"),
                saId == null ? null : new Ref(saId, rs.getString("sa_name")), instant(rs, "sample_audited_at"),
                instant(rs, "submitted_at"), instant(rs, "decided_at"), instant(rs, "updated_at"),
                rs.getString("purpose"), rs.getInt("submission_no"), rs.getObject("policy_version_id", UUID.class),
                pvNo == 0 ? null : pvNo, rs.getString("decision_reason"), rs.getInt("version"),
                instant(rs, "created_at"));
    }

    static LineRow mapLine(ResultSet rs, int row) throws SQLException {
        UUID receiptId = rs.getObject("r_id", UUID.class);
        String outcome = rs.getString("policy_outcome");
        int nights = rs.getInt("nights");
        Integer nightsOrNull = rs.wasNull() ? null : nights;
        int pvNo = rs.getInt("pv_no");
        Integer pvNoOrNull = rs.wasNull() ? null : pvNo;
        return new LineRow(rs.getObject("id", UUID.class), rs.getObject("claim_id", UUID.class),
                rs.getObject("employee_id", UUID.class), rs.getInt("line_no"), rs.getString("category"),
                rs.getBigDecimal("amount"), rs.getObject("expense_date", LocalDate.class), rs.getString("vendor"),
                rs.getString("vendor_key"), rs.getString("notes"), rs.getString("city"), nightsOrNull,
                outcome == null ? null : PolicyOutcome.valueOf(outcome),
                rs.getObject("evaluated_policy_version_id", UUID.class), pvNoOrNull, instant(rs, "evaluated_at"),
                rs.getBoolean("needs_evaluation"), instant(rs, "created_at"),
                receiptId == null ? null : new ReceiptRow(receiptId, rs.getString("file_name"),
                        rs.getString("content_type"), rs.getInt("size_bytes"), rs.getString("sha256"),
                        instant(rs, "uploaded_at"), rs.getString("storage_key")));
    }

    private AuditRow mapAudit(ResultSet rs, int row) throws SQLException {
        UUID actor = rs.getObject("actor_id", UUID.class);
        UUID obo = rs.getObject("on_behalf_of_id", UUID.class);
        String details = rs.getString("details");
        return new AuditRow(rs.getLong("id"), instant(rs, "occurred_at"),
                actor == null ? null : new Ref(actor, rs.getString("a_name")),
                obo == null ? null : new Ref(obo, rs.getString("o_name")),
                rs.getString("action"), rs.getString("entity_type"), rs.getString("entity_id"),
                rs.getObject("claim_id", UUID.class), rs.getString("from_status"), rs.getString("to_status"),
                rs.getString("comment"),
                details == null ? null : json.readValue(details, new TypeReference<Map<String, Object>>() {
                }));
    }

    static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp ts = rs.getTimestamp(column);
        return ts == null ? null : ts.toInstant();
    }
}
