package com.team25.backend.policy;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.team25.backend.audit.AuditService;
import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.auth.UserDirectory.Ref;
import com.team25.backend.claims.ClaimApi.Page;
import com.team25.backend.domain.Money;
import com.team25.backend.web.BadRequestException;
import com.team25.backend.web.ConflictException;

/**
 * F4 versioned policy configuration (US15). Publishing writes a complete new version (rules, tier-1 cities,
 * thresholds) with author and date; earlier versions never change. New and edited lines are evaluated with the
 * newest version; lines already evaluated keep theirs (US15-AC3, enforced by the submit flow).
 */
@Service
public class PolicyService {

    public record Settings(String receiptThreshold, boolean weekendFlagEnabled, int overdueThresholdHours,
            String autoApproveMaxTotal, String auditorAboveTotal, String financeHeadAboveTotal, int sampleAuditPercent) {
    }

    public record RuleView(String code, String category, String unit, String cityTier, String softLimit, String hardLimit) {
    }

    public record PolicyView(int versionNo, boolean current, String changeNote, Ref createdBy, Instant createdAt,
            Settings settings, List<RuleView> rules, List<String> tier1Cities) {
    }

    public record Summary(int versionNo, boolean current, String changeNote, Ref createdBy, Instant createdAt) {
    }

    private final JdbcClient jdbc;
    private final PolicyRepository policies;
    private final AuditService audit;

    public PolicyService(JdbcClient jdbc, PolicyRepository policies, AuditService audit) {
        this.jdbc = jdbc;
        this.policies = policies;
        this.audit = audit;
    }

    public PolicyView view(PolicyVersion v, int currentNo) {
        return new PolicyView(v.versionNo(), v.versionNo() == currentNo, v.changeNote(),
                v.createdById() == null ? null : new Ref(v.createdById(), v.createdByName()), v.createdAt(),
                new Settings(Money.format(v.receiptThreshold()), v.weekendFlagEnabled(), v.overdueThresholdHours(),
                        Money.format(v.autoApproveMaxTotal()), Money.format(v.auditorAboveTotal()),
                        Money.format(v.financeHeadAboveTotal()), v.sampleAuditPercent()),
                v.rules().stream().map(r -> new RuleView(r.code(), r.category(), r.unit().name(), r.cityTier(),
                        Money.format(r.softLimit()), Money.format(r.hardLimit()))).toList(),
                v.tier1Cities());
    }

    @Transactional(readOnly = true)
    public PolicyView current() {
        PolicyVersion v = policies.current();
        return view(v, v.versionNo());
    }

    @Transactional(readOnly = true)
    public PolicyView byNumber(int versionNo) {
        return view(policies.byNumber(versionNo), policies.current().versionNo());
    }

    @Transactional(readOnly = true)
    public Page<Summary> versions(int page, int size) {
        int current = policies.current().versionNo();
        long total = jdbc.sql("SELECT count(*) FROM policy_version").query(Long.class).single();
        List<Summary> items = jdbc.sql("""
                SELECT v.version_no, v.change_note, v.created_at, v.created_by, u.full_name
                  FROM policy_version v LEFT JOIN app_user u ON u.id = v.created_by
                 ORDER BY v.version_no DESC OFFSET :offset LIMIT :limit""")
                .param("offset", page * size).param("limit", size)
                .query((rs, i) -> {
                    UUID by = rs.getObject("created_by", UUID.class);
                    return new Summary(rs.getInt("version_no"), rs.getInt("version_no") == current,
                            rs.getString("change_note"), by == null ? null : new Ref(by, rs.getString("full_name")),
                            rs.getTimestamp("created_at").toInstant());
                })
                .list();
        return Page.of(items, page, size, total);
    }

    public record NewRule(String code, String category, String unit, String cityTier, String softLimit, String hardLimit) {
    }

