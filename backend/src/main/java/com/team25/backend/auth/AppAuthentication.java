package com.team25.backend.auth;

import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

/** Authentication whose principal is the {@link AppPrincipal} loaded from the database. */
public class AppAuthentication extends AbstractAuthenticationToken {

    private final AppPrincipal principal;
    private final transient Jwt jwt;

    public AppAuthentication(AppPrincipal principal, Jwt jwt) {
        super(principal.roles().stream().map(r -> new SimpleGrantedAuthority(r.authority())).toList());
        this.principal = principal;
        this.jwt = jwt;
        setAuthenticated(true);
    }

    @Override
    public Object getCredentials() {
        return jwt;
    }

    @Override
    public AppPrincipal getPrincipal() {
        return principal;
    }

    @Override
    public String getName() {
        return principal.id().toString();
    }
}
