package com.team25.backend.web;

import java.util.Map;

/** Parses {@code field,asc|desc} against an allow-list of field → column; anything else is a 400. */
public final class Sorts {

    private Sorts() {
    }

    public static String orderBy(String sort, Map<String, String> allowed, String defaultOrder) {
        if (sort == null || sort.isBlank()) {
            return defaultOrder;
        }
        String[] parts = sort.split(",", -1);
        String column = allowed.get(parts[0].strip());
        String dir = parts.length > 1 ? parts[1].strip().toLowerCase(java.util.Locale.ROOT) : "asc";
        if (column == null || parts.length > 2 || !(dir.equals("asc") || dir.equals("desc"))) {
            throw new BadRequestException("Invalid value for parameter 'sort': allowed fields are "
                    + String.join(", ", allowed.keySet().stream().sorted().toList()));
        }
        return column + " " + dir.toUpperCase(java.util.Locale.ROOT) + " NULLS LAST";
    }
}
