package com.team25.backend.claims;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.team25.backend.approvals.ApprovalRouting;
import com.team25.backend.approvals.ApprovalRouting.Assignment;
import com.team25.backend.audit.AuditService;
import com.team25.backend.audit.AuditService.Entry;
import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.claims.ClaimApi.ClaimPreview;
import com.team25.backend.claims.ClaimApi.LineEvaluation;
import com.team25.backend.claims.ClaimApi.LinePreview;
import com.team25.backend.claims.ClaimApi.PolicyPreview;
import com.team25.backend.claims.ClaimApi.PreviewRequest;
import com.team25.backend.claims.ClaimApi.SubmitRequest;
import com.team25.backend.claims.ClaimRepository.ClaimRow;
import com.team25.backend.claims.ClaimRepository.LineRow;
import com.team25.backend.claims.ClaimRepository.StepRow;
import com.team25.backend.domain.ClaimStatus;
import com.team25.backend.domain.Money;
import com.team25.backend.domain.PolicyOutcome;
import com.team25.backend.domain.Role;
import com.team25.backend.domain.StepType;
import com.team25.backend.notify.NotificationService;
import com.team25.backend.policy.FindingRepository;
import com.team25.backend.policy.FindingView;
import com.team25.backend.policy.JdbcPolicyHistory;
import com.team25.backend.policy.PolicyEngine;
import com.team25.backend.policy.PolicyEngine.Finding;
import com.team25.backend.policy.PolicyEngine.LineInput;
import com.team25.backend.policy.PolicyEngine.LineResult;
import com.team25.backend.policy.PolicyRepository;
import com.team25.backend.policy.PolicyVersion;
import com.team25.backend.policy.SampleAuditSampler;
import com.team25.backend.web.ConflictException;
import com.team25.backend.web.LineError;
import com.team25.backend.web.UnprocessableException;

/**
 * Submit, resubmit and policy preview (docs/api/openapi.yaml "submit"). The engine runs only on new and edited
 * lines with the current policy version; unchanged lines keep their result and version (US15-AC3).
 */
@Service
public class SubmitService {

    private final JdbcClient jdbc;
    private final ClaimRepository claims;
    private final ClaimService claimService;
    private final ClaimViews views;
    private final PolicyRepository policies;
    private final FindingRepository findings;
    private final SampleAuditSampler sampler;
    private final ApprovalRouting routing;
    private final AuditService audit;
    private final NotificationService notifications;

    public SubmitService(JdbcClient jdbc, ClaimRepository claims, ClaimService claimService, ClaimViews views,
            PolicyRepository policies, FindingRepository findings, SampleAuditSampler sampler, ApprovalRouting routing,
            AuditService audit, NotificationService notifications) {
        this.jdbc = jdbc;
        this.claims = claims;
        this.claimService = claimService;
        this.views = views;
        this.policies = policies;
        this.findings = findings;
        this.sampler = sampler;
        this.routing = routing;
        this.audit = audit;
        this.notifications = notifications;
    }

    // ------------------------------------------------------------------ submit / resubmit

