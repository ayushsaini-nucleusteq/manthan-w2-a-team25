package com.team25.backend.policy;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.team25.backend.policy.PolicyVersion.Rule;
import com.team25.backend.policy.PolicyVersion.Unit;
import com.team25.backend.web.NotFoundException;

/** Loads policy versions. The current version is the highest version_no. */
@Repository
public class PolicyRepository {

    private static final String SELECT = """
            SELECT v.*, u.full_name AS created_by_name
              FROM policy_version v LEFT JOIN app_user u ON u.id = v.created_by
            """;

    private final JdbcClient jdbc;

    public PolicyRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public PolicyVersion current() {
        return jdbc.sql(SELECT + " ORDER BY v.version_no DESC LIMIT 1").query(this::map).optional()
                .orElseThrow(() -> new IllegalStateException("No policy version configured"));
    }

    public PolicyVersion byId(UUID id) {
        return jdbc.sql(SELECT + " WHERE v.id = :id").param("id", id).query(this::map).optional()
                .orElseThrow(() -> new NotFoundException("Policy version not found"));
    }

    public PolicyVersion byNumber(int versionNo) {
        return jdbc.sql(SELECT + " WHERE v.version_no = :n").param("n", versionNo).query(this::map).optional()
                .orElseThrow(() -> new NotFoundException("Policy version not found"));
    }

    private PolicyVersion map(ResultSet rs, int row) throws SQLException {
        UUID id = rs.getObject("id", UUID.class);
        List<Rule> rules = jdbc.sql("""
                SELECT code, name, category, unit, city_tier, soft_limit, hard_limit
                  FROM policy_rule WHERE policy_version_id = :id ORDER BY category, code""")
                .param("id", id)
                .query((r, i) -> new Rule(r.getString("code"), r.getString("name"), r.getString("category"),
                        Unit.valueOf(r.getString("unit")), r.getString("city_tier"), r.getBigDecimal("soft_limit"),
                        r.getBigDecimal("hard_limit")))
                .list();
        List<String> cities = jdbc.sql("SELECT display_name FROM policy_tier1_city WHERE policy_version_id = :id ORDER BY display_name")
                .param("id", id).query(String.class).list();
        return new PolicyVersion(id, rs.getInt("version_no"), rs.getString("change_note"),
                rs.getObject("created_by", UUID.class), rs.getString("created_by_name"),
                rs.getTimestamp("created_at").toInstant(), money(rs, "receipt_threshold"),
                rs.getBoolean("weekend_flag_enabled"), rs.getInt("overdue_threshold_hours"),
                money(rs, "auto_approve_max_total"), money(rs, "auditor_above_total"),
                money(rs, "finance_head_above_total"), rs.getInt("sample_audit_percent"), rules, cities);
    }

    private static BigDecimal money(ResultSet rs, String column) throws SQLException {
        return rs.getBigDecimal(column);
    }
}
