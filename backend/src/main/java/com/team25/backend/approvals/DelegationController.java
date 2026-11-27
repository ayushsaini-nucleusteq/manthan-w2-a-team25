package com.team25.backend.approvals;

import java.net.URI;
import java.time.LocalDate;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.team25.backend.approvals.DelegationRepository.DelegationView;
import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.claims.ClaimApi.Page;

/** M4 delegation (and F5 overview with scope=all for the finance head). */
@RestController
@Validated
@RequestMapping("/api/delegations")
@PreAuthorize("hasAnyRole('MANAGER', 'AUDITOR', 'FINANCE_HEAD')")
public class DelegationController {

    public record DelegationCreateRequest(@NotNull UUID delegateId, @NotNull LocalDate startsOn, @NotNull LocalDate endsOn,
            @Size(max = 500) String reason) {
    }

    private final DelegationService delegations;

    public DelegationController(DelegationService delegations) {
        this.delegations = delegations;
    }

    @GetMapping
    public Page<DelegationView> list(@AuthenticationPrincipal AppPrincipal me,
            @RequestParam(defaultValue = "given") String scope,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate activeOn,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) String sort) {
        return delegations.list(me, scope, activeOn, page, size, sort);
    }

    @PostMapping
    public ResponseEntity<DelegationView> create(@AuthenticationPrincipal AppPrincipal me,
            @Valid @RequestBody DelegationCreateRequest r) {
        DelegationView d = delegations.create(me, r.delegateId(), r.startsOn(), r.endsOn(), r.reason());
        return ResponseEntity.created(URI.create("/api/delegations/" + d.id())).body(d);
    }

    @DeleteMapping("/{delegationId}")
    public ResponseEntity<Void> revoke(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID delegationId) {
        delegations.revoke(me, delegationId);
        return ResponseEntity.noContent().build();
    }
}
