package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

/** A1 review queue, A3 bulk actions (US9), A4 sample audit (US11). */
class AuditorIT extends ApiTestSupport {

    private List<String> numbers(Res page) {
        List<String> out = new ArrayList<>();
        page.body().path("items").forEach(i -> out.add(i.path("claim").path("claimNumber").asString()));
        return out;
    }

    private String auditor(int i) {
        return emailsWithRole("AUDITOR").get(i);
    }

    @Test
    void US9_AC1_queueFiltersCombineAndListOldestFirst() {
        Person p = freshEmployee();
        JsonNode mid = pendingAuditor(p, "30000.00");
        JsonNode high = pendingAuditor(p, "150000.00");
        String dept = mid.path("department").path("id").asString();

        Res above = get(auditor(0), "/api/auditor/queue?size=100&amountBand=ABOVE_100K&departmentId=" + dept);
        assertThat(above.status()).isEqualTo(200);
        assertThat(numbers(above)).contains(high.path("claimNumber").asString())
                .doesNotContain(mid.path("claimNumber").asString());
        Res band = get(auditor(0), "/api/auditor/queue?size=100&amountBand=FROM_25K_TO_100K&departmentId=" + dept);
        assertThat(numbers(band)).contains(mid.path("claimNumber").asString())
                .doesNotContain(high.path("claimNumber").asString());

        // Age filter combines too: only claims waiting at least 30 hours.
        jdbc.sql("UPDATE approval_step SET pending_since = now() - interval '31 hours' WHERE claim_id = :c AND status = 'PENDING'")
                .param("c", UUID.fromString(mid.path("id").asString())).update();
        Res aged = get(auditor(0), "/api/auditor/queue?size=100&minAgeHours=30&departmentId=" + dept);
        assertThat(numbers(aged)).contains(mid.path("claimNumber").asString())
                .doesNotContain(high.path("claimNumber").asString());

        Res flagged = get(auditor(0), "/api/auditor/queue?size=100&flag=NO_POLICY_RULE&flag=WEEKEND_EXPENSE&q=" + high.path("claimNumber").asString());
        assertThat(numbers(flagged)).containsExactly(high.path("claimNumber").asString());
        assertThat(get(auditor(0), "/api/auditor/queue?amountBand=HUGE").status()).isEqualTo(400);

        Res all = get(auditor(0), "/api/auditor/queue?size=100");
        List<java.time.Instant> since = new ArrayList<>();
        all.body().path("items").forEach(i -> since.add(java.time.Instant.parse(i.path("pendingSince").asString())));
        assertThat(since).isSorted();
    }

    @Test
    void US8_AC3_queueHoldsOnlyAuditorStageClaims() {
        Person p = freshEmployee();
        JsonNode below = approve(p.managerEmail(), routedClaim(p, "25000.00"));
        JsonNode atManager = routedClaim(p, "40000.00");
        Res q = get(auditor(1), "/api/auditor/queue?size=100&departmentId=" + below.path("department").path("id").asString());
        assertThat(numbers(q)).doesNotContain(below.path("claimNumber").asString(), atManager.path("claimNumber").asString());
        q.body().path("items").forEach(i -> assertThat(i.path("claim").path("status").asString()).isEqualTo("PENDING_AUDITOR"));
    }

    @Test
    void US9_AC2_US9_AC3_bulkApproveActsOnlyOnSelectedRowsAndReportsFailedRowsWithReasons() {
        Person p = freshEmployee();
        JsonNode a = pendingAuditor(p, "26000.00");
        JsonNode b = pendingAuditor(p, "27000.00");
        JsonNode notSelected = pendingAuditor(p, "28000.00");
        JsonNode atManager = routedClaim(p, "29000.00");
        UUID missing = UUID.randomUUID();

        Res r = post(auditor(0), "/api/auditor/queue/bulk-approve", Map.of("claimIds",
                List.of(a.path("id").asString(), missing, b.path("id").asString(), atManager.path("id").asString()),
                "comment", "Spot-checked"));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.body().path("succeeded").asInt()).isEqualTo(2);
        assertThat(r.body().path("failed").asInt()).isEqualTo(2);
        JsonNode results = r.body().path("results");
        assertThat(texts(results, "outcome")).containsExactly("SUCCEEDED", "FAILED", "SUCCEEDED", "FAILED");
        assertThat(results.get(0).path("newStatus").asString()).isEqualTo("APPROVED");
        assertThat(results.get(1).path("error").path("status").asInt()).isEqualTo(404);
        assertThat(results.get(3).path("error").path("status").asInt()).isEqualTo(409);
        assertThat(results.get(3).path("error").path("message").asString()).contains("not waiting for an auditor");