    @Transactional
    public void submit(AppPrincipal me, UUID claimId, SubmitRequest req) {
        ClaimRow c = claimService.lockEditable(me, claimId);
        ClaimService.checkVersion(c, req.version());
        jdbc.sql("SELECT pg_advisory_xact_lock(hashtext(:k))").param("k", c.employeeId().toString()).query().listOfRows();

        PolicyVersion policy = policies.current();
        List<LineRow> lines = claims.lines(claimId);
        List<LineError> blockers = blockers(policy, lines);
        if (!blockers.isEmpty()) {
            throw new UnprocessableException("Claim cannot be submitted (" + blockers.size()
                    + (blockers.size() == 1 ? " problem)" : " problems)"), blockers);
        }

        Instant now = Instant.now();
        boolean resubmit = c.status() == ClaimStatus.SENT_BACK;
        String comment = ClaimService.blankToNull(req.comment());
        audit.record(Entry.claim(me.id(), claimId, resubmit ? "RESUBMITTED" : "SUBMITTED")
                .status(c.status(), ClaimStatus.SUBMITTED).comment(comment)
                .details(Map.of("policyVersionNo", policy.versionNo(), "submissionNo", c.submissionNo() + 1)));

        // Evaluate new / edited lines only; lock receipt hashes so concurrent submits can't both miss a duplicate.
        List<LineRow> toEvaluate = lines.stream().filter(l -> l.needsEvaluation() || l.policyOutcome() == null).toList();
        toEvaluate.stream().filter(l -> l.receipt() != null).map(l -> l.receipt().sha256()).distinct().sorted()
                .forEach(sha -> jdbc.sql("SELECT pg_advisory_xact_lock(hashtext(:k))").param("k", sha).query().listOfRows());
        List<LineInput> inputs = lines.stream().map(SubmitService::input).toList();
        List<LineInput> evalInputs = toEvaluate.stream().map(SubmitService::input).toList();
        List<LineResult> results = PolicyEngine.evaluate(policy, c.employeeId(), claimId, c.claimNumber(), inputs,
                evalInputs, new JdbcPolicyHistory(jdbc, c.employeeId(), claimId));
        for (LineResult r : results) {
            findings.replaceForLine(claimId, r.lineId(), policy.id(), r.findings(), now);
            jdbc.sql("""
                    UPDATE expense_line SET policy_outcome = :o, evaluated_policy_version_id = :v, evaluated_at = :at,
                           needs_evaluation = false
                     WHERE id = :id""")
                    .param("o", r.outcome().name()).param("v", policy.id()).param("at", Timestamp.from(now))
                    .param("id", r.lineId()).update();
        }

        // Claim outcome = worst line (stored results for unchanged lines), plus the claim-total rule.
        Map<UUID, PolicyOutcome> outcomes = new LinkedHashMap<>();
        lines.forEach(l -> outcomes.put(l.id(), l.policyOutcome()));
        results.forEach(r -> outcomes.put(r.lineId(), r.outcome()));
        PolicyOutcome worstLine = outcomes.values().stream().reduce(PolicyOutcome.AUTO_APPROVE, PolicyOutcome::worst);
        BigDecimal total = c.totalAmount();
        List<Finding> claimLevel = PolicyEngine.claimTotalFinding(policy, worstLine, total).map(List::of).orElse(List.of());
        findings.replaceClaimLevel(claimId, policy.id(), claimLevel, now);
        PolicyOutcome outcome = claimLevel.isEmpty() ? worstLine : worstLine.worst(PolicyOutcome.ROUTE);

        audit.record(Entry.claim(me.id(), claimId, "POLICY_EVALUATED")
                .details(Map.of("policyVersionNo", policy.versionNo(), "evaluatedLines", results.size(),
                        "outcome", outcome.name())));
        jdbc.sql("""
                UPDATE expense_claim c
                   SET submission_no = submission_no + 1, submitted_at = :now, policy_version_id = :v,
                       policy_outcome = :o, department_id = (SELECT u.department_id FROM app_user u WHERE u.id = c.employee_id)
                 WHERE id = :id""")
                .param("now", Timestamp.from(now)).param("v", policy.id()).param("o", outcome.name())
                .param("id", claimId).update();

        if (worstLine == PolicyOutcome.AUTO_REJECT) {
            autoReject(me, claimId, now);
        } else if (!resubmit) {
            firstRouting(me, c, policy, total, outcome, now);
        } else {
            resubmitRouting(me, c, policy, total, outcome, now);
        }
    }

    /** Submit blockers (422): no lines, missing receipt above the threshold, expense date in the future. */
    static List<LineError> blockers(PolicyVersion policy, List<LineRow> lines) {
        List<LineError> errors = new ArrayList<>();
        if (lines.isEmpty()) {
            errors.add(new LineError(null, null, null, LineError.NO_LINES, "Add at least one line before submitting"));
        }
        for (LineRow l : lines) {
            errors.addAll(lineBlockers(policy, l.id(), l.lineNo(), l.amount(), l.expenseDate(), l.receipt() != null));
        }
        return errors;
    }

    static List<LineError> lineBlockers(PolicyVersion policy, UUID lineId, Integer lineNo, BigDecimal amount,
            java.time.LocalDate date, boolean hasReceipt) {
        List<LineError> errors = new ArrayList<>();
        if (!hasReceipt && amount.compareTo(policy.receiptThreshold()) > 0) {
            errors.add(new LineError(lineId, lineNo, "receipt", LineError.RECEIPT_REQUIRED,
                    (lineNo == null ? "Receipt" : "Line " + lineNo + ": receipt") + " required for amounts above "
                            + Money.format(policy.receiptThreshold())));
        }
        if (date.isAfter(Money.today())) {
            errors.add(new LineError(lineId, lineNo, "expenseDate", LineError.EXPENSE_DATE_IN_FUTURE,
                    (lineNo == null ? "Expense" : "Line " + lineNo + ": expense") + " date is in the future"));
        }
        return errors;
    }

