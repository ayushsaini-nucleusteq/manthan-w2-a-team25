package com.team25.backend.payouts;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.team25.backend.audit.AuditService;
import com.team25.backend.audit.AuditService.Entry;
import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.auth.UserDirectory.Ref;
import com.team25.backend.claims.ClaimApi.ClaimSummary;
import com.team25.backend.claims.ClaimApi.Page;
import com.team25.backend.claims.ClaimRepository;
import com.team25.backend.domain.Money;
import com.team25.backend.notify.NotificationService;
import com.team25.backend.web.BadRequestException;
import com.team25.backend.web.ConflictException;
import com.team25.backend.web.NotFoundException;
import com.team25.backend.web.Sorts;

/**
 * F2 / F3 payouts. A batch reserves its claims at creation (payout_item.claim_id is UNIQUE, so a claim can never be
 * in two batches); the first CSV export moves the claims to IN_BATCH (US13-AC3); mark-paid needs confirm=true and
 * moves them to PAID, notifying each owner (US14). Batches cannot be cancelled.
 */
@Service
public class PayoutService {

    /** Payout-eligible: not in a batch, APPROVED, or AUTO_APPROVED with no pending sample audit. */
    static final String ELIGIBLE = """
            c.payout_batch_id IS NULL
            AND (c.status = 'APPROVED'
                 OR (c.status = 'AUTO_APPROVED' AND (NOT c.sample_audit OR c.sample_audit_status = 'CLEARED')))""";

    private static final Map<String, String> ELIGIBLE_SORTS = Map.of(
            "decidedAt", "c.decided_at", "totalAmount", "c.total_amount", "claimNumber", "c.claim_number");
    private static final Map<String, String> BATCH_SORTS = Map.of(
            "createdAt", "b.created_at", "batchNumber", "b.batch_number", "totalAmount", "b.total_amount");

    public record Batch(UUID id, String batchNumber, String status, int claimCount, String totalAmount, Ref createdBy,
            Instant createdAt, Instant exportedAt, Instant paidAt, String bankReference, int version) {
    }

    public record Item(UUID claimId, String claimNumber, Ref employee, String employeeCode, String amount,
            String bankAccountNumber, String ifscCode) {
    }

    public record BatchDetail(UUID id, String batchNumber, String status, int claimCount, String totalAmount,
            Ref createdBy, Instant createdAt, Instant exportedAt, Instant paidAt, String bankReference, int version,
            List<Item> items) {

        static BatchDetail of(Batch b, List<Item> items) {
            return new BatchDetail(b.id(), b.batchNumber(), b.status(), b.claimCount(), b.totalAmount(), b.createdBy(),
                    b.createdAt(), b.exportedAt(), b.paidAt(), b.bankReference(), b.version(), items);
        }
    }

    public record Csv(String fileName, byte[] bytes) {
    }

    private static final String BATCH_SELECT = """
            SELECT b.*, u.full_name AS created_by_name FROM payout_batch b JOIN app_user u ON u.id = b.created_by
            """;

    private final JdbcClient jdbc;
    private final ClaimRepository claims;
    private final AuditService audit;
    private final NotificationService notifications;

    public PayoutService(JdbcClient jdbc, ClaimRepository claims, AuditService audit, NotificationService notifications) {
        this.jdbc = jdbc;
        this.claims = claims;
        this.audit = audit;
        this.notifications = notifications;
    }

    @Transactional(readOnly = true)
    public Page<ClaimSummary> eligible(UUID departmentId, String q, int page, int size, String sort) {
        List<String> where = new ArrayList<>(List.of(ELIGIBLE));
        Map<String, Object> params = new HashMap<>();
        if (departmentId != null) {
            where.add("c.department_id = :dept");
            params.put("dept", departmentId);
        }
        if (q != null && !q.isBlank()) {
            where.add("(c.claim_number ILIKE :q OR c.title ILIKE :q)");
            params.put("q", ClaimRepository.like(q));
        }
        String order = Sorts.orderBy(sort, ELIGIBLE_SORTS, "c.decided_at ASC");
        long total = claims.countWhere(where, params);
        return Page.of(claims.listWhere(where, params, order, page, size), page, size, total);
    }

