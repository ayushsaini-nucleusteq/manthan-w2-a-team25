package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;

/** US18: queue and approval-age metrics exported for Prometheus. */
class MetricsIT extends ApiTestSupport {

    private String scrape() {
        Res r = call("GET", "/actuator/prometheus", null, null);
        assertThat(r.status()).isEqualTo(200);
        return new String(r.raw().body(), StandardCharsets.UTF_8);
    }

    private static double value(String metrics, String series) {
        Matcher m = Pattern.compile("(?m)^" + Pattern.quote(series) + " ([0-9.eE+-]+)$").matcher(metrics);
        assertThat(m.find()).as("series %s", series).isTrue();
        return Double.parseDouble(m.group(1));
    }

    @Test
    void US18_AC1_queueSizeOldestPendingAndConfiguredThresholdAreExported() {
        String metrics = scrape();
        for (String step : new String[] { "MANAGER", "AUDITOR", "FINANCE_HEAD", "SAMPLE_AUDIT" }) {
            assertThat(metrics).contains("expenseflow_queue_size{application=\"backend\",step=\"" + step + "\"}");
            assertThat(metrics).contains("expenseflow_oldest_pending_approval_seconds{application=\"backend\",step=\"" + step + "\"}");
        }
        assertThat(value(metrics, "expenseflow_queue_size{application=\"backend\",step=\"MANAGER\"}")).isPositive();
        assertThat(value(metrics, "expenseflow_oldest_pending_approval_seconds{application=\"backend\",step=\"MANAGER\"}")).isPositive();
        int hours = get("arjun.shah@expenseflow.test", "/api/policy/current").body().path("settings")
                .path("overdueThresholdHours").asInt();
        assertThat(value(metrics, "expenseflow_approval_age_threshold_seconds{application=\"backend\"}")).isEqualTo(hours * 3600.0);
    }

    @Test
    void approvalDecisionLatencyIsTimedPerStepAndDecision() {
        Person p = freshEmployee();
        approve(p.managerEmail(), routedClaim(p, "1550.00"));
        String metrics = scrape();
        assertThat(metrics).containsPattern(
                "expenseflow_approval_decision_seconds_count\\{application=\"backend\",decision=\"APPROVED\",step=\"MANAGER\"\\} [1-9]");
        assertThat(metrics).contains("expenseflow_approval_decision_seconds_bucket{");
    }
}
