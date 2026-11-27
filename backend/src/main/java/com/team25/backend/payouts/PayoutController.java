package com.team25.backend.payouts;

import java.net.URI;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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

import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.claims.ClaimApi.ClaimSummary;
import com.team25.backend.claims.ClaimApi.Page;
import com.team25.backend.payouts.PayoutService.Batch;
import com.team25.backend.payouts.PayoutService.BatchDetail;
import com.team25.backend.web.BadRequestException;

/** F2 batch builder and F3 export / mark paid. FINANCE_HEAD only. */
@RestController
@Validated
@RequestMapping("/api/payouts")
@PreAuthorize("hasRole('FINANCE_HEAD')")
public class PayoutController {

    public record CreateRequest(@Size(min = 1, max = 1000) List<@NotNull UUID> claimIds) {
    }

    public record MarkPaidRequest(@NotNull Integer version, Boolean confirm, @NotBlank @Size(max = 64) String bankReference,
            LocalDate paidOn) {
    }

    private final PayoutService payouts;

    public PayoutController(PayoutService payouts) {
        this.payouts = payouts;
    }

    @GetMapping("/eligible-claims")
    public Page<ClaimSummary> eligible(@RequestParam(required = false) UUID departmentId,
            @RequestParam(required = false) @Size(max = 100) String q,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) String sort) {
        return payouts.eligible(departmentId, q, page, size, sort);
    }

    @GetMapping
    public Page<Batch> list(@RequestParam(required = false) @Pattern(regexp = "CREATED|EXPORTED|PAID") String status,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) String sort) {
        return payouts.list(status, page, size, sort);
    }

    @PostMapping
    public ResponseEntity<BatchDetail> create(@AuthenticationPrincipal AppPrincipal me,
            @Valid @RequestBody(required = false) CreateRequest request) {
        BatchDetail b = payouts.create(me, request == null ? null : request.claimIds());
        return ResponseEntity.created(URI.create("/api/payouts/" + b.id())).body(b);
    }

    @GetMapping("/{batchId}")
    public BatchDetail get(@PathVariable UUID batchId) {
        return payouts.detail(batchId);
    }

    @GetMapping("/{batchId}/export")
    public ResponseEntity<byte[]> export(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID batchId) {
        PayoutService.Csv csv = payouts.export(me, batchId);
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", java.nio.charset.StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(csv.fileName()).build().toString())
                .body(csv.bytes());
    }

    @PostMapping("/{batchId}/mark-paid")
    public BatchDetail markPaid(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID batchId,
            @Valid @RequestBody MarkPaidRequest request) {
        if (!Boolean.TRUE.equals(request.confirm())) {
            throw new BadRequestException("Validation failed: confirm: must be true to mark a batch paid");
        }
        return payouts.markPaid(me, batchId, request.version(), request.bankReference(), request.paidOn());
    }
}
