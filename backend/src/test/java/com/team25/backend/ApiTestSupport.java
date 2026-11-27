package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.micrometer.metrics.test.autoconfigure.AutoConfigureMetrics;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.team25.backend.domain.Money;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Base for API integration tests: one Spring context and one PostgreSQL container for all ITs (the demo seed runs
 * once), plain HTTP calls against the running server, and helpers to pick fresh seeded users and safe dates.
 *
 * <p>Seeded expense dates are at least 15 days old, so tests use dates within the last 12 days and fresh
 * employees, and never collide with seeded history (meals day totals, duplicates).
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
@AutoConfigureMetrics // Boot disables metrics export in tests by default; MetricsIT scrapes /actuator/prometheus
public abstract class ApiTestSupport {

    @LocalServerPort
    protected int port;

    @Autowired
    protected JsonMapper json;

    @Autowired
    protected JdbcClient jdbc;

    @Value("${app.seed.user-password}")
    protected String password;

    private static final HttpClient HTTP = HttpClient.newHttpClient();
    private static final AtomicInteger NEXT_EMPLOYEE = new AtomicInteger();
    private static final Map<String, String> TOKENS = new ConcurrentHashMap<>();

    protected record Res(int status, JsonNode body, HttpResponse<byte[]> raw) {

        public String text(String field) {
            return body.path(field).asString();
        }
    }

    /** A seeded employee (EMPLOYEE only) and their manager. */
    protected record Person(UUID id, String email, String name, UUID managerId, String managerEmail) {
    }

    // ------------------------------------------------------------------ HTTP

    protected String token(String email) {
        return TOKENS.computeIfAbsent(email, e -> {
            Res r = call("POST", "/api/auth/login", null, Map.of("email", e, "password", password));
            assertThat(r.status()).as("login %s", e).isEqualTo(200);
            return r.text("accessToken");
        });
    }

    protected Res get(String email, String path) {
        return call("GET", path, email == null ? null : token(email), null);
    }

    protected Res post(String email, String path, Object body) {
        return call("POST", path, email == null ? null : token(email), body);
    }

    protected Res put(String email, String path, Object body) {
        return call("PUT", path, token(email), body);
    }

    protected Res patch(String email, String path, Object body) {
        return call("PATCH", path, token(email), body);
    }

    protected Res delete(String email, String path) {
        return call("DELETE", path, token(email), null);
    }

    protected Res call(String method, String path, String bearer, Object body) {
        try {
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
            if (bearer != null) {
                b.header("Authorization", "Bearer " + bearer);
            }
            if (body != null) {
                b.header("Content-Type", "application/json")
                        .method(method, HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(body)));
            } else {
                b.method(method, HttpRequest.BodyPublishers.noBody());
            }
            return wrap(HTTP.send(b.build(), HttpResponse.BodyHandlers.ofByteArray()));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    protected Res upload(String email, UUID claimId, UUID lineId, byte[] bytes, String fileName) {
        String boundary = "----it" + UUID.randomUUID();
        byte[] head = ("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + fileName
                + "\"\r\nContent-Type: application/octet-stream\r\n\r\n").getBytes(StandardCharsets.UTF_8);
        byte[] tail = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
        byte[] all = new byte[head.length + bytes.length + tail.length];
        System.arraycopy(head, 0, all, 0, head.length);
        System.arraycopy(bytes, 0, all, head.length, bytes.length);
        System.arraycopy(tail, 0, all, head.length + bytes.length, tail.length);
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/claims/" + claimId
                    + "/lines/" + lineId + "/receipt"))
                    .header("Authorization", "Bearer " + token(email))
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .PUT(HttpRequest.BodyPublishers.ofByteArray(all)).build();
            return wrap(HTTP.send(req, HttpResponse.BodyHandlers.ofByteArray()));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private Res wrap(HttpResponse<byte[]> r) {
        String type = r.headers().firstValue("Content-Type").orElse("");
        JsonNode body = r.body().length > 0 && type.contains("json") ? json.readTree(r.body()) : json.nullNode();
        return new Res(r.statusCode(), body, r);
    }

    // ------------------------------------------------------------------ data helpers

    /** A seeded plain employee not used by any other test, plus their manager. */
    protected Person freshEmployee() {
        List<Person> all = jdbc.sql("""
                SELECT u.id, u.email, u.full_name, m.id AS mid, m.email AS memail
                  FROM app_user u JOIN app_user m ON m.id = u.manager_id
                 WHERE u.active AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id AND r.role <> 'EMPLOYEE')
                   AND EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = m.id AND r.role = 'MANAGER')
                   AND u.email <> 'asha.verma@expenseflow.test'
                 ORDER BY u.employee_code""")
                .query((rs, i) -> new Person(rs.getObject("id", UUID.class), rs.getString("email"), rs.getString("full_name"),
                        rs.getObject("mid", UUID.class), rs.getString("memail")))
                .list();
        return all.get(NEXT_EMPLOYEE.getAndIncrement() % all.size());
    }

    protected String emailOf(UUID userId) {
        return jdbc.sql("SELECT email FROM app_user WHERE id = :id").param("id", userId).query(String.class).single();
    }

