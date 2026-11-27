package com.team25.backend.config;

import java.util.Arrays;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import com.team25.backend.observability.RequestIdFilter;

import tools.jackson.databind.json.JsonMapper;

/**
 * CORS for the frontend, applied as a servlet filter so it also covers error responses (404, 400...)
 * and preflights for paths that don't exist yet. Origins come from FRONTEND_ORIGIN (comma-separated).
 */
@Configuration(proxyBeanMethods = false)
public class CorsConfig {

    @Bean
    FilterRegistrationBean<CorsFilter> corsFilter(@Value("${app.cors.allowed-origins}") String allowedOrigins, JsonMapper json) {
        List<String> origins = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();

        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOrigins(origins);
        cors.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cors.setAllowedHeaders(List.of("*"));
        cors.setExposedHeaders(List.of(RequestIdFilter.HEADER));
        cors.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", cors);

        CorsFilter filter = new CorsFilter(source);
        filter.setCorsProcessor(new JsonCorsProcessor(json));

        FilterRegistrationBean<CorsFilter> registration = new FilterRegistrationBean<>(filter);
        // Right after RequestIdFilter, so even rejected preflights get a request id.
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 10);
        return registration;
    }
}
