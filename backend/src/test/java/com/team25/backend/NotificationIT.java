package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

/** S2 notifications: approval waiting, sent back, claim decided, payout done; read / read-all. */
class NotificationIT extends ApiTestSupport {

    private JsonNode latest(String email, String type, String claimNumber) {
        for (JsonNode n : get(email, "/api/notifications?size=100").body().path("items")) {
            if (n.path("type").asString().equals(type) && n.path("claimNumber").asString().equals(claimNumber)) {
                return n;
            }
        }
        throw new AssertionError("no " + type + " for " + claimNumber + " in " + email + "'s notifications");
    }

    @Test
    void S2_approvalWaitingSentBackDecidedAndPayoutDoneAreNotified() {
        Person p = freshEmployee();
        JsonNode claim = routedClaim(p, "1450.00");
        String number = claim.path("claimNumber").asString();
        JsonNode waiting = latest(p.managerEmail(), "APPROVAL_WAITING", number);
        assertThat(waiting.path("read").asBoolean()).isFalse();
        assertThat(waiting.path("message").asString()).contains(number);

        JsonNode back = act(p.managerEmail(), "send-back", claim, Map.of("comment", "Add the boarding pass")).body();
        assertThat(latest(p.email(), "SENT_BACK", number).path("message").asString()).contains("Add the boarding pass");

        JsonNode re = post(p.email(), "/api/claims/" + claim.path("id").asString() + "/submit",
                Map.of("version", back.path("version").asInt())).body();
        approve(p.managerEmail(), re);
        assertThat(latest(p.email(), "CLAIM_DECIDED", number).path("title").asString()).isEqualTo("Claim approved");

        String head = "arjun.shah@expenseflow.test";
        JsonNode batch = post(head, "/api/payouts", Map.of("claimIds", List.of(claim.path("id").asString()))).body();
        get(head, "/api/payouts/" + batch.path("id").asString() + "/export");
        int version = get(head, "/api/payouts/" + batch.path("id").asString()).body().path("version").asInt();
        post(head, "/api/payouts/" + batch.path("id").asString() + "/mark-paid",
                Map.of("version", version, "confirm", true, "bankReference", "UTR-IT-1"));
        JsonNode paid = latest(p.email(), "PAYOUT_DONE", number);
        assertThat(paid.path("payoutBatchId").asString()).isEqualTo(batch.path("id").asString());
    }

    @Test
    void S2_unreadCountMarkReadAndReadAllAffectOnlyTheCallersNotifications() {
        Person p = freshEmployee();
        JsonNode claim = routedClaim(p, "1460.00");
        act(p.managerEmail(), "reject", claim, Map.of("reason", "Duplicate trip"));
        long unread = get(p.email(), "/api/notifications/unread-count").body().path("unread").asLong();
        assertThat(unread).isPositive();

        JsonNode n = latest(p.email(), "CLAIM_DECIDED", claim.path("claimNumber").asString());
        String id = n.path("id").asString();
        assertThat(post(p.managerEmail(), "/api/notifications/" + id + "/read", null).status()).isEqualTo(404);
        Res read = post(p.email(), "/api/notifications/" + id + "/read", null);
        assertThat(read.body().path("read").asBoolean()).isTrue();
        String readAt = read.text("readAt");
        assertThat(post(p.email(), "/api/notifications/" + id + "/read", null).text("readAt")).isEqualTo(readAt);
        assertThat(get(p.email(), "/api/notifications/unread-count").body().path("unread").asLong()).isEqualTo(unread - 1);
        assertThat(texts(get(p.email(), "/api/notifications?unread=true&size=100").body().path("items"), "id")).doesNotContain(id);

        long managerUnread = get(p.managerEmail(), "/api/notifications/unread-count").body().path("unread").asLong();
        Res all = post(p.email(), "/api/notifications/read-all", null);
        assertThat(all.body().path("updated").asLong()).isEqualTo(unread - 1);
        assertThat(get(p.email(), "/api/notifications/unread-count").body().path("unread").asLong()).isZero();
        assertThat(get(p.managerEmail(), "/api/notifications/unread-count").body().path("unread").asLong()).isEqualTo(managerUnread);
    }
}
