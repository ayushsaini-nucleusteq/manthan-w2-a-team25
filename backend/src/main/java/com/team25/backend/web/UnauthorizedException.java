package com.team25.backend.web;

/** Sign-in failed (unknown or inactive user); becomes a 401. */
public class UnauthorizedException extends RuntimeException {

    public UnauthorizedException(String message) {
        super(message);
    }
}
