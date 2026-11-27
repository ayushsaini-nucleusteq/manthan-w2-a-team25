package com.team25.backend.users;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.claims.ClaimApi.Page;
import com.team25.backend.domain.Role;
import com.team25.backend.users.UserService.User;
import com.team25.backend.web.BadRequestException;

import tools.jackson.databind.JsonNode;

/** F5 users and hierarchy. Approvers can list (to pick a delegate); only the finance head can change users. */
@RestController
@Validated
@RequestMapping("/api/users")
public class UserController {

    private static final Set<String> PATCHABLE = Set.of("version", "managerId", "roles", "active");

    private final UserService users;

    public UserController(UserService users) {
        this.users = users;
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('MANAGER', 'AUDITOR', 'FINANCE_HEAD')")
    public Page<User> list(@RequestParam(required = false) Role role,
            @RequestParam(required = false) UUID departmentId,
            @RequestParam(required = false) UUID managerId,
            @RequestParam(required = false) Boolean active,
            @RequestParam(required = false) @Size(max = 100) String q,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) String sort) {
        return users.list(role, departmentId, managerId, active, q, page, size, sort);
    }

    /** Partial update: only fields present change; {@code managerId: null} removes the manager. */
    @PatchMapping("/{userId}")
    @PreAuthorize("hasRole('FINANCE_HEAD')")
    public User update(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID userId, @RequestBody JsonNode body) {
        if (body == null || !body.isObject()) {
            throw new BadRequestException("Malformed or missing request body");
        }
        for (String name : body.propertyNames()) {
            if (!PATCHABLE.contains(name)) {
                throw new BadRequestException("Validation failed: " + name + ": cannot be changed here");
            }
        }
        if (!body.hasNonNull("version") || !body.get("version").isIntegralNumber()) {
            throw new BadRequestException("Validation failed: version: must not be null");
        }
        if (body.size() < 2) {
            throw new BadRequestException("Validation failed: nothing to change");
        }
        boolean setManager = body.has("managerId");
        UUID managerId = null;
        if (setManager && !body.get("managerId").isNull()) {
            try {
                managerId = UUID.fromString(body.get("managerId").asString());
            } catch (IllegalArgumentException e) {
                throw new BadRequestException("Validation failed: managerId: must be a UUID");
            }
        }
        List<Role> roles = null;
        if (body.has("roles")) {
            if (!body.get("roles").isArray() || body.get("roles").isEmpty()) {
                throw new BadRequestException("Validation failed: roles: must be a non-empty array");
            }
            roles = new ArrayList<>();
            for (JsonNode r : body.get("roles")) {
                try {
                    roles.add(Role.valueOf(r.asString()));
                } catch (IllegalArgumentException e) {
                    throw new BadRequestException("Validation failed: roles: unknown role " + r.asString());
                }
            }
        }
        Boolean active = null;
        if (body.has("active")) {
            if (!body.get("active").isBoolean()) {
                throw new BadRequestException("Validation failed: active: must be true or false");
            }
            active = body.get("active").asBoolean();
        }
        return users.update(me, userId, body.get("version").asInt(), setManager, managerId, roles, active);
    }
}
