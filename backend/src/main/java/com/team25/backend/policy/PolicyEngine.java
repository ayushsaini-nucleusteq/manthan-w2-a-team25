package com.team25.backend.policy;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.team25.backend.domain.Money;
import com.team25.backend.domain.PolicyOutcome;
import com.team25.backend.policy.PolicyVersion.Rule;

/**
 * The policy engine (docs/data-model.md "Policy engine"). Pure: everything outside the claim comes through
 * {@link History}, so the same rules run for requests (SQL-backed history) and for the demo seeder (in-memory).
 *
 * <p>Per line: receipt-hash duplicate → AUTO_REJECT; same vendor+amount+date → ROUTE (DUPLICATE); limit rule
 * over hard → AUTO_REJECT, over soft → ROUTE, else AUTO_APPROVE (WITHIN_LIMIT); weekend → ROUTE; no rule for the
 * category → ROUTE (NO_POLICY_RULE). The line outcome is its worst finding. Missing receipts and future dates are
 * not findings: they block submit (422) before the engine runs.
 */
public final class PolicyEngine {

    public static final String RULE_WEEKEND = "WEEKEND";
    public static final String RULE_DUPLICATE = "DUPLICATE";
    public static final String RULE_DUPLICATE_RECEIPT = "DUPLICATE_RECEIPT";
    public static final String RULE_NO_POLICY = "NO_POLICY_RULE";
    public static final String RULE_AUTO_APPROVE_MAX = "AUTO_APPROVE_MAX_TOTAL";

    private PolicyEngine() {
    }

    /** One line as the engine sees it. {@code createdAt} orders "earlier" lines across claims. */
    public record LineInput(UUID id, int lineNo, String category, BigDecimal amount, LocalDate expenseDate,
            String vendorKey, String city, Integer nights, String receiptSha256, Instant createdAt) {
    }

    /** A matched earlier line (duplicates). {@code employeeId} decides whether the match may be shown. */
    public record Match(UUID claimId, String claimNumber, UUID lineId, int lineNo, UUID employeeId) {
    }

    /** Lines outside the claim being evaluated, limited to counted claims (SUBMITTED or later, not rejected). */
    public interface History {

        /** Sum of the employee's in-scope lines of {@code category} on {@code date} in other claims. */
        BigDecimal otherClaimsDayTotal(String category, LocalDate date);

        /** The employee's earlier in-scope line with the same vendor, amount and date in another claim. */
        Optional<Match> vendorDuplicate(String vendorKey, BigDecimal amount, LocalDate date, Instant before);

        /** Any employee's earlier in-scope line with the same receipt hash in another claim. */
        Optional<Match> receiptDuplicate(String sha256, Instant before);
    }

    public record Finding(String ruleCode, String ruleName, String reasonCode, PolicyOutcome outcome, String message,
            String limitType, String unit, BigDecimal limit, BigDecimal actual, BigDecimal excess, Match matched) {
    }

    public record LineResult(UUID lineId, PolicyOutcome outcome, List<Finding> findings) {
    }

    /**
     * Evaluates {@code toEvaluate} (new or edited lines). {@code claimLines} is every line of the claim, so
     * in-claim duplicates and per-day totals see the unchanged lines too.
     */
    public static List<LineResult> evaluate(PolicyVersion policy, UUID employeeId, UUID claimId, String claimNumber,
            Collection<LineInput> claimLines, Collection<LineInput> toEvaluate, History history) {
        List<LineResult> results = new ArrayList<>();
        for (LineInput line : toEvaluate) {
            results.add(evaluateLine(policy, employeeId, claimId, claimNumber, claimLines, line, history));
        }
        return results;
    }

