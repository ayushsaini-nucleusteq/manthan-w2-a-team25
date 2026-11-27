package com.team25.backend.policy;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.team25.backend.domain.PolicyOutcome;
import com.team25.backend.policy.PolicyEngine.Finding;
import com.team25.backend.policy.PolicyEngine.LineInput;
import com.team25.backend.policy.PolicyEngine.LineResult;
import com.team25.backend.policy.PolicyEngine.Match;
import com.team25.backend.policy.PolicyVersion.Rule;
import com.team25.backend.policy.PolicyVersion.Unit;

/** Unit tests for every policy rule (use case: "unit tests for every policy rule"). No Spring, no database. */
class PolicyEngineTest {

    static final UUID EMPLOYEE = UUID.randomUUID();
    static final UUID CLAIM = UUID.randomUUID();
    static final LocalDate MONDAY = LocalDate.of(2026, 11, 23);
    static final LocalDate SATURDAY = MONDAY.with(TemporalAdjusters.next(DayOfWeek.SATURDAY));

    static PolicyVersion policy(boolean weekendFlag) {
        return new PolicyVersion(UUID.randomUUID(), 1, "seed", null, null, Instant.EPOCH, money("500.00"), weekendFlag, 48,
                money("25000.00"), money("25000.00"), money("100000.00"), 10,
                List.of(new Rule("MEALS_DAILY", "Meals per day", "MEALS", Unit.PER_DAY, null, money("1500.00"), money("3000.00")),
                        new Rule("HOTEL_NIGHTLY_TIER1", "Hotel per night (tier-1 city)", "HOTEL", Unit.PER_NIGHT, "TIER1",
                                money("6000.00"), money("12000.00")),
                        new Rule("HOTEL_NIGHTLY_OTHER", "Hotel per night (other city)", "HOTEL", Unit.PER_NIGHT, "OTHER",
                                money("4000.00"), money("8000.00")),
                        new Rule("LOCAL_CAB_TRIP", "Local cab per trip", "LOCAL_CAB", Unit.PER_TRIP, null, money("2000.00"),
                                money("4000.00"))),
                List.of("Mumbai", "Delhi", "Bengaluru"));
    }

    /** History stub: other claims' day totals, vendor matches and receipt matches. */
    static final class StubHistory implements PolicyEngine.History {
        final Map<String, BigDecimal> dayTotals = new HashMap<>();
        Match vendorMatch;
        Match receiptMatch;

        @Override
        public BigDecimal otherClaimsDayTotal(String category, LocalDate date) {
            return dayTotals.getOrDefault(category + date, BigDecimal.ZERO);
        }

        @Override
        public Optional<Match> vendorDuplicate(String vendorKey, BigDecimal amount, LocalDate date, Instant before) {
            return Optional.ofNullable(vendorMatch);
        }

        @Override
        public Optional<Match> receiptDuplicate(String sha256, Instant before) {
            return Optional.ofNullable(receiptMatch);
        }
    }

    static BigDecimal money(String v) {
        return new BigDecimal(v);
    }

    static LineInput line(int no, String category, String amount, LocalDate date, String vendor, String city, Integer nights,
            String sha) {
        return new LineInput(UUID.randomUUID(), no, category, money(amount), date, vendor.toLowerCase(), city, nights, sha,
                Instant.now());
    }

    static LineInput line(String category, String amount) {
        return line(1, category, amount, MONDAY, "Vendor " + UUID.randomUUID(), null, null, null);
    }

    static LineResult eval(PolicyVersion p, List<LineInput> claimLines, LineInput target, PolicyEngine.History h) {
        return PolicyEngine.evaluate(p, EMPLOYEE, CLAIM, "CL-000999", claimLines, List.of(target), h).get(0);
    }

    static LineResult eval(LineInput only) {
        return eval(policy(true), List.of(only), only, new StubHistory());
    }

    static Finding finding(LineResult r, String reasonCode) {
        return r.findings().stream().filter(f -> f.reasonCode().equals(reasonCode)).findFirst()
                .orElseThrow(() -> new AssertionError("no " + reasonCode + " in " + r.findings()));
    }

    // ---------------------------------------------------------------- meals per day

    @Test
    void mealsWithinTheDailyLimitIsAutoApprovedAndShowsTheLimit() {
        LineResult r = eval(line("MEALS", "1500.00"));
        assertThat(r.outcome()).isEqualTo(PolicyOutcome.AUTO_APPROVE);
        Finding f = finding(r, "WITHIN_LIMIT");
        assertThat(f.ruleName()).isEqualTo("Meals per day");
        assertThat(f.limit()).isEqualByComparingTo("1500.00");
        assertThat(f.excess()).isEqualByComparingTo("0.00");
    }

