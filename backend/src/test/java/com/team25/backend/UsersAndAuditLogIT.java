package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

/** F5 users and hierarchy, F6 global audit log. */
class UsersAndAuditLogIT extends ApiTestSupport {

    private static final String HEAD = "arjun.shah@expenseflow.test";

    private JsonNode user(String email) {
        JsonNode items = get(HEAD, "/api/users?size=5&q=" + email).body().path("items");
        assertThat(items.size()).isEqualTo(1);
        return items.get(0);
    }

    @Test
    void F5_financeHeadSetsManagerRolesAndActiveAndChangesAreAudited() {
        Person p = freshEmployee();
        JsonNode u = user(p.email());
        String id = u.path("id").asString();
        String newManager = emailsWithRole("MANAGER").stream().filter(e -> !e.equals(p.managerEmail())).findFirst().orElseThrow();

        Res moved = patch(HEAD, "/api/users/" + id, Map.of("version", u.path("version").asInt(),
                "managerId", idOf(newManager).toString()));
        assertThat(moved.status()).as(moved.body().toString()).isEqualTo(200);
        assertThat(moved.body().path("manager").path("id").asString()).isEqualTo(idOf(newManager).toString());

        Res promoted = patch(HEAD, "/api/users/" + id, Map.of("version", moved.body().path("version").asInt(),
                "roles", List.of("MANAGER")));
        assertThat(promoted.body().path("roles").toString()).contains("EMPLOYEE", "MANAGER");
        Res restored = patch(HEAD, "/api/users/" + id, Map.of("version", promoted.body().path("version").asInt(),
                "roles", List.of("EMPLOYEE"), "managerId", p.managerId().toString()));
        assertThat(restored.body().path("roles").toString()).doesNotContain("MANAGER");

        Res off = patch(HEAD, "/api/users/" + id, Map.of("version", restored.body().path("version").asInt(), "active", false));
        assertThat(off.body().path("active").asBoolean()).isFalse();
        Res login = post(null, "/api/auth/login", Map.of("email", p.email(), "password", password));
        assertThat(login.status()).isEqualTo(401);
        Res on = patch(HEAD, "/api/users/" + id, Map.of("version", off.body().path("version").asInt(), "active", true));
        assertThat(on.body().path("active").asBoolean()).isTrue();

        assertThat(patch(HEAD, "/api/users/" + id, Map.of("version", 0, "active", true)).status()).isEqualTo(409);
        JsonNode events = get(HEAD, "/api/audit-events?action=USER_UPDATED&size=100").body().path("items");
        assertThat(texts(events, "entityId")).contains(id);
    }

    @Test
    void F5_guardsCyclesSelfDemotionAndTheLastFinanceHead() {
        JsonNode arjun = user(HEAD);
        JsonNode kavya = user("kavya.menon@expenseflow.test");
        // Arjun manages Kavya; making Kavya Arjun's manager would be a cycle.
        assertThat(patch(HEAD, "/api/users/" + arjun.path("id").asString(), Map.of("version", arjun.path("version").asInt(),
                "managerId", kavya.path("id").asString())).status()).isEqualTo(400);
        assertThat(patch(HEAD, "/api/users/" + arjun.path("id").asString(), Map.of("version", arjun.path("version").asInt(),
                "managerId", arjun.path("id").asString())).status()).isEqualTo(400);
        assertThat(patch(HEAD, "/api/users/" + arjun.path("id").asString(), Map.of("version", arjun.path("version").asInt(),
                "roles", List.of("MANAGER"))).status()).isEqualTo(409);
        assertThat(patch(HEAD, "/api/users/" + arjun.path("id").asString(), Map.of("version", arjun.path("version").asInt(),
                "active", false)).status()).isEqualTo(409);
        assertThat(patch(HEAD, "/api/users/" + arjun.path("id").asString(), Map.of("version", arjun.path("version").asInt()))
                .status()).isEqualTo(400);
        assertThat(patch(freshEmployee().managerEmail(), "/api/users/" + arjun.path("id").asString(),
                Map.of("version", 0, "active", true)).status()).isEqualTo(403);
        assertThat(get(freshEmployee().email(), "/api/users").status()).isEqualTo(403);
        assertThat(get(freshEmployee().managerEmail(), "/api/users?role=MANAGER").status()).isEqualTo(200);
    }

    @Test
    void F6_globalAuditLogSearchesByActorActionClaimAndDate() {
        Person p = freshEmployee();
        JsonNode c = routedClaim(p, "1600.00");
        String claimId = c.path("id").asString();
        JsonNode byClaim = get(HEAD, "/api/audit-events?size=100&claimId=" + claimId).body();
        assertThat(texts(byClaim.path("items"), "action")).contains("CLAIM_CREATED", "SUBMITTED", "ROUTED");

        JsonNode byActor = get("meera.iyer@expenseflow.test", "/api/audit-events?size=100&action=SUBMITTED&actorId=" + p.id()
                + "&from=2020-01-01T00:00:00Z").body();
        assertThat(texts(byActor.path("items"), "claimId")).contains(claimId);
        byActor.path("items").forEach(e -> assertThat(e.path("action").asString()).isEqualTo("SUBMITTED"));

        JsonNode none = get(HEAD, "/api/audit-events?claimId=" + claimId + "&to=2020-01-01T00:00:00Z").body();
        assertThat(none.path("totalItems").asLong()).isZero();
        assertThat(get(p.email(), "/api/audit-events").status()).isEqualTo(403);
        assertThat(call("DELETE", "/api/audit-events", token(HEAD), null).status()).isIn(404, 405);
    }
}
