package com.team25.backend.claims;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import com.fasterxml.jackson.annotation.JsonUnwrapped;
import com.team25.backend.auth.UserDirectory.Dept;
import com.team25.backend.auth.UserDirectory.Ref;
import com.team25.backend.domain.ClaimStatus;
import com.team25.backend.domain.Money;
import com.team25.backend.domain.PolicyOutcome;
import com.team25.backend.policy.FindingView;
import com.team25.backend.web.LineError;

/** Request and response shapes of the claim endpoints (docs/api/openapi.yaml). */
public final class ClaimApi {

    private ClaimApi() {
    }

    // ------------------------------------------------------------------ requests

    public record LineRequest(
            @NotBlank String category,
            @NotNull @Pattern(regexp = Money.PATTERN, message = "must be a decimal string with two decimals, e.g. \"1500.00\"") String amount,
            @NotNull LocalDate expenseDate,
            @NotBlank @Size(max = 150) String vendor,
            @Size(max = 500) String notes,
            @Size(max = 80) String city,
            @Min(1) @Max(60) Integer nights) {
    }

    /** Line create: same fields plus an optional client-generated id (offline sync). */
    public record LineCreateRequest(
            UUID id,
            @NotBlank String category,
            @NotNull @Pattern(regexp = Money.PATTERN, message = "must be a decimal string with two decimals, e.g. \"1500.00\"") String amount,
            @NotNull LocalDate expenseDate,
            @NotBlank @Size(max = 150) String vendor,
            @Size(max = 500) String notes,
            @Size(max = 80) String city,
            @Min(1) @Max(60) Integer nights) {

        public LineRequest fields() {
            return new LineRequest(category, amount, expenseDate, vendor, notes, city, nights);
        }
    }

    public record ClaimCreateRequest(
            UUID id,
            @NotBlank @Size(max = 150) String title,
            @Size(max = 1000) String purpose,
            LocalDate tripStartDate,
            LocalDate tripEndDate,
            String currency,
            @Size(max = 50) List<@Valid LineCreateRequest> lines) {
    }

    public record SubmitRequest(@NotNull Integer version, @Size(max = 2000) String comment) {
    }

    public record PreviewRequest(@Valid LineRequest line, UUID lineId, Boolean hasReceipt) {
    }

    // ------------------------------------------------------------------ responses

    public record ReceiptView(UUID id, String fileName, String contentType, int sizeBytes, String sha256, Instant uploadedAt) {
    }

    public record LineView(UUID id, int lineNo, String category, String amount, LocalDate expenseDate, String vendor,
            String notes, String city, Integer nights, ReceiptView receipt, PolicyOutcome policyOutcome,
            Integer policyVersionNo, List<FindingView> findings) {
    }

    /** approverName = who decided, or while undecided the named assignee (null for a role pool). */
    public record StepView(UUID id, int sequence, String stepType, Ref assignee, String status, Instant pendingSince,
            boolean overdue, String approverName, String onBehalfOfName, Instant decidedAt, Ref actedBy,
            Ref onBehalfOf, Instant actedAt, String comment) {
    }

    public record StatusChange(ClaimStatus fromStatus, ClaimStatus toStatus, Instant at, Ref actor, Ref onBehalfOf) {
    }

    public record ClaimComment(String kind, String text, Ref author, Ref onBehalfOf, Instant at) {
    }

    public record LineEvaluation(UUID lineId, int policyVersionNo, PolicyOutcome outcome, List<FindingView> findings) {
    }

    public record PolicyEvaluation(int submissionNo, int policyVersionNo, Instant evaluatedAt, PolicyOutcome outcome,
            String totalAmount, List<FindingView> claimFindings, List<LineEvaluation> lines) {
    }

    public record ClaimSummary(UUID id, String claimNumber, String title, ClaimStatus status, Ref employee,
            Dept department, LocalDate tripStartDate, LocalDate tripEndDate, String currency, String totalAmount,
            int lineCount, PolicyOutcome policyOutcome, List<String> flags, boolean sampleAudit,
            String sampleAuditStatus, Ref sampleAuditedBy, Instant sampleAuditedAt, Instant submittedAt,
            Instant decidedAt, Instant updatedAt) {
    }

    public record ClaimDetail(@JsonUnwrapped ClaimSummary summary, String purpose, int submissionNo,
            Integer policyVersionNo, String decisionReason, boolean editable, List<LineView> lines,
            PolicyEvaluation latestEvaluation, List<StepView> approvalSteps, List<StatusChange> statusHistory,
            List<ClaimComment> comments, List<String> allowedActions, int version, Instant createdAt) {
    }

    public record Page<T>(List<T> items, int page, int size, long totalItems, int totalPages) {

        public static <T> Page<T> of(List<T> items, int page, int size, long total) {
            return new Page<>(items, page, size, total, (int) ((total + size - 1) / size));
        }
    }

    public record ClaimListPage(List<ClaimSummary> items, int page, int size, long totalItems, int totalPages,
            Map<ClaimStatus, Long> statusCounts) {
    }

    public record LinePreview(PolicyOutcome outcome, List<FindingView> findings, List<LineError> submitBlockers) {
    }

    public record ClaimPreview(PolicyOutcome outcome, String totalAmount, List<String> projectedSteps,
            List<LineEvaluation> lines, List<FindingView> claimFindings) {
    }

    public record PolicyPreview(int policyVersionNo, LinePreview line, ClaimPreview claim, List<LineError> submitBlockers) {
    }

    public record AuditEventView(long id, Instant occurredAt, Ref actor, Ref onBehalfOf, String action,
            String entityType, String entityId, UUID claimId, String fromStatus, String toStatus, String comment,
            Map<String, Object> details) {
    }
}
