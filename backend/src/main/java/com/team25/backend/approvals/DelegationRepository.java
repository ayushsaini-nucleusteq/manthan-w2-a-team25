package com.team25.backend.approvals;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.team25.backend.auth.UserDirectory.Ref;

/**
 * Delegations are active while today (Asia/Kolkata) is within [starts_on, ends_on] and they are not revoked,
 * so one ends by itself after its end date (US7-AC3). Covered roles = approver roles both people hold.
 */
@Repository
public class DelegationRepository {

    /** SQL for "today" in the business time zone. */
    public static final String TODAY = " (now() AT TIME ZONE 'Asia/Kolkata')::date ";

    public record DelegationView(UUID id, Ref delegator, Ref delegate, List<String> roles, LocalDate startsOn,
            LocalDate endsOn, String reason, boolean active, Instant createdAt, Instant revokedAt) {
    }

    private final JdbcClient jdbc;

    public DelegationRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<DelegationView> activeReceivedBy(UUID delegateId) {
        return jdbc.sql("""
                SELECT d.id, d.starts_on, d.ends_on, d.reason, d.created_at, d.revoked_at,
                       a.id AS a_id, a.full_name AS a_name, b.id AS b_id, b.full_name AS b_name,
                       ARRAY(SELECT r1.role FROM user_role r1 JOIN user_role r2 ON r2.role = r1.role AND r2.user_id = d.delegate_id
                              WHERE r1.user_id = d.delegator_id AND r1.role <> 'EMPLOYEE' ORDER BY r1.role) AS roles
                  FROM delegation d
                  JOIN app_user a ON a.id = d.delegator_id
                  JOIN app_user b ON b.id = d.delegate_id
                 WHERE d.delegate_id = :me AND d.revoked_at IS NULL
                   AND """ + TODAY + " BETWEEN d.starts_on AND d.ends_on ORDER BY d.starts_on")
                .param("me", delegateId)
                .query((rs, i) -> new DelegationView(
                        rs.getObject("id", UUID.class),
                        new Ref(rs.getObject("a_id", UUID.class), rs.getString("a_name")),
                        new Ref(rs.getObject("b_id", UUID.class), rs.getString("b_name")),
                        List.of((String[]) rs.getArray("roles").getArray()),
                        rs.getObject("starts_on", LocalDate.class),
                        rs.getObject("ends_on", LocalDate.class),
                        rs.getString("reason"),
                        true,
                        rs.getTimestamp("created_at").toInstant(),
                        null))
                .list();
    }

    /** True when {@code delegateId} may currently act for {@code delegatorId} on a step needing {@code role}. */
    public boolean canActFor(UUID delegatorId, UUID delegateId, String role) {
        return jdbc.sql("""
                SELECT EXISTS (
                  SELECT 1 FROM delegation d
                   WHERE d.delegator_id = :delegator AND d.delegate_id = :delegate AND d.revoked_at IS NULL
                     AND """ + TODAY + " BETWEEN d.starts_on AND d.ends_on"
                + " AND EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = :delegate AND r.role = :role))")
                .param("delegator", delegatorId)
                .param("delegate", delegateId)
                .param("role", role)
                .query(Boolean.class).single();
    }
}
