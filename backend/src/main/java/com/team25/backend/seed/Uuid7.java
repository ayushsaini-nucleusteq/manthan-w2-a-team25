package com.team25.backend.seed;

import java.util.UUID;
import java.util.random.RandomGenerator;

/** Monotonic UUIDv7 generator for bulk inserts, so rows keep insertion order like the DB default uuidv7(). */
final class Uuid7 {

    private final RandomGenerator random;
    private long lastMillis;
    private long counter;

    Uuid7(RandomGenerator random) {
        this.random = random;
    }

    synchronized UUID next() {
        long now = System.currentTimeMillis();
        if (now <= lastMillis) {
            counter++;
            if (counter > 0xFFF) {
                lastMillis++;
                counter = 0;
            }
        } else {
            lastMillis = now;
            counter = 0;
        }
        long msb = (lastMillis << 16) | 0x7000L | counter;
        long lsb = (random.nextLong() & 0x3FFFFFFFFFFFFFFFL) | 0x8000000000000000L;
        return new UUID(msb, lsb);
    }
}
