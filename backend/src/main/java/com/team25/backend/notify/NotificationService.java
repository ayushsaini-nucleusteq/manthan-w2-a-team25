package com.team25.backend.notify;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import com.team25.backend.auth.UserDirectory;
import com.team25.backend.claims.ClaimRepository.ClaimRow;
import com.team25.backend.domain.Money;
import com.team25.backend.domain.Role;

/**
 * Writes S2 notifications in the same transaction as the change. Slice 1 only writes them; the
 * /api/notifications endpoints come in a later slice.
 */
@Service
public class NotificationService {

    private final JdbcClient jdbc;
    private final UserDirectory users;

    public NotificationService(JdbcClient jdbc, UserDirectory users) {
        this.jdbc = jdbc;
        this.users = users;
    }

    /** A step became pending: tell the named assignee, or every holder of the pool role (never the owner). */
    public void approvalWaiting(ClaimRow claim, UUID assigneeId, Role requiredRole) {
        Set<UUID> recipients = new LinkedHashSet<>();
        if (assigneeId != null) {
            recipients.add(assigneeId);
        } else {
            recipients.addAll(users.activeWithRole(requiredRole));
        }
        recipients.remove(claim.employeeId());
        for (UUID r : recipients) {
            insert(r, "APPROVAL_WAITING", claim.id(), "Claim waiting for your approval",
                    claim.claimNumber() + " from " + claim.employeeName() + ", " + Money.format(claim.totalAmount()) + " INR");
        }
    }

    public void sentBack(ClaimRow claim, String comment) {
        insert(claim.employeeId(), "SENT_BACK", claim.id(), "Claim sent back for clarification",
                claim.claimNumber() + ": " + abbreviate(comment));
    }

    public void decided(ClaimRow claim, String status, String reason) {
        String title = switch (status) {
            case "APPROVED", "AUTO_APPROVED" -> "Claim approved";
            case "REJECTED", "AUTO_REJECTED" -> "Claim rejected";
            default -> "Claim decided";
        };
        insert(claim.employeeId(), "CLAIM_DECIDED", claim.id(), title,
                claim.claimNumber() + (reason == null ? "" : ": " + abbreviate(reason)));
    }

    public void payoutDone(ClaimRow claim, UUID batchId, String batchNumber) {
        insert(claim.employeeId(), "PAYOUT_DONE", claim.id(), batchId, "Payment sent",
                claim.claimNumber() + ": " + Money.format(claim.totalAmount()) + " INR paid in " + batchNumber);
    }

    private void insert(UUID recipient, String type, UUID claimId, String title, String message) {
        insert(recipient, type, claimId, null, title, message);
    }

    private void insert(UUID recipient, String type, UUID claimId, UUID batchId, String title, String message) {
        jdbc.sql("""
                INSERT INTO notification (recipient_id, type, claim_id, payout_batch_id, title, message)
                VALUES (:r, :type, :claim, :batch, :title, :message)""")
                .param("r", recipient).param("type", type).param("claim", claimId).param("batch", batchId)
                .param("title", title).param("message", abbreviate(message))
                .update();
    }

    private static String abbreviate(String s) {
        return s == null ? "" : s.length() <= 480 ? s : s.substring(0, 477) + "...";
    }
}
