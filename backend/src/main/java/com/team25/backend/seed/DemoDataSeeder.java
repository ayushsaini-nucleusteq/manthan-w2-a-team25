package com.team25.backend.seed;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Random;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import com.team25.backend.claims.ReceiptService;
import com.team25.backend.claims.ReceiptStorage;
import com.team25.backend.domain.ClaimStatus;
import com.team25.backend.domain.Money;
import com.team25.backend.domain.PolicyOutcome;
import com.team25.backend.domain.Role;
import com.team25.backend.domain.StepType;
import com.team25.backend.policy.PolicyEngine;
import com.team25.backend.policy.PolicyEngine.Finding;
import com.team25.backend.policy.PolicyEngine.LineInput;
import com.team25.backend.policy.PolicyEngine.LineResult;
import com.team25.backend.policy.PolicyEngine.Match;
import com.team25.backend.policy.PolicyRepository;
import com.team25.backend.policy.PolicyVersion;

import tools.jackson.databind.json.JsonMapper;

/**
 * Seeds a demo organisation once into an empty database (idempotent: skipped when any user exists):
 * 8 departments, 150 users with a reporting hierarchy (2 finance heads, 3 auditors, managers), and 3000 claims
 * across every resting status, with planted duplicates and limit breaches. Claims run through the real
 * {@link PolicyEngine} with an in-memory history, and auto-approved claims go through the same one-per-block-of-10
 * sample selection as live submits. Everything is written in one transaction.
 *
 * <p>All users share one password from SEED_USER_PASSWORD (never committed; see docs/demo-accounts.md).
 */
