# Testing

## Strategy

| Layer | What | Where | Runs in |
|---|---|---|---|
| Unit | Every policy rule: meals per day (soft/hard, day total across claims and lines), hotel per night by city tier, cab per trip, weekend flag on/off, no-rule category, vendor and receipt duplicates (same vs other employee), claim total, worst-finding outcome | `backend/src/test/java/.../policy/PolicyEngineTest.java` | `mvnw verify` (surefire) |
| Integration (API) | One test per acceptance criterion, named after it, against the real app and a real PostgreSQL (Testcontainers) with the full 3,000-claim seed | `*IT.java` (see `docs/api/ac-traceability.md` for AC → test) | `mvnw verify` (failsafe) |
| Concurrency | Parallel requests released together: two approvers on one step, the same claim in two batches, a double submit, bulk vs single approve (each repeated 3 times) | `ConcurrencyIT` | `mvnw verify` |
| Alert rules | `OldestPendingApprovalTooOld` fires once per breach, stays firing, follows the configured threshold | `deploy/prometheus/alert-rules.test.yml` (promtool) | CI, `docs/runbook.md` |
| Smoke / E2E | The 10 cases below against `docker compose` from scratch | Phase 6 smoke script, results in the delivery notes | Manually, per release |

Rules: never weaken or delete a test to make it pass. Tests share one database, so use `freshEmployee()` and recent dates. Only `PolicyConfigIT` (ordered last) changes the policy.

## 10 end-to-end cases

Each case runs on a fresh stack (`docker compose down -v && docker compose up --build -d`) with the demo accounts from `docs/demo-accounts.md`. "Automated by" names the integration test that checks the same behaviour through the API.

| # | Case | Steps | Expected | Automated by |
|---|---|---|---|---|
| E2E-1 | Sign in per role | Log in as Asha, Ravi, Meera, Arjun; then with a wrong password | 200 with home screens E1, M1, A1, F1; wrong password → 401 "Email or password is incorrect" | `AuthIT` |
| E2E-2 | Clean claim auto-approves | Asha files meals 420.00 on a weekday, submits | `AUTO_APPROVED`; line shows "Meals per day", limit 1500.00, excess 0.00 | `SubmitPolicyIT.cleanClaimWithinLimitsAndAtMost25000IsAutoApproved` |
| E2E-3 | Receipt blocks submit | Asha adds a line above 500 without a receipt, submits; then uploads one and submits | 422 naming the line; then accepted | `SubmitPolicyIT.US1_AC4_...` |
| E2E-4 | Over-limit routes to the manager | Asha files Mumbai hotel 13,200 for 2 nights; Ravi approves from his inbox | `PENDING_MANAGER` with limit 6000.00 / excess 600.00; then `APPROVED` by Ravi | `SubmitPolicyIT.overSoftLimit...`, `ApprovalChainIT.US5_AC2_...` |
| E2E-5 | Above 25,000 → auditor | Claim of 30,000: Ravi approves, then Meera | `PENDING_AUDITOR` after Ravi, `APPROVED` after Meera | `ApprovalChainIT.US8_AC1_...` |
| E2E-6 | Above 1,00,000 → finance head | Claim of 1,20,000: Ravi, Meera, Arjun approve | `PENDING_AUDITOR` → `PENDING_FINANCE_HEAD` → `APPROVED` | `ApprovalChainIT.US12_AC1_...` |
| E2E-7 | Send back and reply | Ravi sends back with a comment; Asha replies and resubmits | `SENT_BACK` with the comment; resubmit returns to Ravi; history and comments show both | `ApprovalChainIT.US4_AC1_...`, `US4_AC2_...` |
| E2E-8 | Auditor bulk approve with a failing row | Meera bulk-approves two auditor-stage claims plus an unknown id | 200: two SUCCEEDED, one FAILED (404) with a reason | `AuditorIT.US9_AC2_US9_AC3_...` |
| E2E-9 | Sample audit | Submit clean claims until one is tagged; Meera clears it in A4 | Tagged claim only in A4 (not A1); after clearing, `CLEARED` by Meera with a time, and payout-eligible | `AuditorIT.US11_*`, `PayoutIT.US13_AC1_...` |
| E2E-10 | Payout | Arjun batches approved claims, exports the CSV, marks paid without and then with confirm, then again | CSV in the bank-file format; claims `IN_BATCH`; 400 without confirm; `PAID` and owners notified; second mark-paid 409 | `PayoutIT.US13_*`, `US14_*`, `NotificationIT` |

## Defect log

Defects found while building, with cause, fix and the test that now guards each one.

