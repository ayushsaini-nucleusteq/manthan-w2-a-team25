package com.team25.backend.auth;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.team25.backend.domain.Role;

/** Read access to users and roles. */
@Repository
public class UserDirectory {

    public record Dept(UUID id, String code, String name) {
    }

    public record Ref(UUID id, String fullName) {
    }

    public record UserRow(UUID id, String fullName, String email, String employeeCode, Dept department, Ref manager,
            boolean active, Set<Role> roles) {

        public AppPrincipal principal() {
            return new AppPrincipal(id, fullName, roles);
        }
    }

    private static final String SELECT = """
            SELECT u.id, u.full_name, u.email, u.employee_code, u.active,
                   d.id AS dept_id, d.code AS dept_code, d.name AS dept_name,
                   m.id AS mgr_id, m.full_name AS mgr_name,
                   ARRAY(SELECT r.role FROM user_role r WHERE r.user_id = u.id ORDER BY r.role) AS roles
              FROM app_user u
              JOIN department d ON d.id = u.department_id
              LEFT JOIN app_user m ON m.id = u.manager_id
            """;

    private final JdbcClient jdbc;

    public UserDirectory(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<UserRow> find(UUID id) {
        return jdbc.sql(SELECT + " WHERE u.id = :id").param("id", id).query(UserDirectory::map).optional();
    }

    /** Sign-in lookup: user id, BCrypt hash and active flag for an email (case-insensitive, citext). */
    public record Credentials(UUID id, String passwordHash, boolean active) {
    }

    public Optional<Credentials> credentials(String email) {
        // The cast matters: citext = text would fall back to case-sensitive text equality.
        return jdbc.sql("SELECT id, password_hash, active FROM app_user WHERE email = CAST(:email AS citext)")
                .param("email", email.strip())
                .query((rs, i) -> new Credentials(rs.getObject("id", UUID.class), rs.getString("password_hash"),
                        rs.getBoolean("active")))
                .optional();
    }

    /** Active users holding {@code role}, for pool notifications. */
    public List<UUID> activeWithRole(Role role) {
        return jdbc.sql("""
                SELECT u.id FROM app_user u JOIN user_role r ON r.user_id = u.id
                 WHERE u.active AND r.role = :role""")
                .param("role", role.name()).query(UUID.class).list();
    }

    static UserRow map(ResultSet rs, int row) throws SQLException {
        UUID mgrId = rs.getObject("mgr_id", UUID.class);
        return new UserRow(
                rs.getObject("id", UUID.class),
                rs.getString("full_name"),
                rs.getString("email"),
                rs.getString("employee_code"),
                new Dept(rs.getObject("dept_id", UUID.class), rs.getString("dept_code"), rs.getString("dept_name")),
                mgrId == null ? null : new Ref(mgrId, rs.getString("mgr_name")),
                rs.getBoolean("active"),
                roles(rs.getArray("roles")));
    }

    static Set<Role> roles(Array array) throws SQLException {
        Set<Role> roles = EnumSet.noneOf(Role.class);
        if (array != null) {
            for (Object o : (Object[]) array.getArray()) {
                roles.add(Role.valueOf(o.toString()));
            }
        }
        return roles;
    }
}
