package com.team25.backend.claims;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.team25.backend.audit.AuditService;
import com.team25.backend.audit.AuditService.Entry;
import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.claims.ClaimApi.ClaimCreateRequest;
import com.team25.backend.claims.ClaimApi.LineCreateRequest;
import com.team25.backend.claims.ClaimApi.LineRequest;
import com.team25.backend.claims.ClaimRepository.ClaimRow;
import com.team25.backend.claims.ClaimRepository.LineRow;
import com.team25.backend.domain.ClaimStatus;
import com.team25.backend.domain.Money;
import com.team25.backend.web.BadRequestException;
import com.team25.backend.web.ConflictException;
import com.team25.backend.web.ForbiddenException;

import tools.jackson.databind.JsonNode;

/** Draft claims: header and line CRUD. Drafts and sent-back claims are editable; everything is locked after submit. */
@Service
public class ClaimService {

    static final int MAX_LINES = 50;
    private static final Set<String> PATCHABLE = Set.of("version", "title", "purpose", "tripStartDate", "tripEndDate");

    /** Result of an idempotent create: {@code created=false} means a replay of an existing id (HTTP 200). */
    public record Created(UUID claimId, boolean created) {
    }

    private final JdbcClient jdbc;
    private final ClaimRepository claims;
    private final AuditService audit;
    private final ReceiptStorage storage;

    public ClaimService(JdbcClient jdbc, ClaimRepository claims, AuditService audit, ReceiptStorage storage) {
        this.jdbc = jdbc;
        this.claims = claims;
        this.audit = audit;
        this.storage = storage;
    }

    // ------------------------------------------------------------------ claims

    @Transactional
    public Created create(AppPrincipal me, ClaimCreateRequest req) {
        if (req.currency() != null && !"INR".equals(req.currency())) {
            throw new BadRequestException("Validation failed: currency: only INR is supported");
        }
        checkTripDates(req.tripStartDate(), req.tripEndDate());
        List<LineCreateRequest> lineReqs = req.lines() == null ? List.of() : req.lines();
        List<LineData> lines = new ArrayList<>();
        for (LineCreateRequest l : lineReqs) {
            lines.add(validate(l.fields()));
        }

        if (req.id() != null) {
            var existing = claims.find(req.id());
            if (existing.isPresent()) {
                return replay(me, existing.get(), req, lineReqs, lines);
            }
        }
        for (LineCreateRequest l : lineReqs) {
            if (l.id() != null && lineExists(l.id())) {
                throw new ConflictException("Line id " + l.id() + " already exists");
            }
        }

        UUID claimId = jdbc.sql("""
                INSERT INTO expense_claim (id, claim_number, employee_id, department_id, title, purpose, trip_start_date,
                                           trip_end_date, status)
                SELECT COALESCE(:id, uuidv7()), 'CL-' || lpad(nextval('claim_number_seq')::text, 6, '0'), u.id,
                       u.department_id, :title, :purpose, :start, :end, 'DRAFT'
                  FROM app_user u WHERE u.id = :me
                ON CONFLICT (id) DO NOTHING
                RETURNING id""")
                .param("id", req.id()).param("title", req.title().strip()).param("purpose", blankToNull(req.purpose()))
                .param("start", req.tripStartDate()).param("end", req.tripEndDate()).param("me", me.id())
                .query(UUID.class).optional()
                .orElse(null);
        if (claimId == null) {
            // Lost a race with a concurrent replay of the same id.
            return replay(me, claims.find(req.id()).orElseThrow(), req, lineReqs, lines);
        }
        audit.record(Entry.claim(me.id(), claimId, "CLAIM_CREATED").status(null, ClaimStatus.DRAFT)
                .details(Map.of("title", req.title().strip(), "lineCount", lines.size())));
        for (int i = 0; i < lines.size(); i++) {
            insertLine(me, claimId, lineReqs.get(i).id(), i + 1, lines.get(i));
        }
        refreshTotal(claimId);
        return new Created(claimId, true);
    }

