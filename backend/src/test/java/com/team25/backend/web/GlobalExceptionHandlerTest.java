package com.team25.backend.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

/** Guideline "stack traces and internal details are never shown": an unexpected 500 says only "Unexpected error". */
class GlobalExceptionHandlerTest {

    @Test
    void SEC_ERR_1_unexpectedErrorsHideTheExceptionMessage() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/claims");
        ResponseEntity<ApiError> r = new GlobalExceptionHandler().unexpected(
                new IllegalStateException("ERROR: relation \"app_user\" password=hunter2 at com.team25.Secret"), request);
        assertThat(r.getStatusCode().value()).isEqualTo(500);
        assertThat(r.getBody().message()).isEqualTo("Unexpected error");
        assertThat(r.getBody().toString()).doesNotContain("hunter2", "app_user", "com.team25", "IllegalStateException");
    }

    @Test
    void SEC_ERR_1_dataIntegrityErrorsHideTheSql() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/claims");
        ResponseEntity<ApiError> r = new GlobalExceptionHandler().dataIntegrity(
                new org.springframework.dao.DataIntegrityViolationException("duplicate key value violates unique constraint \"app_user_email_key\""),
                request);
        assertThat(r.getStatusCode().value()).isEqualTo(409);
        assertThat(r.getBody().message()).isEqualTo("Request conflicts with existing data");
    }
}
