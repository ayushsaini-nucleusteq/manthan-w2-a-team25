package com.team25.backend.policy;

import java.util.List;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.team25.backend.auth.UserDirectory.Dept;

/** Reference data any signed-in user can read: departments and expense categories. */
@RestController
public class ReferenceController {

    public record Category(String code, String name, boolean requiresHotelDetails, boolean coveredByPolicy) {
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
}
