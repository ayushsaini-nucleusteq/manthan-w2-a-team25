package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

/** M1-M3 and the chain: manager → auditor above 25000 → finance head above 100000. */
class ApprovalChainIT extends ApiTestSupport {

    /** A routed claim (airfare has no policy rule) of exactly {@code amount}, with a receipt. */
    private JsonNode routed(Person p, String amount) {
        return submitOk(p.email(), draft(p.email(), line("AIRFARE", amount, weekday(2), unique("IndiGo"))));
    }

    private JsonNode reload(String email, JsonNode claim) {
        return get(email, "/api/claims/" + claim.path("id").asString()).body();
    }

    private JsonNode approveOk(String email, JsonNode claim) {
        Res r = act(email, "approve", claim, Map.of());
        assertThat(r.status()).as(r.body().toString()).isEqualTo(200);
        return r.body();
    }

    @Test
    void US8_AC1_above25000MovesToPendingAuditorAfterManagerApproval() {
        Person p = freshEmployee();
        JsonNode c = routed(p, "25000.01");
        JsonNode afterManager = approveOk(p.managerEmail(), c);
        assertThat(afterManager.path("status").asString()).isEqualTo("PENDING_AUDITOR");
        String auditor = emailsWithRole("AUDITOR").get(0);
        assertThat(texts(get(auditor, "/api/approvals/inbox?stepType=AUDITOR&size=100&q=" + c.path("claimNumber").asString())
                .body().path("items"), "stepId")).hasSize(1);
        assertThat(approveOk(auditor, afterManager).path("status").asString()).isEqualTo("APPROVED");
    }

    @Test
    void US8_AC2_exactly25000DoesNotRouteToAuditor() {
        Person p = freshEmployee();
        JsonNode c = routed(p, "25000.00");
        assertThat(texts(c.path("approvalSteps"), "stepType")).containsExactly("MANAGER");
        assertThat(approveOk(p.managerEmail(), c).path("status").asString()).isEqualTo("APPROVED");
    }

    @Test
    void US8_AC3_claimAtOrBelowThresholdNeverReachesTheAuditor() {
        Person p = freshEmployee();
        JsonNode c = routed(p, "24999.99");
        approveOk(p.managerEmail(), c);
        String auditor = emailsWithRole("AUDITOR").get(1);
        Res inbox = get(auditor, "/api/approvals/inbox?q=" + c.path("claimNumber").asString());
        assertThat(inbox.body().path("totalItems").asLong()).isZero();
    }

    @Test
    void US12_AC1_above100000NeedsFinanceHeadAfterAuditor() {
        Person p = freshEmployee();
        JsonNode c = routed(p, "100000.01");
        assertThat(texts(c.path("approvalSteps"), "stepType")).containsExactly("MANAGER", "AUDITOR", "FINANCE_HEAD");
        JsonNode s1 = approveOk(p.managerEmail(), c);
        JsonNode s2 = approveOk(emailsWithRole("AUDITOR").get(0), s1);
        assertThat(s2.path("status").asString()).isEqualTo("PENDING_FINANCE_HEAD");
        String head = emailsWithRole("FINANCE_HEAD").get(0);
        assertThat(get(head, "/api/approvals/inbox?q=" + c.path("claimNumber").asString()).body().path("totalItems").asLong())
                .isEqualTo(1);
        assertThat(approveOk(head, s2).path("status").asString()).isEqualTo("APPROVED");
    }

    @Test
    void US12_AC2_exactly100000DoesNotNeedFinanceHead() {
        Person p = freshEmployee();
        JsonNode c = routed(p, "100000.00");
        assertThat(texts(c.path("approvalSteps"), "stepType")).containsExactly("MANAGER", "AUDITOR");
    }

    @Test
    void US5_AC1_inboxListsTheOldestPendingClaimFirst() {
        Person p = freshEmployee();
        JsonNode older = routed(p, "1200.00");
        JsonNode newer = routed(p, "1300.00");
        Res inbox = get(p.managerEmail(), "/api/approvals/inbox?size=100");
        List<String> ids = new java.util.ArrayList<>();
        inbox.body().path("items").forEach(i -> ids.add(i.path("claim").path("id").asString()));
        assertThat(ids).containsSubsequence(older.path("id").asString(), newer.path("id").asString());
        List<java.time.Instant> since = texts(inbox.body().path("items"), "pendingSince").stream()
                .map(java.time.Instant::parse).toList();
        assertThat(since).isSorted();
    }

