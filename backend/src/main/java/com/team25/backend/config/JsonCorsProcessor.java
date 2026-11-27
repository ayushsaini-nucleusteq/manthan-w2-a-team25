package com.team25.backend.config;

import java.io.IOException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.DefaultCorsProcessor;

import com.team25.backend.web.ApiError;

import tools.jackson.databind.json.JsonMapper;

/** Same CORS rules as Spring's default, but a rejected request gets the standard {@link ApiError} JSON instead of plain text. */
class JsonCorsProcessor extends DefaultCorsProcessor {

    private static final ThreadLocal<HttpServletRequest> CURRENT = new ThreadLocal<>();

    private final JsonMapper json;

    JsonCorsProcessor(JsonMapper json) {
        this.json = json;
    }

    @Override
    public boolean processRequest(CorsConfiguration config, HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        CURRENT.set(request);
        try {
            return super.processRequest(config, request, response);
        } finally {
            CURRENT.remove();
        }
    }

    @Override
    protected void rejectRequest(ServerHttpResponse response) throws IOException {
        HttpServletRequest request = CURRENT.get();
        ApiError error = ApiError.of(HttpStatus.FORBIDDEN, "CORS request not allowed from this origin", request);
        response.setStatusCode(HttpStatus.FORBIDDEN);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        response.getBody().write(json.writeValueAsBytes(error));
        response.flush();
    }
}
