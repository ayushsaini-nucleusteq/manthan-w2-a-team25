package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

/** F2 / F3 payouts (US13, US14). */
class PayoutIT extends ApiTestSupport {

    private static final String HEAD = "arjun.shah@expenseflow.test";

    private JsonNode approvedClaim(Person p, String amount) {
        JsonNode c = approve(p.managerEmail(), routedClaim(p, amount));
        assertThat(c.path("status").asString()).isEqualTo("APPROVED");
        return c;
    }

    private String status(Person p, JsonNode claim) {
        return get(p.email(), "/api/claims/" + claim.path("id").asString()).text("status");
    }

    @Test
    void US13_AC1_onlyApprovedOrClearedClaimsAreEligibleAndCanBeBatched() {
        Person p = freshEmployee();
        JsonNode approved = approvedClaim(p, "1234.00");
        JsonNode pending = routedClaim(p, "1235.00");
        JsonNode sampled = sampledClaim(p);

        Res eligible = get(HEAD, "/api/payouts/eligible-claims?size=100&q=" + approved.path("claimNumber").asString());
        assertThat(texts(eligible.body().path("items"), "id")).containsExactly(approved.path("id").asString());
        for (JsonNode c : List.of(pending, sampled)) {
            assertThat(get(HEAD, "/api/payouts/eligible-claims?q=" + c.path("claimNumber").asString()).body()
                    .path("totalItems").asLong()).as(c.path("status").asString()).isZero();
            Res r = post(HEAD, "/api/payouts", Map.of("claimIds", List.of(c.path("id").asString())));
            assertThat(r.status()).isEqualTo(409);
            assertThat(r.text("message")).contains("not eligible");
        }
        // Clearing the sample audit makes the auto-approved claim eligible.
        String auditor = emailsWithRole("AUDITOR").get(0);
        post(auditor, "/api/auditor/sample-audits/" + sampled.path("id").asString() + "/clear",
                Map.of("version", sampled.path("version").asInt()));
        assertThat(get(HEAD, "/api/payouts/eligible-claims?q=" + sampled.path("claimNumber").asString()).body()
                .path("totalItems").asLong()).isEqualTo(1);
        assertThat(get(p.managerEmail(), "/api/payouts/eligible-claims").status()).isEqualTo(403);
    }

    @Test
    void US13_AC2_US13_AC3_batchTotalsCsvExportMovesClaimsToInBatch() {
        Person p = freshEmployee();
        JsonNode a = approvedClaim(p, "1000.50");
        JsonNode b = approvedClaim(p, "2000.25");
        Res created = post(HEAD, "/api/payouts", Map.of("claimIds", List.of(a.path("id").asString(), b.path("id").asString())));
        assertThat(created.status()).as(created.body().toString()).isEqualTo(201);
        assertThat(created.text("status")).isEqualTo("CREATED");
        assertThat(created.text("totalAmount")).isEqualTo("3000.75");
        assertThat(created.body().path("claimCount").asInt()).isEqualTo(2);
        assertThat(created.text("batchNumber")).matches("PAY-\\d{4}-\\d{4}");
        assertThat(status(p, a)).isEqualTo("APPROVED"); // reserved, not yet moved
        // A claim already in a batch can't go into another.
        assertThat(post(HEAD, "/api/payouts", Map.of("claimIds", List.of(a.path("id").asString()))).status()).isEqualTo(409);

        String batchId = created.text("id");
        Res csv = get(HEAD, "/api/payouts/" + batchId + "/export");
        assertThat(csv.status()).isEqualTo(200);
        assertThat(csv.raw().headers().firstValue("Content-Type").orElse("")).startsWith("text/csv");
        assertThat(csv.raw().headers().firstValue("Content-Disposition").orElse("")).contains(created.text("batchNumber") + ".csv");
        String text = new String(csv.raw().body(), StandardCharsets.UTF_8);
        String[] lines = text.split("\n");
        assertThat(lines[0]).isEqualTo(
                "batch_number,claim_number,employee_code,employee_name,bank_account_number,ifsc_code,amount,currency,narration");
        assertThat(lines).hasSize(3);
        assertThat(text).contains(a.path("claimNumber").asString() + ",").contains(",1000.50,INR,").contains(",2000.25,INR,");
        assertThat(status(p, a)).isEqualTo("IN_BATCH");
        assertThat(status(p, b)).isEqualTo("IN_BATCH");
        assertThat(get(HEAD, "/api/payouts/" + batchId).text("status")).isEqualTo("EXPORTED");
        assertThat(new String(get(HEAD, "/api/payouts/" + batchId + "/export").raw().body(), StandardCharsets.UTF_8))
                .isEqualTo(text);
    }

    @Test
    void US14_AC1_US14_AC2_US14_AC3_markPaidNeedsConfirmMovesClaimsToPaidNotifiesAndCannotRepeat() {
        Person p = freshEmployee();
        JsonNode a = approvedClaim(p, "1500.00");
        JsonNode batch = post(HEAD, "/api/payouts", Map.of("claimIds", List.of(a.path("id").asString()))).body();
        String id = batch.path("id").asString();
        Map<String, Object> pay = Map.of("version", batch.path("version").asInt(), "confirm", true, "bankReference", "UTR123");
        assertThat(post(HEAD, "/api/payouts/" + id + "/mark-paid", pay).status()).as("export first").isEqualTo(409);

        get(HEAD, "/api/payouts/" + id + "/export");
        int version = get(HEAD, "/api/payouts/" + id).body().path("version").asInt();
        assertThat(post(HEAD, "/api/payouts/" + id + "/mark-paid",
                Map.of("version", version, "bankReference", "UTR123")).status()).isEqualTo(400);
        assertThat(post(HEAD, "/api/payouts/" + id + "/mark-paid",
                Map.of("version", version, "confirm", false, "bankReference", "UTR123")).status()).isEqualTo(400);

        Res paid = post(HEAD, "/api/payouts/" + id + "/mark-paid",
                Map.of("version", version, "confirm", true, "bankReference", "UTR2026112700042"));
        assertThat(paid.status()).as(paid.body().toString()).isEqualTo(200);
        assertThat(paid.text("status")).isEqualTo("PAID");
        assertThat(paid.text("bankReference")).isEqualTo("UTR2026112700042");
        assertThat(status(p, a)).isEqualTo("PAID");
        long notified = jdbc.sql("""
                SELECT count(*) FROM notification WHERE recipient_id = :r AND type = 'PAYOUT_DONE' AND claim_id = :c
                   AND payout_batch_id = :b""")
                .param("r", p.id()).param("c", UUID.fromString(a.path("id").asString())).param("b", UUID.fromString(id))
                .query(Long.class).single();
        assertThat(notified).isEqualTo(1);

        Res again = post(HEAD, "/api/payouts/" + id + "/mark-paid",
                Map.of("version", paid.body().path("version").asInt(), "confirm", true, "bankReference", "UTR9"));
        assertThat(again.status()).isEqualTo(409);
        assertThat(again.text("message")).contains("already marked paid");
        assertThat(texts(get(HEAD, "/api/payouts?status=PAID&size=100").body().path("items"), "id")).contains(id);
    }
}
