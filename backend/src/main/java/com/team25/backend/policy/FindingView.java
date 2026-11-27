package com.team25.backend.policy;

import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonInclude.Include;
import com.team25.backend.domain.Money;
import com.team25.backend.domain.PolicyOutcome;

/**
 * API shape of a policy finding (openapi PolicyFinding). {@code ruleCode}, {@code ruleName}, {@code limit} and
 * {@code excess} are always present (US2-AC1). Matched ids appear only for the same employee's lines (D7).
 */
public record FindingView(String ruleCode, String ruleName, String reasonCode, PolicyOutcome outcome, String message,
        @JsonInclude(Include.NON_NULL) String limitType,
        @JsonInclude(Include.NON_NULL) String unit,
        String limit,
        @JsonInclude(Include.NON_NULL) String actual,
        String excess,
        @JsonInclude(Include.NON_NULL) UUID matchedClaimId,
        @JsonInclude(Include.NON_NULL) String matchedClaimNumber,
        @JsonInclude(Include.NON_NULL) UUID matchedLineId,
        @JsonInclude(Include.NON_NULL) Integer matchedLineNo) {

    /** From a fresh engine result; {@code ownerId} decides whether the matched line may be shown. */
    public static FindingView of(PolicyEngine.Finding f, UUID ownerId) {
        PolicyEngine.Match m = f.matched();
        boolean show = m != null && ownerId.equals(m.employeeId());
        return new FindingView(f.ruleCode(), f.ruleName(), f.reasonCode(), f.outcome(), f.message(), f.limitType(),
                f.unit(), Money.format(f.limit()), Money.format(f.actual()), Money.format(f.excess()),
                show ? m.claimId() : null, show ? m.claimNumber() : null, show ? m.lineId() : null,
                show ? m.lineNo() : null);
    }
}
