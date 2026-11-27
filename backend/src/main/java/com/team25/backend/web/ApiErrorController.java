package com.team25.backend.web;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.boot.webmvc.error.ErrorController;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.team25.backend.observability.RequestIdFilter;

/**
 * Replaces Spring Boot's default /error endpoint. It renders errors that never reached a controller
 * (thrown in a filter, or sendError from the container) as {@link ApiError}, without exception details.
 */
@RestController
public class ApiErrorController implements ErrorController {

    private static final Logger log = LoggerFactory.getLogger(ApiErrorController.class);

    @RequestMapping("${server.error.path:/error}")
    public ResponseEntity<ApiError> error(HttpServletRequest request) {
        Object code = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
        if (code == null) {
            // Not a real error dispatch: someone requested /error directly.
            HttpStatus notFound = HttpStatus.NOT_FOUND;
            return ResponseEntity.status(notFound)
                    .body(ApiError.of(notFound, "No endpoint " + request.getMethod() + " " + request.getRequestURI(), request));
        }

        HttpStatus status = code instanceof Integer i && HttpStatus.resolve(i) != null
                ? HttpStatus.valueOf(i)
                : HttpStatus.INTERNAL_SERVER_ERROR;
        Object originalUri = request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI);
        String path = originalUri != null ? originalUri.toString() : request.getRequestURI();

        if (status.is5xxServerError()) {
            logWithRequestId(request, path, (Throwable) request.getAttribute(RequestDispatcher.ERROR_EXCEPTION));
        }
        String message = status.is5xxServerError() ? "Unexpected error" : status.getReasonPhrase();
        return ResponseEntity.status(status).body(ApiError.of(status, message, path, request));
    }

    // The error dispatch runs after RequestIdFilter has cleared the MDC, so restore it for this line.
    private static void logWithRequestId(HttpServletRequest request, String path, Throwable error) {
        String requestId = RequestIdFilter.current(request);
        boolean restored = requestId != null && MDC.get(RequestIdFilter.MDC_KEY) == null;
        if (restored) {
            MDC.put(RequestIdFilter.MDC_KEY, requestId);
        }
        try {
            log.error("Unhandled error on {} {}", request.getMethod(), path, error);
        } finally {
            if (restored) {
                MDC.remove(RequestIdFilter.MDC_KEY);
            }
        }
    }
}