| # | Found | Symptom | Cause | Fix | Guarded by |
|---|---|---|---|---|---|
| D-01 | AuthIT | `Arjun.Shah@...` couldn't sign in | `citext = text` parameter falls back to case-sensitive text equality | Cast the parameter: `email = CAST(:email AS citext)` | `AuthIT.W1_loginWithEmailAndPassword...` |
| D-02 | Code review | SQL like `...ANDc.status` / `::dateBETWEEN` | Java text blocks strip trailing spaces before `"""`, so concatenated fragments lost their separator | Fragments `COUNTED` and `TODAY` padded with spaces; comment added | All submit / inbox ITs |
| D-03 | First full test run | Seeder hung writing a batch; Postgres in `ClientRead`, client blocked on socket write | One large batch stalled through Docker Desktop's port proxy on Windows | Seeder writes in chunks of 500 rows | `SeedDataIT` (every run) |
| D-04 | AuditorIT | Bulk approve of a manager-stage claim returned 403 instead of 409 | "May act" was checked before "right step type" | Step-type check moved before the approver check | `AuditorIT.US9_AC2_US9_AC3_...` |
| D-05 | PayoutIT | CSV export returned 500 | `version = version + 1` ambiguous in an `UPDATE ... FROM` self-join | Qualified as `c.version + 1` | `PayoutIT.US13_AC2_US13_AC3_...` |
| D-06 | Code review | Dashboard department spend joined `department` after `WHERE` | String-built SQL in the wrong order | FROM / WHERE split into separate fragments | `DashboardIT.US16_AC1_...` |
| D-07 | Code review | Policy validation said "softLimit" for the hard limit | Field labels swapped | Labels fixed | `PolicyConfigIT.invalidVersionsAreRejected` |
| D-08 | MetricsIT | `/actuator/prometheus` 404 in tests | Spring Boot disables metrics export in tests | `@AutoConfigureMetrics` on the test base class | `MetricsIT` |
| D-09 | Spec review | OpenAPI flow-style values with commas parsed as extra fake fields (10 places) | Unquoted commas end a plain scalar in `{ ... }` | Values quoted; a parser-based detector run after every spec change | Spec validation (0 fake keys, 239 examples valid) |
| D-10 | Concurrency review | Two concurrent decisions relied on the claim lock alone | No database-level compare-and-set on the step | `UPDATE approval_step ... WHERE status = 'PENDING'`, 409 if 0 rows | `ConcurrencyIT` |

## Security checklist run (2026-11-27)

Run against the code and the local stack. "Verified by" says how each item was checked.

| Check | Result | Verified by |
|---|---|---|
| Passwords hashed (BCrypt), never returned or logged | Pass | `SeedDataIT` (hashes start with `$2`), `AuthIT.W2_...` (failed-login audit has the email, not the password) |
| Same error for wrong email and wrong password | Pass | `AuthIT.W1_wrongPasswordAndUnknownEmailGetTheSameMessage` |
| Brute-force protection | **Limitation**: none (no rate limit or lockout) | `docs/security.md` |
| Token expiry and revocation | Pass for expiry (8 h); **limitation**: logout doesn't revoke | `AuthIT`, `docs/security.md` |
| Every endpoint needs a token except login | Pass | `AuthIT.W2_noPublicUserListAndApiNeedsAToken`; Spring Security config |
| Role checks per endpoint | Pass | 403 cases in `AuthIT`, `AuditorIT`, `PayoutIT`, `DashboardIT`, `UsersAndAuditLogIT`, `DelegationIT` |
| IDOR: someone else's claim | Pass (404) | `AuditTrailIT.US4_AC3_...`, `US17_AC3_...`, `ClaimDraftIT.draftsAreEditable...` |
| Self-approval | Pass (service + DB trigger) | `ApprovalChainIT.nobodyApprovesTheirOwnClaim`, `AuditorIT` bulk 403 row |
| Mass assignment | Pass: PATCH bodies reject unknown fields | `ClaimService.update`, `UserController.update` |
| SQL injection | Pass: parameterised SQL only; sort allow-list; `LIKE` escaped | Code review of all `JdbcClient` calls |
| File upload | Pass: 5 MB, sniffed type, server-side storage key, `nosniff` | `ClaimDraftIT.US3_AC2_...` (text and over-size rejected) |
| CSV / formula injection | Pass | `PayoutService.cell` |
| Error leakage | Pass: `ApiError` only, no stack traces | Every 4xx/5xx assertion; `server.error.*` settings |
| Security headers | Pass: `nosniff`, `X-Frame-Options: DENY`, `no-store` | `curl -D -` against the running stack |
| CORS | Pass: allow-list from `FRONTEND_ORIGIN` | `CorsConfig` |
| Secrets in git | Pass: `.env` ignored and untracked; no secret value in any tracked file | `git check-ignore`, grep of the working tree; CI step |
| Container runs as non-root, DB not exposed | Pass | `backend/Dockerfile`, `docker-compose.yml` |
| Append-only audit | Pass (triggers); **limitation**: DB user is a superuser in compose | `AuditTrailIT.US17_AC2_...` |
| Dependency vulnerabilities | CI dependency review on pull requests (high and above) | `.github/workflows/backend-ci.yml`, **not yet run on GitHub** |
| TLS / actuator exposure | **Limitation**: plain HTTP; actuator unauthenticated | `docs/security.md` |
