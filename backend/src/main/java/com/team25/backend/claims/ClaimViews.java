package com.team25.backend.claims;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Component;

import com.team25.backend.approvals.ApprovalRouting;
import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.auth.UserDirectory.Ref;
import com.team25.backend.claims.ClaimApi.ClaimComment;
import com.team25.backend.claims.ClaimApi.ClaimDetail;
import com.team25.backend.claims.ClaimApi.LineEvaluation;
import com.team25.backend.claims.ClaimApi.LineView;
import com.team25.backend.claims.ClaimApi.PolicyEvaluation;
import com.team25.backend.claims.ClaimApi.ReceiptView;
import com.team25.backend.claims.ClaimApi.StatusChange;
import com.team25.backend.claims.ClaimApi.StepView;
import com.team25.backend.claims.ClaimRepository.AuditRow;
import com.team25.backend.claims.ClaimRepository.ClaimRow;
import com.team25.backend.claims.ClaimRepository.LineRow;
import com.team25.backend.claims.ClaimRepository.StepRow;
import com.team25.backend.domain.ClaimStatus;
import com.team25.backend.domain.Money;
import com.team25.backend.domain.StepType;
import com.team25.backend.policy.FindingRepository;
import com.team25.backend.policy.FindingView;
import com.team25.backend.policy.PolicyRepository;
import com.team25.backend.web.NotFoundException;

/** Builds the claim detail for a given viewer (status history, comments, steps, allowed actions). */
@Component
public class ClaimViews {

    private static final Set<String> DECIDED = Set.of("APPROVED", "REJECTED", "SENT_BACK");
    private static final Map<String, String> COMMENT_KINDS = Map.of(
            "COMMENTED", "COMMENT",
            "APPROVED", "APPROVAL_NOTE",
            "SENT_BACK", "SEND_BACK",
            "REJECTED", "REJECT_REASON",
            "RESUBMITTED", "RESUBMIT_REPLY",
            "SAMPLE_AUDIT_CLEARED", "SAMPLE_AUDIT_NOTE");

    private final ClaimRepository claims;
    private final FindingRepository findings;
    private final PolicyRepository policies;
    private final ApprovalRouting routing;

    public ClaimViews(ClaimRepository claims, FindingRepository findings, PolicyRepository policies, ApprovalRouting routing) {
        this.claims = claims;
        this.findings = findings;
        this.policies = policies;
        this.routing = routing;
    }

    /** Loads a claim the caller may see, or 404 (US4-AC3: someone else's claim is "not found"). */
    public ClaimRow visible(UUID claimId, AppPrincipal me) {
        ClaimRow claim = claims.find(claimId).orElseThrow(ClaimViews::notFound);
        if (!claims.canView(claim, me)) {
            throw notFound();
        }
        return claim;
    }

    public static NotFoundException notFound() {
        return new NotFoundException("Claim not found");
    }

