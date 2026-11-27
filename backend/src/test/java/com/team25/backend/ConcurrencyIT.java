package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.function.Supplier;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.RepeatedTest;

import tools.jackson.databind.JsonNode;

/**
 * Races: two requests released at the same instant. Correctness comes from the database (claim row locks,
 * version checks, a compare-and-set on approval_step.status, UNIQUE payout_item.claim_id, advisory locks), so
 * exactly one request wins and the other gets 409.
 */
class ConcurrencyIT extends ApiTestSupport {

    private static final ExecutorService POOL = Executors.newFixedThreadPool(4);

    @AfterAll
    static void shutdown() {
        POOL.shutdownNow();
    }

    /** Runs both actions in parallel, released together by a latch; returns their statuses. */
    private List<Integer> race(Supplier<Integer> a, Supplier<Integer> b) throws Exception {
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<Integer>> futures = new ArrayList<>();
        for (Supplier<Integer> s : List.of(a, b)) {
            futures.add(POOL.submit(() -> {
                ready.countDown();
                go.await();
                return s.get();
            }));
        }
        ready.await();
        go.countDown();
        List<Integer> statuses = new ArrayList<>();
        for (Future<Integer> f : futures) {
            statuses.add(f.get());
        }
        return statuses;
    }

    private long count(String sql, UUID claimId) {
        return jdbc.sql(sql).param("c", claimId).query(Long.class).single();
    }

    @RepeatedTest(3)
    void twoApproversOnTheSameStepExactlyOneWins() throws Exception {
        Person p = freshEmployee();
        JsonNode c = pendingAuditor(p, "33000.00");
        List<String> auditors = emailsWithRole("AUDITOR");
        String a1 = auditors.get(0);
        String a2 = auditors.get(1);
        token(a1);
        token(a2);
        Map<String, Object> body = Map.of("version", c.path("version").asInt());
        String path = "/api/claims/" + c.path("id").asString() + "/approve";

        List<Integer> statuses = race(() -> post(a1, path, body).status(), () -> post(a2, path, body).status());

        assertThat(statuses).containsExactlyInAnyOrder(200, 409);
        UUID id = UUID.fromString(c.path("id").asString());
        assertThat(get(p.email(), "/api/claims/" + id).text("status")).isEqualTo("APPROVED");
        assertThat(count("SELECT count(*) FROM audit_event WHERE claim_id = :c AND action = 'APPROVED' AND details->>'stepType' = 'AUDITOR'", id))
                .isEqualTo(1);
    }

    @RepeatedTest(3)
    void sameClaimInTwoPayoutBatchesAtOnceOnlyOneBatchGetsIt() throws Exception {
        Person p = freshEmployee();
        JsonNode c = approve(p.managerEmail(), routedClaim(p, "1777.00"));
        String head = "arjun.shah@expenseflow.test";
        token(head);
        Map<String, Object> body = Map.of("claimIds", List.of(c.path("id").asString()));

        List<Integer> statuses = race(() -> post(head, "/api/payouts", body).status(),
                () -> post(head, "/api/payouts", body).status());

        assertThat(statuses).containsExactlyInAnyOrder(201, 409);
        assertThat(count("SELECT count(*) FROM payout_item WHERE claim_id = :c", UUID.fromString(c.path("id").asString())))
                .isEqualTo(1);
    }

    @RepeatedTest(3)
    void sameClaimSubmittedTwiceAtOnceSubmitsOnce() throws Exception {
        Person p = freshEmployee();
        JsonNode draft = draft(p.email(), line("AIRFARE", "2222.00", weekday(1), unique("IndiGo")));
        token(p.email());
        Map<String, Object> body = Map.of("version", draft.path("version").asInt());
        String path = "/api/claims/" + draft.path("id").asString() + "/submit";

        List<Integer> statuses = race(() -> post(p.email(), path, body).status(), () -> post(p.email(), path, body).status());

        assertThat(statuses).containsExactlyInAnyOrder(200, 409);
        UUID id = UUID.fromString(draft.path("id").asString());
        assertThat(count("SELECT submission_no::bigint FROM expense_claim WHERE id = :c", id)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM audit_event WHERE claim_id = :c AND action = 'SUBMITTED'", id)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM approval_step WHERE claim_id = :c", id)).isEqualTo(1);
    }

    @RepeatedTest(3)
    void bulkApproveRacingASingleApproveNeverApprovesTwice() throws Exception {
        Person p = freshEmployee();
        JsonNode c = pendingAuditor(p, "34000.00");
        List<String> auditors = emailsWithRole("AUDITOR");
        String bulkAuditor = auditors.get(0);
        String singleAuditor = auditors.get(1);
        token(bulkAuditor);
        token(singleAuditor);
        String id = c.path("id").asString();
        List<String> bulkOutcome = new ArrayList<>();

        List<Integer> statuses = race(() -> {
            Res r = post(bulkAuditor, "/api/auditor/queue/bulk-approve", Map.of("claimIds", List.of(id)));
            bulkOutcome.add(r.body().path("results").get(0).path("outcome").asString());
            return r.status();
        }, () -> post(singleAuditor, "/api/claims/" + id + "/approve", Map.of("version", c.path("version").asInt())).status());

        assertThat(statuses.get(0)).isEqualTo(200); // the bulk call itself always answers 200 with per-row results
        boolean bulkWon = bulkOutcome.get(0).equals("SUCCEEDED");
        boolean singleWon = statuses.get(1) == 200;
        assertThat(bulkWon ^ singleWon).as("exactly one approval landed (bulk=%s, single=%s)", bulkWon, statuses.get(1)).isTrue();
        if (!singleWon) {
            assertThat(statuses.get(1)).isEqualTo(409);
        }
        UUID uuid = UUID.fromString(id);
        assertThat(count("SELECT count(*) FROM audit_event WHERE claim_id = :c AND action = 'APPROVED' AND details->>'stepType' = 'AUDITOR'", uuid))
                .isEqualTo(1);
        assertThat(get(p.email(), "/api/claims/" + id).text("status")).isEqualTo("APPROVED");
    }
}
