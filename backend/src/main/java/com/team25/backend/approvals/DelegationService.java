package com.team25.backend.approvals;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.team25.backend.approvals.DelegationRepository.DelegationView;
import com.team25.backend.audit.AuditService;
import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.auth.UserDirectory.Ref;
import com.team25.backend.claims.ClaimApi.Page;
import com.team25.backend.domain.Money;
import com.team25.backend.domain.Role;
import com.team25.backend.web.BadRequestException;
import com.team25.backend.web.ConflictException;
import com.team25.backend.web.ForbiddenException;
import com.team25.backend.web.NotFoundException;
import com.team25.backend.web.Sorts;

/**
 * M4 / F5 delegations. A delegation is active while today (Asia/Kolkata) is within its dates and it is not
 * revoked, so it ends by itself (US7-AC3). It covers the approver roles both people hold; no re-delegation.
 */
@Service
public class DelegationService {

    private static final Map<String, String> SORTS = Map.of(
            "startsOn", "d.starts_on", "endsOn", "d.ends_on", "createdAt", "d.created_at");

    private static final String SELECT = """
            SELECT d.id, d.starts_on, d.ends_on, d.reason, d.created_at, d.revoked_at,
                   a.id AS a_id, a.full_name AS a_name, b.id AS b_id, b.full_name AS b_name,
                   ARRAY(SELECT r1.role FROM user_role r1 JOIN user_role r2 ON r2.role = r1.role AND r2.user_id = d.delegate_id
                          WHERE r1.user_id = d.delegator_id AND r1.role <> 'EMPLOYEE' ORDER BY r1.role) AS roles,
                   (d.revoked_at IS NULL AND""" + DelegationRepository.TODAY + """
            BETWEEN d.starts_on AND d.ends_on) AS active
              FROM delegation d
              JOIN app_user a ON a.id = d.delegator_id
              JOIN app_user b ON b.id = d.delegate_id
            """;

    private final JdbcClient jdbc;
    private final AuditService audit;

