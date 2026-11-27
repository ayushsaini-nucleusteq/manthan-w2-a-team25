package com.team25.backend.auth;

import java.io.IOException;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;

import com.team25.backend.web.ApiError;

import tools.jackson.databind.json.JsonMapper;

/**
 * Stateless bearer-JWT security. Every /api endpoint needs a token except POST /api/auth/login; role checks
 * are {@code @PreAuthorize} on controllers plus per-claim access checks in the services (404 for claims the
 * caller can't see, 403 for actions their role or ownership forbids). Actuator keeps its own exposure limits.
 */
@Configuration(proxyBeanMethods = false)
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain apiSecurity(HttpSecurity http, JwtService jwtService, UserDirectory users, JsonMapper json)
            throws Exception {
        AuthenticationEntryPoint unauthorized = (request, response, ex) ->
                write(json, request, response, HttpStatus.UNAUTHORIZED,
                        request.getHeader("Authorization") == null ? "Authentication required" : "Invalid or expired token");
        AccessDeniedHandler forbidden = (request, response, ex) ->
                write(json, request, response, HttpStatus.FORBIDDEN, "Your role does not allow this operation");

        http.csrf(c -> c.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .httpBasic(b -> b.disable())
                .formLogin(f -> f.disable())
                .logout(l -> l.disable())
                .requestCache(r -> r.disable())
                .authorizeHttpRequests(a -> a
                        // Exposure is limited to health, info and prometheus in application.properties.
                        .requestMatchers("/actuator/**").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/login").permitAll()
                        .requestMatchers("/error").permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(o -> o
                        .jwt(j -> j.decoder(jwtService.decoder()).jwtAuthenticationConverter(fromDatabase(users)))
                        .authenticationEntryPoint(unauthorized)
                        .accessDeniedHandler(forbidden))
                .exceptionHandling(e -> e.authenticationEntryPoint(unauthorized).accessDeniedHandler(forbidden));
        return http.build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    /** Token subject → current user row; inactive or unknown users are rejected even with a valid token. */
    static Converter<Jwt, AbstractAuthenticationToken> fromDatabase(UserDirectory users) {
        return jwt -> {
            UUID id;
            try {
                id = UUID.fromString(jwt.getSubject());
            } catch (IllegalArgumentException | NullPointerException e) {
                throw new BadCredentialsException("Invalid token subject");
            }
            UserDirectory.UserRow user = users.find(id).orElseThrow(() -> new BadCredentialsException("Unknown user"));
            if (!user.active()) {
                throw new DisabledException("User is inactive");
            }
            return new AppAuthentication(user.principal(), jwt);
        };
    }

    private static void write(JsonMapper json, HttpServletRequest request, HttpServletResponse response, HttpStatus status,
            String message) throws IOException {
        if (status == HttpStatus.UNAUTHORIZED) {
            response.setHeader("WWW-Authenticate", "Bearer");
        }
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getOutputStream().write(json.writeValueAsBytes(ApiError.of(status, message, request)));
    }
}
