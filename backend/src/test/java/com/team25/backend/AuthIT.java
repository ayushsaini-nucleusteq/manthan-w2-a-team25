package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

/** S1 sign-in (wireframe changes W1/W2) and role checks. */
class AuthIT extends ApiTestSupport {

    @Test
    void W1_loginWithEmailAndPasswordReturnsJwtAllRolesAndHomeScreen() {
        Res r = post(null, "/api/auth/login", Map.of("email", "Arjun.Shah@expenseflow.test", "password", password));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.text("tokenType")).isEqualTo("Bearer");
        assertThat(r.body().path("expiresIn").asInt()).isEqualTo(28800);
        JsonNode user = r.body().path("user");
        assertThat(user.path("roles").toString()).contains("EMPLOYEE", "MANAGER", "FINANCE_HEAD");
        assertThat(user.path("homeScreen").asString()).isEqualTo("F1");

        Res me = call("GET", "/api/auth/me", r.text("accessToken"), null);
        assertThat(me.status()).isEqualTo(200);
        assertThat(me.text("email")).isEqualTo("arjun.shah@expenseflow.test");
    }

    @Test
    void W1_homeScreenFollowsTheHighestRole() {
        assertThat(get("asha.verma@expenseflow.test", "/api/auth/me").text("homeScreen")).isEqualTo("E1");
        assertThat(get("ravi.kumar@expenseflow.test", "/api/auth/me").text("homeScreen")).isEqualTo("M1");
        assertThat(get("meera.iyer@expenseflow.test", "/api/auth/me").text("homeScreen")).isEqualTo("A1");
    }

    @Test
    void W1_wrongPasswordAndUnknownEmailGetTheSameMessage() {
        Res wrongPassword = post(null, "/api/auth/login", Map.of("email", "asha.verma@expenseflow.test", "password", "nope"));
        Res unknownEmail = post(null, "/api/auth/login", Map.of("email", "nobody@expenseflow.test", "password", "nope"));
        assertThat(wrongPassword.status()).isEqualTo(401);
        assertThat(unknownEmail.status()).isEqualTo(401);
        assertThat(wrongPassword.text("message")).isEqualTo("Email or password is incorrect");
        assertThat(unknownEmail.text("message")).isEqualTo("Email or password is incorrect");
        assertThat(wrongPassword.text("requestId")).isNotBlank();
    }

    @Test
    void W2_loginsFailedLoginsAndLogoutsAreAudited() {
        long before = jdbc.sql("SELECT count(*) FROM audit_event WHERE action IN ('LOGIN', 'LOGIN_FAILED', 'LOGOUT')")
                .query(Long.class).single();
        post(null, "/api/auth/login", Map.of("email", "ravi.kumar@expenseflow.test", "password", "wrong"));
        Res ok = post(null, "/api/auth/login", Map.of("email", "ravi.kumar@expenseflow.test", "password", password));
        Res logout = call("POST", "/api/auth/logout", ok.text("accessToken"), null);
        assertThat(logout.status()).isEqualTo(204);
        long after = jdbc.sql("SELECT count(*) FROM audit_event WHERE action IN ('LOGIN', 'LOGIN_FAILED', 'LOGOUT')")
                .query(Long.class).single();
        assertThat(after - before).isEqualTo(3);
        String failedDetails = jdbc.sql("SELECT details::text FROM audit_event WHERE action = 'LOGIN_FAILED' ORDER BY id DESC LIMIT 1")
                .query(String.class).single();
        assertThat(failedDetails).contains("ravi.kumar@expenseflow.test").doesNotContain("wrong");
    }

    @Test
    void W2_noPublicUserListAndApiNeedsAToken() {
        assertThat(call("GET", "/api/auth/users", null, null).status()).isEqualTo(401);
        Res anonymous = call("GET", "/api/claims", null, null);
        assertThat(anonymous.status()).isEqualTo(401);
        assertThat(anonymous.text("message")).isEqualTo("Authentication required");
        assertThat(call("GET", "/api/claims", "not-a-jwt", null).status()).isEqualTo(401);
    }

    @Test
    void roleChecks_employeeCannotUseTheApproverInbox() {
        Res r = get("asha.verma@expenseflow.test", "/api/approvals/inbox");
        assertThat(r.status()).isEqualTo(403);
        assertThat(r.text("message")).isEqualTo("Your role does not allow this operation");
    }
}
