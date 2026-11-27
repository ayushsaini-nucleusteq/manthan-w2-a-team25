package com.team25.backend.claims;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Objects;

import com.team25.backend.claims.ClaimApi.LineRequest;
import com.team25.backend.claims.ClaimRepository.LineRow;
import com.team25.backend.domain.Money;
import com.team25.backend.web.BadRequestException;

/** A validated, normalised line (US1-AC1: category, amount, date and vendor are required). */
public record LineData(String category, BigDecimal amount, LocalDate expenseDate, String vendor, String notes,
        String city, Integer nights) {

    /** Validates what bean validation can't: amount > 0, date not in the future, hotel fields, known category. */
    public static LineData of(LineRequest r, boolean requiresHotelDetails) {
        BigDecimal amount = Money.parse(r.amount());
        if (amount.signum() <= 0) {
            throw new BadRequestException("Validation failed: amount: must be greater than 0");
        }
        if (r.expenseDate().isAfter(Money.today())) {
            throw new BadRequestException("Validation failed: expenseDate: must not be in the future");
        }
        String city = blankToNull(r.city());
        if (requiresHotelDetails && (city == null || r.nights() == null)) {
            throw new BadRequestException("Validation failed: city and nights are required for " + r.category());
        }
        if (!requiresHotelDetails && (city != null || r.nights() != null)) {
            throw new BadRequestException("Validation failed: city and nights are only allowed for hotel lines");
        }
        return new LineData(r.category(), Money.scale(amount), r.expenseDate(), r.vendor().strip(),
                blankToNull(r.notes()), city, r.nights());
    }

    public boolean sameAs(LineRow row) {
        return category.equals(row.category()) && amount.compareTo(row.amount()) == 0
                && expenseDate.equals(row.expenseDate()) && vendor.equals(row.vendor())
                && Objects.equals(notes, row.notes()) && Objects.equals(city, row.city())
                && Objects.equals(nights, row.nights());
    }

    /** True when a change affects the policy result (notes don't). */
    public boolean policyRelevantChange(LineRow row) {
        return !category.equals(row.category()) || amount.compareTo(row.amount()) != 0
                || !expenseDate.equals(row.expenseDate()) || !vendor.equals(row.vendor())
                || !Objects.equals(city, row.city()) || !Objects.equals(nights, row.nights());
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }
}
