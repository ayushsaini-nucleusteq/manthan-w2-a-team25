package com.team25.backend.claims;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import com.team25.backend.audit.AuditService;
import com.team25.backend.audit.AuditService.Entry;
import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.claims.ClaimApi.ReceiptView;
import com.team25.backend.claims.ClaimRepository.LineRow;
import com.team25.backend.claims.ClaimRepository.ReceiptRow;
import com.team25.backend.web.BadRequestException;
import com.team25.backend.web.NotFoundException;

/**
 * Receipt upload/download. Type is sniffed from the bytes (PDF, JPEG, PNG), never trusted from the client;
 * max 5 MB; the server computes SHA-256. A reused hash is accepted here and auto-rejected at submit.
 */
@Service
public class ReceiptService {

    public static final int MAX_BYTES = 5 * 1024 * 1024;

    public record ReceiptFile(byte[] bytes, String contentType, String fileName) {
    }

    private final JdbcClient jdbc;
    private final ClaimRepository claims;
    private final ClaimService claimService;
    private final ClaimViews views;
    private final ReceiptStorage storage;
    private final AuditService audit;

    public ReceiptService(JdbcClient jdbc, ClaimRepository claims, ClaimService claimService, ClaimViews views,
            ReceiptStorage storage, AuditService audit) {
        this.jdbc = jdbc;
        this.claims = claims;
        this.claimService = claimService;
        this.views = views;
        this.storage = storage;
        this.audit = audit;
    }

    @Transactional
    public ReceiptView upload(AppPrincipal me, UUID claimId, UUID lineId, MultipartFile file) {
        claimService.lockEditable(me, claimId);
        LineRow line = claims.line(claimId, lineId).orElseThrow(ClaimService::lineNotFound);
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        if (bytes.length == 0) {
            throw new BadRequestException("Receipt file is empty");
        }
        if (bytes.length > MAX_BYTES) {
            throw new BadRequestException("Receipt is larger than 5 MB");
        }
        String contentType = sniff(bytes);
        if (contentType == null) {
            throw new BadRequestException("Receipt must be a PDF, JPEG or PNG file");
        }
        String sha256 = sha256(bytes);
        String fileName = fileName(file.getOriginalFilename(), contentType);

        UUID receiptId = UUID.randomUUID();
        String key = storage.write(claimId, receiptId, bytes);
        storage.deleteOnRollback(key);
        ReceiptRow old = line.receipt();
        if (old != null) {
            jdbc.sql("DELETE FROM receipt WHERE id = :id").param("id", old.id()).update();
            storage.deleteAfterCommit(List.of(old.storageKey()));
        }
        jdbc.sql("""
                INSERT INTO receipt (id, line_id, storage_key, file_name, content_type, size_bytes, sha256, uploaded_by)
                VALUES (:id, :line, :key, :name, :type, :size, :sha, :by)""")
                .param("id", receiptId).param("line", lineId).param("key", key).param("name", fileName)
                .param("type", contentType).param("size", bytes.length).param("sha", sha256).param("by", me.id())
                .update();
        jdbc.sql("UPDATE expense_line SET needs_evaluation = true, updated_at = now() WHERE id = :id")
                .param("id", lineId).update();
        claimService.refreshTotal(claimId);
        audit.record(Entry.claim(me.id(), claimId, "RECEIPT_UPLOADED").entity("EXPENSE_LINE", lineId)
                .details(Map.of("lineNo", line.lineNo(), "fileName", fileName, "contentType", contentType,
                        "sizeBytes", bytes.length, "sha256", sha256, "replaced", old != null)));
        ReceiptRow stored = claims.line(claimId, lineId).map(LineRow::receipt).orElseThrow();
        return new ReceiptView(stored.id(), stored.fileName(), stored.contentType(), stored.sizeBytes(), stored.sha256(),
                stored.uploadedAt());
    }

    @Transactional(readOnly = true)
    public ReceiptFile download(AppPrincipal me, UUID claimId, UUID lineId) {
        views.visible(claimId, me);
        LineRow line = claims.line(claimId, lineId).orElseThrow(ClaimService::lineNotFound);
        if (line.receipt() == null) {
            throw new NotFoundException("This line has no receipt");
        }
        ReceiptRow r = line.receipt();
        try {
            return new ReceiptFile(storage.read(r.storageKey()), r.contentType(), r.fileName());
        } catch (UncheckedIOException e) {
            throw new NotFoundException("Receipt file is not available");
        }
    }

    /** Magic-number sniffing: %PDF-, PNG signature, JPEG SOI marker. */
    static String sniff(byte[] b) {
        if (b.length >= 5 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F' && b[4] == '-') {
            return "application/pdf";
        }
        if (b.length >= 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G'
                && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) {
            return "image/png";
        }
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        return null;
    }

    public static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Keeps only the base name, drops control and quote characters, caps the length. */
    static String fileName(String original, String contentType) {
        String ext = switch (contentType) {
            case "application/pdf" -> ".pdf";
            case "image/png" -> ".png";
            default -> ".jpg";
        };
        if (original == null || original.isBlank()) {
            return "receipt" + ext;
        }
        String base = original.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}\"';]", "").strip();
        if (base.isEmpty()) {
            return "receipt" + ext;
        }
        return base.length() > 200 ? base.substring(base.length() - 200) : base;
    }
}
