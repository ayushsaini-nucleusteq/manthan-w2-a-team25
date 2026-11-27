# AI-Manthan-Team-25

ExpenseFlow (Track A): expense claims with a policy engine, multi-level approvals, auditor queue, payouts and an append-only audit trail. This repository holds the backend, deployment and docs; the frontend lives separately.

## Backend

### Run it (one command)

1. Copy `.env.example` to `.env` and fill in real values (`.env` is gitignored, never commit it):

   | Variable | Required | Purpose |
   |---|---|---|
   | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | yes | Database (compose refuses to start without them) |
   | `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD` | yes | Grafana login |
   | `SEED_USER_PASSWORD` | yes, before the first start | Shared password of the seeded demo users; the backend won't start on an empty database without it |
   | `JWT_SECRET` | recommended | HS256 key, 32+ bytes (`openssl rand -base64 48`). Empty = random key per start (everyone is signed out on restart) |
   | `FRONTEND_ORIGIN` | no (default `http://localhost:5173`) | Browser origin(s) allowed by CORS, comma-separated |
   | `BACKEND_PORT`, `PROMETHEUS_PORT`, `GRAFANA_PORT` | no | Host ports (8080, 9090, 3000) |

2. Start everything:

   ```bash
   docker compose up --build -d
   ```

   The first start runs the migrations and seeds the demo data: 8 departments, 150 users and 3,000 claims. This takes about 25 s; wait until `docker compose ps` shows the backend as `healthy`.

### URLs

| What | URL |
|---|---|
| API | http://localhost:8080/api (e.g. `POST /api/auth/login`) |
| Health / readiness | http://localhost:8080/actuator/health, `/actuator/health/readiness` |
| Metrics | http://localhost:8080/actuator/prometheus |
| Prometheus (targets, alerts) | http://localhost:9090 (`/targets`, `/alerts`) |
| Grafana | http://localhost:3000 (login from `.env`; home dashboard "Team25 Backend") |

### Sign in

Demo accounts (one per role) are listed in [`docs/demo-accounts.md`](docs/demo-accounts.md). They all use the `SEED_USER_PASSWORD` from your `.env`.

```bash
curl -s -X POST http://localhost:8080/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"asha.verma@expenseflow.test","password":"<SEED_USER_PASSWORD>"}'
```

### Tests

```bash
./backend/mvnw -f backend verify       # Windows: backend\mvnw.cmd -f backend verify
```

The tests need Docker: they start their own PostgreSQL with Testcontainers and never touch the compose database. They are integration tests named after the acceptance criteria they prove; [`docs/api/ac-traceability.md`](docs/api/ac-traceability.md) maps each AC to its test. The Prometheus alert rules have their own unit tests: see [`docs/runbook.md`](docs/runbook.md#check-alert-rules).

### Docs

- API contract: [`docs/api/openapi.yaml`](docs/api/openapi.yaml); examples: [`docs/api/request-examples.md`](docs/api/request-examples.md)
- Screens to endpoints: [`docs/api/screen-map.md`](docs/api/screen-map.md); data model and state machine: [`docs/data-model.md`](docs/data-model.md)
- Operations: [`docs/runbook.md`](docs/runbook.md); security: [`docs/security.md`](docs/security.md)
