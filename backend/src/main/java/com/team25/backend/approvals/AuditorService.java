package com.team25.backend.approvals;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.claims.ClaimApi.ClaimSummary;
import com.team25.backend.claims.ClaimApi.Page;
import com.team25.backend.claims.ClaimRepository;
import com.team25.backend.domain.ClaimStatus;
import com.team25.backend.domain.StepType;
import com.team25.backend.web.ConflictException;
import com.team25.backend.web.ForbiddenException;
import com.team25.backend.web.NotFoundException;
import com.team25.backend.web.Sorts;

/**
 * A3 bulk actions and the A4 sample-audit worklist. Bulk actions are NOT transactional here: each claim goes
 * through {@link ApprovalService} in its own transaction, so one failing row never undoes the others (US9-AC3).
 */
@Service
public class AuditorService {

    public record BulkResult(UUID claimId, String outcome, ClaimStatus newStatus, BulkError error) {
    }

    public record BulkError(int status, String message) {
    }

    public record BulkResponse(int succeeded, int failed, List<BulkResult> results) {
    }

    private static final Map<String, String> SAMPLE_SORTS = Map.of(
            "submittedAt", "c.submitted_at", "totalAmount", "c.total_amount", "claimNumber", "c.claim_number");

    private final ApprovalService approvals;
    private final ClaimRepository claims;

    public AuditorService(ApprovalService approvals, ClaimRepository claims) {
        this.approvals = approvals;
        this.claims = claims;
    }

    public BulkResponse bulkApprove(AppPrincipal me, List<UUID> claimIds, String comment) {
        return bulk(claimIds, id -> approvals.approve(me, id, null, comment, StepType.AUDITOR));
    }

    public BulkResponse bulkSendBack(AppPrincipal me, List<UUID> claimIds, String comment) {
        return bulk(claimIds, id -> approvals.sendBack(me, id, null, comment, StepType.AUDITOR));
    }

    private static BulkResponse bulk(List<UUID> claimIds, Function<UUID, ClaimStatus> action) {
        List<BulkResult> results = new ArrayList<>();
        int ok = 0;
        for (UUID id : claimIds) {
            BulkError error;
            try {
                ClaimStatus status = action.apply(id);
                results.add(new BulkResult(id, "SUCCEEDED", status, null));
                ok++;
                continue;
            } catch (NotFoundException e) {
                error = new BulkError(404, e.getMessage());
            } catch (ForbiddenException e) {
                error = new BulkError(403, e.getMessage());
            } catch (ConflictException e) {
                error = new BulkError(409, e.getMessage());
            } catch (DataAccessException e) {
                error = new BulkError(409, "Claim changed while it was being processed; retry");
            }
            results.add(new BulkResult(id, "FAILED", null, error));
        }
        return new BulkResponse(ok, claimIds.size() - ok, results);
    }

    /**
     * A4 worklist. PENDING (default): tagged AUTO_APPROVED claims waiting for an auditor, excluding the caller's
     * own; a sample returned by resubmit is only in its assigned auditor's list. Other statuses show history.
     */
    @Transactional(readOnly = true)
    public Page<ClaimSummary> sampleAudits(AppPrincipal me, String status, UUID departmentId, String q, int page, int size,
            String sort) {
        List<String> where = new ArrayList<>();
        Map<String, Object> params = new HashMap<>();
        where.add("c.sample_audit");
        where.add("c.sample_audit_status = :st");
        where.add("c.employee_id <> :me");
        params.put("st", status);
        params.put("me", me.id());
        if ("PENDING".equals(status)) {
            where.add("c.status = 'AUTO_APPROVED'");
            where.add("""
                    EXISTS (SELECT 1 FROM approval_step s WHERE s.claim_id = c.id AND s.step_type = 'SAMPLE_AUDIT'
                             AND s.status = 'PENDING' AND (s.assignee_id IS NULL OR s.assignee_id = :me))""");
        }
        if (departmentId != null) {
            where.add("c.department_id = :dept");
            params.put("dept", departmentId);
        }
        if (q != null && !q.isBlank()) {
            where.add("(c.claim_number ILIKE :q OR c.title ILIKE :q)");
            params.put("q", ClaimRepository.like(q));
        }
        String order = Sorts.orderBy(sort, SAMPLE_SORTS, "c.submitted_at ASC");
        long total = claims.countWhere(where, params);
        return Page.of(claims.listWhere(where, params, order, page, size), page, size, total);
    }
}
