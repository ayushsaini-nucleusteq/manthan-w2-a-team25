package com.team25.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

/** The demo seed: organisation, 3000 claims across statuses, planted problems, exact sample tagging. */
class SeedDataIT extends ApiTestSupport {

    private long count(String sql) {
        return jdbc.sql(sql).query(Long.class).single();
    }

    @Test
    void seed_organisationHas8Departments150UsersAuditorsAndFinanceHeads() {
        assertThat(count("SELECT count(*) FROM department")).isEqualTo(8);
        assertThat(count("SELECT count(*) FROM app_user")).isEqualTo(150);
        assertThat(count("SELECT count(*) FROM user_role WHERE role = 'AUDITOR'")).isGreaterThanOrEqualTo(2);
        assertThat(count("SELECT count(*) FROM user_role WHERE role = 'FINANCE_HEAD'")).isGreaterThanOrEqualTo(1);
        assertThat(count("SELECT count(*) FROM app_user WHERE manager_id IS NULL")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM app_user WHERE email NOT LIKE '%.%@expenseflow.test'")).isZero();
        assertThat(count("SELECT count(*) FROM app_user WHERE password_hash NOT LIKE '$2%'")).as("BCrypt hashes").isZero();
    }

    @Test
    void seed_3000ClaimsAcrossEveryRestingStatusWithPlantedDuplicatesAndBreaches() {
        assertThat(count("SELECT count(*) FROM expense_claim WHERE claim_number ~ '^CL-[0-9]{6}$' AND created_at < now() - interval '13 days'"))
                .isEqualTo(3000);
        List<String> statuses = jdbc.sql("SELECT DISTINCT status FROM expense_claim WHERE created_at < now() - interval '13 days'")
                .query(String.class).list();
        // SUBMITTED is transient (entered and left in one transaction), so it never rests in the table.
        assertThat(statuses).containsExactlyInAnyOrder("DRAFT", "AUTO_APPROVED", "AUTO_REJECTED", "PENDING_MANAGER",
                "PENDING_AUDITOR", "PENDING_FINANCE_HEAD", "SENT_BACK", "REJECTED", "APPROVED", "IN_BATCH", "PAID");
        assertThat(count("SELECT count(*) FROM policy_finding WHERE reason_code = 'DUPLICATE'")).isPositive();
        assertThat(count("SELECT count(*) FROM policy_finding WHERE reason_code = 'DUPLICATE_RECEIPT'")).isPositive();
        assertThat(count("SELECT count(*) FROM policy_finding WHERE reason_code = 'SOFT_LIMIT_EXCEEDED'")).isPositive();
        assertThat(count("SELECT count(*) FROM policy_finding WHERE reason_code = 'HARD_LIMIT_EXCEEDED'")).isPositive();
        assertThat(count("SELECT count(*) FROM payout_batch WHERE status = 'PAID'")).isPositive();
    }

    @Test
    void US11_AC1_exactlyOneInEveryTenAutoApprovedClaimsIsSampleTagged() {
        // Every completed block of 10 has exactly one tagged claim; the open block has at most one.
        Map<String, Object> blocks = jdbc.sql("""
                SELECT count(*) FILTER (WHERE filled = 10) AS complete,
                       count(*) FILTER (WHERE filled >= target_position) AS tagged,
                       COALESCE(sum(filled), 0) AS approved
                  FROM sample_audit_block""").query().singleRow();
        long autoApprovedEver = count("""
                SELECT count(*) FROM expense_claim c
                 WHERE EXISTS (SELECT 1 FROM audit_event e WHERE e.claim_id = c.id AND e.action = 'AUTO_APPROVED')""");
        long tagged = count("SELECT count(*) FROM expense_claim WHERE sample_audit");
        assertThat(((Number) blocks.get("approved")).longValue()).isEqualTo(autoApprovedEver);
        assertThat(((Number) blocks.get("complete")).longValue()).isEqualTo(autoApprovedEver / 10);
        assertThat(tagged).isEqualTo(((Number) blocks.get("tagged")).longValue());
        assertThat(tagged).isBetween(autoApprovedEver / 10, autoApprovedEver / 10 + 1);
    }
}
