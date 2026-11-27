package com.team25.backend.approvals;

import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.team25.backend.approvals.ApprovalService.InboxFilter;
import com.team25.backend.approvals.ApprovalService.InboxItem;
import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.claims.ClaimApi.AuditEventView;
import com.team25.backend.claims.ClaimApi.ClaimDetail;
import com.team25.backend.claims.ClaimApi.Page;
import com.team25.backend.claims.ClaimViews;
import com.team25.backend.domain.Money;
import com.team25.backend.domain.StepType;

/** Approver inbox (M1) and decision bar (M3 / A2). Comments are open to anyone who can see the claim. */
@RestController
@Validated
public class ApprovalController {

    public record ApproveRequest(@NotNull Integer version, @Size(max = 2000) String comment) {
    }

    public record RejectRequest(@NotNull Integer version, @NotBlank @Size(max = 2000) String reason) {
    }

    public record SendBackRequest(@NotNull Integer version, @NotBlank @Size(max = 2000) String comment) {
    }

    public record CommentRequest(@NotBlank @Size(max = 2000) String comment) {
    }

    private final ApprovalService approvals;
    private final ClaimViews views;

    public ApprovalController(ApprovalService approvals, ClaimViews views) {
        this.approvals = approvals;
        this.views = views;
    }

    @GetMapping("/api/approvals/inbox")
    @PreAuthorize("hasAnyRole('MANAGER', 'AUDITOR', 'FINANCE_HEAD')")
    public Page<InboxItem> inbox(@AuthenticationPrincipal AppPrincipal me,
            @RequestParam(defaultValue = "PENDING") @Pattern(regexp = "PENDING|OVERDUE|SENT_BACK|DECIDED") String state,
            @RequestParam(required = false) StepType stepType,
            @RequestParam(required = false) UUID departmentId,
            @RequestParam(required = false) @Pattern(regexp = Money.PATTERN) String minAmount,
            @RequestParam(required = false) @Pattern(regexp = Money.PATTERN) String maxAmount,
            @RequestParam(required = false) @Size(max = 100) String q,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        InboxFilter filter = new InboxFilter(state, stepType, departmentId, ApprovalService.money(minAmount),
                ApprovalService.money(maxAmount), q);
        return approvals.inbox(me, filter, page, size);
    }

    @PostMapping("/api/claims/{claimId}/approve")
    @PreAuthorize("hasAnyRole('MANAGER', 'AUDITOR', 'FINANCE_HEAD')")
    public ClaimDetail approve(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @Valid @RequestBody ApproveRequest request) {
        approvals.approve(me, claimId, request.version(), request.comment());
        return views.detail(claimId, me);
    }

    @PostMapping("/api/claims/{claimId}/reject")
    @PreAuthorize("hasAnyRole('MANAGER', 'AUDITOR', 'FINANCE_HEAD')")
    public ClaimDetail reject(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @Valid @RequestBody RejectRequest request) {
        approvals.reject(me, claimId, request.version(), request.reason().strip());
        return views.detail(claimId, me);
    }

    @PostMapping("/api/claims/{claimId}/send-back")
    @PreAuthorize("hasAnyRole('MANAGER', 'AUDITOR', 'FINANCE_HEAD')")
    public ClaimDetail sendBack(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @Valid @RequestBody SendBackRequest request) {
        approvals.sendBack(me, claimId, request.version(), request.comment().strip());
        return views.detail(claimId, me);
    }

    @PostMapping("/api/claims/{claimId}/comments")
    public ResponseEntity<AuditEventView> comment(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @Valid @RequestBody CommentRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(approvals.comment(me, claimId, request.comment()));
    }
}