    /** Publishes version N+1; 409 when {@code basedOnVersionNo} is no longer current. */
    @Transactional
    public PolicyView publish(AppPrincipal me, int basedOn, String changeNote, Settings s, List<NewRule> rules,
            List<String> cities) {
        Integer current = jdbc.sql("SELECT version_no FROM policy_version ORDER BY version_no DESC LIMIT 1 FOR UPDATE")
                .query(Integer.class).single();
        if (current != basedOn) {
            throw new ConflictException("Policy version " + current + " is current; you edited version " + basedOn
                    + ". Reload and apply your change again.");
        }
        PolicyVersion previous = policies.current();
        BigDecimal auditorAbove = money("settings.auditorAboveTotal", s.auditorAboveTotal());
        BigDecimal headAbove = money("settings.financeHeadAboveTotal", s.financeHeadAboveTotal());
        if (headAbove.compareTo(auditorAbove) < 0) {
            throw new BadRequestException("Validation failed: settings.financeHeadAboveTotal: must not be below auditorAboveTotal");
        }
        Set<String> categories = new HashSet<>(jdbc.sql("SELECT code FROM expense_category").query(String.class).list());
        Map<String, String> categoryNames = new HashMap<>();
        jdbc.sql("SELECT code, name FROM expense_category").query(rs -> {
            categoryNames.put(rs.getString("code"), rs.getString("name"));
        });
        Set<String> codes = new HashSet<>();
        Set<String> slots = new HashSet<>();
        for (NewRule r : rules) {
            if (!codes.add(r.code())) {
                throw new BadRequestException("Validation failed: rules: duplicate rule code " + r.code());
            }
            if (!categories.contains(r.category())) {
                throw new BadRequestException("Validation failed: rules: unknown category " + r.category());
            }
            if (!slots.add(r.category() + "|" + r.cityTier())) {
                throw new BadRequestException("Validation failed: rules: two rules for " + r.category()
                        + (r.cityTier() == null ? "" : " / " + r.cityTier()));
            }
            if (money("hardLimit", r.hardLimit()).compareTo(money("softLimit", r.softLimit())) < 0) {
                throw new BadRequestException("Validation failed: rules: " + r.code() + " hardLimit is below softLimit");
            }
        }
        Map<String, String> cityKeys = new LinkedHashMap<>();
        for (String c : cities) {
            String key = PolicyVersion.cityKey(c);
            if (key.isEmpty() || cityKeys.put(key, c.strip()) != null) {
                throw new BadRequestException("Validation failed: tier1Cities: duplicate or empty city '" + c + "'");
            }
        }

        UUID id = jdbc.sql("""
                INSERT INTO policy_version (version_no, change_note, created_by, receipt_threshold, weekend_flag_enabled,
                    overdue_threshold_hours, auto_approve_max_total, auditor_above_total, finance_head_above_total,
                    sample_audit_percent)
                VALUES (:no, :note, :me, :receipt, :weekend, :overdue, :autoMax, :auditor, :head, :pct) RETURNING id""")
                .param("no", current + 1).param("note", changeNote.strip()).param("me", me.id())
                .param("receipt", money("settings.receiptThreshold", s.receiptThreshold()))
                .param("weekend", s.weekendFlagEnabled()).param("overdue", s.overdueThresholdHours())
                .param("autoMax", money("settings.autoApproveMaxTotal", s.autoApproveMaxTotal()))
                .param("auditor", auditorAbove).param("head", headAbove).param("pct", s.sampleAuditPercent())
                .query(UUID.class).single();
        for (NewRule r : rules) {
            String name = previous.rules().stream().filter(p -> p.code().equals(r.code())).map(PolicyVersion.Rule::name)
                    .findFirst().orElseGet(() -> defaultName(categoryNames.get(r.category()), r.unit(), r.cityTier()));
            jdbc.sql("""
                    INSERT INTO policy_rule (policy_version_id, code, name, category, unit, city_tier, soft_limit, hard_limit)
                    VALUES (:v, :code, :name, :cat, :unit, :tier, :soft, :hard)""")
                    .param("v", id).param("code", r.code()).param("name", name).param("cat", r.category())
                    .param("unit", r.unit()).param("tier", r.cityTier())
                    .param("soft", money("softLimit", r.softLimit())).param("hard", money("hardLimit", r.hardLimit()))
                    .update();
        }
        for (var e : cityKeys.entrySet()) {
            jdbc.sql("INSERT INTO policy_tier1_city (policy_version_id, city_key, display_name) VALUES (:v, :k, :n)")
                    .param("v", id).param("k", e.getKey()).param("n", e.getValue()).update();
        }
        audit.record(new AuditService.Entry(me.id(), null, "POLICY_VERSION_CREATED", "POLICY_VERSION", id.toString(), null,
                null, null, changeNote.strip(), Map.of("versionNo", current + 1, "basedOnVersionNo", basedOn,
                        "ruleCount", rules.size(), "tier1CityCount", cityKeys.size())));
        return byNumber(current + 1);
    }

    static String defaultName(String categoryName, String unit, String tier) {
        String per = switch (unit) {
            case "PER_DAY" -> "per day";
            case "PER_NIGHT" -> "per night";
            default -> "per trip";
        };
        String suffix = tier == null ? "" : "TIER1".equals(tier) ? " (tier-1 city)" : " (other city)";
        return (categoryName == null ? "Limit" : categoryName) + " " + per + suffix;
    }

    private static BigDecimal money(String field, String value) {
        try {
            return Money.parse(value);
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("Validation failed: " + field + ": " + e.getMessage());
        }
    }
}
