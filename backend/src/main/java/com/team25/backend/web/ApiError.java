package com.team25.backend.web;

import java.time.Instant;
import java.util.List;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpStatus;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.team25.backend.observability.RequestIdFilter;

/**
 * The one JSON error shape every endpoint returns. {@code errors} is only present on 422 from submit
 * (per-line problems, see docs/api/openapi.yaml ApiError).
 */
public record ApiError(Instant timestamp, int status, String error, String message, String path, String requestId,
        @JsonInclude(JsonInclude.Include.NON_NULL) List<LineError> errors) {

    public static ApiError of(HttpStatus status, String message, HttpServletRequest request) {
        return of(status, message, request.getRequestURI(), request);
    }

    public static ApiError of(HttpStatus status, String message, String path, HttpServletRequest request) {
        return new ApiError(Instant.now(), status.value(), status.getReasonPhrase(), message, path,
                RequestIdFilter.current(request), null);
    }

    public ApiError withErrors(List<LineError> lineErrors) {
        return new ApiError(timestamp, status, error, message, path, requestId, lineErrors);
    }
}
