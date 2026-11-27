package com.team25.backend.users;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
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
import com.team25.backend.auth.AppPrincipal;
import com.team25.backend.auth.UserDirectory.Dept;
import com.team25.backend.auth.UserDirectory.Ref;
import com.team25.backend.claims.ClaimApi.Page;
import com.team25.backend.claims.ClaimRepository;
import com.team25.backend.domain.Role;
import com.team25.backend.web.BadRequestException;
import com.team25.backend.web.ConflictException;
import com.team25.backend.web.NotFoundException;
import com.team25.backend.web.Sorts;

/** F5 users and hierarchy: list, set manager, roles and active flag (finance head). */
@Service
public class UserService {

    public record User(UUID id, String employeeCode, String fullName, String email, List<Role> roles, Dept department,
            Ref manager, boolean active, int version) {
    }

    private static final Map<String, String> SORTS = Map.of("fullName", "u.full_name", "employeeCode", "u.employee_code");

    private static final String SELECT = """
            SELECT u.id, u.employee_code, u.full_name, u.email, u.active, u.version, u.manager_id,
                   d.id AS dept_id, d.code AS dept_code, d.name AS dept_name, m.full_name AS mgr_name,
                   ARRAY(SELECT r.role FROM user_role r WHERE r.user_id = u.id ORDER BY r.role) AS roles
              FROM app_user u JOIN department d ON d.id = u.department_id LEFT JOIN app_user m ON m.id = u.manager_id
            """;

    private final JdbcClient jdbc;
    private final AuditService audit;

