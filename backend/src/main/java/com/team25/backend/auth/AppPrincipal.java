package com.team25.backend.auth;

import java.util.Collections;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;

import com.team25.backend.domain.Role;

/** The signed-in user, rebuilt from the database on every request (roles and active flag are never trusted from the token). */
public record AppPrincipal(UUID id, String fullName, Set<Role> roles) {

    public AppPrincipal {
        roles = Collections.unmodifiableSet(roles.isEmpty() ? EnumSet.noneOf(Role.class) : EnumSet.copyOf(roles));
    }

    public boolean has(Role role) {
        return roles.contains(role);
    }

    public boolean hasAny(Role... any) {
        for (Role r : any) {
            if (roles.contains(r)) {
                return true;
            }
        }
        return false;
    }

    /** Landing screen for the highest role held (S1): F1, A1, M1, otherwise E1. */
    public String homeScreen() {
        if (has(Role.FINANCE_HEAD)) {
            return "F1";
        }
        if (has(Role.AUDITOR)) {
            return "A1";
        }
        if (has(Role.MANAGER)) {
            return "M1";
        }
        return "E1";
    }
}
