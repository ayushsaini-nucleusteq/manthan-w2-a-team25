package com.team25.backend.claims;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.claims.ClaimApi.AuditEventView;
import com.team25.backend.claims.ClaimApi.ClaimCreateRequest;
import com.team25.backend.claims.ClaimApi.ClaimDetail;
import com.team25.backend.claims.ClaimApi.ClaimListPage;
import com.team25.backend.claims.ClaimApi.LineCreateRequest;
import com.team25.backend.claims.ClaimApi.LineRequest;
import com.team25.backend.claims.ClaimApi.Page;
import com.team25.backend.claims.ClaimApi.PolicyPreview;
import com.team25.backend.claims.ClaimApi.PreviewRequest;
import com.team25.backend.claims.ClaimApi.ReceiptView;
import com.team25.backend.claims.ClaimApi.SubmitRequest;
import com.team25.backend.claims.ClaimRepository.ListFilter;
import com.team25.backend.domain.ClaimStatus;
import com.team25.backend.domain.Role;
import com.team25.backend.web.ForbiddenException;
import com.team25.backend.web.Sorts;

import tools.jackson.databind.JsonNode;

/**
 * Claims, lines, receipts, policy preview, submit and the per-claim audit trail. Any signed-in user may file
 * claims; per-claim access (404 / 403) is enforced in the services.
 */
@RestController
@Validated
@RequestMapping("/api/claims")
public class ClaimController {

    private static final Map<String, String> SORTS = Map.of(
            "updatedAt", "c.updated_at",
            "submittedAt", "c.submitted_at",
            "totalAmount", "c.total_amount",
            "claimNumber", "c.claim_number");

    private final ClaimRepository claims;
    private final ClaimService claimService;
    private final ClaimViews views;
    private final ReceiptService receipts;
    private final SubmitService submits;

    public ClaimController(ClaimRepository claims, ClaimService claimService, ClaimViews views, ReceiptService receipts,
            SubmitService submits) {
        this.claims = claims;
        this.claimService = claimService;
        this.views = views;
        this.receipts = receipts;
        this.submits = submits;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public ClaimListPage list(@AuthenticationPrincipal AppPrincipal me,
            @RequestParam(defaultValue = "mine") String scope,
            @RequestParam(required = false) List<ClaimStatus> status,
            @RequestParam(required = false) UUID employeeId,
            @RequestParam(required = false) UUID departmentId,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) String sort) {
        boolean all = switch (scope) {
            case "mine" -> false;
            case "all" -> true;
            default -> throw new com.team25.backend.web.BadRequestException("Invalid value for parameter 'scope'");
        };
        if (all && !me.hasAny(Role.AUDITOR, Role.FINANCE_HEAD)) {
            throw new ForbiddenException("Only auditors and the finance head can list all claims");
        }
        ListFilter filter = new ListFilter(all ? null : me.id(), status, all ? employeeId : null, all ? departmentId : null, q);
        String orderBy = Sorts.orderBy(sort, SORTS, "c.updated_at DESC");
        long total = claims.count(filter);
        Page<ClaimApi.ClaimSummary> p = Page.of(claims.list(filter, orderBy, page, size), page, size, total);
        return new ClaimListPage(p.items(), p.page(), p.size(), p.totalItems(), p.totalPages(), claims.statusCounts(filter));
    }

    @PostMapping
    public ResponseEntity<ClaimDetail> create(@AuthenticationPrincipal AppPrincipal me,
            @Valid @RequestBody ClaimCreateRequest request) {
        ClaimService.Created created = claimService.create(me, request);
        ClaimDetail body = views.detail(created.claimId(), me);
        return created.created()
                ? ResponseEntity.created(URI.create("/api/claims/" + created.claimId())).body(body)
                : ResponseEntity.ok(body);
    }

    @GetMapping("/{claimId}")
    @Transactional(readOnly = true)
    public ClaimDetail get(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId) {
        views.visible(claimId, me);
        return views.detail(claimId, me);
    }

    @PatchMapping("/{claimId}")
    public ClaimDetail update(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @RequestBody JsonNode body) {
        claimService.update(me, claimId, body);
        return views.detail(claimId, me);
    }

    @DeleteMapping("/{claimId}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId) {
        claimService.delete(me, claimId);
        return ResponseEntity.noContent().build();
    }

    // ------------------------------------------------------------------ lines and receipts

    @PostMapping("/{claimId}/lines")
    public ResponseEntity<ClaimDetail> addLine(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @Valid @RequestBody LineCreateRequest request) {
        boolean created = claimService.addLine(me, claimId, request);
        return ResponseEntity.status(created ? HttpStatus.CREATED : HttpStatus.OK).body(views.detail(claimId, me));
    }

    @PutMapping("/{claimId}/lines/{lineId}")
    public ClaimDetail replaceLine(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @PathVariable UUID lineId, @Valid @RequestBody LineRequest request) {
        claimService.replaceLine(me, claimId, lineId, request);
        return views.detail(claimId, me);
    }

    @DeleteMapping("/{claimId}/lines/{lineId}")
    public ClaimDetail deleteLine(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @PathVariable UUID lineId) {
        claimService.deleteLine(me, claimId, lineId);
        return views.detail(claimId, me);
    }

    @PutMapping(path = "/{claimId}/lines/{lineId}/receipt", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ReceiptView uploadReceipt(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @PathVariable UUID lineId, @RequestPart("file") MultipartFile file) {
        return receipts.upload(me, claimId, lineId, file);
    }

    @GetMapping("/{claimId}/lines/{lineId}/receipt")
    public ResponseEntity<byte[]> downloadReceipt(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @PathVariable UUID lineId, @RequestParam(defaultValue = "false") boolean download) {
        ReceiptService.ReceiptFile f = receipts.download(me, claimId, lineId);
        ContentDisposition disposition = (download ? ContentDisposition.attachment() : ContentDisposition.inline())
                .filename(f.fileName(), StandardCharsets.UTF_8).build();
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(f.contentType()))
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .header("X-Content-Type-Options", "nosniff")
                .body(f.bytes());
    }

    // ------------------------------------------------------------------ policy preview and submit

    @PostMapping("/{claimId}/policy-preview")
    public PolicyPreview preview(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @Valid @RequestBody(required = false) PreviewRequest request) {
        return submits.preview(me, claimId, request);
    }

    @PostMapping("/{claimId}/submit")
    public ClaimDetail submit(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @Valid @RequestBody SubmitRequest request) {
        submits.submit(me, claimId, request);
        return views.detail(claimId, me);
    }

    // ------------------------------------------------------------------ audit trail (S3)

    @GetMapping("/{claimId}/audit-trail")
    @Transactional(readOnly = true)
    public Page<AuditEventView> auditTrail(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID claimId,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int size) {
        views.visible(claimId, me);
        long total = claims.countAudit(claimId);
        List<AuditEventView> items = claims.audit(claimId, page * size, size).stream()
                .map(r -> new AuditEventView(r.id(), r.occurredAt(), r.actor(), r.onBehalfOf(), r.action(), r.entityType(),
                        r.entityId(), r.claimId(), r.fromStatus(), r.toStatus(), r.comment(), r.details()))
                .toList();
        return Page.of(items, page, size, total);
    }
}
