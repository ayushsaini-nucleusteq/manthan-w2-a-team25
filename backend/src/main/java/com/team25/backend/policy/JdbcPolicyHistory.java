package com.team25.backend.policy;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;

import com.team25.backend.policy.PolicyEngine.Match;

/**
 * Policy history backed by the database. "In scope" = lines of other claims in SUBMITTED or any later status,
 * including SENT_BACK; never DRAFT, AUTO_REJECTED or REJECTED (decision D9).
 */
public class JdbcPolicyHistory implements PolicyEngine.History {

    // Leading/trailing spaces matter: it is appended right after a text block, whose trailing spaces are stripped.
    public static final String COUNTED = " c.status NOT IN ('DRAFT', 'AUTO_REJECTED', 'REJECTED') ";

    private final JdbcClient jdbc;
    private final UUID employeeId;
    private final UUID claimId;

    public JdbcPolicyHistory(JdbcClient jdbc, UUID employeeId, UUID claimId) {
        this.jdbc = jdbc;
        this.employeeId = employeeId;
        this.claimId = claimId;
    }

    @Override
    public BigDecimal otherClaimsDayTotal(String category, LocalDate date) {
        return jdbc.sql("""
                SELECT COALESCE(SUM(l.amount), 0) FROM expense_line l JOIN expense_claim c ON c.id = l.claim_id
                 WHERE l.employee_id = :emp AND l.category = :cat AND l.expense_date = :d AND c.id <> :claim AND """ + COUNTED)
                .param("emp", employeeId).param("cat", category).param("d", date).param("claim", claimId)
                .query(BigDecimal.class).single();
    }

    @Override
    public Optional<Match> vendorDuplicate(String vendorKey, BigDecimal amount, LocalDate date, Instant before) {
        return jdbc.sql("""
                SELECT c.id AS claim_id, c.claim_number, l.id AS line_id, l.line_no, l.employee_id
                  FROM expense_line l JOIN expense_claim c ON c.id = l.claim_id
                 WHERE l.employee_id = :emp AND l.vendor_key = :vk AND l.amount = :amt AND l.expense_date = :d
                   AND c.id <> :claim AND l.created_at < :before AND """ + COUNTED + """

                 ORDER BY l.created_at, l.line_no LIMIT 1""")
                .param("emp", employeeId).param("vk", vendorKey).param("amt", amount).param("d", date)
                .param("claim", claimId).param("before", java.sql.Timestamp.from(before))
                .query(JdbcPolicyHistory::match).optional();
    }

    @Override
    public Optional<Match> receiptDuplicate(String sha256, Instant before) {
        return jdbc.sql("""
                SELECT c.id AS claim_id, c.claim_number, l.id AS line_id, l.line_no, l.employee_id
                  FROM receipt r JOIN expense_line l ON l.id = r.line_id JOIN expense_claim c ON c.id = l.claim_id
                 WHERE r.sha256 = :sha AND c.id <> :claim AND l.created_at < :before AND """ + COUNTED + """

                 ORDER BY l.created_at, l.line_no LIMIT 1""")
                .param("sha", sha256).param("claim", claimId).param("before", java.sql.Timestamp.from(before))
                .query(JdbcPolicyHistory::match).optional();
    }

    private static Match match(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new Match(rs.getObject("claim_id", UUID.class), rs.getString("claim_number"),
                rs.getObject("line_id", UUID.class), rs.getInt("line_no"), rs.getObject("employee_id", UUID.class));
    }
}
