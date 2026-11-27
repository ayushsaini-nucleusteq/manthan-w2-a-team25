package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

/** E4 / E6 and submit: policy engine outcomes, 422 blockers, duplicates. */
class SubmitPolicyIT extends ApiTestSupport {

    private static JsonNode finding(JsonNode line, String reasonCode) {
        for (JsonNode f : line.path("findings")) {
            if (f.path("reasonCode").asString().equals(reasonCode)) {
                return f;
            }
        }
        throw new AssertionError("no " + reasonCode + " finding in " + line);
    }

    @Test
    void cleanClaimWithinLimitsAndAtMost25000IsAutoApproved() {
        Person p = freshEmployee();
        JsonNode claim = draft(p.email(), line("MEALS", "450.00", weekday(1), "Chai Point"),
                line("LOCAL_CAB", "1999.99", weekday(1), "Uber"));
        JsonNode result = submitOk(p.email(), claim);
        assertThat(result.path("status").asString()).isEqualTo("AUTO_APPROVED");
        assertThat(result.path("policyOutcome").asString()).isEqualTo("AUTO_APPROVE");
        assertThat(result.path("approvalSteps").size()).isLessThanOrEqualTo(1); // a sample-audit step if tagged
        assertThat(result.path("lines").get(0).path("policyVersionNo").asInt()).isEqualTo(1);
    }

    @Test
    void overSoftLimitRoutesToManagerAndHardLimitAutoRejectsWithReason() {
        Person p = freshEmployee();
        JsonNode soft = submitOk(p.email(), draft(p.email(), line("LOCAL_CAB", "2600.00", weekday(2), "Ola")));
        assertThat(soft.path("status").asString()).isEqualTo("PENDING_MANAGER");
        JsonNode f = finding(soft.path("lines").get(0), "SOFT_LIMIT_EXCEEDED");
        assertThat(f.path("limit").asString()).isEqualTo("2000.00");
        assertThat(f.path("excess").asString()).isEqualTo("600.00");
        assertThat(soft.path("approvalSteps").get(0).path("assignee").path("id").asString()).isEqualTo(p.managerId().toString());

        JsonNode hard = submitOk(p.email(), draft(p.email(), line("LOCAL_CAB", "4500.00", weekday(3), "Rapido")));
        assertThat(hard.path("status").asString()).isEqualTo("AUTO_REJECTED");
        assertThat(hard.path("decisionReason").asString()).contains("Line 1").contains("hard limit 4000.00");
        assertThat(finding(hard.path("lines").get(0), "HARD_LIMIT_EXCEEDED").path("excess").asString()).isEqualTo("500.00");
        assertThat(hard.path("allowedActions").toString()).doesNotContain("SUBMIT", "EDIT");
    }

    @Test
    void cleanLinesButTotalAbove25000RouteWithTheClaimTotalFinding() {
        Person p = freshEmployee();
        JsonNode r = submitOk(p.email(), draft(p.email(),
                hotel("12000.00", weekday(4), "Taj Hotels", "Mumbai", 2),
                hotel("7200.00", weekday(3), "ITC Hotels", "Delhi", 2),
                hotel("6000.00", weekday(2), "Novotel", "Pune", 1)));
        assertThat(r.path("status").asString()).isEqualTo("PENDING_MANAGER");
        assertThat(r.path("latestEvaluation").path("claimFindings").get(0).path("reasonCode").asString())
                .isEqualTo("CLAIM_TOTAL_ABOVE_AUTO_APPROVE_LIMIT");
        assertThat(texts(r.path("approvalSteps"), "stepType")).containsExactly("MANAGER", "AUDITOR");
    }