    private void autoReject(AppPrincipal me, UUID claimId, Instant now) {
        String reason = findings.forClaim(claimId).entrySet().stream()
                .filter(e -> e.getKey() != null)
                .flatMap(e -> e.getValue().stream().filter(f -> f.outcome() == PolicyOutcome.AUTO_REJECT)
                        .map(f -> "Line " + lineNo(claimId, e.getKey()) + ": " + f.message()))
                .sorted()
                .collect(Collectors.joining("; "));
        jdbc.sql("UPDATE approval_step SET status = 'CANCELLED' WHERE claim_id = :id AND status IN ('WAITING', 'PENDING', 'SENT_BACK')")
                .param("id", claimId).update();
        jdbc.sql("""
                UPDATE expense_claim SET status = 'AUTO_REJECTED', decision_reason = :reason, decided_at = :now,
                       sample_audit = false, sample_audit_status = NULL, version = version + 1, updated_at = now()
                 WHERE id = :id""")
                .param("reason", truncate(reason, 2000)).param("now", Timestamp.from(now)).param("id", claimId).update();
        audit.record(Entry.claim(me.id(), claimId, "AUTO_REJECTED").status(ClaimStatus.SUBMITTED, ClaimStatus.AUTO_REJECTED)
                .comment(truncate(reason, 2000)));
        ClaimRow after = claims.find(claimId).orElseThrow();
        notifications.decided(after, "AUTO_REJECTED", reason);
    }

    private void firstRouting(AppPrincipal me, ClaimRow c, PolicyVersion policy, BigDecimal total, PolicyOutcome outcome,
            Instant now) {
        if (outcome == PolicyOutcome.AUTO_APPROVE) {
            boolean sampled = sampler.next(policy.sampleAuditPercent());
            jdbc.sql("""
                    UPDATE expense_claim SET status = 'AUTO_APPROVED', decided_at = :now, sample_audit = :s,
                           sample_audit_status = CASE WHEN :s THEN 'PENDING' END, version = version + 1, updated_at = now()
                     WHERE id = :id""")
                    .param("now", Timestamp.from(now)).param("s", sampled).param("id", c.id()).update();
            audit.record(Entry.claim(me.id(), c.id(), "AUTO_APPROVED").status(ClaimStatus.SUBMITTED, ClaimStatus.AUTO_APPROVED));
            if (sampled) {
                routing.insertStep(c.id(), 1, StepType.SAMPLE_AUDIT, new Assignment(null, Role.AUDITOR), "PENDING", now);
                audit.record(Entry.claim(me.id(), c.id(), "SAMPLE_AUDIT_SELECTED"));
            }
            notifications.decided(claims.find(c.id()).orElseThrow(), "AUTO_APPROVED", null);
            return;
        }
        List<StepType> steps = routing.createChain(c.id(), c.employeeId(), total, policy, 1, now);
        setStatus(c.id(), ClaimStatus.PENDING_MANAGER);
        ClaimRow after = claims.find(c.id()).orElseThrow();
        audit.record(Entry.claim(me.id(), c.id(), "ROUTED").status(ClaimStatus.SUBMITTED, ClaimStatus.PENDING_MANAGER)
                .details(Map.of("steps", steps.stream().map(Enum::name).toList(), "flags", after.flags())));
        notifyPending(after);
    }

