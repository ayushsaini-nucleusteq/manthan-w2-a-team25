package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;

import org.junit.jupiter.api.Test;

import com.team25.backend.domain.Money;

import tools.jackson.databind.JsonNode;

/** F1 dashboard (US16, US18-AC3). */
class DashboardIT extends ApiTestSupport {

    private static final String HEAD = "arjun.shah@expenseflow.test";

    private JsonNode dashboard(String email) {
        Res r = get(email, "/api/dashboard?from=" + Money.today().minusDays(365) + "&to=" + Money.today());
        assertThat(r.status()).as(r.body().toString()).isEqualTo(200);
        return r.body();
    }

    @Test
    void US16_AC1_spendByCategoryDepartmentAndMonthAddUpToTheTotal() {
        JsonNode d = dashboard(HEAD);
        BigDecimal total = new BigDecimal(d.path("totalSpend").asString());
        assertThat(total).isPositive();
        for (String series : new String[] { "spendByCategory", "spendByDepartment", "spendByMonth" }) {
            BigDecimal sum = BigDecimal.ZERO;
            for (JsonNode row : d.path(series)) {
                sum = sum.add(new BigDecimal(row.path("amount").asString()));
            }
            assertThat(sum).as(series).isEqualByComparingTo(total);
        }
        assertThat(d.path("spendByDepartment").size()).isEqualTo(8);
        assertThat(d.path("spendByMonth").get(0).path("month").asString()).matches("\\d{4}-\\d{2}");
    }

    @Test
    void US16_AC2_violationsAndAverageApprovalTime() {
        JsonNode d = dashboard("meera.iyer@expenseflow.test");
        JsonNode v = d.path("policyViolations");
        assertThat(v.path("totalFindings").asLong()).isPositive();
        assertThat(v.path("autoRejectedClaims").asLong()).isPositive();
        assertThat(v.path("routedClaims").asLong()).isPositive();
        long byReason = 0;
        for (JsonNode r : v.path("byReason")) {
            assertThat(r.path("reasonCode").asString()).isNotEqualTo("WITHIN_LIMIT");
            byReason += r.path("count").asLong();
        }
        assertThat(byReason).isEqualTo(v.path("totalFindings").asLong());
        assertThat(d.path("approvalTime").path("claimCount").asLong()).isPositive();
        assertThat(d.path("approvalTime").path("averageHours").asDouble()).isPositive();
    }

    @Test
    void US16_AC3_US18_AC3_oldestPendingQueueSizesAndAgeAlert() {
        JsonNode d = dashboard(HEAD);
        assertThat(d.path("queues").size()).isEqualTo(4);
        long pending = 0;
        for (JsonNode q : d.path("queues")) {
            pending += q.path("pending").asLong();
            assertThat(q.path("overdue").asLong()).isLessThanOrEqualTo(q.path("pending").asLong());
        }
        assertThat(pending).isPositive();
        JsonNode oldest = d.path("oldestPending");
        assertThat(oldest.path("claimNumber").asString()).startsWith("CL-");
        assertThat(oldest.path("ageHours").asDouble()).isPositive();
        JsonNode alert = d.path("approvalAgeAlert");
        assertThat(alert.path("thresholdHours").asInt()).isEqualTo(
                get(HEAD, "/api/policy/current").body().path("settings").path("overdueThresholdHours").asInt());
        assertThat(alert.path("breached").asBoolean()).isEqualTo(oldest.path("ageHours").asDouble() >= alert.path("thresholdHours").asInt());
    }

    @Test
    void wireframeOverview_pendingPerStepAndApprovedCountsAreAvailableToTheFinanceHead() {
        JsonNode queues = dashboard(HEAD).path("queues");
        java.util.Map<String, Long> pending = new java.util.HashMap<>();
        queues.forEach(q -> pending.put(q.path("stepType").asString(), q.path("pending").asLong()));
        assertThat(pending).containsKeys("MANAGER", "AUDITOR", "FINANCE_HEAD");
        JsonNode counts = get(HEAD, "/api/claims?scope=all&size=1").body().path("statusCounts");
        assertThat(counts.path("APPROVED").asLong()).isPositive();
        assertThat(counts.path("PENDING_MANAGER").asLong()).isPositive();
    }

    @Test
    void dashboardIsForAuditorsAndFinanceHeadAndRangeIsChecked() {
        assertThat(get(freshEmployee().managerEmail(), "/api/dashboard?from=2026-01-01&to=2026-02-01").status()).isEqualTo(403);
        assertThat(get(HEAD, "/api/dashboard?from=2024-01-01&to=2026-02-01").status()).isEqualTo(400);
        assertThat(get(HEAD, "/api/dashboard?from=2026-02-01&to=2026-01-01").status()).isEqualTo(400);
        assertThat(get(HEAD, "/api/dashboard?from=2026-02-01").status()).isEqualTo(400);
        JsonNode dept = get(HEAD, "/api/dashboard?from=" + Money.today().minusDays(365) + "&to=" + Money.today()
                + "&departmentId=" + get(HEAD, "/api/departments").body().get(0).path("id").asString()).body();
        assertThat(dept.path("spendByDepartment").size()).isEqualTo(1);
    }
}
