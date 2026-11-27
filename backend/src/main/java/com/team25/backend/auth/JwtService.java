package com.team25.backend.auth;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.stereotype.Component;

import com.nimbusds.jose.jwk.source.ImmutableSecret;

/**
 * HS256 tokens valid for 8 hours. The secret comes from JWT_SECRET (at least 32 bytes); when it is not set a
 * random secret is generated at startup, so tokens stop working after a restart (fine for the demo stack).
 */
@Component
public class JwtService {

    public static final Duration TTL = Duration.ofHours(8);
    static final String ISSUER = "expenseflow";

    private static final Logger log = LoggerFactory.getLogger(JwtService.class);

    private final JwtEncoder encoder;
    private final JwtDecoder decoder;

    public JwtService(@Value("${app.jwt.secret:}") String secret) {
        byte[] key;
        if (secret == null || secret.isBlank()) {
            key = new byte[32];
            new SecureRandom().nextBytes(key);
            log.warn("JWT_SECRET is not set: using a random signing key; tokens become invalid when the app restarts");
        } else {
            key = secret.getBytes(StandardCharsets.UTF_8);
            if (key.length < 32) {
                throw new IllegalStateException("JWT_SECRET must be at least 32 bytes for HS256");
            }
        }
        SecretKey secretKey = new SecretKeySpec(key, "HmacSHA256");
        this.encoder = new NimbusJwtEncoder(new ImmutableSecret<>(secretKey));
        this.decoder = NimbusJwtDecoder.withSecretKey(secretKey).macAlgorithm(MacAlgorithm.HS256).build();
    }

    public String issue(AppPrincipal user, Instant now) {
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(ISSUER)
                .subject(user.id().toString())
                .issuedAt(now)
                .expiresAt(now.plus(TTL))
                .id(Base64.getUrlEncoder().withoutPadding().encodeToString(randomId()))
                .claim("name", user.fullName())
                .claim("roles", user.roles().stream().map(Enum::name).sorted().toList())
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).type("JWT").build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }

    public JwtDecoder decoder() {
        return decoder;
    }

    private static byte[] randomId() {
        byte[] b = new byte[12];
        new SecureRandom().nextBytes(b);
        return b;
    }
}