    /**
     * Resubmit after a send-back. Chain step: back to the step that sent it, routed now (D4), plus any steps the
     * new total requires. Sample-audit step: back to the same auditor only if still clean and within the
     * auto-approve limit, otherwise the tag is dropped and the normal chain starts from the manager (D5).
     */
    private void resubmitRouting(AppPrincipal me, ClaimRow c, PolicyVersion policy, BigDecimal total, PolicyOutcome outcome,
            Instant now) {
        List<StepRow> steps = claims.steps(c.id());
        StepRow sentBack = steps.stream().filter(s -> "SENT_BACK".equals(s.status())).findFirst()
                .orElseThrow(() -> new ConflictException("Claim has no step to return to"));
        int nextSeq = steps.stream().mapToInt(StepRow::sequence).max().orElse(0) + 1;

        if (sentBack.stepType() == StepType.SAMPLE_AUDIT) {
            if (outcome == PolicyOutcome.AUTO_APPROVE) {
                reopen(sentBack, routing.returnAssignment(sentBack, c.employeeId()), now);
                jdbc.sql("""
                        UPDATE expense_claim SET status = 'AUTO_APPROVED', sample_audit_status = 'PENDING',
                               version = version + 1, updated_at = now() WHERE id = :id""")
                        .param("id", c.id()).update();
                audit.record(Entry.claim(me.id(), c.id(), "ROUTED").status(ClaimStatus.SUBMITTED, ClaimStatus.AUTO_APPROVED)
                        .details(Map.of("returnedTo", "SAMPLE_AUDIT")));
                return;
            }
            jdbc.sql("UPDATE approval_step SET status = 'CANCELLED' WHERE id = :id").param("id", sentBack.id()).update();
            jdbc.sql("""
                    UPDATE expense_claim SET sample_audit = false, sample_audit_status = NULL, sample_audited_by = NULL,
                           sample_audited_at = NULL, decided_at = NULL WHERE id = :id""")
                    .param("id", c.id()).update();
            List<StepType> created = routing.createChain(c.id(), c.employeeId(), total, policy, nextSeq, now);
            setStatus(c.id(), ClaimStatus.PENDING_MANAGER);
            ClaimRow after = claims.find(c.id()).orElseThrow();
            audit.record(Entry.claim(me.id(), c.id(), "ROUTED").status(ClaimStatus.SUBMITTED, ClaimStatus.PENDING_MANAGER)
                    .details(Map.of("steps", created.stream().map(Enum::name).toList(), "sampleTagRemoved", true)));
            notifyPending(after);
            return;
        }

        Assignment to = routing.returnAssignment(sentBack, c.employeeId());
        reopen(sentBack, to, now);
        Set<StepType> existing = steps.stream().filter(s -> !"CANCELLED".equals(s.status())).map(StepRow::stepType)
                .collect(Collectors.toSet());
        List<StepType> appended = routing.appendMissing(c.id(), total, policy, existing, nextSeq);
        ClaimStatus status = ClaimStatus.pendingFor(sentBack.stepType());
        setStatus(c.id(), status);
        ClaimRow after = claims.find(c.id()).orElseThrow();
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("returnedTo", sentBack.stepType().name());
        details.put("assigneeId", to.assigneeId() == null ? null : to.assigneeId().toString());
        details.put("appendedSteps", appended.stream().map(Enum::name).toList());
        audit.record(Entry.claim(me.id(), c.id(), "ROUTED").status(ClaimStatus.SUBMITTED, status).details(details));
        if (!appended.isEmpty()) {
            audit.record(Entry.claim(me.id(), c.id(), "STEPS_ADDED")
                    .details(Map.of("steps", appended.stream().map(Enum::name).toList())));
        }
        notifyPending(after);
    }

    private void reopen(StepRow step, Assignment to, Instant now) {
        jdbc.sql("""
                UPDATE approval_step SET status = 'PENDING', pending_since = :now, assignee_id = :assignee,
                       required_role = :role, acted_by = NULL, acted_on_behalf_of = NULL, acted_at = NULL, comment = NULL
                 WHERE id = :id""")
                .param("now", Timestamp.from(now)).param("assignee", to.assigneeId()).param("role", to.requiredRole().name())
                .param("id", step.id()).update();
    }

    private void setStatus(UUID claimId, ClaimStatus status) {
        jdbc.sql("UPDATE expense_claim SET status = :s, decided_at = NULL, version = version + 1, updated_at = now() WHERE id = :id")
                .param("s", status.name()).param("id", claimId).update();
    }

    private void notifyPending(ClaimRow claim) {
        claims.steps(claim.id()).stream().filter(s -> "PENDING".equals(s.status())).findFirst()
                .ifPresent(s -> notifications.approvalWaiting(claim, s.assigneeId(), s.requiredRole()));
    }

    // ------------------------------------------------------------------ preview (E4 / E6)

