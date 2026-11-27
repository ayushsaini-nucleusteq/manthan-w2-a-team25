package com.team25.backend.audit;

import java.util.Map;
import java.util.UUID;

import org.slf4j.MDC;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import com.team25.backend.observability.RequestIdFilter;

import tools.jackson.databind.json.JsonMapper;

/**
 * Writes the append-only audit trail. Callers run inside the transaction of the change they describe, so an
 * event exists exactly when the change committed. Rows are never updated or deleted (DB triggers enforce it).
 */
@Service
public class AuditService {

    /** One audit row. {@code details} carries "what changed" (US17-AC1), e.g. {@code changes: {field: {from, to}}}. */
    public record Entry(UUID actorId, UUID onBehalfOfId, String action, String entityType, String entityId, UUID claimId,
            String fromStatus, String toStatus, String comment, Map<String, ?> details) {

        public static Entry claim(UUID actorId, UUID claimId, String action) {
            return new Entry(actorId, null, action, "CLAIM", claimId.toString(), claimId, null, null, null, null);
        }

        public Entry onBehalfOf(UUID id) {
            return new Entry(actorId, id, action, entityType, entityId, claimId, fromStatus, toStatus, comment, details);
        }

        public Entry status(Object from, Object to) {
            return new Entry(actorId, onBehalfOfId, action, entityType, entityId, claimId,
                    from == null ? null : from.toString(), to == null ? null : to.toString(), comment, details);
        }

        public Entry comment(String text) {
            return new Entry(actorId, onBehalfOfId, action, entityType, entityId, claimId, fromStatus, toStatus, text, details);
        }

        public Entry details(Map<String, ?> map) {
            return new Entry(actorId, onBehalfOfId, action, entityType, entityId, claimId, fromStatus, toStatus, comment, map);
        }

        public Entry entity(String type, Object id) {
            return new Entry(actorId, onBehalfOfId, action, type, id.toString(), claimId, fromStatus, toStatus, comment, details);
        }
    }

    private final JdbcClient jdbc;
    private final JsonMapper json;

    public AuditService(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public void record(Entry e) {
        jdbc.sql("""
                INSERT INTO audit_event (actor_id, on_behalf_of_id, action, entity_type, entity_id, claim_id,
                                         from_status, to_status, comment, details, request_id)
                VALUES (:actor, :obo, :action, :etype, :eid, :claim, :from, :to, :comment, CAST(:details AS jsonb), :rid)""")
                .param("actor", e.actorId())
                .param("obo", e.onBehalfOfId())
                .param("action", e.action())
                .param("etype", e.entityType())
                .param("eid", e.entityId())
                .param("claim", e.claimId())
                .param("from", e.fromStatus())
                .param("to", e.toStatus())
                .param("comment", e.comment())
                .param("details", e.details() == null ? null : json.writeValueAsString(e.details()))
                .param("rid", MDC.get(RequestIdFilter.MDC_KEY))
                .update();
    }
}