@Component
@ConditionalOnProperty(name = "app.seed.enabled", havingValue = "true")
public class DemoDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoDataSeeder.class);
    private static final String DOMAIN = "@expenseflow.test";

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final PasswordEncoder passwords;
    private final PolicyRepository policies;
    private final JsonMapper json;
    private final String userPassword;
    private final int claimCount;

    private final Random rnd = new Random(25);
    private final Uuid7 ids = new Uuid7(new Random(2025));

    public DemoDataSeeder(JdbcTemplate jdbc, TransactionTemplate tx, PasswordEncoder passwords, PolicyRepository policies,
            JsonMapper json, @Value("${app.seed.user-password:}") String userPassword,
            @Value("${app.seed.claims:3000}") int claimCount) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.passwords = passwords;
        this.policies = policies;
        this.json = json;
        this.userPassword = userPassword;
        this.claimCount = claimCount;
    }

    @Override
    public void run(ApplicationArguments args) {
        Integer users = jdbc.queryForObject("SELECT count(*) FROM app_user", Integer.class);
        if (users != null && users > 0) {
            log.info("Demo seed skipped: database already has {} users", users);
            return;
        }
        if (userPassword == null || userPassword.isBlank()) {
            throw new IllegalStateException("SEED_USER_PASSWORD must be set (in .env) to seed demo users");
        }
        long start = System.nanoTime();
        tx.executeWithoutResult(s -> seed());
        log.info("Demo seed done in {} ms", Duration.ofNanos(System.nanoTime() - start).toMillis());
    }

    // ================================================================== organisation

    record Dept(UUID id, String code, String name) {
    }

    record SeedUser(UUID id, String fullName, String email, String code, Dept dept, UUID managerId, Set<Role> roles,
            String bankAccount, String ifsc) {

        boolean has(Role r) {
            return roles.contains(r);
        }
    }

    private final List<Dept> depts = new ArrayList<>();
    private final List<SeedUser> users = new ArrayList<>();
    private final Map<UUID, SeedUser> byId = new HashMap<>();
    private final Set<String> emails = new HashSet<>();

    private static final String[] FIRST = { "Aarav", "Aditi", "Akash", "Ananya", "Bhavna", "Chetan", "Deepa", "Dev",
            "Divya", "Farhan", "Gauri", "Harsh", "Ishaan", "Isha", "Jaya", "Karan", "Kiran", "Lakshmi", "Manish", "Mohit",
            "Nandini", "Neha", "Nikhil", "Pooja", "Pranav", "Priya", "Rahul", "Rajesh", "Ritu", "Sameer", "Sanjay",
            "Shreya", "Siddharth", "Tanvi", "Varun", "Vikram", "Yash", "Zoya", "Anil", "Swati", "Gaurav", "Pallavi" };
    private static final String[] LAST = { "Agarwal", "Bansal", "Bhat", "Chopra", "Desai", "Fernandes", "Gupta", "Jain",
            "Joshi", "Khan", "Kulkarni", "Mehta", "Mishra", "Nair", "Patel", "Pillai", "Rao", "Reddy", "Saxena", "Sethi",
            "Sharma", "Singh", "Sinha", "Thomas", "Yadav", "Malhotra", "Ghosh", "Bose", "Chauhan", "Naidu" };

    private void seedOrganisation(String passwordHash) {
        String[][] deptDefs = { { "ENG", "Engineering" }, { "SALES", "Sales" }, { "FIN", "Finance" },
                { "HR", "Human Resources" }, { "OPS", "Operations" }, { "MKT", "Marketing" }, { "LEGAL", "Legal" },
                { "IT", "IT Services" } };
        for (String[] d : deptDefs) {
            depts.add(new Dept(ids.next(), d[0], d[1]));
        }
        Dept eng = dept("ENG");
        Dept fin = dept("FIN");

        SeedUser arjun = user("Arjun Shah", fin, null, Role.MANAGER, Role.FINANCE_HEAD);
        SeedUser kavya = user("Kavya Menon", fin, arjun.id(), Role.MANAGER, Role.FINANCE_HEAD);
        user("Meera Iyer", fin, kavya.id(), Role.AUDITOR);
        user("Rohan Das", fin, kavya.id(), Role.AUDITOR);
        user("Sneha Kapoor", fin, kavya.id(), Role.AUDITOR);

        Map<String, SeedUser> heads = new LinkedHashMap<>();
        heads.put("FIN", kavya);
        for (Dept d : depts) {
            if (!d.code().equals("FIN")) {
                heads.put(d.code(), user(randomName(), d, arjun.id(), Role.MANAGER));
            }
        }
        Map<String, List<SeedUser>> teamManagers = new LinkedHashMap<>();
        SeedUser ravi = user("Ravi Kumar", eng, heads.get("ENG").id(), Role.MANAGER);
        teamManagers.computeIfAbsent("ENG", k -> new ArrayList<>()).add(ravi);
        for (Dept d : depts) {
            int wanted = d.code().equals("FIN") ? 1 : 2;
            List<SeedUser> list = teamManagers.computeIfAbsent(d.code(), k -> new ArrayList<>());
            while (list.size() < wanted) {
                list.add(user(randomName(), d, heads.get(d.code()).id(), Role.MANAGER));
            }
        }
        user("Asha Verma", eng, ravi.id());
        int[] weights = { 30, 25, 6, 8, 18, 14, 6, 13 }; // ENG, SALES, FIN, HR, OPS, MKT, LEGAL, IT
        int total = 0;
        for (int w : weights) {
            total += w;
        }
        Map<String, Integer> rr = new HashMap<>();
        while (users.size() < 150) {
            int pick = rnd.nextInt(total);
            int i = 0;
            while (pick >= weights[i]) {
                pick -= weights[i++];
            }
            Dept d = depts.get(i);
            List<SeedUser> tms = teamManagers.get(d.code());
            int n = rr.merge(d.code(), 1, Integer::sum);
            user(randomName(), d, tms.get(n % tms.size()).id());
        }

        batch("INSERT INTO department (id, code, name) VALUES (?, ?, ?)",
                depts.stream().map(d -> new Object[] { d.id(), d.code(), d.name() }).toList());
        // Insert managers before reports (FK on manager_id): order by depth in the hierarchy.
        Instant joined = Instant.now().minus(400, ChronoUnit.DAYS);
        List<SeedUser> ordered = new ArrayList<>(users);
        ordered.sort(Comparator.comparingInt(this::depth));
        batch("""
                INSERT INTO app_user (id, email, full_name, employee_code, password_hash, department_id, manager_id,
                                      bank_account_number, ifsc_code, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ordered.stream().map(u -> new Object[] { u.id(), u.email(), u.fullName(), u.code(), passwordHash,
                        u.dept().id(), u.managerId(), u.bankAccount(), u.ifsc(), ts(joined), ts(joined) }).toList());
        List<Object[]> roles = new ArrayList<>();
        for (SeedUser u : users) {
            for (Role r : u.roles()) {
                roles.add(new Object[] { u.id(), r.name() });
            }
        }
        batch("INSERT INTO user_role (user_id, role) VALUES (?, ?)", roles);
    }

    private int depth(SeedUser u) {
        int d = 0;
        UUID m = u.managerId();
        while (m != null) {
            d++;
            m = byId.get(m).managerId();
        }
        return d;
    }

    private Dept dept(String code) {
        return depts.stream().filter(d -> d.code().equals(code)).findFirst().orElseThrow();
    }

    private String randomName() {
        while (true) {
            String name = FIRST[rnd.nextInt(FIRST.length)] + " " + LAST[rnd.nextInt(LAST.length)];
            if (!emails.contains(email(name))) {
                return name;
            }
        }
    }

    private static String email(String fullName) {
        return fullName.toLowerCase(java.util.Locale.ROOT).replace(' ', '.') + DOMAIN;
    }

    private SeedUser user(String fullName, Dept dept, UUID managerId, Role... extra) {
        Set<Role> roles = EnumSet.of(Role.EMPLOYEE);
        roles.addAll(List.of(extra));
        String email = email(fullName);
        if (!emails.add(email)) {
            throw new IllegalStateException("Duplicate seed email " + email);
        }
        String[] banks = { "HDFC0", "ICIC0", "SBIN0", "UTIB0", "KKBK0" };
        SeedUser u = new SeedUser(ids.next(), fullName, email, "E" + (1001 + users.size()), dept, managerId, roles,
                String.format("%012d", Math.abs(rnd.nextLong()) % 1_000_000_000_000L),
                banks[rnd.nextInt(banks.length)] + String.format("%06d", rnd.nextInt(1_000_000)));
        users.add(u);
        byId.put(u.id(), u);
        return u;
    }

    // ================================================================== claims

    private static final String[] CITIES = { "Mumbai", "Delhi", "Bengaluru", "Chennai", "Pune", "Hyderabad", "Kolkata",
            "Ahmedabad", "Jaipur", "Lucknow", "Kochi", "Indore", "Nagpur", "Coimbatore", "Chandigarh" };
    private static final Map<String, String[]> VENDORS = Map.of(
            "MEALS", new String[] { "Cafe Madras", "Haldiram's", "Saravana Bhavan", "Barbeque Nation", "Paradise Biryani",
                    "Mainland China", "Chai Point", "Cafe Coffee Day", "Swiggy", "Zomato" },
            "LOCAL_CAB", new String[] { "Uber", "Ola", "Rapido", "Meru Cabs", "BluSmart" },
            "HOTEL", new String[] { "Taj Hotels", "ITC Hotels", "Lemon Tree", "Ginger Hotels", "Treebo", "FabHotel",
                    "Novotel", "Hyatt Regency" },
            "AIRFARE", new String[] { "IndiGo", "Air India", "Vistara", "Akasa Air", "SpiceJet" },
            "TRAIN", new String[] { "IRCTC" },
            "OTHER", new String[] { "Staples India", "Amazon Business", "FedEx", "Croma", "Printo" });
    private static final String[] TITLES = { "Client visit - %s", "Team offsite - %s", "Conference - %s",
            "Customer workshop - %s", "Training - %s", "Vendor audit - %s", "Sales meeting - %s" };
    private static final String[] REJECT_REASONS = { "Personal expense, not reimbursable",
            "Trip was not pre-approved", "Duplicate of an expense already reimbursed", "Exceeds policy without justification" };
    private static final String[] SEND_BACK_COMMENTS = { "Please attach the itemised bill",
            "Which client was this for? Add the purpose", "Receipt is not readable, please re-upload",
            "Split the hotel and meals into separate lines" };

    record SLine(UUID id, int lineNo, String category, BigDecimal amount, LocalDate date, String vendor, String notes,
            String city, Integer nights, UUID receiptId, String receiptKey, String sha, String receiptName, int receiptSize) {
    }

    record SStep(UUID id, int seq, StepType type, Role role, UUID assignee, String status, Instant pendingSince,
            UUID sentBackBy, UUID actedBy, Instant actedAt, String comment) {
    }

    /** In-memory {@link PolicyEngine.History} over counted claims seeded so far. */
    final class MemoryHistory implements PolicyEngine.History {
        private final Map<String, BigDecimal> dayTotals = new HashMap<>();
        private final Map<String, Match> vendors = new HashMap<>();
        private final Map<String, Match> hashes = new HashMap<>();
        private final Map<UUID, List<SLine>> linesByEmployee = new HashMap<>();
        UUID employee;

        @Override
        public BigDecimal otherClaimsDayTotal(String category, LocalDate date) {
            return dayTotals.getOrDefault(employee + "|" + category + "|" + date, BigDecimal.ZERO);
        }

        @Override
        public Optional<Match> vendorDuplicate(String vendorKey, BigDecimal amount, LocalDate date, Instant before) {
            return Optional.ofNullable(vendors.get(employee + "|" + vendorKey + "|" + amount.toPlainString() + "|" + date));
        }

        @Override
        public Optional<Match> receiptDuplicate(String sha256, Instant before) {
            return Optional.ofNullable(hashes.get(sha256));
        }

        void add(UUID emp, UUID claimId, String claimNumber, List<SLine> lines) {
            for (SLine l : lines) {
                dayTotals.merge(emp + "|" + l.category() + "|" + l.date(), l.amount(), BigDecimal::add);
                vendors.putIfAbsent(emp + "|" + key(l.vendor()) + "|" + l.amount().toPlainString() + "|" + l.date(),
                        new Match(claimId, claimNumber, l.id(), l.lineNo(), emp));
                if (l.sha() != null) {
                    hashes.putIfAbsent(l.sha(), new Match(claimId, claimNumber, l.id(), l.lineNo(), emp));
                }
            }
            linesByEmployee.computeIfAbsent(emp, k -> new ArrayList<>()).addAll(lines);
        }
    }

    // Batches collected during generation, written at the end.
    private final List<Object[]> claimRows = new ArrayList<>();
    private final List<Object[]> lineRows = new ArrayList<>();
    private final List<Object[]> receiptRows = new ArrayList<>();
    private final List<Object[]> findingRows = new ArrayList<>();
    private final List<Object[]> stepRows = new ArrayList<>();
    private final List<Object[]> auditRows = new ArrayList<>();
    private final List<int[]> sampleBlocks = new ArrayList<>(); // {target, filled}
    private final List<String> allReceiptLabels = new ArrayList<>();

    /** Claims eligible for payout: claimId → (owner, total, decidedAt, statusBefore). */
    record Payable(UUID claimId, SeedUser owner, BigDecimal total, Instant decidedAt, ClaimStatus status) {
    }

    private final List<Payable> payables = new ArrayList<>();

    private void seed() {
        String hash = passwords.encode(userPassword);
        seedOrganisation(hash);
        PolicyVersion policy = policies.current();
        if (claimCount > 0) {
            seedClaims(policy);
        }
        log.info("Seeded {} departments, {} users, {} claims", depts.size(), users.size(), claimCount);
    }

    private void seedClaims(PolicyVersion policy) {
        LocalDate today = Money.today();
        Instant now = Instant.now();
        MemoryHistory history = new MemoryHistory();
        List<SeedUser> filers = users;
        List<SeedUser> auditors = users.stream().filter(u -> u.has(Role.AUDITOR)).toList();
        List<SeedUser> heads = users.stream().filter(u -> u.has(Role.FINANCE_HEAD)).toList();

        // Submit instants, oldest first, between 330 and 15 days ago (expense dates stay at least 15 days old,
        // so live demo/test claims with recent dates never collide with seeded history).
        List<Instant> times = new ArrayList<>();
        for (int i = 0; i < claimCount; i++) {
            LocalDate day = today.minusDays(15 + rnd.nextInt(316));
            times.add(day.atTime(LocalTime.of(9 + rnd.nextInt(9), rnd.nextInt(60))).atZone(Money.BUSINESS_ZONE).toInstant());
        }
        times.sort(Comparator.naturalOrder());

        for (int n = 0; n < claimCount; n++) {
            Instant submitted = times.get(n);
            LocalDate submitDay = submitted.atZone(Money.BUSINESS_ZONE).toLocalDate();
            SeedUser owner = filers.get(rnd.nextInt(filers.size()));
            UUID claimId = ids.next();
            String claimNumber = String.format("CL-%06d", n + 1);
            Instant created = submitted.minus(2 + rnd.nextInt(48), ChronoUnit.HOURS);
            boolean big = rnd.nextDouble() < 0.06;
            LocalDate tripEnd = submitDay.minusDays(1 + rnd.nextInt(6));
            LocalDate tripStart = tripEnd.minusDays(big ? 2 + rnd.nextInt(5) : rnd.nextInt(3));
            String city = CITIES[rnd.nextInt(CITIES.length)];
            String title = String.format(TITLES[rnd.nextInt(TITLES.length)], city);

            List<SLine> lines = generateLines(owner, history, big, tripStart, tripEnd, city, rnd.nextDouble());
            BigDecimal total = lines.stream().map(SLine::amount).reduce(BigDecimal.ZERO, BigDecimal::add);

            boolean draft = rnd.nextDouble() < 0.04;
            List<Object[]> audit = new ArrayList<>();
            audit.add(auditRow(created, owner.id(), null, "CLAIM_CREATED", claimId, null, "DRAFT", null,
                    Map.of("title", title, "lineCount", lines.size())));

            if (draft) {
                writeLines(claimId, owner, lines, created, null, null, Map.of());
                claimRows.add(claimRow(claimId, claimNumber, owner, title, tripStart, tripEnd, ClaimStatus.DRAFT, total, 0,
                        null, null, null, false, null, null, null, null, null, null, created, created));
                auditRows.addAll(audit);
                continue;
            }

            // ---- policy engine (same code as live submits)
            history.employee = owner.id();
            List<LineInput> inputs = lines.stream().map(l -> new LineInput(l.id(), l.lineNo(), l.category(), l.amount(),
                    l.date(), key(l.vendor()), l.city(), l.nights(), l.sha(), created)).toList();
            List<LineResult> results = PolicyEngine.evaluate(policy, owner.id(), claimId, claimNumber, inputs, inputs, history);
            Map<UUID, LineResult> byLine = results.stream().collect(Collectors.toMap(LineResult::lineId, r -> r));
            PolicyOutcome worst = results.stream().map(LineResult::outcome).reduce(PolicyOutcome.AUTO_APPROVE, PolicyOutcome::worst);
            Optional<Finding> claimTotal = PolicyEngine.claimTotalFinding(policy, worst, total);
            PolicyOutcome outcome = claimTotal.isPresent() ? worst.worst(PolicyOutcome.ROUTE) : worst;
            writeLines(claimId, owner, lines, created, submitted, policy, byLine);
            claimTotal.ifPresent(f -> findingRows.add(findingRow(claimId, null, policy, f, submitted)));

            audit.add(auditRow(submitted, owner.id(), null, "SUBMITTED", claimId, "DRAFT", "SUBMITTED", null,
                    Map.of("policyVersionNo", policy.versionNo(), "submissionNo", 1)));
            audit.add(auditRow(submitted, owner.id(), null, "POLICY_EVALUATED", claimId, null, null, null,
                    Map.of("policyVersionNo", policy.versionNo(), "evaluatedLines", lines.size(), "outcome", outcome.name())));

            ClaimStatus status;
            String reason = null;
            Instant decided = null;
            boolean sampled = false;
            String sampleStatus = null;
            UUID sampleBy = null;
            Instant sampleAt = null;
            Instant updated = submitted;
            long ageDays = ChronoUnit.DAYS.between(submitDay, today);

            if (worst == PolicyOutcome.AUTO_REJECT) {
                status = ClaimStatus.AUTO_REJECTED;
                decided = submitted;
                reason = results.stream().flatMap(r -> r.findings().stream()
                        .filter(f -> f.outcome() == PolicyOutcome.AUTO_REJECT)
                        .map(f -> "Line " + lineNo(lines, r.lineId()) + ": " + f.message()))
                        .sorted().collect(Collectors.joining("; "));
                audit.add(auditRow(submitted, owner.id(), null, "AUTO_REJECTED", claimId, "SUBMITTED", "AUTO_REJECTED", reason, null));
            } else if (outcome == PolicyOutcome.AUTO_APPROVE) {
                status = ClaimStatus.AUTO_APPROVED;
                decided = submitted;
                audit.add(auditRow(submitted, owner.id(), null, "AUTO_APPROVED", claimId, "SUBMITTED", "AUTO_APPROVED", null, null));
                sampled = nextSample(policy.sampleAuditPercent());
                if (sampled) {
                    audit.add(auditRow(submitted, owner.id(), null, "SAMPLE_AUDIT_SELECTED", claimId, null, null, null, null));
                    SeedUser auditor = pick(auditors, owner);
                    if (ageDays > 20) {
                        sampleStatus = "CLEARED";
                        sampleBy = auditor.id();
                        sampleAt = submitted.plus(6 + rnd.nextInt(14), ChronoUnit.HOURS);
                        stepRows.add(stepRow(new SStep(ids.next(), 1, StepType.SAMPLE_AUDIT, Role.AUDITOR, null, "APPROVED",
                                null, null, auditor.id(), sampleAt, "Receipts match"), claimId));
                        audit.add(auditRow(sampleAt, auditor.id(), null, "SAMPLE_AUDIT_CLEARED", claimId, "AUTO_APPROVED",
                                "AUTO_APPROVED", "Receipts match", Map.of("stepType", "SAMPLE_AUDIT")));
                        updated = sampleAt;
                    } else {
                        sampleStatus = "PENDING";
                        stepRows.add(stepRow(new SStep(ids.next(), 1, StepType.SAMPLE_AUDIT, Role.AUDITOR, null, "PENDING",
                                submitted, null, null, null, null), claimId));
                    }
                }
                if (!"PENDING".equals(sampleStatus)) {
                    payables.add(new Payable(claimId, owner, total, sampleAt != null ? sampleAt : decided, status));
                }
            } else {
                // ---- routed: build the chain and decide how far it got
                List<StepType> chain = new ArrayList<>(List.of(StepType.MANAGER));
                if (total.compareTo(policy.auditorAboveTotal()) > 0) {
                    chain.add(StepType.AUDITOR);
                }
                if (total.compareTo(policy.financeHeadAboveTotal()) > 0) {
                    chain.add(StepType.FINANCE_HEAD);
                }
                String fate;
                int at;
                double r = rnd.nextDouble();
                if (ageDays <= 10) {
                    fate = "PENDING";
                    at = rnd.nextInt(chain.size());
                } else if (r < 0.07) {
                    fate = "REJECTED";
                    at = rnd.nextInt(chain.size());
                } else if (r < 0.10 && ageDays <= 45) {
                    fate = "SENT_BACK";
                    at = rnd.nextInt(chain.size());
                } else if (r < 0.12) {
                    fate = "PENDING";
                    at = rnd.nextInt(chain.size());
                } else {
                    fate = "APPROVED";
                    at = chain.size();
                }
                audit.add(auditRow(submitted, owner.id(), null, "ROUTED", claimId, "SUBMITTED", "PENDING_MANAGER", null,
                        Map.of("steps", chain.stream().map(Enum::name).toList())));
                Instant t = submitted;
                ClaimStatus current = ClaimStatus.PENDING_MANAGER;
                status = current;
                for (int i = 0; i < chain.size(); i++) {
                    StepType type = chain.get(i);
                    UUID assignee = null;
                    Role role = type == StepType.AUDITOR ? Role.AUDITOR : type == StepType.FINANCE_HEAD ? Role.FINANCE_HEAD : Role.MANAGER;
                    SeedUser actor;
                    if (type == StepType.MANAGER && owner.managerId() != null) {
                        assignee = owner.managerId();
                        actor = byId.get(assignee);
                    } else if (type == StepType.MANAGER) {
                        role = Role.FINANCE_HEAD; // owner with no manager → finance-head pool (D6)
                        actor = pick(heads, owner);
                    } else {
                        actor = pick(type == StepType.AUDITOR ? auditors : heads, owner);
                    }
                    Instant pendingSince = t;
                    if (i < at) {
                        t = t.plus(4 + rnd.nextInt(60), ChronoUnit.HOURS);
                        String comment = rnd.nextDouble() < 0.3 ? "Looks fine" : null;
                        stepRows.add(stepRow(new SStep(ids.next(), i + 1, type, role, assignee, "APPROVED", pendingSince, null,
                                actor.id(), t, comment), claimId));
                        ClaimStatus next = i + 1 < chain.size() ? ClaimStatus.pendingFor(chain.get(i + 1)) : ClaimStatus.APPROVED;
                        audit.add(auditRow(t, actor.id(), null, "APPROVED", claimId, current.name(), next.name(), comment,
                                Map.of("stepType", type.name())));
                        current = next;
                    } else if (i == at && fate.equals("PENDING")) {
                        stepRows.add(stepRow(new SStep(ids.next(), i + 1, type, role, assignee, "PENDING", pendingSince, null,
                                null, null, null), claimId));
                    } else if (i == at && fate.equals("REJECTED")) {
                        t = t.plus(4 + rnd.nextInt(60), ChronoUnit.HOURS);
                        reason = REJECT_REASONS[rnd.nextInt(REJECT_REASONS.length)];
                        stepRows.add(stepRow(new SStep(ids.next(), i + 1, type, role, assignee, "REJECTED", pendingSince, null,
                                actor.id(), t, reason), claimId));
                        audit.add(auditRow(t, actor.id(), null, "REJECTED", claimId, current.name(), "REJECTED", reason,
                                Map.of("stepType", type.name())));
                        current = ClaimStatus.REJECTED;
                        decided = t;
                    } else if (i == at && fate.equals("SENT_BACK")) {
                        t = t.plus(4 + rnd.nextInt(60), ChronoUnit.HOURS);
                        String comment = SEND_BACK_COMMENTS[rnd.nextInt(SEND_BACK_COMMENTS.length)];
                        stepRows.add(stepRow(new SStep(ids.next(), i + 1, type, role, assignee, "SENT_BACK", pendingSince,
                                actor.id(), actor.id(), t, comment), claimId));
                        audit.add(auditRow(t, actor.id(), null, "SENT_BACK", claimId, current.name(), "SENT_BACK", comment,
                                Map.of("stepType", type.name())));
                        current = ClaimStatus.SENT_BACK;
                    } else {
                        String st = fate.equals("REJECTED") ? "CANCELLED" : "WAITING";
                        stepRows.add(stepRow(new SStep(ids.next(), i + 1, type, role, null, st, null, null, null, null, null),
                                claimId));
                    }
                }
                status = current;
                updated = t;
                if (status == ClaimStatus.APPROVED) {
                    decided = t;
                    payables.add(new Payable(claimId, owner, total, t, status));
                }
            }

            claimRows.add(claimRow(claimId, claimNumber, owner, title, tripStart, tripEnd, status, total, 1, policy.id(),
                    outcome, reason, sampled, sampleStatus, sampleBy, sampleAt, submitted, decided, null, created, updated));
            auditRows.addAll(audit);
            if (status != ClaimStatus.AUTO_REJECTED && status != ClaimStatus.REJECTED) {
                history.add(owner.id(), claimId, claimNumber, lines);
            }
        }
        seedPayouts(today, now);
        flush();
    }

    private int lineNo(List<SLine> lines, UUID id) {
        return lines.stream().filter(l -> l.id().equals(id)).findFirst().map(SLine::lineNo).orElse(0);
    }

    private SeedUser pick(List<SeedUser> pool, SeedUser except) {
        List<SeedUser> candidates = pool.stream().filter(u -> !u.id().equals(except.id())).toList();
        return candidates.get(rnd.nextInt(candidates.size()));
    }

    /** Same rule as SampleAuditSampler: one random position per block of 100 / percent. */
    private boolean nextSample(int percent) {
        int size = Math.max(1, 100 / percent);
        if (sampleBlocks.isEmpty() || sampleBlocks.get(sampleBlocks.size() - 1)[1] >= size) {
            sampleBlocks.add(new int[] { 1 + rnd.nextInt(size), 0 });
        }
        int[] block = sampleBlocks.get(sampleBlocks.size() - 1);
        block[1]++;
        return block[1] == block[0];
    }

    private List<SLine> generateLines(SeedUser owner, MemoryHistory history, boolean big, LocalDate start, LocalDate end,
            String city, double plant) {
        int count = big ? 3 + rnd.nextInt(3) : weighted(new int[] { 30, 35, 25, 10 }) + 1;
        List<SLine> lines = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            String category = big && i == 0 ? "AIRFARE" : big && i == 1 ? "HOTEL"
                    : new String[] { "MEALS", "LOCAL_CAB", "HOTEL", "AIRFARE", "TRAIN", "OTHER" }[weighted(new int[] { 35, 25, 18, 8, 8, 6 })];
            LocalDate date = pickDate(start, end);
            String vendor = VENDORS.get(category)[rnd.nextInt(VENDORS.get(category).length)];
            String lineCity = null;
            Integer nights = null;
            BigDecimal amount;
            double breach = rnd.nextDouble();
            switch (category) {
                case "MEALS" -> amount = breach < 0.006 ? amt(3100, 4200) : breach < 0.02 ? amt(1550, 2900) : amt(150, 900);
                case "LOCAL_CAB" -> amount = breach < 0.007 ? amt(4100, 5200) : breach < 0.03 ? amt(2050, 3900) : amt(120, 1500);
                case "HOTEL" -> {
                    lineCity = rnd.nextDouble() < 0.6 ? CITIES[rnd.nextInt(8)] : CITIES[8 + rnd.nextInt(CITIES.length - 8)];
                    nights = big ? 3 + rnd.nextInt(4) : 1 + rnd.nextInt(3);
                    boolean tier1 = List.of("Mumbai", "Delhi", "Bengaluru", "Chennai", "Pune", "Hyderabad", "Kolkata", "Ahmedabad")
                            .contains(lineCity);
                    int cap = tier1 ? 6000 : 4000;
                    BigDecimal perNight = breach < 0.007 ? amt(cap * 2 + 100, cap * 2 + 2500)
                            : breach < 0.035 ? amt(cap + 100, cap * 2 - 100) : amt(cap / 2, cap - 200);
                    amount = perNight.multiply(BigDecimal.valueOf(nights));
                }
                case "AIRFARE" -> amount = big ? amt(30000, 95000) : amt(3500, 16000);
                case "TRAIN" -> amount = amt(400, 3500);
                default -> amount = amt(150, 2500);
            }
            lines.add(line(i + 1, category, amount, date, vendor, lineCity, nights));
        }
        // Planted duplicates: same vendor+amount+date as an earlier line of the same employee (→ ROUTE),
        // or the same receipt file as an earlier receipt of anyone (→ AUTO_REJECTED).
        List<SLine> earlier = history.linesByEmployee.getOrDefault(owner.id(), List.of());
        if (plant < 0.025 && !earlier.isEmpty()) {
            SLine src = earlier.get(rnd.nextInt(earlier.size()));
            lines.set(0, line(1, src.category(), src.amount(), src.date(), src.vendor(), src.city(), src.nights()));
        } else if (plant < 0.035 && !allReceiptLabels.isEmpty()) {
            SLine first = lines.get(0);
            String label = allReceiptLabels.get(rnd.nextInt(allReceiptLabels.size()));
            lines.set(0, withReceipt(first, label));
        }
        return lines;
    }

    private SLine line(int lineNo, String category, BigDecimal amount, LocalDate date, String vendor, String city, Integer nights) {
        UUID id = ids.next();
        boolean receipt = amount.compareTo(new BigDecimal("500.00")) > 0 || rnd.nextDouble() < 0.6;
        SLine l = new SLine(id, lineNo, category, Money.scale(amount), date, vendor,
                rnd.nextDouble() < 0.3 ? "Business " + category.toLowerCase(java.util.Locale.ROOT).replace('_', ' ') : null,
                city, nights, null, null, null, null, 0);
        if (!receipt) {
            return l;
        }
        String label = vendor + " " + Money.format(amount) + " " + date + " " + id.toString().substring(0, 8);
        allReceiptLabels.add(label);
        return withReceipt(l, label);
    }

    private SLine withReceipt(SLine l, String label) {
        byte[] pdf = ReceiptStorage.SeedReceipts.pdf(label);
        UUID receiptId = ids.next();
        String safe = label.replaceAll("[^A-Za-z0-9 .,:/#-]", " ");
        return new SLine(l.id(), l.lineNo(), l.category(), l.amount(), l.date(), l.vendor(), l.notes(), l.city(), l.nights(),
                receiptId, ReceiptStorage.SEED_PREFIX + safe + "#" + receiptId, ReceiptService.sha256(pdf),
                "receipt-" + l.vendor().toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9]+", "-") + ".pdf", pdf.length);
    }

    private LocalDate pickDate(LocalDate start, LocalDate end) {
        long span = ChronoUnit.DAYS.between(start, end);
        LocalDate d = start.plusDays(span <= 0 ? 0 : rnd.nextInt((int) span + 1));
        // Mostly weekdays: three in four weekend dates move to the Friday before.
        if ((d.getDayOfWeek() == DayOfWeek.SATURDAY || d.getDayOfWeek() == DayOfWeek.SUNDAY) && rnd.nextDouble() < 0.75) {
            d = d.minusDays(d.getDayOfWeek() == DayOfWeek.SATURDAY ? 1 : 2);
        }
        return d;
    }

    private BigDecimal amt(int min, int max) {
        int rupees = min + rnd.nextInt(Math.max(1, max - min + 1));
        int paise = rnd.nextDouble() < 0.7 ? 0 : rnd.nextInt(100);
        return BigDecimal.valueOf(rupees * 100L + paise, 2);
    }

    private int weighted(int[] weights) {
        int total = 0;
        for (int w : weights) {
            total += w;
        }
        int pick = rnd.nextInt(total);
        int i = 0;
        while (pick >= weights[i]) {
            pick -= weights[i++];
        }
        return i;
    }

    private static String key(String vendor) {
        return vendor.strip().replaceAll("\\s+", " ").toLowerCase(java.util.Locale.ROOT);
    }

    // ================================================================== payouts

    private void seedPayouts(LocalDate today, Instant now) {
        SeedUser head = users.get(0); // Arjun Shah, finance head
        Map<YearMonth, List<Payable>> paid = new TreeMap<>();
        List<Payable> inBatch = new ArrayList<>();
        for (Payable p : payables) {
            long days = Duration.between(p.decidedAt(), now).toDays();
            if (days > 30) {
                paid.computeIfAbsent(YearMonth.from(p.decidedAt().atZone(Money.BUSINESS_ZONE)), k -> new ArrayList<>()).add(p);
            } else if (days >= 12) {
                inBatch.add(p);
            }
        }
        List<Object[]> batches = new ArrayList<>();
        List<Object[]> items = new ArrayList<>();
        Map<UUID, Object[]> claimUpdates = new HashMap<>();
        int batchNo = 0;
        for (List<Payable> group : paid.values()) {
            batchNo++;
            writeBatch(group, head, batchNo, true, batches, items, claimUpdates);
        }
        if (!inBatch.isEmpty()) {
            batchNo++;
            writeBatch(inBatch, head, batchNo, false, batches, items, claimUpdates);
        }
        batch("""
                INSERT INTO payout_batch (id, batch_number, status, claim_count, total_amount, created_by, created_at,
                                          exported_at, paid_at, paid_by, bank_reference)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", batches);
        // Claims reference batches; update the pending claim rows before they are written.
        for (int i = 0; i < claimRows.size(); i++) {
            Object[] row = claimRows.get(i);
            Object[] upd = claimUpdates.get((UUID) row[0]);
            if (upd != null) {
                row[8] = upd[0];   // status
                row[23] = upd[1];  // payout_batch_id
                row[24] = upd[2];  // paid_at
                row[26] = upd[3];  // updated_at
            }
        }
        payoutItems = items;
    }

    private List<Object[]> payoutItems = List.of();

    private void writeBatch(List<Payable> group, SeedUser head, int batchNo, boolean paid, List<Object[]> batches,
            List<Object[]> items, Map<UUID, Object[]> claimUpdates) {
        UUID batchId = ids.next();
        Instant latest = group.stream().map(Payable::decidedAt).max(Comparator.naturalOrder()).orElseThrow();
        Instant createdAt = latest.plus(1, ChronoUnit.DAYS);
        Instant exportedAt = createdAt.plus(1, ChronoUnit.HOURS);
        Instant paidAt = paid ? createdAt.plus(2, ChronoUnit.DAYS) : null;
        BigDecimal total = group.stream().map(Payable::total).reduce(BigDecimal.ZERO, BigDecimal::add);
        String number = String.format("PAY-%d-%04d", createdAt.atZone(Money.BUSINESS_ZONE).getYear(), batchNo);
        batches.add(new Object[] { batchId, number, paid ? "PAID" : "EXPORTED", group.size(), total, head.id(),
                ts(createdAt), ts(exportedAt), ts(paidAt), paid ? head.id() : null,
                paid ? String.format("UTR%s%06d", createdAt.atZone(Money.BUSINESS_ZONE).toLocalDate().toString().replace("-", ""), batchNo) : null });
        auditRows.add(new Object[] { ts(createdAt), head.id(), null, "PAYOUT_BATCH_CREATED", "PAYOUT_BATCH", batchId.toString(),
                null, null, "CREATED", null, details(Map.of("batchNumber", number, "claimCount", group.size())) });
        auditRows.add(new Object[] { ts(exportedAt), head.id(), null, "PAYOUT_EXPORTED", "PAYOUT_BATCH", batchId.toString(),
                null, "CREATED", "EXPORTED", null, null });
        if (paid) {
            auditRows.add(new Object[] { ts(paidAt), head.id(), null, "PAYOUT_PAID", "PAYOUT_BATCH", batchId.toString(),
                    null, "EXPORTED", "PAID", null, null });
        }
        for (Payable p : group) {
            items.add(new Object[] { ids.next(), batchId, p.claimId(), p.owner().id(), p.total(), p.owner().bankAccount(),
                    p.owner().ifsc() });
            auditRows.add(auditRow(exportedAt, head.id(), null, "PAYOUT_EXPORTED", p.claimId(), p.status().name(), "IN_BATCH",
                    null, Map.of("batchNumber", number)));
            if (paid) {
                auditRows.add(auditRow(paidAt, head.id(), null, "PAYOUT_PAID", p.claimId(), "IN_BATCH", "PAID", null,
                        Map.of("batchNumber", number)));
            }
            claimUpdates.put(p.claimId(), new Object[] { paid ? "PAID" : "IN_BATCH", batchId, ts(paidAt),
                    ts(paid ? paidAt : exportedAt) });
        }
    }

    // ================================================================== rows

    private void writeLines(UUID claimId, SeedUser owner, List<SLine> lines, Instant created, Instant evaluated,
            PolicyVersion policy, Map<UUID, LineResult> results) {
        for (SLine l : lines) {
            LineResult r = results.get(l.id());
            lineRows.add(new Object[] { l.id(), claimId, owner.id(), l.lineNo(), l.category(), l.amount(), l.date(),
                    l.vendor(), l.notes(), l.city(), l.nights(), r == null ? null : r.outcome().name(),
                    r == null ? null : policy.id(), ts(r == null ? null : evaluated), r == null, ts(created), ts(created) });
            if (l.receiptId() != null) {
                receiptRows.add(new Object[] { l.receiptId(), l.id(), l.receiptKey(), l.receiptName(), "application/pdf",
                        l.receiptSize(), l.sha(), owner.id(), ts(created) });
            }
            if (r != null) {
                for (Finding f : r.findings()) {
                    findingRows.add(findingRow(claimId, l.id(), policy, f, evaluated));
                }
            }
        }
    }

    private Object[] findingRow(UUID claimId, UUID lineId, PolicyVersion policy, Finding f, Instant at) {
        return new Object[] { ids.next(), claimId, lineId, policy.id(), f.ruleCode(), f.ruleName(), f.reasonCode(),
                f.outcome().name(), f.message().length() > 500 ? f.message().substring(0, 500) : f.message(),
                f.limitType(), f.unit(), f.limit(), f.actual(), f.excess(),
                f.matched() == null ? null : f.matched().claimId(), f.matched() == null ? null : f.matched().lineId(), ts(at) };
    }

    private Object[] stepRow(SStep s, UUID claimId) {
        return new Object[] { s.id(), claimId, s.seq(), s.type().name(), s.role().name(), s.assignee(), s.status(),
                ts(s.pendingSince()), s.sentBackBy(), s.actedBy(), ts(s.actedAt()), s.comment() };
    }

    private Object[] claimRow(UUID id, String number, SeedUser owner, String title, LocalDate tripStart, LocalDate tripEnd,
            ClaimStatus status, BigDecimal total, int submissionNo, UUID policyVersionId, PolicyOutcome outcome,
            String reason, boolean sampled, String sampleStatus, UUID sampleBy, Instant sampleAt, Instant submitted,
            Instant decided, UUID batchId, Instant created, Instant updated) {
        return new Object[] { id, number, owner.id(), owner.dept().id(), title, "Business travel and client work",
                tripStart, tripEnd, status.name(), Money.scale(total), submissionNo, policyVersionId,
                outcome == null ? null : outcome.name(),
                reason == null ? null : reason.length() > 2000 ? reason.substring(0, 1997) + "..." : reason,
                sampled, sampleStatus, sampleBy, ts(sampleAt), ts(submitted), ts(decided), ts(created), 0,
                null /* 22 unused */, batchId, null /* paid_at */, null, ts(updated) };
    }

    private Object[] auditRow(Instant at, UUID actor, UUID obo, String action, UUID claimId, String from, String to,
            String comment, Map<String, ?> details) {
        return new Object[] { ts(at), actor, obo, action, "CLAIM", claimId.toString(), claimId, from, to,
                comment == null ? null : comment.length() > 2000 ? comment.substring(0, 2000) : comment, details(details) };
    }

    private String details(Map<String, ?> map) {
        return map == null ? null : json.writeValueAsString(map);
    }

    private void flush() {
        batch("""
                INSERT INTO expense_claim (id, claim_number, employee_id, department_id, title, purpose, trip_start_date,
                    trip_end_date, status, total_amount, submission_no, policy_version_id, policy_outcome, decision_reason,
                    sample_audit, sample_audit_status, sample_audited_by, sample_audited_at, submitted_at, decided_at,
                    created_at, version, payout_batch_id, paid_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                claimRows.stream().map(r -> new Object[] { r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9],
                        r[10], r[11], r[12], r[13], r[14], r[15], r[16], r[17], r[18], r[19], r[20], r[21], r[23], r[24],
                        r[26] }).toList());
        batch("""
                INSERT INTO expense_line (id, claim_id, employee_id, line_no, category, amount, expense_date, vendor, notes,
                    city, nights, policy_outcome, evaluated_policy_version_id, evaluated_at, needs_evaluation, created_at,
                    updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", lineRows);
        batch("""
                INSERT INTO receipt (id, line_id, storage_key, file_name, content_type, size_bytes, sha256, uploaded_by,
                    uploaded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", receiptRows);
        batch("""
                INSERT INTO policy_finding (id, claim_id, line_id, policy_version_id, rule_code, rule_name, reason_code,
                    outcome, message, limit_type, unit, limit_value, actual_value, excess_value, matched_claim_id,
                    matched_line_id, evaluated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", findingRows);
        batch("""
                INSERT INTO approval_step (id, claim_id, sequence, step_type, required_role, assignee_id, status,
                    pending_since, sent_back_by, acted_by, acted_at, comment)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", stepRows);
        batch("""
                INSERT INTO payout_item (id, batch_id, claim_id, employee_id, amount, bank_account_number, ifsc_code)
                VALUES (?, ?, ?, ?, ?, ?, ?)""", payoutItems);
        auditRows.sort(Comparator.comparing(r -> (Timestamp) r[0]));
        batch("""
                INSERT INTO audit_event (occurred_at, actor_id, on_behalf_of_id, action, entity_type, entity_id, claim_id,
                    from_status, to_status, comment, details)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb))""", auditRows);
        List<Object[]> blocks = new ArrayList<>();
        for (int i = 0; i < sampleBlocks.size(); i++) {
            blocks.add(new Object[] { i + 1, sampleBlocks.get(i)[0], sampleBlocks.get(i)[1] });
        }
        batch("INSERT INTO sample_audit_block (block_no, target_position, filled) VALUES (?, ?, ?)", blocks);
        jdbc.execute("SELECT setval('claim_number_seq', " + Math.max(1, claimRows.size()) + ")");
    }

    /**
     * Writes rows in chunks of {@value #CHUNK}. Smaller round trips keep one huge batch from stalling on a slow
     * link (seen with Docker Desktop's port proxy on Windows).
     */
    private void batch(String sql, List<Object[]> rows) {
        for (int from = 0; from < rows.size(); from += CHUNK) {
            jdbc.batchUpdate(sql, rows.subList(from, Math.min(rows.size(), from + CHUNK)));
        }
    }

    private static final int CHUNK = 500;

    private static Timestamp ts(Instant i) {
        return i == null ? null : Timestamp.from(i);
    }
}
