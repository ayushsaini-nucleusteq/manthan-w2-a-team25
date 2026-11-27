package com.team25.backend.policy;

import java.time.Instant;
import java.util.List;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.team25.backend.auth.UserDirectory.Dept;
import com.team25.backend.auth.UserDirectory.Ref;
import com.team25.backend.domain.Money;

/** Reference data any signed-in user can read: departments, categories, the current policy version. */
@RestController
public class ReferenceController {

    public record Category(String code, String name, boolean requiresHotelDetails, boolean coveredByPolicy) {
    }

    public record Settings(String receiptThreshold, boolean weekendFlagEnabled, int overdueThresholdHours,
            String autoApproveMaxTotal, String auditorAboveTotal, String financeHeadAboveTotal, int sampleAuditPercent) {
    }

    public record RuleView(String code, String category, String unit, String cityTier, String softLimit, String hardLimit) {
    }

    public record PolicyView(int versionNo, boolean current, String changeNote, Ref createdBy, Instant createdAt,
            Settings settings, List<RuleView> rules, List<String> tier1Cities) {
    }

    private final JdbcClient jdbc;
    private final PolicyRepository policies;

    public ReferenceController(JdbcClient jdbc, PolicyRepository policies) {
        this.jdbc = jdbc;
        this.policies = policies;
    }

    @GetMapping("/api/departments")
    public List<Dept> departments() {
        return jdbc.sql("SELECT id, code, name FROM department ORDER BY name")
                .query((rs, i) -> new Dept(rs.getObject("id", java.util.UUID.class), rs.getString("code"), rs.getString("name")))
                .list();
    }

    @GetMapping("/api/expense-categories")
    public List<Category> categories() {
        PolicyVersion current = policies.current();
        return jdbc.sql("SELECT code, name, requires_hotel_details FROM expense_category WHERE active ORDER BY sort_order")
                .query((rs, i) -> new Category(rs.getString("code"), rs.getString("name"),
                        rs.getBoolean("requires_hotel_details"), current.coversCategory(rs.getString("code"))))
                .list();
    }

    @GetMapping("/api/policy/current")
    public PolicyView currentPolicy() {
        PolicyVersion v = policies.current();
        return new PolicyView(v.versionNo(), true, v.changeNote(),
                v.createdById() == null ? null : new Ref(v.createdById(), v.createdByName()), v.createdAt(),
                new Settings(Money.format(v.receiptThreshold()), v.weekendFlagEnabled(), v.overdueThresholdHours(),
                        Money.format(v.autoApproveMaxTotal()), Money.format(v.auditorAboveTotal()),
                        Money.format(v.financeHeadAboveTotal()), v.sampleAuditPercent()),
                v.rules().stream().map(r -> new RuleView(r.code(), r.category(), r.unit().name(), r.cityTier(),
                        Money.format(r.softLimit()), Money.format(r.hardLimit()))).toList(),
                v.tier1Cities());
    }
}
