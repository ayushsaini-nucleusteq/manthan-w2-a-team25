package com.team25.backend.observability;

import java.time.Duration;
import java.time.Instant;
import java.util.EnumMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import com.team25.backend.domain.StepType;
import com.team25.backend.policy.PolicyRepository;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;

/**
 * Approval queue metrics for US18 / the runbook:
 * <ul>
 * <li>{@code expenseflow_queue_size{step}}: pending approval steps per step type;</li>
 * <li>{@code expenseflow_oldest_pending_approval_seconds{step}}: age of the oldest pending step (0 when none);</li>
 * <li>{@code expenseflow_approval_age_threshold_seconds}: the configured overdue threshold (policy), so the
 * Prometheus alert compares against configuration instead of a hard-coded number (US18-AC1);</li>
 * <li>{@code expenseflow_approval_decision_seconds{step,decision}}: time from a step becoming pending to the decision.</li>
 * </ul>
 * Gauges read one cached snapshot, refreshed at most every 5 seconds, so scrapes don't hammer the database.
 */
@Component
public class ApprovalMetrics {

    private static final Logger log = LoggerFactory.getLogger(ApprovalMetrics.class);
    private static final Duration MAX_AGE = Duration.ofSeconds(5);

    private record Snapshot(Instant at, Map<StepType, Long> counts, Map<StepType, Double> oldestSeconds, double thresholdSeconds) {
    }

    private final JdbcClient jdbc;
    private final PolicyRepository policies;
    private final MeterRegistry registry;
    private volatile Snapshot snapshot;

    public ApprovalMetrics(JdbcClient jdbc, PolicyRepository policies, MeterRegistry registry) {
        this.jdbc = jdbc;
        this.policies = policies;
        this.registry = registry;
        for (StepType step : StepType.values()) {
            Gauge.builder("expenseflow.queue.size", this, m -> m.snapshot().counts().getOrDefault(step, 0L))
                    .description("Pending approval steps").tag("step", step.name()).register(registry);
            Gauge.builder("expenseflow.oldest.pending.approval.seconds", this,
                    m -> m.snapshot().oldestSeconds().getOrDefault(step, 0.0))
                    .description("Age of the oldest pending approval step").tag("step", step.name()).register(registry);
        }
        Gauge.builder("expenseflow.approval.age.threshold.seconds", this, m -> m.snapshot().thresholdSeconds())
                .description("Configured overdue threshold (policy overdueThresholdHours)").register(registry);
    }

    public void recordDecision(StepType step, String decision, Duration waited) {
        Timer.builder("expenseflow.approval.decision")
                .description("Time from an approval step becoming pending to its decision")
                .tag("step", step.name()).tag("decision", decision)
                .publishPercentileHistogram()
                .register(registry)
                .record(waited.isNegative() ? Duration.ZERO : waited);
    }

    private Snapshot snapshot() {
        Snapshot s = snapshot;
        if (s != null && Duration.between(s.at(), Instant.now()).compareTo(MAX_AGE) < 0) {
            return s;
        }
        try {
            Map<StepType, Long> counts = new EnumMap<>(StepType.class);
            Map<StepType, Double> oldest = new EnumMap<>(StepType.class);
            jdbc.sql("""
                    SELECT step_type, count(*) AS n,
                           COALESCE(EXTRACT(EPOCH FROM now() - min(pending_since)), 0) AS oldest
                      FROM approval_step WHERE status = 'PENDING' GROUP BY step_type""")
                    .query(rs -> {
                        StepType t = StepType.valueOf(rs.getString("step_type"));
                        counts.put(t, rs.getLong("n"));
                        oldest.put(t, rs.getDouble("oldest"));
                    });
            double threshold = policies.current().overdueThresholdHours() * 3600.0;
            s = new Snapshot(Instant.now(), counts, oldest, threshold);
        } catch (RuntimeException e) {
            log.debug("Approval metrics snapshot failed", e);
            s = new Snapshot(Instant.now(), Map.of(), Map.of(), s == null ? Double.NaN : s.thresholdSeconds());
        }
        snapshot = s;
        return s;
    }
}