    public ClaimDetail detail(UUID claimId, AppPrincipal me) {
        ClaimRow c = claims.find(claimId).orElseThrow(ClaimViews::notFound);
        List<LineRow> lines = claims.lines(claimId);
        Map<UUID, List<FindingView>> byLine = findings.forClaim(claimId);
        List<StepRow> steps = claims.steps(claimId);
        int overdueHours = policies.current().overdueThresholdHours();
        Instant now = Instant.now();

        List<LineView> lineViews = lines.stream().map(l -> lineView(l, byLine.getOrDefault(l.id(), List.of()))).toList();

        PolicyEvaluation latest = null;
        if (c.submissionNo() > 0 && c.policyOutcome() != null) {
            List<LineEvaluation> evaluated = lines.stream()
                    .filter(l -> l.policyOutcome() != null && l.evaluatedPolicyVersionNo() != null)
                    .map(l -> new LineEvaluation(l.id(), l.evaluatedPolicyVersionNo(), l.policyOutcome(),
                            byLine.getOrDefault(l.id(), List.of())))
                    .toList();
            Instant evaluatedAt = lines.stream().map(LineRow::evaluatedAt).filter(Objects::nonNull)
                    .max(Comparator.naturalOrder()).orElse(c.submittedAt());
            latest = new PolicyEvaluation(c.submissionNo(), c.policyVersionNo() == null ? 0 : c.policyVersionNo(),
                    evaluatedAt, c.policyOutcome(), Money.format(c.totalAmount()), byLine.getOrDefault(null, List.of()),
                    evaluated);
        }

        List<StepView> stepViews = steps.stream().map(s -> stepView(s, overdueHours, now)).toList();

        List<AuditRow> audit = claims.audit(claimId, 0, 5000);
        List<StatusChange> history = new ArrayList<>();
        List<ClaimComment> comments = new ArrayList<>();
        for (AuditRow e : audit) {
            if (e.toStatus() != null && !e.toStatus().equals(e.fromStatus()) && e.actor() != null) {
                history.add(new StatusChange(e.fromStatus() == null ? null : ClaimStatus.valueOf(e.fromStatus()),
                        ClaimStatus.valueOf(e.toStatus()), e.occurredAt(), e.actor(), e.onBehalfOf()));
            }
            if (e.comment() != null && COMMENT_KINDS.containsKey(e.action()) && e.actor() != null) {
                comments.add(new ClaimComment(COMMENT_KINDS.get(e.action()), e.comment(), e.actor(), e.onBehalfOf(),
                        e.occurredAt()));
            }
        }

        boolean owner = c.ownedBy(me.id());
        boolean editable = owner && ClaimStatus.EDITABLE.contains(c.status());
        return new ClaimDetail(c.summary(), c.purpose(), c.submissionNo(), c.policyVersionNo(), c.decisionReason(),
                editable, lineViews, latest, stepViews, history, comments, allowedActions(c, steps, me, editable),
                c.version(), c.createdAt());
    }

    static LineView lineView(LineRow l, List<FindingView> lineFindings) {
        ReceiptView receipt = l.receipt() == null ? null : new ReceiptView(l.receipt().id(), l.receipt().fileName(),
                l.receipt().contentType(), l.receipt().sizeBytes(), l.receipt().sha256(), l.receipt().uploadedAt());
        return new LineView(l.id(), l.lineNo(), l.category(), Money.format(l.amount()), l.expenseDate(), l.vendor(),
                l.notes(), l.city(), l.nights(), receipt, l.policyOutcome(), l.evaluatedPolicyVersionNo(),
                l.policyOutcome() == null ? List.of() : lineFindings);
    }

    static StepView stepView(StepRow s, int overdueHours, Instant now) {
        boolean decided = DECIDED.contains(s.status());
        boolean overdue = "PENDING".equals(s.status()) && s.pendingSince() != null
                && Duration.between(s.pendingSince(), now).toHours() >= overdueHours;
        Ref assignee = s.assigneeId() == null ? null : new Ref(s.assigneeId(), s.assigneeName());
        Ref actedBy = s.actedBy() == null ? null : new Ref(s.actedBy(), s.actedByName());
        Ref obo = s.onBehalfOf() == null ? null : new Ref(s.onBehalfOf(), s.onBehalfOfName());
        String approverName = decided ? s.actedByName() : s.assigneeName();
        return new StepView(s.id(), s.sequence(), s.stepType().name(), assignee, s.status(), s.pendingSince(), overdue,
                approverName, decided ? s.onBehalfOfName() : null, decided ? s.actedAt() : null, actedBy, obo,
                s.actedAt(), s.comment());
    }

    private List<String> allowedActions(ClaimRow c, List<StepRow> steps, AppPrincipal me, boolean editable) {
        List<String> actions = new ArrayList<>();
        if (editable) {
            actions.add("EDIT");
            if (c.status() == ClaimStatus.DRAFT && c.submissionNo() == 0) {
                actions.add("DELETE");
            }
            actions.add("SUBMIT");
        }
        if (ClaimStatus.PENDING_CHAIN.contains(c.status())) {
            steps.stream()
                    .filter(s -> "PENDING".equals(s.status()) && s.stepType() != StepType.SAMPLE_AUDIT)
                    .findFirst()
                    .flatMap(s -> routing.actAs(s, me, c.employeeId()))
                    .ifPresent(a -> actions.addAll(List.of("APPROVE", "REJECT", "SEND_BACK")));
        }
        if (c.status() != ClaimStatus.DRAFT) {
            actions.add("COMMENT");
        }
        return actions;
    }
}
