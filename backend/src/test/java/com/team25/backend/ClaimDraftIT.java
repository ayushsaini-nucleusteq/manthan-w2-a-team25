package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.team25.backend.claims.ReceiptService;

import tools.jackson.databind.JsonNode;

/** E1-E5: drafts, lines, receipts, offline sync, claim numbers. */
class ClaimDraftIT extends ApiTestSupport {

    @Test
    void US1_AC1_eachLineRequiresCategoryAmountDateAndVendor() {
        Person p = freshEmployee();
        for (String missing : List.of("category", "amount", "expenseDate", "vendor")) {
            Map<String, Object> l = new HashMap<>(line("MEALS", "250.00", weekday(1), "Chai Point"));
            l.remove(missing);
            Res r = post(p.email(), "/api/claims", Map.of("title", "Missing " + missing, "lines", List.of(l)));
            assertThat(r.status()).as(missing).isEqualTo(400);
            assertThat(r.text("message")).contains(missing);
        }
        Res future = post(p.email(), "/api/claims", Map.of("title", "Future",
                "lines", List.of(line("MEALS", "250.00", com.team25.backend.domain.Money.today().plusDays(1), "Chai Point"))));
        assertThat(future.status()).isEqualTo(400);
        assertThat(future.text("message")).contains("expenseDate");
    }

    @Test
    void US1_AC3_savedDraftAppearsInMyClaimsWithTheSameContent() {
        Person p = freshEmployee();
        Res created = post(p.email(), "/api/claims", Map.of("title", "Draft to reopen", "purpose", "Workshop",
                "tripStartDate", weekday(3).toString(), "tripEndDate", weekday(2).toString(),
                "lines", List.of(hotel("9000.00", weekday(3), "Lemon Tree", "Jaipur", 2),
                        line("MEALS", "640.50", weekday(2), "Saravana Bhavan"))));
        assertThat(created.status()).isEqualTo(201);
        String id = created.text("id");
        assertThat(created.text("claimNumber")).matches("CL-\\d{6,}");
        assertThat(created.raw().headers().firstValue("Location")).hasValue("/api/claims/" + id);

        Res list = get(p.email(), "/api/claims?status=DRAFT");
        assertThat(texts(list.body().path("items"), "id")).contains(id);
        assertThat(list.body().path("statusCounts").path("DRAFT").asInt()).isPositive();

        JsonNode reopened = get(p.email(), "/api/claims/" + id).body();
        assertThat(reopened.path("title").asString()).isEqualTo("Draft to reopen");
        assertThat(reopened.path("purpose").asString()).isEqualTo("Workshop");
        assertThat(reopened.path("totalAmount").asString()).isEqualTo("9640.50");
        JsonNode hotelLine = reopened.path("lines").get(0);
        assertThat(hotelLine.path("city").asString()).isEqualTo("Jaipur");
        assertThat(hotelLine.path("nights").asInt()).isEqualTo(2);
        assertThat(reopened.path("lines").get(1).path("amount").asString()).isEqualTo("640.50");
        assertThat(reopened.path("allowedActions").toString()).contains("EDIT", "DELETE", "SUBMIT");
    }

    @Test
    void US3_AC3_offlineReplayReturnsExistingClaimAndLineAndDifferentContentConflicts() {
        Person p = freshEmployee();
        UUID claimId = UUID.randomUUID();
        UUID lineId = UUID.randomUUID();
        Map<String, Object> l = new HashMap<>(line("LOCAL_CAB", "320.00", weekday(1), "Ola"));
        l.put("id", lineId);
        Map<String, Object> body = Map.of("id", claimId, "title", "Offline draft", "lines", List.of(l));

        assertThat(post(p.email(), "/api/claims", body).status()).isEqualTo(201);
        Res replay = post(p.email(), "/api/claims", body);
        assertThat(replay.status()).isEqualTo(200);
        assertThat(replay.body().path("lines").size()).isEqualTo(1);
        assertThat(post(p.email(), "/api/claims", Map.of("id", claimId, "title", "Changed", "lines", List.of(l))).status())
                .isEqualTo(409);

        UUID line2 = UUID.randomUUID();
        Map<String, Object> second = new HashMap<>(line("MEALS", "180.00", weekday(1), "Chai Point"));
        second.put("id", line2);
        assertThat(post(p.email(), "/api/claims/" + claimId + "/lines", second).status()).isEqualTo(201);
        Res lineReplay = post(p.email(), "/api/claims/" + claimId + "/lines", second);
        assertThat(lineReplay.status()).isEqualTo(200);
        assertThat(lineReplay.body().path("lines").size()).isEqualTo(2);
        second.put("amount", "181.00");
        assertThat(post(p.email(), "/api/claims/" + claimId + "/lines", second).status()).isEqualTo(409);

        // Someone else reusing the id gets a conflict, never the other user's claim.
        assertThat(post(freshEmployee().email(), "/api/claims", body).status()).isEqualTo(409);
    }

