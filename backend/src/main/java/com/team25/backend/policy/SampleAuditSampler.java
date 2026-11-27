package com.team25.backend.policy;

import java.security.SecureRandom;
import java.util.Optional;
import java.util.random.RandomGenerator;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Exactly one sampled claim per block of {@code 100 / percent} auto-approved claims (US11-AC1). The position in
 * each block is drawn at random when the block opens. Serialized with a transaction-scoped advisory lock.
 */
@Component
public class SampleAuditSampler {

    private static final long LOCK_KEY = 0x5A3D_0001L;

    private final JdbcClient jdbc;
    private final RandomGenerator random = new SecureRandom();

    public SampleAuditSampler(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Counts one more auto-approved claim; true when this claim is the sampled one of its block. */
    public boolean next(int samplePercent) {
        if (samplePercent <= 0) {
            return false;
        }
        int blockSize = Math.max(1, 100 / samplePercent);
        jdbc.sql("SELECT pg_advisory_xact_lock(:k)").param("k", LOCK_KEY).query().singleRow();
        record Block(int no, int target, int filled) {
        }
        Optional<Block> open = jdbc.sql("SELECT block_no, target_position, filled FROM sample_audit_block ORDER BY block_no DESC LIMIT 1")
                .query((rs, i) -> new Block(rs.getInt(1), rs.getInt(2), rs.getInt(3))).optional();
        Block block;
        if (open.isEmpty() || open.get().filled() >= blockSize) {
            int no = open.map(b -> b.no() + 1).orElse(1);
            block = new Block(no, 1 + random.nextInt(blockSize), 0);
            jdbc.sql("INSERT INTO sample_audit_block (block_no, target_position, filled) VALUES (:n, :t, 0)")
                    .param("n", block.no()).param("t", block.target()).update();
        } else {
            block = open.get();
        }
        int filled = block.filled() + 1;
        jdbc.sql("UPDATE sample_audit_block SET filled = :f WHERE block_no = :n").param("f", filled).param("n", block.no()).update();
        return filled == block.target();
    }
}
