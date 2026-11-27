package com.team25.backend.web;

/** Throw from domain code when a requested resource doesn't exist; becomes a 404. */
public class NotFoundException extends RuntimeException {

    public NotFoundException(String message) {
        super(message);
    }
}