    @Transactional(readOnly = true)
    public PolicyPreview preview(AppPrincipal me, UUID claimId, PreviewRequest req) {
        ClaimRow c = views.visible(claimId, me);
        if (!c.ownedBy(me.id())) {
            throw new com.team25.backend.web.ForbiddenException("Only the claim owner can preview it");
        }
        if (!ClaimStatus.EDITABLE.contains(c.status())) {
            throw new ConflictException("Claim is locked after submit (status " + c.status() + ")");
        }
        PolicyVersion policy = policies.current();
        List<LineRow> lines = new ArrayList<>(claims.lines(claimId));
        Map<UUID, List<FindingView>> stored = findings.forClaim(claimId);

        LineInput unsaved = null;
        LineRow replaced = null;
        if (req != null && req.line() != null) {
            LineData d = claimService.validate(req.line());
            if (req.lineId() != null) {
                replaced = lines.stream().filter(l -> l.id().equals(req.lineId())).findFirst()
                        .orElseThrow(ClaimService::lineNotFound);
            }
            int lineNo = replaced != null ? replaced.lineNo() : lines.stream().mapToInt(LineRow::lineNo).max().orElse(0) + 1;
            String sha = replaced != null && replaced.receipt() != null ? replaced.receipt().sha256() : null;
            unsaved = new LineInput(replaced != null ? replaced.id() : UUID.randomUUID(), lineNo, d.category(),
                    d.amount(), d.expenseDate(), vendorKey(d.vendor()), d.city(), d.nights(), sha, Instant.now());
        }
        final LineRow replacedLine = replaced;
        List<LineInput> inputs = new ArrayList<>(lines.stream().filter(l -> replacedLine == null || !l.id().equals(replacedLine.id()))
                .map(SubmitService::input).toList());
        if (unsaved != null) {
            inputs.add(unsaved);
        }
        PolicyEngine.History history = new JdbcPolicyHistory(jdbc, c.employeeId(), claimId);

        // Saved lines: stored result if unchanged, fresh evaluation if new/edited.
        List<LineEvaluation> lineEvals = new ArrayList<>();
        PolicyOutcome worst = PolicyOutcome.AUTO_APPROVE;
        for (LineRow l : lines) {
            if (replacedLine != null && l.id().equals(replacedLine.id())) {
                continue;
            }
            if (!l.needsEvaluation() && l.policyOutcome() != null) {
                lineEvals.add(new LineEvaluation(l.id(), l.evaluatedPolicyVersionNo(), l.policyOutcome(),
                        stored.getOrDefault(l.id(), List.of())));
                worst = worst.worst(l.policyOutcome());
            } else {
                LineResult r = PolicyEngine.evaluate(policy, c.employeeId(), claimId, c.claimNumber(), inputs,
                        List.of(input(l)), history).get(0);
                lineEvals.add(new LineEvaluation(l.id(), policy.versionNo(), r.outcome(), findingViews(r, c.employeeId())));
                worst = worst.worst(r.outcome());
            }
        }

        LinePreview linePreview = null;
        BigDecimal total = c.totalAmount();
        if (unsaved != null) {
            LineResult r = PolicyEngine.evaluate(policy, c.employeeId(), claimId, c.claimNumber(), inputs, List.of(unsaved),
                    history).get(0);
            worst = worst.worst(r.outcome());
            boolean hasReceipt = Boolean.TRUE.equals(req.hasReceipt()) || (replacedLine != null && replacedLine.receipt() != null);
            linePreview = new LinePreview(r.outcome(), findingViews(r, c.employeeId()),
                    lineBlockers(policy, null, null, unsaved.amount(), unsaved.expenseDate(), hasReceipt));
            total = total.add(unsaved.amount()).subtract(replacedLine != null ? replacedLine.amount() : BigDecimal.ZERO);
        }

        Optional<Finding> claimTotal = PolicyEngine.claimTotalFinding(policy, worst, total);
        PolicyOutcome outcome = claimTotal.isPresent() ? worst.worst(PolicyOutcome.ROUTE) : worst;
        List<String> projected = new ArrayList<>();
        if (outcome == PolicyOutcome.ROUTE) {
            projected.add(StepType.MANAGER.name());
            if (total.compareTo(policy.auditorAboveTotal()) > 0) {
                projected.add(StepType.AUDITOR.name());
            }
            if (total.compareTo(policy.financeHeadAboveTotal()) > 0) {
                projected.add(StepType.FINANCE_HEAD.name());
            }
        }
        ClaimPreview claimPreview = new ClaimPreview(outcome, Money.format(total), projected, lineEvals,
                claimTotal.map(f -> List.of(FindingView.of(f, c.employeeId()))).orElse(List.of()));
        return new PolicyPreview(policy.versionNo(), linePreview, claimPreview, blockers(policy, lines));
    }

    private static List<FindingView> findingViews(LineResult r, UUID ownerId) {
        return r.findings().stream().map(f -> FindingView.of(f, ownerId)).toList();
    }

    static LineInput input(LineRow l) {
        return new LineInput(l.id(), l.lineNo(), l.category(), l.amount(), l.expenseDate(), l.vendorKey(), l.city(),
                l.nights(), l.receipt() == null ? null : l.receipt().sha256(), l.createdAt());
    }

    /** Same normalisation as the generated expense_line.vendor_key column. */
    static String vendorKey(String vendor) {
        return vendor.strip().replaceAll("\\s+", " ").toLowerCase(java.util.Locale.ROOT);
    }

    private int lineNo(UUID claimId, UUID lineId) {
        return claims.line(claimId, lineId).map(LineRow::lineNo).orElse(0);
    }

    private static String truncate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max - 3) + "...";
    }
}
