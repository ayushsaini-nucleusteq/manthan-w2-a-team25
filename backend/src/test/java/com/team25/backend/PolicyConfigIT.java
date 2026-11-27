package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

/**
 * F4 versioned policy (US15). Publishing changes global state, so this class runs last (see
 * junit-platform.properties) and only ADDS a rule for OTHER (no other test uses that category).
 */
@Order(Integer.MAX_VALUE)
class PolicyConfigIT extends ApiTestSupport {

    private static final String HEAD = "arjun.shah@expenseflow.test";

    /** The current version as a create request, plus an OTHER per-trip rule. */
    private Map<String, Object> nextVersion(JsonNode current, String note, boolean addOtherRule) {
        List<Map<String, Object>> rules = new ArrayList<>();
        for (JsonNode r : current.path("rules")) {
            if (r.path("category").asString().equals("OTHER")) {
                continue;
            }
            Map<String, Object> m = new HashMap<>();
            m.put("code", r.path("code").asString());
            m.put("category", r.path("category").asString());
            m.put("unit", r.path("unit").asString());
            m.put("cityTier", r.path("cityTier").isNull() ? null : r.path("cityTier").asString());
            m.put("softLimit", r.path("softLimit").asString());
            m.put("hardLimit", r.path("hardLimit").asString());
            rules.add(m);
        }
        if (addOtherRule) {
            rules.add(Map.of("code", "OTHER_PER_TRIP", "category", "OTHER", "unit", "PER_TRIP",
                    "softLimit", "1000.00", "hardLimit", "2000.00"));
        }
        List<String> cities = new ArrayList<>();
        current.path("tier1Cities").forEach(c -> cities.add(c.asString()));
        return Map.of("basedOnVersionNo", current.path("versionNo").asInt(), "changeNote", note,
                "settings", json.convertValue(current.path("settings"), Map.class), "rules", rules, "tier1Cities", cities);
    }

    @Test
    void US15_AC1_US15_AC2_financeHeadPublishesAVersionWithAuthorAndDate() {
        JsonNode current = get(HEAD, "/api/policy/current").body();
        Map<String, Object> body = nextVersion(current, "Add a limit for Other", true);
        assertThat(post(freshEmployee().managerEmail(), "/api/policy/versions", body).status()).isEqualTo(403);

        Res published = post(HEAD, "/api/policy/versions", body);
        assertThat(published.status()).as(published.body().toString()).isEqualTo(201);
        int no = published.body().path("versionNo").asInt();
        assertThat(no).isEqualTo(current.path("versionNo").asInt() + 1);
        assertThat(published.body().path("current").asBoolean()).isTrue();
        assertThat(published.body().path("createdBy").path("fullName").asString()).isEqualTo("Arjun Shah");
        assertThat(published.text("createdAt")).isNotBlank();
        assertThat(published.body().path("rules").toString()).contains("OTHER_PER_TRIP");

        JsonNode versions = get(freshEmployee().email(), "/api/policy/versions").body().path("items");
        assertThat(versions.get(0).path("versionNo").asInt()).isEqualTo(no);
        assertThat(versions.get(0).path("changeNote").asString()).isEqualTo("Add a limit for Other");
        assertThat(get(HEAD, "/api/policy/versions/" + current.path("versionNo").asInt()).body().path("current").asBoolean())
                .isFalse();
        // Editing an old version: someone published in between.
        assertThat(post(HEAD, "/api/policy/versions", body).status()).isEqualTo(409);
        // Categories now report OTHER as covered.
        assertThat(get(HEAD, "/api/expense-categories").body().toString()).contains("\"code\":\"OTHER\"", "\"coveredByPolicy\":true");
    }

    @Test
    void invalidVersionsAreRejected() {
        JsonNode current = get(HEAD, "/api/policy/current").body();
        Map<String, Object> body = new HashMap<>(nextVersion(current, "Bad", false));
        List<Map<String, Object>> rules = new ArrayList<>((List<Map<String, Object>>) body.get("rules"));
        rules.add(Map.of("code", "TRAIN_TRIP", "category", "TRAIN", "unit", "PER_TRIP", "softLimit", "500.00",
                "hardLimit", "100.00"));
        body.put("rules", rules);
        Res r = post(HEAD, "/api/policy/versions", body);
        assertThat(r.status()).isEqualTo(400);
        assertThat(r.text("message")).contains("hardLimit is below softLimit");
    }

    @Test
    void US15_AC3_changesApplyToNewLinesOnlyAndPastDecisionsKeepTheirVersion() {
        Person p = freshEmployee();
        JsonNode before = get(HEAD, "/api/policy/current").body();
        int oldVersion = before.path("versionNo").asInt();
        // A routed claim evaluated under the current version: OTHER may or may not have a rule yet.
        JsonNode claim = submitOk(p.email(), draft(p.email(), line("TRAIN", "700.00", weekday(1), "IRCTC")));
        JsonNode back = act(p.managerEmail(), "send-back", claim, Map.of("comment", "Add the courier cost")).body();

        Res published = post(HEAD, "/api/policy/versions", nextVersion(before, "Re-publish for US15-AC3", true));
        assertThat(published.status()).isEqualTo(201);
        int newVersion = published.body().path("versionNo").asInt();

        String id = claim.path("id").asString();
        JsonNode added = post(p.email(), "/api/claims/" + id + "/lines", line("OTHER", "1500.00", weekday(1), "FedEx")).body();
        upload(p.email(), java.util.UUID.fromString(id),
                java.util.UUID.fromString(added.path("lines").get(1).path("id").asString()), pdf(), "courier.pdf");
        JsonNode fresh = get(p.email(), "/api/claims/" + id).body();
        JsonNode re = post(p.email(), "/api/claims/" + id + "/submit", Map.of("version", fresh.path("version").asInt())).body();

        JsonNode oldLine = re.path("lines").get(0);
        JsonNode newLine = re.path("lines").get(1);
        assertThat(oldLine.path("policyVersionNo").asInt()).isEqualTo(oldVersion);
        assertThat(newLine.path("policyVersionNo").asInt()).isEqualTo(newVersion);
        assertThat(newLine.path("findings").get(0).path("ruleCode").asString()).isEqualTo("OTHER_PER_TRIP");
        assertThat(newLine.path("findings").get(0).path("reasonCode").asString()).isEqualTo("SOFT_LIMIT_EXCEEDED");
        assertThat(back.path("status").asString()).isEqualTo("SENT_BACK");
        assertThat(re.path("policyVersionNo").asInt()).isEqualTo(newVersion);
    }
}
