package com.team25.backend.notify;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.claims.ClaimApi.Page;
import com.team25.backend.web.NotFoundException;

/** S2 notifications: the caller's own only (another user's id is a 404). */
@RestController
@Validated
@RequestMapping("/api/notifications")
public class NotificationController {

    public record Notification(UUID id, String type, String title, String message, UUID claimId, String claimNumber,
            UUID payoutBatchId, boolean read, Instant readAt, Instant createdAt) {
    }

    public record UnreadCount(long unread) {
    }

    public record ReadAllResult(int updated) {
    }

    private static final String SELECT = """
            SELECT n.*, c.claim_number FROM notification n LEFT JOIN expense_claim c ON c.id = n.claim_id
            """;

    private final JdbcClient jdbc;

    public NotificationController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public Page<Notification> list(@AuthenticationPrincipal AppPrincipal me,
            @RequestParam(required = false) Boolean unread,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        String where = " WHERE n.recipient_id = :me" + (Boolean.TRUE.equals(unread) ? " AND n.read_at IS NULL"
                : Boolean.FALSE.equals(unread) ? " AND n.read_at IS NOT NULL" : "");
        long total = jdbc.sql("SELECT count(*) FROM notification n" + where).param("me", me.id()).query(Long.class).single();
        List<Notification> items = jdbc.sql(SELECT + where + " ORDER BY n.created_at DESC, n.id DESC OFFSET :offset LIMIT :limit")
                .param("me", me.id()).param("offset", page * size).param("limit", size)
                .query(NotificationController::map).list();
        return Page.of(items, page, size, total);
    }

    @GetMapping("/unread-count")
    public UnreadCount unreadCount(@AuthenticationPrincipal AppPrincipal me) {
        return new UnreadCount(jdbc.sql("SELECT count(*) FROM notification WHERE recipient_id = :me AND read_at IS NULL")
                .param("me", me.id()).query(Long.class).single());
    }

    /** Idempotent: reading an already-read notification keeps its first readAt. */
    @PostMapping("/{notificationId}/read")
    @Transactional
    public Notification read(@AuthenticationPrincipal AppPrincipal me, @PathVariable UUID notificationId) {
        int updated = jdbc.sql("""
                UPDATE notification SET read_at = COALESCE(read_at, now()) WHERE id = :id AND recipient_id = :me""")
                .param("id", notificationId).param("me", me.id()).update();
        if (updated == 0) {
            throw new NotFoundException("Notification not found");
        }
        return jdbc.sql(SELECT + " WHERE n.id = :id").param("id", notificationId).query(NotificationController::map).single();
    }

    @PostMapping("/read-all")
    @Transactional
    public ReadAllResult readAll(@AuthenticationPrincipal AppPrincipal me) {
        return new ReadAllResult(jdbc.sql("UPDATE notification SET read_at = now() WHERE recipient_id = :me AND read_at IS NULL")
                .param("me", me.id()).update());
    }

    static Notification map(ResultSet rs, int row) throws SQLException {
        Timestamp readAt = rs.getTimestamp("read_at");
        return new Notification(rs.getObject("id", UUID.class), rs.getString("type"), rs.getString("title"),
                rs.getString("message"), rs.getObject("claim_id", UUID.class), rs.getString("claim_number"),
                rs.getObject("payout_batch_id", UUID.class), readAt != null, readAt == null ? null : readAt.toInstant(),
                rs.getTimestamp("created_at").toInstant());
    }
}
