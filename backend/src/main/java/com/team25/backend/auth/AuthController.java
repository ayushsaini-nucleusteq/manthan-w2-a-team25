package com.team25.backend.auth;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.team25.backend.approvals.DelegationRepository;
import com.team25.backend.approvals.DelegationRepository.DelegationView;
import com.team25.backend.audit.AuditService;
import com.team25.backend.auth.UserDirectory.Credentials;
import com.team25.backend.auth.UserDirectory.Dept;
import com.team25.backend.auth.UserDirectory.Ref;
import com.team25.backend.auth.UserDirectory.UserRow;
import com.team25.backend.domain.Role;
import com.team25.backend.web.UnauthorizedException;

/**
 * S1 sign-in: email + password (BCrypt). Unknown email, wrong password and inactive user all get the same 401
 * message, and a dummy hash is checked for unknown emails so timing doesn't reveal which accounts exist.
 * Logins, failed logins and logouts are audited. Logout is client-side (the token stays valid until it expires).
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    static final String BAD_CREDENTIALS = "Email or password is incorrect";

    public record LoginRequest(@NotBlank @Email @Size(max = 254) String email, @NotBlank @Size(max = 128) String password) {
    }

    public record CurrentUser(UUID id, String fullName, String email, String employeeCode, List<Role> roles,
            Dept department, Ref manager, String homeScreen, List<DelegationView> delegationsReceived) {
    }

    public record LoginResponse(String accessToken, String tokenType, long expiresIn, CurrentUser user) {
    }

    private final UserDirectory users;
    private final JwtService jwt;
    private final PasswordEncoder passwords;
    private final AuditService audit;
    private final DelegationRepository delegations;
    private final String dummyHash;

    public AuthController(UserDirectory users, JwtService jwt, PasswordEncoder passwords, AuditService audit,
            DelegationRepository delegations) {
        this.users = users;
        this.jwt = jwt;
        this.passwords = passwords;
        this.audit = audit;
        this.delegations = delegations;
        this.dummyHash = passwords.encode("not-a-real-password-" + UUID.randomUUID());
    }

    /** A failed attempt still commits its LOGIN_FAILED audit row: the 401 exception does not roll back. */
    @PostMapping("/login")
    @Transactional(noRollbackFor = UnauthorizedException.class)
    public LoginResponse login(@Valid @RequestBody LoginRequest request) {
        Optional<Credentials> found = users.credentials(request.email());
        boolean passwordOk = passwords.matches(request.password(), found.map(Credentials::passwordHash).orElse(dummyHash));
        if (found.isEmpty() || !passwordOk || !found.get().active()) {
            UUID knownId = found.map(Credentials::id).orElse(null);
            audit.record(new AuditService.Entry(knownId, null, "LOGIN_FAILED", "USER",
                    knownId != null ? knownId.toString() : "unknown", null, null, null, null,
                    Map.of("email", request.email().strip(),
                            "reason", found.isEmpty() ? "UNKNOWN_EMAIL" : !passwordOk ? "WRONG_PASSWORD" : "INACTIVE")));
            throw new UnauthorizedException(BAD_CREDENTIALS);
        }
        UserRow user = users.find(found.get().id()).orElseThrow(() -> new UnauthorizedException(BAD_CREDENTIALS));
        String token = jwt.issue(user.principal(), Instant.now());
        audit.record(new AuditService.Entry(user.id(), null, "LOGIN", "USER", user.id().toString(), null,
                null, null, null, null));
        return new LoginResponse(token, "Bearer", JwtService.TTL.toSeconds(), current(user));
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional(propagation = Propagation.REQUIRED)
    public void logout(@AuthenticationPrincipal AppPrincipal me) {
        audit.record(new AuditService.Entry(me.id(), null, "LOGOUT", "USER", me.id().toString(), null,
                null, null, null, null));
    }

    @GetMapping("/me")
    public CurrentUser me(@AuthenticationPrincipal AppPrincipal me) {
        return current(users.find(me.id()).orElseThrow(() -> new UnauthorizedException("Unknown user")));
    }

    private CurrentUser current(UserRow u) {
        return new CurrentUser(u.id(), u.fullName(), u.email(), u.employeeCode(), List.copyOf(u.roles()), u.department(),
                u.manager(), u.principal().homeScreen(), delegations.activeReceivedBy(u.id()));
    }
}