    /** Same id again: same owner and same content → existing claim (200); anything else → 409 (decision D8). */
    private Created replay(AppPrincipal me, ClaimRow existing, ClaimCreateRequest req, List<LineCreateRequest> lineReqs,
            List<LineData> lines) {
        if (!existing.ownedBy(me.id())) {
            throw new ConflictException("Claim id " + existing.id() + " is already in use");
        }
        List<LineRow> stored = claims.lines(existing.id());
        boolean same = existing.title().equals(req.title().strip())
                && Objects.equals(existing.purpose(), blankToNull(req.purpose()))
                && Objects.equals(existing.tripStartDate(), req.tripStartDate())
                && Objects.equals(existing.tripEndDate(), req.tripEndDate())
                && (lineReqs.isEmpty() || stored.size() == lines.size());
        for (int i = 0; same && !lineReqs.isEmpty() && i < lines.size(); i++) {
            LineRow row = stored.get(i);
            UUID wantedId = lineReqs.get(i).id();
            same = lines.get(i).sameAs(row) && (wantedId == null || wantedId.equals(row.id()));
        }
        if (!same) {
            throw new ConflictException("Claim id " + existing.id() + " already exists with different content");
        }
        return new Created(existing.id(), false);
    }

    @Transactional
    public void update(AppPrincipal me, UUID claimId, JsonNode body) {
        if (body == null || !body.isObject()) {
            throw new BadRequestException("Malformed or missing request body");
        }
        for (String name : body.propertyNames()) {
            if (!PATCHABLE.contains(name)) {
                throw new BadRequestException("Validation failed: " + name + ": cannot be changed");
            }
        }
        if (!body.hasNonNull("version") || !body.get("version").isIntegralNumber()) {
            throw new BadRequestException("Validation failed: version: must not be null");
        }
        if (body.size() < 2) {
            throw new BadRequestException("Validation failed: nothing to change");
        }
        ClaimRow c = lockEditable(me, claimId);
        checkVersion(c, body.get("version").asInt());

        String title = c.title();
        String purpose = c.purpose();
        LocalDate start = c.tripStartDate();
        LocalDate end = c.tripEndDate();
        Map<String, Object> changes = new LinkedHashMap<>();
        if (body.has("title")) {
            String t = body.get("title").isNull() ? "" : body.get("title").asString().strip();
            if (t.isEmpty() || t.length() > 150) {
                throw new BadRequestException("Validation failed: title: must be 1-150 characters");
            }
            changes.put("title", change(title, t));
            title = t;
        }
        if (body.has("purpose")) {
            String p = body.get("purpose").isNull() ? null : blankToNull(body.get("purpose").asString());
            if (p != null && p.length() > 1000) {
                throw new BadRequestException("Validation failed: purpose: size must be at most 1000");
            }
            changes.put("purpose", change(purpose, p));
            purpose = p;
        }
        if (body.has("tripStartDate")) {
            LocalDate d = date(body.get("tripStartDate"), "tripStartDate");
            changes.put("tripStartDate", change(start, d));
            start = d;
        }
        if (body.has("tripEndDate")) {
            LocalDate d = date(body.get("tripEndDate"), "tripEndDate");
            changes.put("tripEndDate", change(end, d));
            end = d;
        }
        checkTripDates(start, end);
        jdbc.sql("""
                UPDATE expense_claim SET title = :title, purpose = :purpose, trip_start_date = :start, trip_end_date = :end,
                       version = version + 1, updated_at = now()
                 WHERE id = :id""")
                .param("title", title).param("purpose", purpose).param("start", start).param("end", end)
                .param("id", claimId).update();
        audit.record(Entry.claim(me.id(), claimId, "CLAIM_UPDATED").details(Map.of("changes", changes)));
    }

    @Transactional
    public void delete(AppPrincipal me, UUID claimId) {
        ClaimRow c = lockOwned(me, claimId);
        if (c.status() != ClaimStatus.DRAFT || c.submissionNo() > 0) {
            throw new ConflictException("Only a draft that was never submitted can be deleted");
        }
        List<String> keys = claims.lines(claimId).stream().filter(l -> l.receipt() != null)
                .map(l -> l.receipt().storageKey()).toList();
        audit.record(Entry.claim(me.id(), claimId, "CLAIM_DELETED").status(ClaimStatus.DRAFT, null)
                .details(Map.of("claimNumber", c.claimNumber())));
        jdbc.sql("DELETE FROM expense_claim WHERE id = :id").param("id", claimId).update();
        storage.deleteAfterCommit(keys);
    }

