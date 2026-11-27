package com.team25.backend.web;

import java.util.UUID;

/** One reason a claim cannot be submitted (422) or a pre-submit blocker in a policy preview. */
public record LineError(UUID lineId, Integer lineNo, String field, String code, String message) {

    public static final String RECEIPT_REQUIRED = "RECEIPT_REQUIRED";
    public static final String EXPENSE_DATE_IN_FUTURE = "EXPENSE_DATE_IN_FUTURE";
    public static final String NO_LINES = "NO_LINES";
}