    public DelegationService(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public Page<DelegationView> list(AppPrincipal me, String scope, LocalDate activeOn, int page, int size, String sort) {
        List<String> where = new ArrayList<>();
        Map<String, Object> params = new HashMap<>();
        switch (scope) {
            case "given" -> where.add("d.delegator_id = :me");
            case "received" -> where.add("d.delegate_id = :me");
            case "all" -> {
                if (!me.has(Role.FINANCE_HEAD)) {
                    throw new ForbiddenException("Only the finance head can list all delegations");
                }
            }
            default -> throw new BadRequestException("Invalid value for parameter 'scope'");
        }
        params.put("me", me.id());
        if (activeOn != null) {
            where.add("d.revoked_at IS NULL AND :on BETWEEN d.starts_on AND d.ends_on");
            params.put("on", activeOn);
        }
        String w = where.isEmpty() ? "" : " WHERE " + String.join(" AND ", where);
        String order = Sorts.orderBy(sort, SORTS, "d.starts_on DESC");
        var count = jdbc.sql("SELECT count(*) FROM delegation d" + w);
        var list = jdbc.sql(SELECT + w + " ORDER BY " + order + ", d.id OFFSET :offset LIMIT :limit");
        for (var e : params.entrySet()) {
            count = count.param(e.getKey(), e.getValue());
            list = list.param(e.getKey(), e.getValue());
        }
        long total = count.query(Long.class).single();
        List<DelegationView> items = list.param("offset", page * size).param("limit", size).query(DelegationService::map).list();
        return Page.of(items, page, size, total);
    }

    @Transactional
    public DelegationView create(AppPrincipal me, UUID delegateId, LocalDate startsOn, LocalDate endsOn, String reason) {
        if (delegateId.equals(me.id())) {
            throw new BadRequestException("Validation failed: delegateId: you cannot delegate to yourself");
        }
        if (endsOn.isBefore(startsOn)) {
            throw new BadRequestException("Validation failed: endsOn: must not be before startsOn");
        }
        if (endsOn.isBefore(Money.today())) {
            throw new BadRequestException("Validation failed: endsOn: must not be in the past");
        }
        boolean delegateActive = jdbc.sql("SELECT EXISTS (SELECT 1 FROM app_user WHERE id = :id AND active)")
                .param("id", delegateId).query(Boolean.class).single();
        if (!delegateActive) {
            throw new NotFoundException("Delegate not found");
        }
        long shared = jdbc.sql("""
                SELECT count(*) FROM user_role r1 JOIN user_role r2 ON r2.role = r1.role AND r2.user_id = :delegate
                 WHERE r1.user_id = :me AND r1.role <> 'EMPLOYEE'""")
                .param("delegate", delegateId).param("me", me.id()).query(Long.class).single();
        if (shared == 0) {
            throw new BadRequestException("Validation failed: delegateId: the delegate must hold one of your approver roles");
        }
        // Serialise per delegator, then check overlap (the exclusion constraint is the backstop).
        jdbc.sql("SELECT pg_advisory_xact_lock(hashtext(:k))").param("k", "delegation:" + me.id()).query().listOfRows();
        boolean overlaps = jdbc.sql("""
                SELECT EXISTS (SELECT 1 FROM delegation WHERE delegator_id = :me AND revoked_at IS NULL
                                 AND daterange(starts_on, ends_on, '[]') && daterange(:s, :e, '[]'))""")
                .param("me", me.id()).param("s", startsOn).param("e", endsOn).query(Boolean.class).single();
        if (overlaps) {
            throw new ConflictException("You already have a delegation that overlaps these dates");
        }
        UUID id = jdbc.sql("""
                INSERT INTO delegation (delegator_id, delegate_id, starts_on, ends_on, reason)
                VALUES (:me, :delegate, :s, :e, :reason) RETURNING id""")
                .param("me", me.id()).param("delegate", delegateId).param("s", startsOn).param("e", endsOn)
                .param("reason", reason == null || reason.isBlank() ? null : reason.strip())
                .query(UUID.class).single();
        audit.record(new AuditService.Entry(me.id(), null, "DELEGATION_CREATED", "DELEGATION", id.toString(), null,
                null, null, null, Map.of("delegateId", delegateId.toString(), "startsOn", startsOn.toString(),
                        "endsOn", endsOn.toString())));
        return find(id);
    }

    /** Soft revoke by the delegator or the finance head; already revoked or ended → 409. */
    @Transactional
    public void revoke(AppPrincipal me, UUID id) {
        DelegationView d = jdbc.sql(SELECT + " WHERE d.id = :id FOR UPDATE OF d").param("id", id)
                .query(DelegationService::map).optional()
                .orElseThrow(() -> new NotFoundException("Delegation not found"));
        boolean delegator = d.delegator().id().equals(me.id());
        if (!delegator && !me.has(Role.FINANCE_HEAD)) {
            if (d.delegate().id().equals(me.id())) {
                throw new ForbiddenException("Only the delegator or the finance head can end a delegation");
            }
            throw new NotFoundException("Delegation not found");
        }
        if (d.revokedAt() != null || d.endsOn().isBefore(Money.today())) {
            throw new ConflictException("Delegation has already ended");
        }
        jdbc.sql("UPDATE delegation SET revoked_at = now() WHERE id = :id").param("id", id).update();
        audit.record(new AuditService.Entry(me.id(), null, "DELEGATION_REVOKED", "DELEGATION", id.toString(), null,
                null, null, null, null));
    }

    private DelegationView find(UUID id) {
        return jdbc.sql(SELECT + " WHERE d.id = :id").param("id", id).query(DelegationService::map).single();
    }

    static DelegationView map(ResultSet rs, int row) throws SQLException {
        java.sql.Timestamp revoked = rs.getTimestamp("revoked_at");
        return new DelegationView(rs.getObject("id", UUID.class),
                new Ref(rs.getObject("a_id", UUID.class), rs.getString("a_name")),
                new Ref(rs.getObject("b_id", UUID.class), rs.getString("b_name")),
                List.of((String[]) rs.getArray("roles").getArray()),
                rs.getObject("starts_on", LocalDate.class), rs.getObject("ends_on", LocalDate.class),
                rs.getString("reason"), rs.getBoolean("active"), rs.getTimestamp("created_at").toInstant(),
                revoked == null ? null : revoked.toInstant());
    }
}