    @Test
    void US5_AC2_approveTakesOnlyTheVersion() {
        Person p = freshEmployee();
        JsonNode c = routed(p, "900.00");
        Res r = post(p.managerEmail(), "/api/claims/" + c.path("id").asString() + "/approve",
                Map.of("version", c.path("version").asInt()));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.text("status")).isEqualTo("APPROVED");
    }

    @Test
    void US5_AC3_sendBackRequiresACommentAndRejectRequiresAReason() {
        Person p = freshEmployee();
        JsonNode c = routed(p, "950.00");
        assertThat(act(p.managerEmail(), "send-back", c, Map.of()).status()).isEqualTo(400);
        assertThat(act(p.managerEmail(), "send-back", c, Map.of("comment", "  ")).status()).isEqualTo(400);
        assertThat(act(p.managerEmail(), "reject", c, Map.of()).status()).isEqualTo(400);
        Res rejected = act(p.managerEmail(), "reject", c, Map.of("reason", "Not a business trip"));
        assertThat(rejected.status()).isEqualTo(200);
        assertThat(rejected.text("status")).isEqualTo("REJECTED");
        assertThat(rejected.text("decisionReason")).isEqualTo("Not a business trip");
    }

    @Test
    void US5_AC4_everyDecisionAppearsInTheAuditTrail() {
        Person p = freshEmployee();
        JsonNode c = routed(p, "980.00");
        JsonNode back = act(p.managerEmail(), "send-back", c, Map.of("comment", "Add the boarding pass")).body();
        JsonNode resubmitted = post(p.email(), "/api/claims/" + c.path("id").asString() + "/submit",
                Map.of("version", back.path("version").asInt(), "comment", "Added")).body();
        approveOk(p.managerEmail(), resubmitted);
        Res trail = get(p.email(), "/api/claims/" + c.path("id").asString() + "/audit-trail");
        assertThat(texts(trail.body().path("items"), "action")).contains("SENT_BACK", "RESUBMITTED", "APPROVED");
    }

    @Test
    void US6_AC2_flagsDoNotBlockApproval() {
        Person p = freshEmployee();
        JsonNode c = submitOk(p.email(), draft(p.email(), line("MEALS", "300.00", saturday(), "Cafe Coffee Day"),
                line("LOCAL_CAB", "2500.00", weekday(1), "Uber")));
        assertThat(c.path("flags").toString()).contains("WEEKEND_EXPENSE", "SOFT_LIMIT_EXCEEDED");
        assertThat(approveOk(p.managerEmail(), c).path("status").asString()).isEqualTo("APPROVED");
    }

    @Test
    void US6_AC1_US6_AC3_managerReviewShowsWeekendFlagAndNamesTheMatchedDuplicateLine() {
        Person p = freshEmployee();
        String vendor = unique("Chai Point");
        JsonNode first = submitOk(p.email(), draft(p.email(), line("MEALS", "210.00", weekday(3), vendor)));
        JsonNode c = submitOk(p.email(), draft(p.email(), line("MEALS", "210.00", weekday(3), vendor),
                line("LOCAL_CAB", "300.00", saturday(), "Ola")));
        JsonNode review = get(p.managerEmail(), "/api/claims/" + c.path("id").asString()).body();
        assertThat(review.path("allowedActions").toString()).contains("APPROVE");
        JsonNode dup = null;
        for (JsonNode f : review.path("lines").get(0).path("findings")) {
            if (f.path("reasonCode").asString().equals("DUPLICATE")) {
                dup = f;
            }
        }
        assertThat(dup).isNotNull();
        assertThat(dup.path("matchedClaimNumber").asString()).isEqualTo(first.path("claimNumber").asString());
        assertThat(dup.path("matchedLineNo").asInt()).isEqualTo(1);
        assertThat(review.path("lines").get(1).path("findings").toString()).contains("WEEKEND_EXPENSE");
        assertThat(review.path("flags").toString()).contains("DUPLICATE", "WEEKEND_EXPENSE");
    }

    @Test
    void US4_AC1_claimDetailShowsStatusHistoryAndEveryComment() {
        Person p = freshEmployee();
        JsonNode c = routed(p, "990.00");
        post(p.managerEmail(), "/api/claims/" + c.path("id").asString() + "/comments", Map.of("comment", "Which client?"));
        JsonNode back = act(p.managerEmail(), "send-back", reload(p.email(), c), Map.of("comment", "Attach invoice")).body();
        JsonNode detail = post(p.email(), "/api/claims/" + c.path("id").asString() + "/submit",
                Map.of("version", back.path("version").asInt(), "comment", "Invoice attached")).body();

        List<String> to = texts(detail.path("statusHistory"), "toStatus");
        assertThat(to).containsSubsequence("DRAFT", "SUBMITTED", "PENDING_MANAGER", "SENT_BACK", "SUBMITTED", "PENDING_MANAGER");
        assertThat(texts(detail.path("comments"), "kind")).containsExactly("COMMENT", "SEND_BACK", "RESUBMIT_REPLY");
        assertThat(texts(detail.path("comments"), "text")).containsExactly("Which client?", "Attach invoice", "Invoice attached");
    }

    @Test
    void US4_AC2_replyingToASendBackResubmitsToTheSameApprover() {
        Person p = freshEmployee();
        JsonNode c = routed(p, "30000.00");
        JsonNode afterManager = approveOk(p.managerEmail(), c);
        String auditor = emailsWithRole("AUDITOR").get(2);
        JsonNode back = act(auditor, "send-back", afterManager, Map.of("comment", "Need the fare breakdown")).body();
        assertThat(back.path("status").asString()).isEqualTo("SENT_BACK");

        JsonNode re = post(p.email(), "/api/claims/" + c.path("id").asString() + "/submit",
                Map.of("version", back.path("version").asInt(), "comment", "Breakdown attached")).body();
        assertThat(re.path("status").asString()).isEqualTo("PENDING_AUDITOR");
        JsonNode auditStep = re.path("approvalSteps").get(1);
        assertThat(auditStep.path("status").asString()).isEqualTo("PENDING");
        assertThat(auditStep.path("assignee").path("id").asString())
                .isEqualTo(jdbc.sql("SELECT id FROM app_user WHERE email = :e").param("e", auditor).query(UUID.class).single().toString());
        // Manager's earlier approval stands; the manager is not asked again.
        assertThat(re.path("approvalSteps").get(0).path("status").asString()).isEqualTo("APPROVED");
        // Another auditor can no longer pick it up; the one who sent it back can.
        assertThat(act(emailsWithRole("AUDITOR").get(0), "approve", re, Map.of()).status()).isEqualTo(403);
        assertThat(approveOk(auditor, re).path("status").asString()).isEqualTo("APPROVED");
    }

    @Test
    void resubmitAddsTheAuditorStepWhenTheNewTotalCrosses25000() {
        Person p = freshEmployee();
        JsonNode c = routed(p, "20000.00");
        JsonNode back = act(p.managerEmail(), "send-back", c, Map.of("comment", "Add the hotel")).body();
        Res added = post(p.email(), "/api/claims/" + c.path("id").asString() + "/lines",
                hotel("9000.00", weekday(2), "Treebo", "Nagpur", 3));
        JsonNode withHotel = added.body();
        upload(p.email(), UUID.fromString(c.path("id").asString()),
                UUID.fromString(withHotel.path("lines").get(1).path("id").asString()), pdf(), "hotel.pdf");
        JsonNode fresh = reload(p.email(), c);
        JsonNode re = post(p.email(), "/api/claims/" + c.path("id").asString() + "/submit",
                Map.of("version", fresh.path("version").asInt())).body();
        assertThat(re.path("status").asString()).isEqualTo("PENDING_MANAGER");
        assertThat(texts(re.path("approvalSteps"), "stepType")).containsExactly("MANAGER", "AUDITOR");
        assertThat(back.path("approvalSteps").size()).isEqualTo(1);
    }

    @Test
    void nobodyApprovesTheirOwnClaim() {
        // A manager files a claim; it goes to *their* manager, and they get 403 on their own claim.
        String manager = "ravi.kumar@expenseflow.test";
        JsonNode c = submitOk(manager, draft(manager, line("AIRFARE", "1500.00", weekday(4), unique("Akasa Air"))));
        Res own = act(manager, "approve", c, Map.of());
        assertThat(own.status()).isEqualTo(403);
        assertThat(own.text("message")).isEqualTo("You cannot act on your own claim");
        String ravisManager = jdbc.sql("SELECT m.email FROM app_user u JOIN app_user m ON m.id = u.manager_id WHERE u.email = :e")
                .param("e", manager).query(String.class).single();
        assertThat(c.path("approvalSteps").get(0).path("approverName").asString()).isNotBlank();
        assertThat(approveOk(ravisManager, c).path("status").asString()).isEqualTo("APPROVED");
    }

    @Test
    void D6_ownerWithNoManagerGoesToTheFinanceHead() {
        String top = "arjun.shah@expenseflow.test";
        JsonNode c = submitOk(top, draft(top, line("AIRFARE", "2500.00", weekday(5), unique("Vistara"))));
        JsonNode step = c.path("approvalSteps").get(0);
        assertThat(step.path("stepType").asString()).isEqualTo("MANAGER");
        assertThat(step.path("assignee").isNull()).isTrue();
        assertThat(approveOk("kavya.menon@expenseflow.test", c).path("status").asString()).isEqualTo("APPROVED");
    }

    @Test
    void W5_inboxFiltersByDepartmentAndAmountBand() {
        Person p = freshEmployee();
        JsonNode small = routed(p, "1100.00");
        JsonNode large = routed(p, "4100.00");
        String dept = small.path("department").path("id").asString();
        Res band = get(p.managerEmail(), "/api/approvals/inbox?size=100&departmentId=" + dept + "&minAmount=4000.00&maxAmount=5000.00");
        List<String> numbers = new java.util.ArrayList<>();
        band.body().path("items").forEach(i -> numbers.add(i.path("claim").path("claimNumber").asString()));
        assertThat(numbers).contains(large.path("claimNumber").asString()).doesNotContain(small.path("claimNumber").asString());
        assertThat(get(p.managerEmail(), "/api/approvals/inbox?minAmount=5.00&maxAmount=1.00").status()).isEqualTo(400);
    }

    @Test
    void W6_approvalStepsCarryApproverNameOnBehalfOfAndDecidedAt() {
        Person p = freshEmployee();
        JsonNode c = routed(p, "1700.00");
        JsonNode pending = c.path("approvalSteps").get(0);
        String managerName = jdbc.sql("SELECT full_name FROM app_user WHERE id = :id").param("id", p.managerId())
                .query(String.class).single();
        assertThat(pending.path("approverName").asString()).isEqualTo(managerName);
        assertThat(pending.path("decidedAt").isNull()).isTrue();

        // A delegate approves on the manager's behalf.
        String delegate = emailsWithRole("MANAGER").stream().filter(e -> !e.equals(p.managerEmail())).findFirst().orElseThrow();
        UUID delegateId = jdbc.sql("SELECT id FROM app_user WHERE email = :e").param("e", delegate).query(UUID.class).single();
        jdbc.sql("""
                INSERT INTO delegation (delegator_id, delegate_id, starts_on, ends_on, reason)
                VALUES (:a, :b, current_date - 1, current_date + 1, 'IT leave')""")
                .param("a", p.managerId()).param("b", delegateId).update();
        try {
            Res inbox = get(delegate, "/api/approvals/inbox?q=" + c.path("claimNumber").asString());
            JsonNode item = inbox.body().path("items").get(0);
            assertThat(item.path("delegated").asBoolean()).isTrue();
            assertThat(item.path("onBehalfOf").path("fullName").asString()).isEqualTo(managerName);
            JsonNode decided = approveOk(delegate, c).path("approvalSteps").get(0);
            String delegateName = jdbc.sql("SELECT full_name FROM app_user WHERE id = :id").param("id", delegateId)
                    .query(String.class).single();
            assertThat(decided.path("approverName").asString()).isEqualTo(delegateName);
            assertThat(decided.path("onBehalfOfName").asString()).isEqualTo(managerName);
            assertThat(decided.path("decidedAt").asString()).isNotBlank();
        } finally {
            jdbc.sql("UPDATE delegation SET revoked_at = now() WHERE delegator_id = :a AND revoked_at IS NULL")
                    .param("a", p.managerId()).update();
        }
    }
}
