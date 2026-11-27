package com.team25.backend.domain;

/** Ordered best to worst: a line takes its worst finding, a claim its worst line. */
public enum PolicyOutcome {
    AUTO_APPROVE, ROUTE, AUTO_REJECT;

    public PolicyOutcome worst(PolicyOutcome other) {
        return other != null && other.ordinal() > ordinal() ? other : this;
    }
}
