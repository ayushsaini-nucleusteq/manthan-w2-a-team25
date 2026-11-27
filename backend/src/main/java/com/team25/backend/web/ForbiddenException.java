package com.team25.backend.web;

/** The caller can see the resource but may not perform this action on it (e.g. own claim); becomes a 403. */
public class ForbiddenException extends RuntimeException {

    public ForbiddenException(String message) {
        super(message);
    }
}