    @Test
    void US1_AC2_receiptRequiredAbove500Only() {
        Person p = freshEmployee();
        JsonNode atThreshold = post(p.email(), "/api/claims", Map.of("title", "No receipt at 500",
                "lines", List.of(line("MEALS", "500.00", weekday(1), "Chai Point")))).body();
        assertThat(submit(p.email(), atThreshold).status()).isEqualTo(200);

        JsonNode above = post(p.email(), "/api/claims", Map.of("title", "No receipt above 500",
                "lines", List.of(line("MEALS", "500.01", weekday(2), "Chai Point")))).body();
        Res r = submit(p.email(), above);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.body().path("errors").get(0).path("code").asString()).isEqualTo("RECEIPT_REQUIRED");
    }

    @Test
    void US1_AC4_submitIsBlockedAndTheLineMissingAReceiptIsNamed() {
        Person p = freshEmployee();
        JsonNode claim = post(p.email(), "/api/claims", Map.of("title", "Blocked",
                "lines", List.of(line("MEALS", "300.00", weekday(1), "Chai Point"),
                        line("LOCAL_CAB", "800.00", weekday(1), "Uber")))).body();
        Res r = submit(p.email(), claim);
        assertThat(r.status()).isEqualTo(422);
        JsonNode err = r.body().path("errors").get(0);
        assertThat(r.body().path("errors").size()).isEqualTo(1);
        assertThat(err.path("lineNo").asInt()).isEqualTo(2);
        assertThat(err.path("lineId").asString()).isEqualTo(claim.path("lines").get(1).path("id").asString());
        assertThat(err.path("message").asString()).contains("Line 2");
        assertThat(get(p.email(), "/api/claims/" + claim.path("id").asString()).text("status")).isEqualTo("DRAFT");

        Res preview = post(p.email(), "/api/claims/" + claim.path("id").asString() + "/policy-preview", null);
        assertThat(preview.body().path("submitBlockers").get(0).path("lineNo").asInt()).isEqualTo(2);
    }

    @Test
    void US2_AC1_previewShowsEachLinesOutcomeWithRuleNameLimitAndExcess() {
        Person p = freshEmployee();
        JsonNode claim = draft(p.email(), line("MEALS", "450.00", weekday(1), "Chai Point"));
        String id = claim.path("id").asString();
        Res preview = post(p.email(), "/api/claims/" + id + "/policy-preview",
                Map.of("line", hotel("13200.00", weekday(1), "Taj Hotels", "Mumbai", 2), "hasReceipt", true));
        assertThat(preview.status()).isEqualTo(200);
        JsonNode lineResult = preview.body().path("line");
        assertThat(lineResult.path("outcome").asString()).isEqualTo("ROUTE");
        JsonNode f = finding(lineResult, "SOFT_LIMIT_EXCEEDED");
        assertThat(f.path("ruleCode").asString()).isEqualTo("HOTEL_NIGHTLY_TIER1");
        assertThat(f.path("ruleName").asString()).isEqualTo("Hotel per night (tier-1 city)");
        assertThat(f.path("limit").asString()).isEqualTo("6000.00");
        assertThat(f.path("excess").asString()).isEqualTo("600.00");

        JsonNode saved = preview.body().path("claim").path("lines").get(0);
        JsonNode within = finding(saved, "WITHIN_LIMIT");
        assertThat(saved.path("outcome").asString()).isEqualTo("AUTO_APPROVE");
        assertThat(within.path("ruleName").asString()).isEqualTo("Meals per day");
        assertThat(within.path("limit").asString()).isEqualTo("1500.00");
        assertThat(within.path("excess").asString()).isEqualTo("0.00");
        assertThat(preview.body().path("claim").path("projectedSteps").toString()).contains("MANAGER");
    }

    @Test
    void US2_AC2_duplicateVendorAmountDateRoutesAndNamesTheEarlierLine() {
        Person p = freshEmployee();
        String vendor = unique("Cafe");
        JsonNode first = submitOk(p.email(), draft(p.email(), line("MEALS", "420.00", weekday(2), vendor)));
        JsonNode second = submitOk(p.email(), draft(p.email(), line("MEALS", "420.00", weekday(2), vendor)));
        assertThat(second.path("status").asString()).isEqualTo("PENDING_MANAGER");
        JsonNode dup = finding(second.path("lines").get(0), "DUPLICATE");
        assertThat(dup.path("outcome").asString()).isEqualTo("ROUTE");
        assertThat(dup.path("matchedClaimId").asString()).isEqualTo(first.path("id").asString());
        assertThat(dup.path("matchedClaimNumber").asString()).isEqualTo(first.path("claimNumber").asString());
        assertThat(dup.path("matchedLineId").asString()).isEqualTo(first.path("lines").get(0).path("id").asString());
        assertThat(dup.path("matchedLineNo").asInt()).isEqualTo(1);

        // Within one claim: the second identical line points at line 1.
        JsonNode same = submitOk(p.email(), draft(p.email(), line("LOCAL_CAB", "210.00", weekday(3), "Ola"),
                line("LOCAL_CAB", "210.00", weekday(3), " ola ")));
        assertThat(finding(same.path("lines").get(1), "DUPLICATE").path("matchedLineNo").asInt()).isEqualTo(1);
    }

    @Test
    void sameReceiptHashAutoRejectsWithoutExposingAnotherEmployeesClaim() {
        Person a = freshEmployee();
        Person b = freshEmployee();
        byte[] receipt = pdf();
        JsonNode claimA = post(a.email(), "/api/claims", Map.of("title", "A",
                "lines", List.of(line("MEALS", "700.00", weekday(1), "Haldiram's")))).body();
        upload(a.email(), UUID.fromString(claimA.path("id").asString()),
                UUID.fromString(claimA.path("lines").get(0).path("id").asString()), receipt, "a.pdf");
        submitOk(a.email(), get(a.email(), "/api/claims/" + claimA.path("id").asString()).body());

        JsonNode claimB = post(b.email(), "/api/claims", Map.of("title", "B",
                "lines", List.of(line("MEALS", "650.00", weekday(1), "Swiggy")))).body();
        upload(b.email(), UUID.fromString(claimB.path("id").asString()),
                UUID.fromString(claimB.path("lines").get(0).path("id").asString()), receipt, "b.pdf");
        JsonNode result = submitOk(b.email(), get(b.email(), "/api/claims/" + claimB.path("id").asString()).body());

        assertThat(result.path("status").asString()).isEqualTo("AUTO_REJECTED");
        JsonNode dup = finding(result.path("lines").get(0), "DUPLICATE_RECEIPT");
        assertThat(dup.path("outcome").asString()).isEqualTo("AUTO_REJECT");
        assertThat(dup.path("message").asString()).contains("another employee");
        assertThat(dup.has("matchedClaimId")).isFalse();
        assertThat(dup.has("matchedLineId")).isFalse();
        assertThat(result.toString()).doesNotContain(claimA.path("claimNumber").asString());
    }

    @Test
    void US2_AC3_weekendLineIsFlaggedAndStillSubmits() {
        Person p = freshEmployee();
        JsonNode r = submitOk(p.email(), draft(p.email(), line("MEALS", "300.00", saturday(), "Paradise Biryani")));
        assertThat(r.path("status").asString()).isEqualTo("PENDING_MANAGER");
        assertThat(finding(r.path("lines").get(0), "WEEKEND_EXPENSE").path("outcome").asString()).isEqualTo("ROUTE");
        assertThat(r.path("flags").toString()).contains("WEEKEND_EXPENSE");
    }

    @Test
    void unknownCategoryIsRoutedWithNoPolicyRuleFlag() {
        Person p = freshEmployee();
        JsonNode r = submitOk(p.email(), draft(p.email(), line("TRAIN", "450.00", weekday(1), "IRCTC")));
        assertThat(r.path("status").asString()).isEqualTo("PENDING_MANAGER");
        assertThat(finding(r.path("lines").get(0), "NO_POLICY_RULE").path("limit").isNull()).isTrue();
    }

    @Test
    void mealsCapIsPerEmployeePerDayAcrossClaims() {
        Person p = freshEmployee();
        submitOk(p.email(), draft(p.email(), line("MEALS", "1000.00", weekday(5), "Mainland China")));
        JsonNode second = submitOk(p.email(), draft(p.email(), line("MEALS", "800.00", weekday(5), "Zomato")));
        JsonNode f = finding(second.path("lines").get(0), "SOFT_LIMIT_EXCEEDED");
        assertThat(f.path("actual").asString()).isEqualTo("1800.00");
        assertThat(f.path("excess").asString()).isEqualTo("300.00");
    }
}
