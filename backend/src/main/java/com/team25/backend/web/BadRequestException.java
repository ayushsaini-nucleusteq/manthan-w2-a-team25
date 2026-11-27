package com.team25.backend.web;

/** Request is well-formed JSON but breaks a business validation rule; becomes a 400. */
public class BadRequestException extends RuntimeException {

    public BadRequestException(String message) {
        super(message);
    }
}
