package com.team25.backend.domain;

import java.util.EnumSet;
import java.util.Set;

public enum ClaimStatus {
    DRAFT, SUBMITTED, AUTO_APPROVED, AUTO_REJECTED, PENDING_MANAGER, PENDING_AUDITOR, PENDING_FINANCE_HEAD,
    SENT_BACK, REJECTED, APPROVED, IN_BATCH, PAID;

    /** States in which the owner may edit header, lines and receipts. */
    public static final Set<ClaimStatus> EDITABLE = EnumSet.of(DRAFT, SENT_BACK);

    /** Chain states where an approver acts through approve / reject / send-back. */
    public static final Set<ClaimStatus> PENDING_CHAIN = EnumSet.of(PENDING_MANAGER, PENDING_AUDITOR, PENDING_FINANCE_HEAD);

    public static ClaimStatus pendingFor(StepType type) {
        return switch (type) {
            case MANAGER -> PENDING_MANAGER;
            case AUDITOR -> PENDING_AUDITOR;
            case FINANCE_HEAD -> PENDING_FINANCE_HEAD;
            case SAMPLE_AUDIT -> AUTO_APPROVED;
        };
    }
}