    @Test
    void US3_AC2_receiptUploadStoresSha256AndCanBeRetriedOrReplaced() {
        Person p = freshEmployee();
        JsonNode claim = post(p.email(), "/api/claims", Map.of("title", "Receipts",
                "lines", List.of(line("MEALS", "900.00", weekday(1), "Barbeque Nation")))).body();
        UUID claimId = UUID.fromString(claim.path("id").asString());
        UUID lineId = UUID.fromString(claim.path("lines").get(0).path("id").asString());
        byte[] pdf = pdf();

        Res first = upload(p.email(), claimId, lineId, pdf, "dinner.pdf");
        assertThat(first.status()).isEqualTo(200);
        assertThat(first.text("sha256")).isEqualTo(ReceiptService.sha256(pdf));
        assertThat(first.text("contentType")).isEqualTo("application/pdf");
        Res retry = upload(p.email(), claimId, lineId, pdf, "dinner.pdf");
        assertThat(retry.status()).isEqualTo(200);
        assertThat(jdbc.sql("SELECT count(*) FROM receipt WHERE line_id = :l").param("l", lineId).query(Long.class).single())
                .isEqualTo(1);

        Res download = get(p.email(), "/api/claims/" + claimId + "/lines/" + lineId + "/receipt");
        assertThat(download.status()).isEqualTo(200);
        assertThat(download.raw().body()).isEqualTo(pdf);
        assertThat(download.raw().headers().firstValue("Content-Disposition").orElse("")).startsWith("inline");

        byte[] png = { (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3 };
        assertThat(upload(p.email(), claimId, lineId, png, "photo.png").text("contentType")).isEqualTo("image/png");
        Res text = upload(p.email(), claimId, lineId, "hello".getBytes(StandardCharsets.UTF_8), "fake.pdf");
        assertThat(text.status()).isEqualTo(400);
        assertThat(text.text("message")).contains("PDF, JPEG or PNG");
        byte[] tooBig = new byte[5 * 1024 * 1024 + 10];
        tooBig[0] = '%';
        tooBig[1] = 'P';
        tooBig[2] = 'D';
        tooBig[3] = 'F';
        tooBig[4] = '-';
        assertThat(upload(p.email(), claimId, lineId, tooBig, "big.pdf").status()).isEqualTo(400);
    }

    @Test
    void W4_claimNumberIsUniqueAndSearchable() {
        Person p = freshEmployee();
        JsonNode a = post(p.email(), "/api/claims", Map.of("title", unique("Search me"))).body();
        JsonNode b = post(p.email(), "/api/claims", Map.of("title", unique("Search me"))).body();
        assertThat(a.path("claimNumber").asString()).isNotEqualTo(b.path("claimNumber").asString());
        String number = a.path("claimNumber").asString();
        Res found = get(p.email(), "/api/claims?q=" + number);
        assertThat(texts(found.body().path("items"), "claimNumber")).containsExactly(number);
        Res byDigits = get(p.email(), "/api/claims?q=" + number.substring(3));
        assertThat(texts(byDigits.body().path("items"), "claimNumber")).contains(number);
    }

    @Test
    void draftsAreEditableUntilSubmitAndOnlyTheOwnerCanChangeThem() {
        Person p = freshEmployee();
        JsonNode claim = post(p.email(), "/api/claims", Map.of("title", "Editable",
                "lines", List.of(line("MEALS", "200.00", weekday(1), "Chai Point")))).body();
        String id = claim.path("id").asString();
        Res patched = patch(p.email(), "/api/claims/" + id, Map.of("version", claim.path("version").asInt(), "title", "Renamed"));
        assertThat(patched.status()).isEqualTo(200);
        assertThat(patched.text("title")).isEqualTo("Renamed");
        assertThat(patch(p.email(), "/api/claims/" + id, Map.of("version", 0, "title", "Stale")).status()).isEqualTo(409);

        // An auditor can see the claim but not edit it (403); another employee can't see it at all (404).
        String auditor = emailsWithRole("AUDITOR").get(0);
        assertThat(patch(auditor, "/api/claims/" + id, Map.of("version", patched.body().path("version").asInt(), "title", "x"))
                .status()).isEqualTo(403);
        assertThat(patch(freshEmployee().email(), "/api/claims/" + id, Map.of("version", 1, "title", "x")).status())
                .isEqualTo(404);

        JsonNode submitted = submitOk(p.email(), patched.body());
        assertThat(submitted.path("status").asString()).isEqualTo("AUTO_APPROVED");
        assertThat(post(p.email(), "/api/claims/" + id + "/lines", line("MEALS", "10.00", weekday(1), "x")).status())
                .isEqualTo(409);
        assertThat(delete(p.email(), "/api/claims/" + id).status()).isEqualTo(409);
    }
}
