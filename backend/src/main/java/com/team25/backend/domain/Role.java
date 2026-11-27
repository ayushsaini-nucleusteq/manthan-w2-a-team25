package com.team25.backend.domain;

/** User roles. Every user holds EMPLOYEE; the others are added on top. Order = precedence (highest last). */
public enum Role {
    EMPLOYEE, MANAGER, AUDITOR, FINANCE_HEAD;

    public String authority() {
        return "ROLE_" + name();
    }
}
