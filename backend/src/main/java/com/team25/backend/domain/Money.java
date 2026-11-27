package com.team25.backend.domain;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.regex.Pattern;

/** INR amounts are NUMERIC(12,2) and travel as two-decimal strings. Business dates are Asia/Kolkata. */
public final class Money {

    public static final String PATTERN = "^\\d{1,10}\\.\\d{2}$";
    private static final Pattern REGEX = Pattern.compile(PATTERN);
    public static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Kolkata");

    private Money() {
    }

    public static BigDecimal parse(String value) {
        if (value == null || !REGEX.matcher(value).matches()) {
            throw new IllegalArgumentException("amount must be a decimal string with two decimals, e.g. \"1500.00\"");
        }
        return new BigDecimal(value);
    }

    public static String format(BigDecimal value) {
        return value == null ? null : value.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }

    public static BigDecimal scale(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }

    public static LocalDate today() {
        return LocalDate.now(BUSINESS_ZONE);
    }
}
