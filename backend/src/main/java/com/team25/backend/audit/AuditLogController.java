package com.team25.backend.audit;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.team25.backend.auth.UserDirectory.Ref;
import com.team25.backend.claims.ClaimApi.AuditEventView;
import com.team25.backend.claims.ClaimApi.Page;
import com.team25.backend.web.Sorts;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** F6 global audit log: search every action; read-only (there is no endpoint that changes or deletes events). */
@RestController
@Validated
public class AuditLogController {

    private final JdbcClient jdbc;
    private final JsonMapper json;

    public AuditLogController(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @GetMapping("/api/audit-events")
    @PreAuthorize("hasAnyRole('AUDITOR', 'FINANCE_HEAD')")
    @Transactional(readOnly = true)
    public Page<AuditEventView> search(@RequestParam(required = false) UUID claimId,
            @RequestParam(required = false) UUID actorId,
            @RequestParam(required = false) @Pattern(regexp = "[A-Z_]{2,40}") String action,
            @RequestParam(required = false) @Pattern(regexp = "[A-Z_]{2,20}") String entityType,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) String sort) {
        String order = Sorts.orderBy(sort, Map.of("occurredAt", "e.occurred_at"), "e.occurred_at DESC");
        String direction = order.contains("ASC") ? "ASC" : "DESC";
        List<String> where = new ArrayList<>();
        Map<String, Object> params = new HashMap<>();
        add(where, params, "e.claim_id = :claim", "claim", claimId);
        add(where, params, "e.actor_id = :actor", "actor", actorId);
        add(where, params, "e.action = :action", "action", action);
        add(where, params, "e.entity_type = :etype", "etype", entityType);
        add(where, params, "e.occurred_at >= :from", "from", from);
        add(where, params, "e.occurred_at <= :to", "to", to);
        String w = where.isEmpty() ? "" : " WHERE " + String.join(" AND ", where);
        var count = jdbc.sql("SELECT count(*) FROM audit_event e" + w);
        var list = jdbc.sql("""
                SELECT e.*, a.full_name AS a_name, o.full_name AS o_name
                  FROM audit_event e LEFT JOIN app_user a ON a.id = e.actor_id LEFT JOIN app_user o ON o.id = e.on_behalf_of_id
                """ + w + " ORDER BY e.occurred_at " + direction + ", e.id " + direction + " OFFSET :offset LIMIT :limit");
        for (var e : params.entrySet()) {
            count = count.param(e.getKey(), e.getValue());
            list = list.param(e.getKey(), e.getValue());
        }
        List<AuditEventView> items = list.param("offset", page * size).param("limit", size).query((rs, i) -> {
            UUID actor = rs.getObject("actor_id", UUID.class);
            UUID obo = rs.getObject("on_behalf_of_id", UUID.class);
            String details = rs.getString("details");
            return new AuditEventView(rs.getLong("id"), rs.getTimestamp("occurred_at").toInstant(),
                    actor == null ? null : new Ref(actor, rs.getString("a_name")),
                    obo == null ? null : new Ref(obo, rs.getString("o_name")),
                    rs.getString("action"), rs.getString("entity_type"), rs.getString("entity_id"),
                    rs.getObject("claim_id", UUID.class), rs.getString("from_status"), rs.getString("to_status"),
                    rs.getString("comment"),
                    details == null ? null : json.readValue(details, new TypeReference<Map<String, Object>>() {
                    }));
        }).list();
        return Page.of(items, page, size, count.query(Long.class).single());
    }

    private static void add(List<String> where, Map<String, Object> params, String sql, String name, Object value) {
        if (value != null) {
            where.add(sql);
            params.put(name, value);
        }
    }
}