    @Test
    void mealsDayTotalAddsOtherClaimsAndOtherLinesOfTheSameDay() {
        StubHistory h = new StubHistory();
        h.dayTotals.put("MEALS" + MONDAY, money("700.00"));
        LineInput a = line(1, "MEALS", "500.00", MONDAY, "A", null, null, null);
        LineInput b = line(2, "MEALS", "400.00", MONDAY, "B", null, null, null);
        Finding f = finding(eval(policy(true), List.of(a, b), b, h), "SOFT_LIMIT_EXCEEDED");
        assertThat(f.actual()).isEqualByComparingTo("1600.00");
        assertThat(f.excess()).isEqualByComparingTo("100.00");
        assertThat(f.outcome()).isEqualTo(PolicyOutcome.ROUTE);
    }

    @Test
    void mealsAboveTheHardLimitAutoRejects() {
        Finding f = finding(eval(line("MEALS", "3000.01")), "HARD_LIMIT_EXCEEDED");
        assertThat(f.outcome()).isEqualTo(PolicyOutcome.AUTO_REJECT);
        assertThat(f.limit()).isEqualByComparingTo("3000.00");
        assertThat(f.limitType()).isEqualTo("HARD");
    }

    // ---------------------------------------------------------------- hotel per night by city tier

    @Test
    void hotelTier1IsComparedPerNightAgainst6000AndCityMatchIgnoresCaseAndSpaces() {
        LineResult r = eval(line(1, "HOTEL", "13200.00", MONDAY, "Taj", "  mumbai ", 2, null));
        Finding f = finding(r, "SOFT_LIMIT_EXCEEDED");
        assertThat(f.ruleCode()).isEqualTo("HOTEL_NIGHTLY_TIER1");
        assertThat(f.actual()).isEqualByComparingTo("6600.00");
        assertThat(f.excess()).isEqualByComparingTo("600.00");
        assertThat(f.unit()).isEqualTo("PER_NIGHT");
    }

    @Test
    void hotelOtherCityUses4000AndExactlyTheLimitIsWithin() {
        assertThat(finding(eval(line(1, "HOTEL", "8000.00", MONDAY, "Treebo", "Nagpur", 2, null)), "WITHIN_LIMIT").ruleCode())
                .isEqualTo("HOTEL_NIGHTLY_OTHER");
        Finding over = finding(eval(line(1, "HOTEL", "4100.00", MONDAY, "Treebo", "Nagpur", 1, null)), "SOFT_LIMIT_EXCEEDED");
        assertThat(over.limit()).isEqualByComparingTo("4000.00");
    }

    @Test
    void hotelAboveTheHardLimitPerNightAutoRejects() {
        LineResult r = eval(line(1, "HOTEL", "25000.00", MONDAY, "Taj", "Delhi", 2, null));
        assertThat(r.outcome()).isEqualTo(PolicyOutcome.AUTO_REJECT);
        assertThat(finding(r, "HARD_LIMIT_EXCEEDED").actual()).isEqualByComparingTo("12500.00");
    }

    // ---------------------------------------------------------------- local cab per trip

    @Test
    void cabBoundariesAt2000And4000() {
        assertThat(eval(line("LOCAL_CAB", "2000.00")).outcome()).isEqualTo(PolicyOutcome.AUTO_APPROVE);
        assertThat(finding(eval(line("LOCAL_CAB", "2000.01")), "SOFT_LIMIT_EXCEEDED").excess()).isEqualByComparingTo("0.01");
        assertThat(eval(line("LOCAL_CAB", "4000.00")).outcome()).isEqualTo(PolicyOutcome.ROUTE);
        assertThat(eval(line("LOCAL_CAB", "4000.01")).outcome()).isEqualTo(PolicyOutcome.AUTO_REJECT);
    }

    // ---------------------------------------------------------------- weekend and unknown category

    @Test
    void weekendIsAFlagOnlyAndCanBeSwitchedOff() {
        LineInput sat = line(1, "MEALS", "200.00", SATURDAY, "Cafe", null, null, null);
        LineResult on = eval(policy(true), List.of(sat), sat, new StubHistory());
        assertThat(on.outcome()).isEqualTo(PolicyOutcome.ROUTE);
        assertThat(finding(on, "WEEKEND_EXPENSE").limit()).isNull();
        LineResult off = eval(policy(false), List.of(sat), sat, new StubHistory());
        assertThat(off.outcome()).isEqualTo(PolicyOutcome.AUTO_APPROVE);
        assertThat(off.findings()).noneMatch(f -> f.reasonCode().equals("WEEKEND_EXPENSE"));
    }

    @Test
    void categoryWithoutARuleIsRoutedWithNoPolicyRule() {
        LineResult r = eval(line("AIRFARE", "100.00"));
        assertThat(r.outcome()).isEqualTo(PolicyOutcome.ROUTE);
        Finding f = finding(r, "NO_POLICY_RULE");
        assertThat(f.limit()).isNull();
        assertThat(f.excess()).isNull();
    }