    /** Creates a batch from the given claims (or all eligible ones); claims keep their status until export. */
    @Transactional
    public BatchDetail create(AppPrincipal me, List<UUID> claimIds) {
        // One batch at a time; the UNIQUE payout_item.claim_id is the hard guarantee underneath.
        jdbc.sql("SELECT pg_advisory_xact_lock(hashtext('payout-batch'))").query().listOfRows();
        record Row(UUID id, String number, UUID employeeId, BigDecimal amount, String account, String ifsc, String status,
                boolean eligible) {
        }
        String select = """
                SELECT c.id, c.claim_number, c.employee_id, c.total_amount, c.status, u.bank_account_number, u.ifsc_code,
                       (""" + ELIGIBLE + """
                ) AS eligible
                  FROM expense_claim c JOIN app_user u ON u.id = c.employee_id
                """;
        List<Row> rows;
        if (claimIds != null) {
            if (new LinkedHashSet<>(claimIds).size() != claimIds.size()) {
                throw new BadRequestException("Validation failed: claimIds: must be unique");
            }
            rows = jdbc.sql(select + " WHERE c.id IN (:ids) ORDER BY c.claim_number FOR UPDATE OF c").param("ids", claimIds)
                    .query((rs, i) -> new Row(rs.getObject("id", UUID.class), rs.getString("claim_number"),
                            rs.getObject("employee_id", UUID.class), rs.getBigDecimal("total_amount"),
                            rs.getString("bank_account_number"), rs.getString("ifsc_code"), rs.getString("status"),
                            rs.getBoolean("eligible")))
                    .list();
            if (rows.size() != claimIds.size()) {
                throw new ConflictException("One or more claims are not eligible for payout (not found)");
            }
            for (Row r : rows) {
                if (!r.eligible()) {
                    throw new ConflictException("Claim " + r.number() + " is not eligible for payout (status " + r.status() + ")");
                }
            }
        } else {
            rows = jdbc.sql(select + " WHERE " + ELIGIBLE + " ORDER BY c.claim_number FOR UPDATE OF c")
                    .query((rs, i) -> new Row(rs.getObject("id", UUID.class), rs.getString("claim_number"),
                            rs.getObject("employee_id", UUID.class), rs.getBigDecimal("total_amount"),
                            rs.getString("bank_account_number"), rs.getString("ifsc_code"), rs.getString("status"), true))
                    .list();
            if (rows.isEmpty()) {
                throw new ConflictException("No claims are eligible for payout");
            }
        }
        for (Row r : rows) {
            if (r.account() == null || r.ifsc() == null) {
                throw new ConflictException("Claim " + r.number() + ": the employee has no bank details");
            }
        }
        BigDecimal total = rows.stream().map(Row::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        int next = jdbc.sql("SELECT COALESCE(max(substring(batch_number from 10)::int), 0) + 1 FROM payout_batch")
                .query(Integer.class).single();
        String number = String.format("PAY-%d-%04d", LocalDate.now(Money.BUSINESS_ZONE).getYear(), next);
        UUID batchId = jdbc.sql("""
                INSERT INTO payout_batch (batch_number, status, claim_count, total_amount, created_by)
                VALUES (:n, 'CREATED', :count, :total, :me) RETURNING id""")
                .param("n", number).param("count", rows.size()).param("total", total).param("me", me.id())
                .query(UUID.class).single();
        for (Row r : rows) {
            jdbc.sql("""
                    INSERT INTO payout_item (batch_id, claim_id, employee_id, amount, bank_account_number, ifsc_code)
                    VALUES (:b, :c, :e, :a, :acc, :ifsc)""")
                    .param("b", batchId).param("c", r.id()).param("e", r.employeeId()).param("a", r.amount())
                    .param("acc", r.account()).param("ifsc", r.ifsc()).update();
            jdbc.sql("UPDATE expense_claim SET payout_batch_id = :b, version = version + 1, updated_at = now() WHERE id = :c")
                    .param("b", batchId).param("c", r.id()).update();
            audit.record(Entry.claim(me.id(), r.id(), "ADDED_TO_BATCH").details(Map.of("batchNumber", number)));
        }
        audit.record(new Entry(me.id(), null, "PAYOUT_BATCH_CREATED", "PAYOUT_BATCH", batchId.toString(), null, null,
                "CREATED", null, Map.of("batchNumber", number, "claimCount", rows.size(), "totalAmount", Money.format(total))));
        return detail(batchId);
    }

    @Transactional(readOnly = true)
    public Page<Batch> list(String status, int page, int size, String sort) {
        String where = status == null ? "" : " WHERE b.status = :status";
        String order = Sorts.orderBy(sort, BATCH_SORTS, "b.created_at DESC");
        var count = jdbc.sql("SELECT count(*) FROM payout_batch b" + where);
        var list = jdbc.sql(BATCH_SELECT + where + " ORDER BY " + order + ", b.id OFFSET :offset LIMIT :limit");
        if (status != null) {
            count = count.param("status", status);
            list = list.param("status", status);
        }
        return Page.of(list.param("offset", page * size).param("limit", size).query(PayoutService::mapBatch).list(),
                page, size, count.query(Long.class).single());
    }

    @Transactional(readOnly = true)
    public BatchDetail detail(UUID batchId) {
        Batch b = jdbc.sql(BATCH_SELECT + " WHERE b.id = :id").param("id", batchId).query(PayoutService::mapBatch)
                .optional().orElseThrow(() -> new NotFoundException("Payout batch not found"));
        return BatchDetail.of(b, items(batchId));
    }

    /** First download: batch CREATED → EXPORTED and its claims → IN_BATCH. Later downloads: same content. */
    @Transactional
    public Csv export(AppPrincipal me, UUID batchId) {
        Batch b = lockBatch(batchId);
        if ("CREATED".equals(b.status())) {
            Instant now = Instant.now();
            jdbc.sql("UPDATE payout_batch SET status = 'EXPORTED', exported_at = :now, version = version + 1 WHERE id = :id")
                    .param("now", Timestamp.from(now)).param("id", batchId).update();
            List<Map<String, Object>> moved = jdbc.sql("""
                    UPDATE expense_claim c SET status = 'IN_BATCH', version = c.version + 1, updated_at = now()
                      FROM expense_claim old
                     WHERE c.id = old.id AND c.payout_batch_id = :b AND c.status IN ('APPROVED', 'AUTO_APPROVED')
                    RETURNING c.id, old.status AS old_status""")
                    .param("b", batchId).query().listOfRows();
            for (Map<String, Object> m : moved) {
                audit.record(Entry.claim(me.id(), (UUID) m.get("id"), "PAYOUT_EXPORTED")
                        .status(m.get("old_status"), "IN_BATCH").details(Map.of("batchNumber", b.batchNumber())));
            }
            audit.record(new Entry(me.id(), null, "PAYOUT_EXPORTED", "PAYOUT_BATCH", batchId.toString(), null, "CREATED",
                    "EXPORTED", null, Map.of("batchNumber", b.batchNumber(), "claimCount", moved.size())));
        }
        StringBuilder csv = new StringBuilder(
                "batch_number,claim_number,employee_code,employee_name,bank_account_number,ifsc_code,amount,currency,narration\n");
        for (Item i : items(batchId)) {
            csv.append(String.join(",", cell(b.batchNumber()), cell(i.claimNumber()), cell(i.employeeCode()),
                    cell(i.employee().fullName()), cell(i.bankAccountNumber()), cell(i.ifscCode()), cell(i.amount()), "INR",
                    cell(i.claimNumber() + " reimbursement"))).append('\n');
        }
        return new Csv(b.batchNumber() + ".csv", csv.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    /** Only from EXPORTED and only with confirm=true; an already-paid batch is a 409 (US14-AC3). */
    @Transactional
    public BatchDetail markPaid(AppPrincipal me, UUID batchId, int version, String bankReference, LocalDate paidOn) {
        Batch b = lockBatch(batchId);
        if ("PAID".equals(b.status())) {
            throw new ConflictException("Batch " + b.batchNumber() + " is already marked paid");
        }
        if (!"EXPORTED".equals(b.status())) {
            throw new ConflictException("Export the batch before marking it paid (status " + b.status() + ")");
        }
        if (b.version() != version) {
            throw new ConflictException("Batch was modified by another request (version " + b.version() + ", you sent "
                    + version + "); reload and retry");
        }
        LocalDate today = Money.today();
        if (paidOn != null && paidOn.isAfter(today)) {
            throw new BadRequestException("Validation failed: paidOn: must not be in the future");
        }
        Instant paidAt = paidOn == null || paidOn.equals(today) ? Instant.now()
                : paidOn.atStartOfDay(Money.BUSINESS_ZONE).toInstant();
        jdbc.sql("""
                UPDATE payout_batch SET status = 'PAID', paid_at = :at, paid_by = :me, bank_reference = :ref,
                       version = version + 1
                 WHERE id = :id""")
                .param("at", Timestamp.from(paidAt)).param("me", me.id()).param("ref", bankReference.strip())
                .param("id", batchId).update();
        List<UUID> paid = jdbc.sql("""
                UPDATE expense_claim SET status = 'PAID', paid_at = :at, version = version + 1, updated_at = now()
                 WHERE payout_batch_id = :b AND status = 'IN_BATCH' RETURNING id""")
                .param("at", Timestamp.from(paidAt)).param("b", batchId).query(UUID.class).list();
        for (UUID claimId : paid) {
            audit.record(Entry.claim(me.id(), claimId, "PAYOUT_PAID").status("IN_BATCH", "PAID")
                    .details(Map.of("batchNumber", b.batchNumber())));
            notifications.payoutDone(claims.find(claimId).orElseThrow(), batchId, b.batchNumber());
        }
        audit.record(new Entry(me.id(), null, "PAYOUT_PAID", "PAYOUT_BATCH", batchId.toString(), null, "EXPORTED", "PAID",
                null, Map.of("batchNumber", b.batchNumber(), "bankReference", bankReference.strip(),
                        "claimCount", paid.size(), "paidOn", (paidOn == null ? today : paidOn).toString())));
        return detail(batchId);
    }

    private Batch lockBatch(UUID batchId) {
        boolean exists = jdbc.sql("SELECT id FROM payout_batch WHERE id = :id FOR UPDATE").param("id", batchId)
                .query(UUID.class).optional().isPresent();
        if (!exists) {
            throw new NotFoundException("Payout batch not found");
        }
        return jdbc.sql(BATCH_SELECT + " WHERE b.id = :id").param("id", batchId).query(PayoutService::mapBatch).single();
    }

    private List<Item> items(UUID batchId) {
        return jdbc.sql("""
                SELECT i.*, c.claim_number, u.full_name, u.employee_code
                  FROM payout_item i JOIN expense_claim c ON c.id = i.claim_id JOIN app_user u ON u.id = i.employee_id
                 WHERE i.batch_id = :b ORDER BY c.claim_number""")
                .param("b", batchId)
                .query((rs, n) -> new Item(rs.getObject("claim_id", UUID.class), rs.getString("claim_number"),
                        new Ref(rs.getObject("employee_id", UUID.class), rs.getString("full_name")),
                        rs.getString("employee_code"), Money.format(rs.getBigDecimal("amount")),
                        rs.getString("bank_account_number"), rs.getString("ifsc_code")))
                .list();
    }

    /** CSV cell: blocks formula injection (=, +, -, @ prefixed with '), quotes commas, quotes and line breaks. */
    static String cell(String value) {
        String v = value == null ? "" : value;
        if (!v.isEmpty() && "=+-@".indexOf(v.charAt(0)) >= 0) {
            v = "'" + v;
        }
        if (v.contains(",") || v.contains("\"") || v.contains("\n") || v.contains("\r")) {
            v = "\"" + v.replace("\"", "\"\"") + "\"";
        }
        return v;
    }

    static Batch mapBatch(ResultSet rs, int row) throws SQLException {
        return new Batch(rs.getObject("id", UUID.class), rs.getString("batch_number"), rs.getString("status"),
                rs.getInt("claim_count"), Money.format(rs.getBigDecimal("total_amount")),
                new Ref(rs.getObject("created_by", UUID.class), rs.getString("created_by_name")),
                ts(rs, "created_at"), ts(rs, "exported_at"), ts(rs, "paid_at"), rs.getString("bank_reference"),
                rs.getInt("version"));
    }

    private static Instant ts(ResultSet rs, String col) throws SQLException {
        Timestamp t = rs.getTimestamp(col);
        return t == null ? null : t.toInstant();
    }
}