    protected List<String> emailsWithRole(String role) {
        return jdbc.sql("""
                SELECT u.email FROM app_user u JOIN user_role r ON r.user_id = u.id
                 WHERE r.role = :role AND u.active ORDER BY u.employee_code""")
                .param("role", role).query(String.class).list();
    }

    /** The n-th most recent weekday, counting back from yesterday (n = 0..7 stays within 12 days). */
    protected static LocalDate weekday(int n) {
        LocalDate d = Money.today().minusDays(1);
        int found = -1;
        while (true) {
            if (d.getDayOfWeek() != DayOfWeek.SATURDAY && d.getDayOfWeek() != DayOfWeek.SUNDAY && ++found == n) {
                return d;
            }
            d = d.minusDays(1);
        }
    }

    /** The most recent Saturday before today. */
    protected static LocalDate saturday() {
        LocalDate d = Money.today().minusDays(1);
        while (d.getDayOfWeek() != DayOfWeek.SATURDAY) {
            d = d.minusDays(1);
        }
        return d;
    }

    protected static Map<String, Object> line(String category, String amount, LocalDate date, String vendor) {
        Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("category", category);
        m.put("amount", amount);
        m.put("expenseDate", date.toString());
        m.put("vendor", vendor);
        return m;
    }

    protected static Map<String, Object> hotel(String amount, LocalDate date, String vendor, String city, int nights) {
        Map<String, Object> m = line("HOTEL", amount, date, vendor);
        m.put("city", city);
        m.put("nights", nights);
        return m;
    }

    /** A unique small PDF (unique bytes → unique SHA-256). */
    protected static byte[] pdf() {
        return ("%PDF-1.4\n% receipt " + UUID.randomUUID() + "\n%%EOF\n").getBytes(StandardCharsets.US_ASCII);
    }

    protected static String unique(String prefix) {
        return prefix + " " + UUID.randomUUID().toString().substring(0, 8);
    }

    /** Creates a draft with the given lines, uploads a receipt to every line above 500, returns the claim JSON. */
    @SafeVarargs
    protected final JsonNode draft(String email, Map<String, Object>... lines) {
        Res r = post(email, "/api/claims", Map.of("title", unique("IT claim"), "lines", List.of(lines)));
        assertThat(r.status()).as(r.body().toString()).isEqualTo(201);
        UUID claimId = UUID.fromString(r.text("id"));
        for (JsonNode l : r.body().path("lines")) {
            if (new java.math.BigDecimal(l.path("amount").asString()).compareTo(new java.math.BigDecimal("500")) > 0) {
                Res up = upload(email, claimId, UUID.fromString(l.path("id").asString()), pdf(), "r.pdf");
                assertThat(up.status()).as(up.body().toString()).isEqualTo(200);
            }
        }
        return get(email, "/api/claims/" + claimId).body();
    }

    protected Res submit(String email, JsonNode claim) {
        return post(email, "/api/claims/" + claim.path("id").asString() + "/submit",
                Map.of("version", claim.path("version").asInt()));
    }

    protected JsonNode submitOk(String email, JsonNode claim) {
        Res r = submit(email, claim);
        assertThat(r.status()).as(r.body().toString()).isEqualTo(200);
        return r.body();
    }

    protected Res act(String email, String action, JsonNode claim, Map<String, Object> extra) {
        Map<String, Object> body = new java.util.HashMap<>(extra);
        body.put("version", claim.path("version").asInt());
        return post(email, "/api/claims/" + claim.path("id").asString() + "/" + action, body);
    }

    /** Approves the current step and asserts 200; returns the updated claim. */
    protected JsonNode approve(String email, JsonNode claim) {
        Res r = act(email, "approve", claim, Map.of());
        assertThat(r.status()).as(r.body().toString()).isEqualTo(200);
        return r.body();
    }

    /** A routed claim (airfare has no policy rule) for exactly {@code amount}, with a receipt. */
    protected JsonNode routedClaim(Person p, String amount) {
        return submitOk(p.email(), draft(p.email(), line("AIRFARE", amount, weekday(2), unique("IndiGo"))));
    }

    /** A claim waiting for an auditor (above 25000, approved by the manager). */
    protected JsonNode pendingAuditor(Person p, String amount) {
        JsonNode c = approve(p.managerEmail(), routedClaim(p, amount));
        assertThat(c.path("status").asString()).isEqualTo("PENDING_AUDITOR");
        return c;
    }

    /**
     * Submits small clean claims until the one-in-ten sampler tags one (at most two blocks of 10), then returns it.
     * Amounts vary so the claims are never duplicates of each other.
     */
    protected JsonNode sampledClaim(Person p) {
        for (int i = 0; i < 25; i++) {
            JsonNode c = submitOk(p.email(), draft(p.email(),
                    line("LOCAL_CAB", (150 + i) + ".00", weekday(i % 5), unique("Meru"))));
            assertThat(c.path("status").asString()).isEqualTo("AUTO_APPROVED");
            if (c.path("sampleAudit").asBoolean()) {
                return c;
            }
        }
        throw new AssertionError("no sample-tagged claim after 25 auto-approved claims");
    }

    protected UUID idOf(String email) {
        return jdbc.sql("SELECT id FROM app_user WHERE email = :e").param("e", email).query(UUID.class).single();
    }

    protected static List<String> texts(JsonNode array, String field) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.path(field).asString()));
        return out;
    }
}
