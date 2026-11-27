package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

/** S3 / US17: append-only audit trail and claim visibility. */
class AuditTrailIT extends ApiTestSupport {

    @Test
    void US17_AC1_eachEntryRecordsWhoWhenAndWhatChanged() {
        Person p = freshEmployee();
        JsonNode c = post(p.email(), "/api/claims", Map.of("title", "Audited",
                "lines", java.util.List.of(line("MEALS", "200.00", weekday(1), "Chai Point")))).body();
        String lineId = c.path("lines").get(0).path("id").asString();
        put(p.email(), "/api/claims/" + c.path("id").asString() + "/lines/" + lineId,
                line("MEALS", "250.00", weekday(1), "Chai Point"));
        JsonNode items = get(p.email(), "/api/claims/" + c.path("id").asString() + "/audit-trail").body().path("items");
        JsonNode update = null;
        for (JsonNode e : items) {
            if (e.path("action").asString().equals("LINE_UPDATED")) {
                update = e;
            }
        }
        assertThat(update).isNotNull();
        assertThat(update.path("actor").path("id").asString()).isEqualTo(p.id().toString());
        assertThat(update.path("occurredAt").asString()).isNotBlank();
        JsonNode amount = update.path("details").path("changes").path("amount");
        assertThat(amount.path("from").asString()).isEqualTo("200.00");
        assertThat(amount.path("to").asString()).isEqualTo("250.00");
        assertThat(texts(items, "action")).startsWith("CLAIM_CREATED", "LINE_ADDED");
    }

    @Test
    void US17_AC2_auditEntriesCannotBeEditedOrDeleted() {
        assertThatThrownBy(() -> jdbc.sql("UPDATE audit_event SET comment = 'tampered' WHERE id = (SELECT min(id) FROM audit_event)").update())
                .hasMessageContaining("append-only");
        assertThatThrownBy(() -> jdbc.sql("DELETE FROM audit_event WHERE id = (SELECT min(id) FROM audit_event)").update())
                .hasMessageContaining("append-only");
        assertThat(call("DELETE", "/api/claims/00000000-0000-0000-0000-000000000000/audit-trail",
                token("asha.verma@expenseflow.test"), null).status()).isIn(404, 405);
    }

    @Test
    void US17_AC3_employeeSeesTheTrailOnlyForTheirOwnClaims() {
        Person owner = freshEmployee();
        Person other = freshEmployee();
        JsonNode c = post(owner.email(), "/api/claims", Map.of("title", "Private")).body();
        String path = "/api/claims/" + c.path("id").asString() + "/audit-trail";
        assertThat(get(owner.email(), path).status()).isEqualTo(200);
        Res denied = get(other.email(), path);
        assertThat(denied.status()).isEqualTo(404);
        assertThat(denied.text("message")).isEqualTo("Claim not found");
    }

    @Test
    void US4_AC3_openingAClaimThatIsNotMineShowsNotFound() {
        Person owner = freshEmployee();
        Person other = freshEmployee();
        JsonNode c = post(owner.email(), "/api/claims", Map.of("title", "Mine only")).body();
        Res r = get(other.email(), "/api/claims/" + c.path("id").asString());
        assertThat(r.status()).isEqualTo(404);
        assertThat(get(other.email(), "/api/claims?q=" + c.path("claimNumber").asString()).body().path("totalItems").asLong())
                .isZero();
        assertThat(get(other.email(), "/api/claims?scope=all").status()).isEqualTo(403);
    }
}
