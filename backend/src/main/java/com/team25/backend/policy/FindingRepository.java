package com.team25.backend.policy;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.team25.backend.domain.Money;
import com.team25.backend.domain.PolicyOutcome;

/** Stored policy results: one set per line (replaced only when the line is re-evaluated) plus claim-level ones. */
@Repository
public class FindingRepository {

    private final JdbcClient jdbc;

    public FindingRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void replaceForLine(UUID claimId, UUID lineId, UUID policyVersionId, List<PolicyEngine.Finding> findings, Instant at) {
        jdbc.sql("DELETE FROM policy_finding WHERE line_id = :line").param("line", lineId).update();
        for (PolicyEngine.Finding f : findings) {
            insert(claimId, lineId, policyVersionId, f, at);
        }
    }

    public void replaceClaimLevel(UUID claimId, UUID policyVersionId, List<PolicyEngine.Finding> findings, Instant at) {
        jdbc.sql("DELETE FROM policy_finding WHERE claim_id = :claim AND line_id IS NULL").param("claim", claimId).update();
        for (PolicyEngine.Finding f : findings) {
            insert(claimId, null, policyVersionId, f, at);
        }
    }

    private void insert(UUID claimId, UUID lineId, UUID versionId, PolicyEngine.Finding f, Instant at) {
        jdbc.sql("""
                INSERT INTO policy_finding (claim_id, line_id, policy_version_id, rule_code, rule_name, reason_code, outcome,
                    message, limit_type, unit, limit_value, actual_value, excess_value, matched_claim_id, matched_line_id,
                    evaluated_at)
                VALUES (:claim, :line, :version, :code, :name, :reason, :outcome, :message, :ltype, :unit, :limit, :actual,
                    :excess, :mclaim, :mline, :at)""")
                .param("claim", claimId).param("line", lineId).param("version", versionId)
                .param("code", f.ruleCode()).param("name", f.ruleName()).param("reason", f.reasonCode())
                .param("outcome", f.outcome().name()).param("message", truncate(f.message(), 500))
                .param("ltype", f.limitType()).param("unit", f.unit()).param("limit", f.limit())
                .param("actual", f.actual()).param("excess", f.excess())
                .param("mclaim", f.matched() == null ? null : f.matched().claimId())
                .param("mline", f.matched() == null ? null : f.matched().lineId())
                .param("at", java.sql.Timestamp.from(at))
                .update();
    }

    /**
     * Stored findings of a claim, keyed by line id ({@code null} key = claim level). Matched ids are returned
     * only when the matched line belongs to the same employee (decision D7).
     */
    public Map<UUID, List<FindingView>> forClaim(UUID claimId) {
        Map<UUID, List<FindingView>> byLine = new LinkedHashMap<>();
        jdbc.sql("""
                SELECT f.*, mc.claim_number AS m_claim_number, ml.line_no AS m_line_no,
                       (mc.employee_id = c.employee_id) AS same_employee
                  FROM policy_finding f
                  JOIN expense_claim c ON c.id = f.claim_id
                  LEFT JOIN expense_claim mc ON mc.id = f.matched_claim_id
                  LEFT JOIN expense_line ml ON ml.id = f.matched_line_id
                 WHERE f.claim_id = :claim
                 ORDER BY f.id""")
                .param("claim", claimId)
                .query(rs -> {
                    boolean show = rs.getBoolean("same_employee") && rs.getObject("matched_claim_id") != null;
                    FindingView view = new FindingView(rs.getString("rule_code"), rs.getString("rule_name"),
                            rs.getString("reason_code"), PolicyOutcome.valueOf(rs.getString("outcome")),
                            rs.getString("message"), rs.getString("limit_type"), rs.getString("unit"),
                            Money.format(rs.getBigDecimal("limit_value")), Money.format(rs.getBigDecimal("actual_value")),
                            Money.format(rs.getBigDecimal("excess_value")),
                            show ? rs.getObject("matched_claim_id", UUID.class) : null,
                            show ? rs.getString("m_claim_number") : null,
                            show ? rs.getObject("matched_line_id", UUID.class) : null,
                            show ? (Integer) rs.getInt("m_line_no") : null);
                    byLine.computeIfAbsent(rs.getObject("line_id", UUID.class), k -> new ArrayList<>()).add(view);
                });
        return byLine;
    }

    private static String truncate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max);
    }
}
