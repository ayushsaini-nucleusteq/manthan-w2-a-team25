package com.team25.backend.approvals;

import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.team25.backend.approvals.ApprovalController.ApproveRequest;
import com.team25.backend.approvals.ApprovalController.RejectRequest;
import com.team25.backend.approvals.ApprovalController.SendBackRequest;
import com.team25.backend.approvals.ApprovalService.InboxItem;
import com.team25.backend.approvals.ApprovalService.QueueFilter;
import com.team25.backend.approvals.AuditorService.BulkResponse;
import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.claims.ClaimApi.ClaimDetail;
import com.team25.backend.claims.ClaimApi.ClaimSummary;
import com.team25.backend.claims.ClaimApi.Page;
import com.team25.backend.claims.ClaimViews;
import com.team25.backend.web.BadRequestException;

/** A1 review queue, A3 bulk bar, A4 sample audits. AUDITOR only. */
@RestController
@Validated
@RequestMapping("/api/auditor")
@PreAuthorize("hasRole('AUDITOR')")
public class AuditorController {

    private static final String REASON_CODES =
            "WITHIN_LIMIT|SOFT_LIMIT_EXCEEDED|HARD_LIMIT_EXCEEDED|DUPLICATE|DUPLICATE_RECEIPT|WEEKEND_EXPENSE|NO_POLICY_RULE|CLAIM_TOTAL_ABOVE_AUTO_APPROVE_LIMIT";

    public record BulkApproveRequest(@NotEmpty @Size(max = 100) List<@NotNull UUID> claimIds, @Size(max = 2000) String comment) {
    }

    public record BulkSendBackRequest(@NotEmpty @Size(max = 100) List<@NotNull UUID> claimIds,
            @NotBlank @Size(max = 2000) String comment) {
    }

    private final ApprovalService approvals;
    private final AuditorService auditor;
    private final ClaimViews views;

    public AuditorController(ApprovalService approvals, AuditorService auditor, ClaimViews views) {
        this.approvals = approvals;
        this.auditor = auditor;
        this.views = views;
    }

    @GetMapping("/queue")
    public Page<InboxItem> queue(@AuthenticationPrincipal AppPrincipal me,
            @RequestParam(required = false) @Pattern(regexp = "UP_TO_25K|FROM_25K_TO_100K|ABOVE_100K") String amountBand,
            @RequestParam(required = false) UUID departmentId,
            @RequestParam(required = false) List<@Pattern(regexp = REASON_CODES) String> flag,
            @RequestParam(required = false) @Min(0) Integer minAgeHours,
            @RequestParam(required = false) @Size(max = 100) String q,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return approvals.auditorQueue(me, new QueueFilter(amountBand, departmentId, flag, minAgeHours, q), page, size);
    }

    @PostMapping("/queue/bulk-approve")
    public BulkResponse bulkApprove(@AuthenticationPrincipal AppPrincipal me, @Valid @RequestBody BulkApproveRequest request) {
        return auditor.bulkApprove(me, distinct(request.claimIds()), request.comment());
    }

    @PostMapping("/queue/bulk-send-back")
    public BulkResponse bulkSendBack(@AuthenticationPrincipal AppPrincipal me,
            @Valid @RequestBody BulkSendBackRequest request) {
        return auditor.bulkSendBack(me, distinct(request.claimIds()), request.comment().strip());
    }

    @GetMapping("/sample-audits")
    public Page<ClaimSummary> sampleAudits(@AuthenticationPrincipal AppPrincipal me,
            @RequestParam(defaultValue = "PENDING") @Pattern(regexp = "PENDING|CLEARED|REJECTED|SENT_BACK") String status,
            @RequestParam(required = false) UUID departmentId,
            @RequestParam(required = false) @Size(max = 100) String q,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) String sort) {
        return auditor.sampleAudits(me, status, departmentId, q, page, size, sort);
    }

    @PostMapping("/sample-audits/{claimId}/clear")
    public ClaimDetail clear(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @Valid @RequestBody ApproveRequest request) {
        approvals.clearSample(me, claimId, request.version(), request.comment());
        return views.detail(claimId, me);
    }

    @PostMapping("/sample-audits/{claimId}/reject")
    public ClaimDetail reject(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @Valid @RequestBody RejectRequest request) {
        approvals.rejectSample(me, claimId, request.version(), request.reason().strip());
        return views.detail(claimId, me);
    }

    @PostMapping("/sample-audits/{claimId}/send-back")
    public ClaimDetail sendBack(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @Valid @RequestBody SendBackRequest request) {
        approvals.sendBackSample(me, claimId, request.version(), request.comment().strip());
        return views.detail(claimId, me);
    }

    /** Contract: claimIds are unique; a repeated id is a 400, not a silent double action. */
    private static List<UUID> distinct(List<UUID> ids) {
        if (ids.stream().distinct().count() != ids.size()) {
            throw new BadRequestException("Validation failed: claimIds: must be unique");
        }
        return ids;
    }
}