    static LineResult evaluateLine(PolicyVersion policy, UUID employeeId, UUID claimId, String claimNumber,
            Collection<LineInput> claimLines, LineInput line, History history) {
        List<Finding> findings = new ArrayList<>();

        // 1. Same receipt file (SHA-256): earlier line in this claim, else any employee's counted claim.
        if (line.receiptSha256() != null) {
            Optional<Match> match = claimLines.stream()
                    .filter(o -> o.lineNo() < line.lineNo() && line.receiptSha256().equals(o.receiptSha256()))
                    .findFirst()
                    .map(o -> new Match(claimId, claimNumber, o.id(), o.lineNo(), employeeId))
                    .or(() -> history.receiptDuplicate(line.receiptSha256(), line.createdAt()));
            match.ifPresent(m -> {
                boolean sameEmployee = employeeId.equals(m.employeeId());
                String message = sameEmployee
                        ? "Receipt file is identical to the receipt on line " + m.lineNo() + " of " + m.claimNumber()
                        : "Receipt file matches a receipt already submitted on another employee's claim";
                findings.add(new Finding(RULE_DUPLICATE_RECEIPT, "Duplicate receipt file", "DUPLICATE_RECEIPT",
                        PolicyOutcome.AUTO_REJECT, message, null, null, null, null, null, m));
            });
        }

        // 2. Same vendor + amount + date: earlier line in this claim, else the employee's counted claims.
        Optional<Match> vendorMatch = claimLines.stream()
                .filter(o -> o.lineNo() < line.lineNo() && o.vendorKey().equals(line.vendorKey())
                        && o.amount().compareTo(line.amount()) == 0 && o.expenseDate().equals(line.expenseDate()))
                .findFirst()
                .map(o -> new Match(claimId, claimNumber, o.id(), o.lineNo(), employeeId))
                .or(() -> history.vendorDuplicate(line.vendorKey(), line.amount(), line.expenseDate(), line.createdAt()));
        vendorMatch.ifPresent(m -> findings.add(new Finding(RULE_DUPLICATE, "Duplicate vendor, amount and date",
                "DUPLICATE", PolicyOutcome.ROUTE,
                "Same vendor, amount and date as line " + m.lineNo() + " of " + m.claimNumber(),
                null, null, null, null, null, m)));

        // 3. Limit rule for the category, or a flag when no rule covers it.
        Optional<Rule> rule = policy.ruleFor(line.category(), line.city());
        if (rule.isPresent()) {
            findings.add(limitFinding(rule.get(), line, claimLines, history));
        } else {
            findings.add(new Finding(RULE_NO_POLICY, "No policy rule for category", "NO_POLICY_RULE", PolicyOutcome.ROUTE,
                    "No policy rule covers category " + line.category() + "; routed for approval",
                    null, null, null, null, null, null));
        }

        // 4. Weekend spend is a flag only.
        DayOfWeek day = line.expenseDate().getDayOfWeek();
        if (policy.weekendFlagEnabled() && (day == DayOfWeek.SATURDAY || day == DayOfWeek.SUNDAY)) {
            findings.add(new Finding(RULE_WEEKEND, "Weekend spend", "WEEKEND_EXPENSE", PolicyOutcome.ROUTE,
                    line.expenseDate() + " is a " + (day == DayOfWeek.SATURDAY ? "Saturday" : "Sunday"),
                    null, null, null, null, null, null));
        }

        PolicyOutcome outcome = PolicyOutcome.AUTO_APPROVE;
        for (Finding f : findings) {
            outcome = outcome.worst(f.outcome());
        }
        return new LineResult(line.id(), outcome, List.copyOf(findings));
    }

    private static Finding limitFinding(Rule rule, LineInput line, Collection<LineInput> claimLines, History history) {
        BigDecimal actual;
        String what;
        switch (rule.unit()) {
            case PER_DAY -> {
                BigDecimal inClaim = claimLines.stream()
                        .filter(o -> o.category().equals(line.category()) && o.expenseDate().equals(line.expenseDate()))
                        .map(LineInput::amount)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
                if (claimLines.stream().noneMatch(o -> o.id().equals(line.id()))) {
                    inClaim = inClaim.add(line.amount()); // unsaved line in a preview
                }
                actual = Money.scale(inClaim.add(history.otherClaimsDayTotal(line.category(), line.expenseDate())));
                what = rule.name() + ": " + Money.format(actual) + " on " + line.expenseDate();
            }
            case PER_NIGHT -> {
                int nights = line.nights() == null || line.nights() < 1 ? 1 : line.nights();
                actual = line.amount().divide(BigDecimal.valueOf(nights), 2, RoundingMode.HALF_UP);
                what = rule.name() + ": " + Money.format(actual) + "/night" + (line.city() == null ? "" : " in " + line.city());
            }
            default -> {
                actual = Money.scale(line.amount());
                what = rule.name() + ": " + Money.format(actual);
            }
        }
        String unit = rule.unit().name();
        if (actual.compareTo(rule.hardLimit()) > 0) {
            BigDecimal excess = actual.subtract(rule.hardLimit());
            return new Finding(rule.code(), rule.name(), "HARD_LIMIT_EXCEEDED", PolicyOutcome.AUTO_REJECT,
                    what + " exceeds the hard limit " + Money.format(rule.hardLimit()) + " by " + Money.format(excess),
                    "HARD", unit, rule.hardLimit(), actual, excess, null);
        }
        if (actual.compareTo(rule.softLimit()) > 0) {
            BigDecimal excess = actual.subtract(rule.softLimit());
            return new Finding(rule.code(), rule.name(), "SOFT_LIMIT_EXCEEDED", PolicyOutcome.ROUTE,
                    what + " exceeds the limit " + Money.format(rule.softLimit()) + " by " + Money.format(excess),
                    "SOFT", unit, rule.softLimit(), actual, excess, null);
        }
        return new Finding(rule.code(), rule.name(), "WITHIN_LIMIT", PolicyOutcome.AUTO_APPROVE,
                what + " is within the limit " + Money.format(rule.softLimit()),
                "SOFT", unit, rule.softLimit(), actual, Money.scale(BigDecimal.ZERO), null);
    }

    /** Claim-level finding: every line is clean but the total is above the auto-approve limit. */
    public static Optional<Finding> claimTotalFinding(PolicyVersion policy, PolicyOutcome worstLine, BigDecimal total) {
        if (worstLine == PolicyOutcome.AUTO_APPROVE && total.compareTo(policy.autoApproveMaxTotal()) > 0) {
            BigDecimal excess = total.subtract(policy.autoApproveMaxTotal());
            return Optional.of(new Finding(RULE_AUTO_APPROVE_MAX, "Auto-approve limit per claim",
                    "CLAIM_TOTAL_ABOVE_AUTO_APPROVE_LIMIT", PolicyOutcome.ROUTE,
                    "Claim total " + Money.format(total) + " is above the auto-approve limit "
                            + Money.format(policy.autoApproveMaxTotal()),
                    "SOFT", "PER_CLAIM", policy.autoApproveMaxTotal(), Money.scale(total), excess, null));
        }
        return Optional.empty();
    }
}