    // ------------------------------------------------------------------ lines

    /** Adds a line; a replayed client id with identical content returns {@code false} (HTTP 200). */
    @Transactional
    public boolean addLine(AppPrincipal me, UUID claimId, LineCreateRequest req) {
        ClaimRow c = lockEditable(me, claimId);
        LineData data = validate(req.fields());
        List<LineRow> lines = claims.lines(claimId);
        if (req.id() != null) {
            var same = lines.stream().filter(l -> l.id().equals(req.id())).findFirst();
            if (same.isPresent()) {
                if (data.sameAs(same.get())) {
                    return false;
                }
                throw new ConflictException("Line id " + req.id() + " already exists with different content");
            }
            if (lineExists(req.id())) {
                throw new ConflictException("Line id " + req.id() + " already exists");
            }
        }
        if (lines.size() >= MAX_LINES) {
            throw new ConflictException("A claim can have at most " + MAX_LINES + " lines");
        }
        int lineNo = lines.stream().mapToInt(LineRow::lineNo).max().orElse(0) + 1;
        insertLine(me, c.id(), req.id(), lineNo, data);
        refreshTotal(claimId);
        return true;
    }

    @Transactional
    public void replaceLine(AppPrincipal me, UUID claimId, UUID lineId, LineRequest req) {
        lockEditable(me, claimId);
        LineRow row = claims.line(claimId, lineId).orElseThrow(ClaimService::lineNotFound);
        LineData data = validate(req);
        if (data.sameAs(row)) {
            return;
        }
        Map<String, Object> changes = new LinkedHashMap<>();
        putIfChanged(changes, "category", row.category(), data.category());
        putIfChanged(changes, "amount", Money.format(row.amount()), Money.format(data.amount()));
        putIfChanged(changes, "expenseDate", row.expenseDate(), data.expenseDate());
        putIfChanged(changes, "vendor", row.vendor(), data.vendor());
        putIfChanged(changes, "notes", row.notes(), data.notes());
        putIfChanged(changes, "city", row.city(), data.city());
        putIfChanged(changes, "nights", row.nights(), data.nights());
        jdbc.sql("""
                UPDATE expense_line SET category = :cat, amount = :amount, expense_date = :date, vendor = :vendor,
                       notes = :notes, city = :city, nights = :nights, updated_at = now(),
                       needs_evaluation = needs_evaluation OR :relevant
                 WHERE id = :id""")
                .param("cat", data.category()).param("amount", data.amount()).param("date", data.expenseDate())
                .param("vendor", data.vendor()).param("notes", data.notes()).param("city", data.city())
                .param("nights", data.nights()).param("relevant", data.policyRelevantChange(row)).param("id", lineId)
                .update();
        refreshTotal(claimId);
        audit.record(Entry.claim(me.id(), claimId, "LINE_UPDATED").entity("EXPENSE_LINE", lineId)
                .details(Map.of("lineNo", row.lineNo(), "changes", changes)));
    }

    @Transactional
    public void deleteLine(AppPrincipal me, UUID claimId, UUID lineId) {
        lockEditable(me, claimId);
        LineRow row = claims.line(claimId, lineId).orElseThrow(ClaimService::lineNotFound);
        jdbc.sql("DELETE FROM expense_line WHERE id = :id").param("id", lineId).update();
        refreshTotal(claimId);
        audit.record(Entry.claim(me.id(), claimId, "LINE_REMOVED").entity("EXPENSE_LINE", lineId)
                .details(Map.of("lineNo", row.lineNo(), "category", row.category(), "amount", Money.format(row.amount()))));
        if (row.receipt() != null) {
            storage.deleteAfterCommit(List.of(row.receipt().storageKey()));
        }
    }

    // ------------------------------------------------------------------ shared helpers

