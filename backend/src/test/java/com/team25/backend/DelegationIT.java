package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.team25.backend.domain.Money;

import tools.jackson.databind.JsonNode;

/** M4 delegation (US7) and the overdue flag. */
class DelegationIT extends ApiTestSupport {

    /** Another manager than {@code p}'s, to act as delegate. */
    private String otherManager(Person p) {
        return emailsWithRole("MANAGER").stream()
                .filter(e -> !e.equals(p.managerEmail()) && !e.equals("arjun.shah@expenseflow.test")
                        && !e.equals("kavya.menon@expenseflow.test"))
                .skip(3).findFirst().orElseThrow();
    }

    private Res delegate(String from, String to, String starts, String ends) {
        return post(from, "/api/delegations", Map.of("delegateId", idOf(to).toString(), "startsOn", starts,
                "endsOn", ends, "reason", "Annual leave"));
    }

    @Test
    void US7_AC1_US7_AC2_delegateSeesItemsMarkedDelegatedAndApprovesOnBehalf() {
        Person p = freshEmployee();
        String delegate = otherManager(p);
        String today = Money.today().toString();
        Res created = delegate(p.managerEmail(), delegate, today, Money.today().plusDays(5).toString());
        assertThat(created.status()).as(created.body().toString()).isEqualTo(201);
        String delegationId = created.text("id");
        try {
            assertThat(created.body().path("active").asBoolean()).isTrue();
            assertThat(created.body().path("roles").toString()).contains("MANAGER");
            assertThat(texts(get(p.managerEmail(), "/api/delegations").body().path("items"), "id")).contains(delegationId);
            assertThat(texts(get(delegate, "/api/delegations?scope=received").body().path("items"), "id")).contains(delegationId);
            assertThat(get(delegate, "/api/auth/me").body().path("delegationsReceived").toString()).contains(delegationId);

            JsonNode claim = routedClaim(p, "1800.00");
            JsonNode item = get(delegate, "/api/approvals/inbox?q=" + claim.path("claimNumber").asString()).body().path("items").get(0);
            assertThat(item.path("delegated").asBoolean()).isTrue();
            assertThat(item.path("onBehalfOf").path("id").asString()).isEqualTo(p.managerId().toString());

            JsonNode approved = approve(delegate, claim);
            assertThat(approved.path("status").asString()).isEqualTo("APPROVED");
            JsonNode trail = get(p.email(), "/api/claims/" + claim.path("id").asString() + "/audit-trail").body().path("items");
            JsonNode decision = null;
            for (JsonNode e : trail) {
                if (e.path("action").asString().equals("APPROVED")) {
                    decision = e;
                }
            }
            assertThat(decision.path("onBehalfOf").path("id").asString()).isEqualTo(p.managerId().toString());
        } finally {
            delete(p.managerEmail(), "/api/delegations/" + delegationId);
        }
    }

    @Test
    void US7_AC3_delegationEndsAutomaticallyAfterItsEndDate() {
        Person p = freshEmployee();
        String delegate = otherManager(p);
        UUID id = jdbc.sql("""
                INSERT INTO delegation (delegator_id, delegate_id, starts_on, ends_on, reason)
                VALUES (:a, :b, current_date - 10, current_date - 1, 'Ended yesterday') RETURNING id""")
                .param("a", p.managerId()).param("b", idOf(delegate)).query(UUID.class).single();
        JsonNode claim = routedClaim(p, "1900.00");
        assertThat(get(delegate, "/api/approvals/inbox?q=" + claim.path("claimNumber").asString()).body()
                .path("totalItems").asLong()).isZero();
        assertThat(act(delegate, "approve", claim, Map.of()).status()).isIn(403, 404);
        JsonNode listed = get(p.managerEmail(), "/api/delegations").body().path("items");
        for (JsonNode d : listed) {
            if (d.path("id").asString().equals(id.toString())) {
                assertThat(d.path("active").asBoolean()).isFalse();
            }
        }
        assertThat(delete(p.managerEmail(), "/api/delegations/" + id).status()).isEqualTo(409);
    }

    @Test
    void delegationValidationOverlapRevokeAndRoles() {
        Person p = freshEmployee();
        String manager = p.managerEmail();
        String delegate = otherManager(p);
        String d1 = Money.today().plusDays(20).toString();
        String d2 = Money.today().plusDays(25).toString();
        assertThat(delegate(manager, manager, d1, d2).status()).isEqualTo(400);
        assertThat(delegate(manager, delegate, d2, d1).status()).isEqualTo(400);
        assertThat(delegate(manager, delegate, Money.today().minusDays(5).toString(), Money.today().minusDays(1).toString())
                .status()).isEqualTo(400);
        assertThat(delegate(manager, p.email(), d1, d2).status()).as("delegate without an approver role").isEqualTo(400);
        assertThat(post(p.email(), "/api/delegations", Map.of("delegateId", p.managerId().toString(), "startsOn", d1,
                "endsOn", d2)).status()).as("employees cannot delegate").isEqualTo(403);

        Res ok = delegate(manager, delegate, d1, d2);
        assertThat(ok.status()).isEqualTo(201);
        assertThat(ok.body().path("active").asBoolean()).isFalse(); // starts in the future
        assertThat(delegate(manager, delegate, Money.today().plusDays(22).toString(), Money.today().plusDays(30).toString())
                .status()).isEqualTo(409);
        assertThat(delete(delegate, "/api/delegations/" + ok.text("id")).status()).isEqualTo(403);
        assertThat(get("arjun.shah@expenseflow.test", "/api/delegations?scope=all&size=100").status()).isEqualTo(200);
        assertThat(get(manager, "/api/delegations?scope=all").status()).isEqualTo(403);
        assertThat(delete(manager, "/api/delegations/" + ok.text("id")).status()).isEqualTo(204);
        assertThat(delete(manager, "/api/delegations/" + ok.text("id")).status()).isEqualTo(409);
    }

    @Test
    void overdueStateUsesTheConfiguredAgeThreshold() {
        Person p = freshEmployee();
        JsonNode claim = routedClaim(p, "2100.00");
        String number = claim.path("claimNumber").asString();
        assertThat(get(p.managerEmail(), "/api/approvals/inbox?state=OVERDUE&q=" + number).body().path("totalItems").asLong())
                .isZero();
        int hours = get(p.email(), "/api/policy/current").body().path("settings").path("overdueThresholdHours").asInt();
        jdbc.sql("UPDATE approval_step SET pending_since = now() - make_interval(hours => :h) WHERE claim_id = :c AND status = 'PENDING'")
                .param("h", hours + 1).param("c", UUID.fromString(claim.path("id").asString())).update();
        JsonNode item = get(p.managerEmail(), "/api/approvals/inbox?state=OVERDUE&q=" + number).body().path("items").get(0);
        assertThat(item.path("overdue").asBoolean()).isTrue();
        assertThat(get(p.email(), "/api/claims/" + claim.path("id").asString()).body().path("approvalSteps").get(0)
                .path("overdue").asBoolean()).isTrue();
    }
}
