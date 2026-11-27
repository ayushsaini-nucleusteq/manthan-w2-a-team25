package com.team25.backend.web;

import java.time.Instant;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpStatus;

import com.team25.backend.observability.RequestIdFilter;

/** The one JSON error shape every endpoint returns. */
public record ApiError(Instant timestamp, int status, String error, String message, String path, String requestId) {

    public static ApiError of(HttpStatus status, String message, HttpServletRequest request) {
        return of(status, message, request.getRequestURI(), request);
    }

    public static ApiError of(HttpStatus status, String message, String path, HttpServletRequest request) {
        return new ApiError(Instant.now(), status.value(), status.getReasonPhrase(), message, path,
                RequestIdFilter.current(request));
    }
}
