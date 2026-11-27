package com.team25.backend.policy;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/** One immutable policy version (F4). Rules, tier-1 cities and thresholds never change once written. */
public record PolicyVersion(UUID id, int versionNo, String changeNote, UUID createdById, String createdByName,
        Instant createdAt, BigDecimal receiptThreshold, boolean weekendFlagEnabled, int overdueThresholdHours,
        BigDecimal autoApproveMaxTotal, BigDecimal auditorAboveTotal, BigDecimal financeHeadAboveTotal,
        int sampleAuditPercent, List<Rule> rules, List<String> tier1Cities) {

    public enum Unit {
        PER_DAY, PER_NIGHT, PER_TRIP
    }

    public record Rule(String code, String name, String category, Unit unit, String cityTier, BigDecimal softLimit,
            BigDecimal hardLimit) {
    }

    public boolean coversCategory(String category) {
        return rules.stream().anyMatch(r -> r.category().equals(category));
    }

    /** The rule for a line: hotel rules pick by city tier; other categories have one rule each. */
    public Optional<Rule> ruleFor(String category, String city) {
        List<Rule> candidates = rules.stream().filter(r -> r.category().equals(category)).toList();
        if (candidates.size() <= 1) {
            return candidates.stream().findFirst();
        }
        String tier = isTier1(city) ? "TIER1" : "OTHER";
        return candidates.stream().filter(r -> tier.equals(r.cityTier())).findFirst()
                .or(() -> candidates.stream().filter(r -> r.cityTier() == null).findFirst());
    }

    public boolean isTier1(String city) {
        String key = cityKey(city);
        return key != null && tier1Cities.stream().anyMatch(c -> cityKey(c).equals(key));
    }

    public static String cityKey(String city) {
        return city == null ? null : city.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }
}
