package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.auth.JwtService;
import com.team25.backend.domain.Role;

import tools.jackson.databind.JsonNode;

/** BA IT security guidelines (docs/requirements/ExpenseFlow_IT_Security_Guidelines.docx), one test per guideline. */
@ExtendWith(OutputCaptureExtension.class)
class SecurityGuidelinesIT extends ApiTestSupport {

    @Autowired
    JwtService jwt;

    @Test
    void SEC_AUTH_2_tokenExpiresAfter8HoursAndAnExpiredTokenIsRejected() {
        String token = post(null, "/api/auth/login", Map.of("email", "asha.verma@expenseflow.test", "password", password))
                .text("accessToken");
        JsonNode claims = json.readTree(Base64.getUrlDecoder().decode(token.split("\\.")[1]));
        assertThat(claims.path("exp").asLong() - claims.path("iat").asLong()).isEqualTo(8 * 3600);

        UUID asha = idOf("asha.verma@expenseflow.test");
        String expired = jwt.issue(new AppPrincipal(asha, "Asha Verma", Set.of(Role.EMPLOYEE)),
                Instant.now().minus(8, ChronoUnit.HOURS).minus(5, ChronoUnit.MINUTES)); // beyond the 60 s clock skew
        Res r = call("GET", "/api/auth/me", expired, null);
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.text("message")).isEqualTo("Invalid or expired token");
        String almost = jwt.issue(new AppPrincipal(asha, "Asha Verma", Set.of(Role.EMPLOYEE)),
                Instant.now().minus(7, ChronoUnit.HOURS).minus(59, ChronoUnit.MINUTES));
        assertThat(call("GET", "/api/auth/me", almost, null).status()).isEqualTo(200);
    }

    @Test
    void SEC_AUTH_1_passwordsAreNeverLoggedOrStoredInPlainText(CapturedOutput output) {
        String wrong = "Wrong-" + UUID.randomUUID();
        post(null, "/api/auth/login", Map.of("email", "ravi.kumar@expenseflow.test", "password", wrong));
        post(null, "/api/auth/login", Map.of("email", "ravi.kumar@expenseflow.test", "password", password));
        assertThat(output.getAll()).contains("/api/auth/login"); // the request log line was captured...
        assertThat(output.getAll()).doesNotContain(wrong).doesNotContain(password); // ...without either password
        long plain = jdbc.sql("SELECT count(*) FROM app_user WHERE password_hash = :p OR password_hash NOT LIKE '$2%'")
                .param("p", password).query(Long.class).single();
        assertThat(plain).isZero();
        long inAudit = jdbc.sql("SELECT count(*) FROM audit_event WHERE details::text LIKE :w OR comment LIKE :w")
                .param("w", "%" + wrong + "%").query(Long.class).single();
        assertThat(inAudit).isZero();
    }

    @Test
    void SEC_AUTHZ_2_someoneElsesClaimIs404OnEverySubResourceNever403() {
        Person owner = freshEmployee();
        Person other = freshEmployee();
        JsonNode c = draft(owner.email(), line("MEALS", "800.00", weekday(1), "Haldiram's"));
        String id = c.path("id").asString();
        String lineId = c.path("lines").get(0).path("id").asString();
        List<Res> attempts = List.of(
                get(other.email(), "/api/claims/" + id),
                get(other.email(), "/api/claims/" + id + "/audit-trail"),
                get(other.email(), "/api/claims/" + id + "/lines/" + lineId + "/receipt"),
                post(other.email(), "/api/claims/" + id + "/policy-preview", null),
                post(other.email(), "/api/claims/" + id + "/submit", Map.of("version", c.path("version").asInt())),
                post(other.email(), "/api/claims/" + id + "/lines", line("MEALS", "10.00", weekday(1), "x")),
                patch(other.email(), "/api/claims/" + id, Map.of("version", c.path("version").asInt(), "title", "x")),
                delete(other.email(), "/api/claims/" + id),
                post(other.email(), "/api/claims/" + id + "/comments", Map.of("comment", "hi")));
        for (Res r : attempts) {
            assertThat(r.status()).as(r.raw().uri().toString()).isEqualTo(404);
            assertThat(r.text("message")).isEqualTo("Claim not found");
        }
        // A manager outside the chain gets the same 404 as an employee.
        JsonNode routed = routedClaim(owner, "1800.00");
        String otherManager = emailsWithRole("MANAGER").stream()
                .filter(e -> !e.equals(owner.managerEmail()) && !e.equals("arjun.shah@expenseflow.test")
                        && !e.equals("kavya.menon@expenseflow.test"))
                .findFirst().orElseThrow();
        assertThat(get(otherManager, "/api/claims/" + routed.path("id").asString()).status()).isEqualTo(404);
        assertThat(act(otherManager, "approve", routed, Map.of()).status()).isEqualTo(404);
    }

    @Test
    void SEC_INPUT_1_serverValidatesTypeLengthAndAllowedValues() {
        Person p = freshEmployee();
        String longTitle = "x".repeat(151);
        assertThat(post(p.email(), "/api/claims", Map.of("title", longTitle)).status()).as("title length").isEqualTo(400);
        Map<String, Object> longVendor = line("MEALS", "100.00", weekday(1), "v".repeat(151));
        assertThat(post(p.email(), "/api/claims", Map.of("title", "t", "lines", List.of(longVendor))).status()).isEqualTo(400);
        Map<String, Object> longNotes = new java.util.HashMap<>(line("MEALS", "100.00", weekday(1), "v"));
        longNotes.put("notes", "n".repeat(501));
        assertThat(post(p.email(), "/api/claims", Map.of("title", "t", "lines", List.of(longNotes))).status()).isEqualTo(400);
        assertThat(post(p.email(), "/api/claims", Map.of("title", "t",
                "lines", List.of(line("CRYPTO", "100.00", weekday(1), "v")))).status()).as("category value").isEqualTo(400);
        assertThat(post(p.email(), "/api/claims", Map.of("title", "t",
                "lines", List.of(line("MEALS", "100.005", weekday(1), "v")))).status()).as("amount format").isEqualTo(400);
        assertThat(post(p.email(), "/api/claims", Map.of("title", "t",
                "lines", List.of(Map.of("category", "MEALS", "amount", 100, "expenseDate", weekday(1).toString(), "vendor", "v"))))
                .status()).as("amount type (number instead of string)").isEqualTo(400);
        assertThat(post(p.email(), "/api/claims", Map.of("title", "t", "currency", "USD")).status()).isEqualTo(400);
        assertThat(get(p.email(), "/api/claims?status=BOGUS").status()).as("enum query param").isEqualTo(400);
        assertThat(get(p.email(), "/api/claims?size=1000").status()).as("page size").isEqualTo(400);
        assertThat(get(p.email(), "/api/claims?sort=password,asc").status()).as("sort allow-list").isEqualTo(400);
    }

    @Test
    void SEC_ERR_1_errorsAreShortAndNeverShowInternals() {
        Person p = freshEmployee();
        Res malformed = call("POST", "/api/claims", token(p.email()), null);
        Res badJson = post(p.email(), "/api/claims", Map.of("title", Map.of("nested", true)));
        Res badUuid = get(p.email(), "/api/claims/not-a-uuid");
        Res noEndpoint = get(p.email(), "/api/nope");
        for (Res r : List.of(malformed, badJson, badUuid, noEndpoint)) {
            assertThat(r.status()).isIn(400, 404);
            String body = new String(r.raw().body(), StandardCharsets.UTF_8);
            assertThat(body).doesNotContain("Exception", "at com.", "at org.", "tools.jackson", "SQL", "stack", "trace");
            assertThat(r.text("message").length()).isLessThan(200);
            assertThat(r.text("requestId")).isNotBlank();
        }
    }

    @Test
    void SEC_AUDIT_1_everyChangeToAClaimIsRecorded() {
        Person p = freshEmployee();
        JsonNode c = post(p.email(), "/api/claims", Map.of("title", "Audited everywhere",
                "lines", List.of(line("LOCAL_CAB", "300.00", weekday(1), "Ola")))).body();
        String id = c.path("id").asString();
        UUID claimId = UUID.fromString(id);
        String lineId = c.path("lines").get(0).path("id").asString();
        c = patch(p.email(), "/api/claims/" + id, Map.of("version", c.path("version").asInt(), "purpose", "Client")).body();
        put(p.email(), "/api/claims/" + id + "/lines/" + lineId, line("LOCAL_CAB", "320.00", weekday(1), "Ola"));
        JsonNode added = post(p.email(), "/api/claims/" + id + "/lines", line("MEALS", "900.00", weekday(1), "Swiggy")).body();
        String second = added.path("lines").get(1).path("id").asString();
        upload(p.email(), claimId, UUID.fromString(second), pdf(), "r.pdf");
        delete(p.email(), "/api/claims/" + id + "/lines/" + second);
        JsonNode fresh = get(p.email(), "/api/claims/" + id).body();
        JsonNode submitted = submitOk(p.email(), fresh);
        post(p.email(), "/api/claims/" + id + "/comments", Map.of("comment", "Note"));

        List<String> actions = jdbc.sql("SELECT action FROM audit_event WHERE claim_id = :c ORDER BY id")
                .param("c", claimId).query(String.class).list();
        assertThat(actions).containsSubsequence("CLAIM_CREATED", "LINE_ADDED", "CLAIM_UPDATED", "LINE_UPDATED", "LINE_ADDED",
                "RECEIPT_UPLOADED", "LINE_REMOVED", "SUBMITTED", "POLICY_EVALUATED", "AUTO_APPROVED", "COMMENTED");
        assertThat(submitted.path("status").asString()).isEqualTo("AUTO_APPROVED");
        // Append-only even for the app's own connection.
        assertThat(jdbc.sql("SELECT count(*) FROM pg_trigger WHERE tgname IN ('audit_event_no_update_delete', 'audit_event_no_truncate')")
                .query(Long.class).single()).isEqualTo(2);
    }

    @Test
    void SEC_INPUT_3_policyLimitsMatchTheGuidelines() {
        JsonNode policy = get("arjun.shah@expenseflow.test", "/api/policy/current").body();
        Map<String, String> soft = new java.util.HashMap<>();
        policy.path("rules").forEach(r -> soft.put(r.path("code").asString(), r.path("softLimit").asString()));
        assertThat(soft).containsEntry("MEALS_DAILY", "1500.00").containsEntry("HOTEL_NIGHTLY_TIER1", "6000.00")
                .containsEntry("HOTEL_NIGHTLY_OTHER", "4000.00").containsEntry("LOCAL_CAB_TRIP", "2000.00");
        assertThat(policy.path("settings").path("receiptThreshold").asString()).isEqualTo("500.00");
    }
}
