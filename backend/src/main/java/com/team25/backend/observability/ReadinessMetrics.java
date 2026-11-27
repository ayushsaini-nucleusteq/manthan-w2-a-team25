package com.team25.backend.observability;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.health.actuate.endpoint.HealthDescriptor;
import org.springframework.boot.health.actuate.endpoint.HealthEndpoint;
import org.springframework.boot.health.contributor.Status;
import org.springframework.stereotype.Component;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.MeterBinder;

/**
 * Exposes the readiness health group (readinessState + db) as a Prometheus gauge, app_readiness
 * (1 = UP, 0 = anything else), so Prometheus can alert when the app is running but not ready,
 * e.g. the database is unreachable while the process itself still answers scrapes.
 *
 * The check runs on its own thread every 5s and the gauge only reads the last result. Running it
 * on the scrape thread would block the scrape while the DB is unreachable (Hikari waits for a
 * connection), the scrape would time out, and Prometheus would report AppDown instead.
 */
@Component
public class ReadinessMetrics implements MeterBinder, DisposableBean {

    private static final long CHECK_INTERVAL_SECONDS = 5;

    private final ObjectProvider<HealthEndpoint> healthEndpoint;
    private final AtomicInteger ready = new AtomicInteger(0);
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "readiness-probe");
        t.setDaemon(true);
        return t;
    });

    public ReadinessMetrics(ObjectProvider<HealthEndpoint> healthEndpoint) {
        this.healthEndpoint = healthEndpoint;
    }

    @Override
    public void bindTo(MeterRegistry registry) {
        Gauge.builder("app.readiness", ready, AtomicInteger::get)
                .description("1 if the readiness health group (readinessState, db) is UP, else 0")
                .register(registry);
        executor.scheduleWithFixedDelay(this::check, 1, CHECK_INTERVAL_SECONDS, TimeUnit.SECONDS);
    }

    private void check() {
        try {
            HealthEndpoint endpoint = healthEndpoint.getIfAvailable();
            HealthDescriptor readiness = endpoint != null ? endpoint.healthForPath("readiness") : null;
            ready.set(readiness != null && Status.UP.equals(readiness.getStatus()) ? 1 : 0);
        } catch (RuntimeException e) {
            ready.set(0);
        }
    }

    @Override
    public void destroy() {
        executor.shutdownNow();
    }
}
