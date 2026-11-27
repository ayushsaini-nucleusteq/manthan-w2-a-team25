package com.team25.backend.web;

import java.util.List;

/** Submit cannot proceed as the claim stands; becomes a 422 with every problem in {@code errors}. */
public class UnprocessableException extends RuntimeException {

    private final transient List<LineError> errors;

    public UnprocessableException(String message, List<LineError> errors) {
        super(message);
        this.errors = List.copyOf(errors);
    }

    public List<LineError> errors() {
        return errors;
    }
}