    // ---------------------------------------------------------------- duplicates

    @Test
    void sameVendorAmountDateAsAnEarlierLineOfTheClaimRoutesAndNamesIt() {
        LineInput first = line(1, "LOCAL_CAB", "300.00", MONDAY, "ola", null, null, null);
        LineInput second = line(2, "LOCAL_CAB", "300.00", MONDAY, "ola", null, null, null);
        Finding dup = finding(eval(policy(true), List.of(first, second), second, new StubHistory()), "DUPLICATE");
        assertThat(dup.outcome()).isEqualTo(PolicyOutcome.ROUTE);
        assertThat(dup.matched().lineNo()).isEqualTo(1);
        // The earlier line itself is not a duplicate of the later one.
        assertThat(eval(policy(true), List.of(first, second), first, new StubHistory()).findings())
                .noneMatch(f -> f.reasonCode().equals("DUPLICATE"));
    }

    @Test
    void sameVendorAmountDateInAnEarlierClaimRoutesWithTheMatchedClaim() {
        StubHistory h = new StubHistory();
        UUID other = UUID.randomUUID();
        h.vendorMatch = new Match(other, "CL-000001", UUID.randomUUID(), 3, EMPLOYEE);
        LineInput l = line("MEALS", "250.00");
        Finding dup = finding(eval(policy(true), List.of(l), l, h), "DUPLICATE");
        assertThat(dup.matched().claimId()).isEqualTo(other);
        assertThat(dup.message()).contains("line 3 of CL-000001");
    }

    @Test
    void sameReceiptHashAutoRejectsAndHidesAnotherEmployeesClaim() {
        StubHistory h = new StubHistory();
        h.receiptMatch = new Match(UUID.randomUUID(), "CL-000002", UUID.randomUUID(), 1, UUID.randomUUID());
        LineInput l = line(1, "MEALS", "700.00", MONDAY, "Cafe", null, null, "abc123");
        LineResult r = eval(policy(true), List.of(l), l, h);
        assertThat(r.outcome()).isEqualTo(PolicyOutcome.AUTO_REJECT);
        Finding f = finding(r, "DUPLICATE_RECEIPT");
        assertThat(f.message()).contains("another employee").doesNotContain("CL-000002");
        FindingView shown = FindingView.of(f, EMPLOYEE);
        assertThat(shown.matchedClaimId()).isNull();
        assertThat(shown.matchedClaimNumber()).isNull();
        // Same employee: the earlier claim is named.
        h.receiptMatch = new Match(UUID.randomUUID(), "CL-000003", UUID.randomUUID(), 2, EMPLOYEE);
        assertThat(FindingView.of(finding(eval(policy(true), List.of(l), l, h), "DUPLICATE_RECEIPT"), EMPLOYEE).matchedClaimNumber())
                .isEqualTo("CL-000003");
    }

    @Test
    void lineOutcomeIsTheWorstFinding() {
        LineInput sat = line(1, "LOCAL_CAB", "5000.00", SATURDAY, "Uber", null, null, null);
        LineResult r = eval(policy(true), List.of(sat), sat, new StubHistory());
        assertThat(r.findings()).extracting(Finding::reasonCode).contains("HARD_LIMIT_EXCEEDED", "WEEKEND_EXPENSE");
        assertThat(r.outcome()).isEqualTo(PolicyOutcome.AUTO_REJECT);
    }

    // ---------------------------------------------------------------- claim total

    @Test
    void cleanClaimAbove25000GetsTheClaimTotalFindingAndExactly25000DoesNot() {
        PolicyVersion p = policy(true);
        assertThat(PolicyEngine.claimTotalFinding(p, PolicyOutcome.AUTO_APPROVE, money("25000.00"))).isEmpty();
        Finding f = PolicyEngine.claimTotalFinding(p, PolicyOutcome.AUTO_APPROVE, money("25000.01")).orElseThrow();
        assertThat(f.reasonCode()).isEqualTo("CLAIM_TOTAL_ABOVE_AUTO_APPROVE_LIMIT");
        assertThat(f.excess()).isEqualByComparingTo("0.01");
        assertThat(PolicyEngine.claimTotalFinding(p, PolicyOutcome.ROUTE, money("90000.00"))).isEmpty();
    }

    @Test
    void everyLineGetsAtLeastOneFinding() {
        List<LineInput> lines = new ArrayList<>(List.of(line("MEALS", "10.00"), line("AIRFARE", "10.00"),
                line(1, "HOTEL", "10.00", MONDAY, "x", "Pune", 1, null), line("LOCAL_CAB", "10.00")));
        for (LineInput l : lines) {
            assertThat(eval(l).findings()).as(l.category()).isNotEmpty();
        }
    }
}
