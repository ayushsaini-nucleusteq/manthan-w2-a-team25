# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

- `frontend/` — React 19 single-page app built with Vite 8 (plain JavaScript/JSX, no TypeScript). It's still close to the stock `create-vite` React template: the entry is `src/main.jsx`, which mounts `src/App.jsx`.
- There is no backend, shared package, or workspace tooling yet. Each app directory has its own `package.json`, so run commands from inside that directory.

## Commands (run from `frontend/`)

- `npm install` — install dependencies
- `npm run dev` — start the Vite dev server with HMR
- `npm run build` — production build into `frontend/dist/`
- `npm run preview` — serve the production build
- `npm run lint` — ESLint over all `*.js`/`*.jsx` files

No test runner is configured yet. If one is added (Vitest fits a Vite setup best), record the commands for running all tests and a single test here.

## Tooling notes

- ESLint uses the flat config (`frontend/eslint.config.js`) with `@eslint/js` recommended, `eslint-plugin-react-hooks` (flat recommended) and `eslint-plugin-react-refresh` (vite preset). The react-refresh rule warns when a module exports anything besides React components, so keep non-component exports in separate files to keep HMR working.
- `vite.config.js` turns on Vite DevTools (`@vitejs/devtools`) for the dev server only (`apply: 'serve'`).
- The React Compiler is not enabled.
ExpenseFlow (Track A): expense claims, a versioned policy engine, a multi-level approval chain, an auditor queue with sample audits, payouts, notifications and an append-only audit trail. This repo holds the **backend, deployment and docs**. The **frontend lives separately**: don't add one here (`docker-compose.yml` has a commented-out `frontend` service as the hook).

## Stack

- Java 21, Spring Boot 4.1.3 (Spring MVC, Spring Security with stateless JWT HS256 via Nimbus, Bean Validation, Actuator).
- Data access with `JdbcClient` and plain SQL. Hibernate only validates (`ddl-auto=validate`); there are no JPA entities.
- PostgreSQL 18. Flyway migrations in `backend/src/main/resources/db/migration` (V1 schema, V2 reference data and policy version 1).
- Micrometer and Prometheus, Grafana 12 (provisioned), ECS JSON logs with a `requestId` on every line.
- Tests: JUnit 5 integration tests against a real PostgreSQL (Testcontainers), named after the AC they prove.
- Docker Compose: `postgres`, `backend`, `prometheus`, `grafana`.

## Layout

```
backend/                     Spring Boot app (mvnw, Dockerfile)
  src/main/java/com/team25/backend/
    auth/        login/logout/me, JWT, security config, user lookup
    claims/      claims, lines, receipts, submit + policy preview, claim detail
    policy/      policy engine (pure), versions (F4), reference data
    approvals/   approval chain, inbox, auditor queue + sample audits, delegations, routing
    payouts/     F2/F3 batches and CSV export
    dashboard/   F1 dashboard
    users/       F5 users and hierarchy
    audit/       append-only audit writer + F6 audit log
    notify/      S2 notifications
    observability/ request ids, readiness + approval metrics
    seed/        demo data seeder (runs once on an empty DB)
    web/         ApiError and exception mapping
  src/test/java/...           *IT integration tests (one Spring context, one Postgres container)
deploy/prometheus/           prometheus.yml, alert-rules.yml, alert-rules.test.yml (promtool)
deploy/grafana/              provisioning + dashboards/backend.json
docs/                        contract (api/openapi.yaml), data-model.md, screen-map, AC traceability,
                             runbook, security, demo accounts, requirements/ (BA sources)
```

## Commands

```bash
docker compose up --build -d          # whole stack; first start seeds demo data (needs SEED_USER_PASSWORD in .env)
docker compose down                   # stop (data kept)
docker compose down -v                # stop and DELETE all data (DB, receipts, Prometheus, Grafana)
./backend/mvnw -f backend verify      # all tests (needs Docker for Testcontainers); Windows: backend\mvnw.cmd -f backend verify
# Alert rule unit tests (Git Bash on Windows: prefix with MSYS_NO_PATHCONV=1)
docker run --rm --entrypoint promtool -w /etc/prometheus -v "$PWD/deploy/prometheus:/etc/prometheus:ro" prom/prometheus:v3.5.0 test rules alert-rules.test.yml
```

## Business rules (summary; details in docs/data-model.md and openapi.yaml)

- **Roles**: EMPLOYEE (everyone), MANAGER, AUDITOR, FINANCE_HEAD (also admin). The JWT carries all of a user's roles; the frontend's role switch only changes which screens show.
- **Claim**: title, purpose, trip dates, INR only. Line: category, amount, date (not in the future), vendor, notes, receipt; hotel lines also have city and nights. Editable only in DRAFT and SENT_BACK.
- **Submit blockers (422)**: no lines, a line above the receipt threshold (500.00) without a receipt, or a future date.
- **Policy (versioned, F4)**: meals 1500/day per employee across claims; hotel 6000/night tier-1, 4000 other; cab 2000/trip. Hard limit = 2 × soft. Over soft → ROUTE; over hard → AUTO_REJECT. Weekend → ROUTE flag. Category without a rule → ROUTE. Same receipt SHA-256 → AUTO_REJECT; same vendor + amount + date → ROUTE (DUPLICATE). Evaluate new and edited lines only, each pinned to its version.
- **Outcome**: worst line. AUTO_APPROVED only if every line is clean and the total is ≤ 25,000; exactly 1 in every 10 auto-approved claims is sample-tagged (A4 only; not payable until cleared).
- **Chain**: manager; + auditor if total > 25,000; + finance head if total > 1,00,000 (exactly 25,000 / 1,00,000 do not add a step). Owner with no manager → finance-head pool. Nobody acts on their own claim. Reject (reason) is final. Send back (comment) → resubmit returns to the same step and approver; missing later steps are appended.
- **Delegation**: date range, delegate must hold the role, active only within the dates, no re-delegation; recorded "on behalf of".
- **Payout**: eligible = APPROVED, or AUTO_APPROVED with no pending sample audit. A batch reserves its claims; export → IN_BATCH; mark paid needs confirm=true → PAID + notify; paid twice → 409.
- **Audit**: every action, append-only, same transaction. Someone else's claim → 404; a role not allowed → 403.

## Working rules

- **The docs are the contract.** `docs/api/openapi.yaml`, `docs/data-model.md`, `docs/api/screen-map.md` and `docs/api/ac-traceability.md` describe what the API does. Change the code to match them, or change them in the same PR with the reason. Regenerate `docs/api/request-examples.md` when the spec changes.
- Every business rule gets an integration test named after its AC (`US8_AC2_exactly25000DoesNotRouteToAuditor`). Never weaken or delete a test to make it pass.
- Tests share one database. Use `freshEmployee()` and expense dates from the last 12 days (seeded data is at least 15 days old). Only `PolicyConfigIT` (ordered last) may change the policy.
- Money is `BigDecimal` / `NUMERIC(12,2)` and travels as a two-decimal string. Business dates use Asia/Kolkata (`Money.today()`).
- Every state change writes an `audit_event` in the same transaction; the table is append-only.
- Use parameterised SQL only. User input never goes into SQL text (sort fields go through `Sorts`, `LIKE` input through `ClaimRepository.like`).

## Git

- Branches: `feature/<short-name>` and `fix/<short-name>` off `main`.
- Commits: `feat: ...`, `fix: ...` (also `docs: ...`, `test: ...`, `chore: ...`), imperative and short.
- **No secrets in git.** Real values live only in `.env` (gitignored); `.env.example` has placeholders. Never commit `.env`, logs, `incident/` captures or receipt files.