    public UserService(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public Page<User> list(Role role, UUID departmentId, UUID managerId, Boolean active, String q, int page, int size,
            String sort) {
        List<String> where = new ArrayList<>();
        Map<String, Object> params = new HashMap<>();
        if (role != null) {
            where.add("EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id AND r.role = :role)");
            params.put("role", role.name());
        }
        if (departmentId != null) {
            where.add("u.department_id = :dept");
            params.put("dept", departmentId);
        }
        if (managerId != null) {
            where.add("u.manager_id = :mgr");
            params.put("mgr", managerId);
        }
        if (active != null) {
            where.add("u.active = :active");
            params.put("active", active);
        }
        if (q != null && !q.isBlank()) {
            where.add("(u.full_name ILIKE :q OR u.email::text ILIKE :q OR u.employee_code ILIKE :q)");
            params.put("q", ClaimRepository.like(q));
        }
        String w = where.isEmpty() ? "" : " WHERE " + String.join(" AND ", where);
        var count = jdbc.sql("SELECT count(*) FROM app_user u" + w);
        var list = jdbc.sql(SELECT + w + " ORDER BY " + Sorts.orderBy(sort, SORTS, "u.full_name ASC")
                + ", u.id OFFSET :offset LIMIT :limit");
        for (var e : params.entrySet()) {
            count = count.param(e.getKey(), e.getValue());
            list = list.param(e.getKey(), e.getValue());
        }
        return Page.of(list.param("offset", page * size).param("limit", size).query(UserService::map).list(), page, size,
                count.query(Long.class).single());
    }

    /**
     * Partial update. 400: manager is self, inactive, unknown or would create a cycle. 409: stale version, a finance
     * head removing their own FINANCE_HEAD role or deactivating themself, or removing the last active finance head
     * or auditor. EMPLOYEE is always kept.
     */
    @Transactional
    public User update(AppPrincipal me, UUID userId, int version, boolean setManager, UUID managerId, List<Role> roles,
            Boolean active) {
        // Serialise user admin so the "last finance head / auditor" checks can't race.
        jdbc.sql("SELECT pg_advisory_xact_lock(hashtext('user-admin'))").query().listOfRows();
        User u = jdbc.sql(SELECT + " WHERE u.id = :id FOR UPDATE OF u").param("id", userId).query(UserService::map)
                .optional().orElseThrow(() -> new NotFoundException("User not found"));
        if (u.version() != version) {
            throw new ConflictException("User was modified by another request (version " + u.version() + ", you sent "
                    + version + "); reload and retry");
        }
        Map<String, Object> changes = new LinkedHashMap<>();
        UUID newManager = u.manager() == null ? null : u.manager().id();
        if (setManager && !Objects.equals(newManager, managerId)) {
            if (managerId != null) {
                if (managerId.equals(userId)) {
                    throw new BadRequestException("Validation failed: managerId: a user cannot manage themself");
                }
                Boolean mActive = jdbc.sql("SELECT active FROM app_user WHERE id = :id").param("id", managerId)
                        .query(Boolean.class).optional()
                        .orElseThrow(() -> new BadRequestException("Validation failed: managerId: unknown user"));
                if (!mActive) {
                    throw new BadRequestException("Validation failed: managerId: manager is inactive");
                }
                if (createsCycle(userId, managerId)) {
                    throw new BadRequestException("Validation failed: managerId: would create a reporting cycle");
                }
            }
            changes.put("managerId", change(newManager, managerId));
            newManager = managerId;
        }
        Set<Role> newRoles = EnumSet.copyOf(u.roles().isEmpty() ? List.of(Role.EMPLOYEE) : u.roles());
        if (roles != null) {
            newRoles = EnumSet.of(Role.EMPLOYEE);
            newRoles.addAll(roles);
            if (!newRoles.equals(EnumSet.copyOf(u.roles()))) {
                changes.put("roles", change(u.roles(), newRoles));
            }
        }
        boolean newActive = active == null ? u.active() : active;
        if (newActive != u.active()) {
            changes.put("active", change(u.active(), newActive));
        }
        boolean self = userId.equals(me.id());
        if (self && u.roles().contains(Role.FINANCE_HEAD) && !newRoles.contains(Role.FINANCE_HEAD)) {
            throw new ConflictException("You cannot remove your own FINANCE_HEAD role");
        }
        if (self && !newActive) {
            throw new ConflictException("You cannot deactivate yourself");
        }
        for (Role guarded : List.of(Role.FINANCE_HEAD, Role.AUDITOR)) {
            boolean loses = u.active() && u.roles().contains(guarded) && (!newActive || !newRoles.contains(guarded));
            if (loses && activeWithRole(guarded) <= 1) {
                throw new ConflictException("This is the last active " + guarded + "; assign the role to someone else first");
            }
        }
        if (changes.isEmpty()) {
            return u;
        }
        jdbc.sql("UPDATE app_user SET manager_id = :m, active = :a, version = version + 1, updated_at = now() WHERE id = :id")
                .param("m", newManager).param("a", newActive).param("id", userId).update();
        if (roles != null) {
            jdbc.sql("DELETE FROM user_role WHERE user_id = :id").param("id", userId).update();
            for (Role r : newRoles) {
                jdbc.sql("INSERT INTO user_role (user_id, role) VALUES (:id, :r)").param("id", userId).param("r", r.name()).update();
            }
        }
        audit.record(new AuditService.Entry(me.id(), null, "USER_UPDATED", "USER", userId.toString(), null, null, null,
                null, Map.of("changes", changes)));
        return jdbc.sql(SELECT + " WHERE u.id = :id").param("id", userId).query(UserService::map).single();
    }

    private boolean createsCycle(UUID userId, UUID managerId) {
        Set<UUID> seen = new HashSet<>();
        UUID current = managerId;
        while (current != null && seen.add(current)) {
            if (current.equals(userId)) {
                return true;
            }
            current = jdbc.sql("SELECT manager_id FROM app_user WHERE id = :id").param("id", current)
                    .query((rs, i) -> rs.getObject("manager_id", UUID.class)).optional().orElse(null);
        }
        return false;
    }

    private long activeWithRole(Role role) {
        return jdbc.sql("""
                SELECT count(*) FROM app_user u JOIN user_role r ON r.user_id = u.id WHERE u.active AND r.role = :r""")
                .param("r", role.name()).query(Long.class).single();
    }

    private static Map<String, Object> change(Object from, Object to) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("from", from == null ? null : from.toString());
        m.put("to", to == null ? null : to.toString());
        return m;
    }

    static User map(ResultSet rs, int row) throws SQLException {
        UUID mgr = rs.getObject("manager_id", UUID.class);
        return new User(rs.getObject("id", UUID.class), rs.getString("employee_code"), rs.getString("full_name"),
                rs.getString("email"), roles(rs.getArray("roles")),
                new Dept(rs.getObject("dept_id", UUID.class), rs.getString("dept_code"), rs.getString("dept_name")),
                mgr == null ? null : new Ref(mgr, rs.getString("mgr_name")), rs.getBoolean("active"), rs.getInt("version"));
    }

    private static List<Role> roles(Array a) throws SQLException {
        List<Role> out = new ArrayList<>();
        for (Object o : (Object[]) a.getArray()) {
            out.add(Role.valueOf(o.toString()));
        }
        return out;
    }
}