        assertThat(get(p.email(), "/api/claims/" + notSelected.path("id").asString()).text("status")).isEqualTo("PENDING_AUDITOR");
        assertThat(get(p.email(), "/api/claims/" + b.path("id").asString()).text("status")).isEqualTo("APPROVED");
        assertThat(post(auditor(0), "/api/auditor/queue/bulk-approve", Map.of("claimIds", List.of())).status()).isEqualTo(400);
    }

    @Test
    void bulkSendBackNeedsACommentAndReturnsPerClaimResults() {
        Person p = freshEmployee();
        JsonNode a = pendingAuditor(p, "31000.00");
        assertThat(post(auditor(1), "/api/auditor/queue/bulk-send-back", Map.of("claimIds", List.of(a.path("id").asString())))
                .status()).isEqualTo(400);
        Res r = post(auditor(1), "/api/auditor/queue/bulk-send-back",
                Map.of("claimIds", List.of(a.path("id").asString()), "comment", "Attach fare rules"));
        assertThat(r.body().path("results").get(0).path("newStatus").asString()).isEqualTo("SENT_BACK");
        assertThat(get(p.email(), "/api/claims/" + a.path("id").asString()).text("status")).isEqualTo("SENT_BACK");
    }

    @Test
    void queueAndSampleAuditsAreAuditorOnly() {
        assertThat(get(freshEmployee().managerEmail(), "/api/auditor/queue").status()).isEqualTo(403);
        assertThat(get("arjun.shah@expenseflow.test", "/api/auditor/sample-audits").status()).isEqualTo(403);
    }

    // ------------------------------------------------------------------ sample audit (A4)

    @Test
    void US11_AC2_taggedClaimsAppearOnlyInTheSampleAuditWorklist() {
        Person p = freshEmployee();
        JsonNode sampled = sampledClaim(p);
        String number = sampled.path("claimNumber").asString();
        assertThat(sampled.path("sampleAuditStatus").asString()).isEqualTo("PENDING");

        Res worklist = get(auditor(0), "/api/auditor/sample-audits?q=" + number);
        assertThat(texts(worklist.body().path("items"), "claimNumber")).containsExactly(number);
        assertThat(get(auditor(0), "/api/auditor/queue?size=100&q=" + number).body().path("totalItems").asLong()).isZero();
        assertThat(get(auditor(0), "/api/approvals/inbox?size=100&q=" + number).body().path("totalItems").asLong()).isZero();
        assertThat(get(p.managerEmail(), "/api/approvals/inbox?size=100&q=" + number).body().path("totalItems").asLong()).isZero();
    }

    @Test
    void US11_AC3_clearRecordsTheAuditorAndTime() {
        Person p = freshEmployee();
        JsonNode sampled = sampledClaim(p);
        String id = sampled.path("id").asString();
        JsonNode auditorView = get(auditor(0), "/api/claims/" + id).body();
        assertThat(auditorView.path("allowedActions").toString()).contains("CLEAR_SAMPLE");

        Res cleared = post(auditor(0), "/api/auditor/sample-audits/" + id + "/clear",
                Map.of("version", auditorView.path("version").asInt(), "comment", "Receipt matches"));
        assertThat(cleared.status()).as(cleared.body().toString()).isEqualTo(200);
        assertThat(cleared.text("status")).isEqualTo("AUTO_APPROVED");
        assertThat(cleared.text("sampleAuditStatus")).isEqualTo("CLEARED");
        assertThat(cleared.body().path("sampleAuditedBy").path("id").asString()).isEqualTo(idOf(auditor(0)).toString());
        assertThat(cleared.text("sampleAuditedAt")).isNotBlank();
        assertThat(texts(cleared.body().path("comments"), "kind")).contains("SAMPLE_AUDIT_NOTE");
        assertThat(texts(get(auditor(0), "/api/auditor/sample-audits?status=CLEARED&q=" + sampled.path("claimNumber").asString())
                .body().path("items"), "id")).containsExactly(id);
        // A second clear is a conflict; the owner can never audit their own claim.
        assertThat(post(auditor(0), "/api/auditor/sample-audits/" + id + "/clear",
                Map.of("version", cleared.body().path("version").asInt())).status()).isEqualTo(409);
    }

    @Test
    void sampleRejectIsFinalWithReasonAndSendBackReturnsToTheSameAuditor() {
        Person p = freshEmployee();
        JsonNode toReject = sampledClaim(p);
        Res rejected = post(auditor(1), "/api/auditor/sample-audits/" + toReject.path("id").asString() + "/reject",
                Map.of("version", toReject.path("version").asInt(), "reason", "Receipt is for a personal trip"));
        assertThat(rejected.text("status")).isEqualTo("REJECTED");
        assertThat(rejected.text("decisionReason")).isEqualTo("Receipt is for a personal trip");
        assertThat(rejected.text("sampleAuditStatus")).isEqualTo("REJECTED");
        assertThat(rejected.body().path("sampleAuditedBy").path("id").asString()).isEqualTo(idOf(auditor(1)).toString());

        JsonNode toSendBack = sampledClaim(p);
        String id = toSendBack.path("id").asString();
        JsonNode back = post(auditor(2), "/api/auditor/sample-audits/" + id + "/send-back",
                Map.of("version", toSendBack.path("version").asInt(), "comment", "Upload a clearer receipt")).body();
        assertThat(back.path("status").asString()).isEqualTo("SENT_BACK");
        JsonNode re = post(p.email(), "/api/claims/" + id + "/submit",
                Map.of("version", back.path("version").asInt(), "comment", "Uploaded")).body();
        assertThat(re.path("status").asString()).isEqualTo("AUTO_APPROVED");
        assertThat(re.path("sampleAuditStatus").asString()).isEqualTo("PENDING");
        String number = re.path("claimNumber").asString();
        assertThat(texts(get(auditor(2), "/api/auditor/sample-audits?q=" + number).body().path("items"), "id")).containsExactly(id);
        assertThat(get(auditor(0), "/api/auditor/sample-audits?q=" + number).body().path("totalItems").asLong()).isZero();
    }
}