    /** Locks a claim the caller owns: 404 if they can't see it, 403 if they can but don't own it. */
    ClaimRow lockOwned(AppPrincipal me, UUID claimId) {
        ClaimRow c = claims.lock(claimId).orElseThrow(ClaimViews::notFound);
        if (!claims.canView(c, me)) {
            throw ClaimViews.notFound();
        }
        if (!c.ownedBy(me.id())) {
            throw new ForbiddenException("Only the claim owner can change it");
        }
        return c;
    }

    /** As {@link #lockOwned}, and the claim must be DRAFT or SENT_BACK (locked after submit, 409). */
    ClaimRow lockEditable(AppPrincipal me, UUID claimId) {
        ClaimRow c = lockOwned(me, claimId);
        if (!ClaimStatus.EDITABLE.contains(c.status())) {
            throw new ConflictException("Claim is locked after submit (status " + c.status() + ")");
        }
        return c;
    }

    static void checkVersion(ClaimRow c, int version) {
        if (c.version() != version) {
            throw new ConflictException("Claim was modified by another request (version " + c.version()
                    + ", you sent " + version + "); reload and retry");
        }
    }

    LineData validate(LineRequest r) {
        Boolean hotel = jdbc.sql("SELECT requires_hotel_details FROM expense_category WHERE code = :c AND active")
                .param("c", r.category()).query(Boolean.class).optional()
                .orElseThrow(() -> new BadRequestException("Validation failed: category: unknown category '" + r.category() + "'"));
        return LineData.of(r, hotel);
    }

    private void insertLine(AppPrincipal me, UUID claimId, UUID lineId, int lineNo, LineData d) {
        UUID id = jdbc.sql("""
                INSERT INTO expense_line (id, claim_id, employee_id, line_no, category, amount, expense_date, vendor,
                                          notes, city, nights)
                VALUES (COALESCE(:id, uuidv7()), :claim, :emp, :no, :cat, :amount, :date, :vendor, :notes, :city, :nights)
                RETURNING id""")
                .param("id", lineId).param("claim", claimId).param("emp", me.id()).param("no", lineNo)
                .param("cat", d.category()).param("amount", d.amount()).param("date", d.expenseDate())
                .param("vendor", d.vendor()).param("notes", d.notes()).param("city", d.city()).param("nights", d.nights())
                .query(UUID.class).single();
        audit.record(Entry.claim(me.id(), claimId, "LINE_ADDED").entity("EXPENSE_LINE", id)
                .details(Map.of("lineNo", lineNo, "category", d.category(), "amount", Money.format(d.amount()),
                        "expenseDate", d.expenseDate().toString(), "vendor", d.vendor())));
    }

    private boolean lineExists(UUID lineId) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM expense_line WHERE id = :id)").param("id", lineId)
                .query(Boolean.class).single();
    }

    void refreshTotal(UUID claimId) {
        jdbc.sql("""
                UPDATE expense_claim
                   SET total_amount = (SELECT COALESCE(SUM(amount), 0) FROM expense_line WHERE claim_id = :id),
                       version = version + 1, updated_at = now()
                 WHERE id = :id""")
                .param("id", claimId).update();
    }

    private static void checkTripDates(LocalDate start, LocalDate end) {
        if (start != null && end != null && end.isBefore(start)) {
            throw new BadRequestException("Validation failed: tripEndDate: must not be before tripStartDate");
        }
    }

    private static LocalDate date(JsonNode node, String field) {
        if (node.isNull()) {
            return null;
        }
        try {
            return LocalDate.parse(node.asString());
        } catch (DateTimeParseException e) {
            throw new BadRequestException("Validation failed: " + field + ": must be a date (YYYY-MM-DD)");
        }
    }

    private static Map<String, Object> change(Object from, Object to) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("from", from == null ? null : from.toString());
        m.put("to", to == null ? null : to.toString());
        return m;
    }

    private static void putIfChanged(Map<String, Object> changes, String field, Object from, Object to) {
        if (!Objects.equals(from, to)) {
            changes.put(field, change(from, to));
        }
    }

    static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }

    static com.team25.backend.web.NotFoundException lineNotFound() {
        return new com.team25.backend.web.NotFoundException("Line not found");
    }
}
