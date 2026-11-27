package com.team25.backend.web;

/** Throw from domain code when a request conflicts with current state; becomes a 409. */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
