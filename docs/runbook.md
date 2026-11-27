# ExpenseFlow runbook

Commands run from the repository root. Container names follow compose: `manthan-w2-a-team25-<service>-1` (`backend`, `postgres`, `prometheus`, `grafana`).

**Drill status.** Each recovery path says whether it was actually exercised:

- **Drilled**: done on the local stack, with the result.
- **Not yet drilled**: the steps are expected to work but haven't been run end to end. Treat them as a plan, not a guarantee.

## 1. Operate

| Task | Command |
|---|---|
| Start everything (build the backend image) | `docker compose up --build -d` |
| Status and health | `docker compose ps` (backend should be `healthy`) |
| Follow backend logs (JSON, one line per request, with `requestId`) | `docker compose logs -f backend` |
| Stop, keeping data | `docker compose down` |
| Restart only the backend | `docker compose restart backend` |
| Rebuild the backend after a code change | `docker compose up --build -d backend` |
| **Reset: delete ALL data** (DB, receipts, Prometheus, Grafana) and re-seed | `docker compose down -v && docker compose up --build -d` |

- The first start on an empty database seeds demo data (about 25 s to `healthy`). Seeding needs `SEED_USER_PASSWORD` in `.env`; without it the backend exits with `SEED_USER_PASSWORD must be set (in .env) to seed demo users`.
- Data lives in named volumes: `pgdata` (database), `receipts` (uploaded receipt files at `/data/receipts`), `promdata`, `grafanadata`. Back up `pgdata` and `receipts` together: a claim's receipt row points at a file in `receipts`.

### Check alert rules

```bash
# Syntax + rules (Git Bash on Windows: prefix with MSYS_NO_PATHCONV=1 and use "$(pwd -W)")
docker run --rm --entrypoint promtool -v "$PWD/deploy/prometheus:/etc/prometheus:ro" prom/prometheus:v3.5.0 check config /etc/prometheus/prometheus.yml
# Unit tests for OldestPendingApprovalTooOld
docker run --rm --entrypoint promtool -w /etc/prometheus -v "$PWD/deploy/prometheus:/etc/prometheus:ro" prom/prometheus:v3.5.0 test rules alert-rules.test.yml
```

Prometheus does not hot-reload rule files here. After editing `deploy/prometheus/*.yml` run `docker compose restart prometheus`.

## 2. Monitor

Grafana: http://localhost:3000, dashboard **Team25 Backend** (home). Prometheus: http://localhost:9090/targets (job `backend` must be UP) and `/alerts`. There is no Alertmanager: alerts are visible in Prometheus and next to the panels, not sent anywhere.

### Dashboard panels

| # | Panel | Shows | Normal |
|---|---|---|---|
| 1 | Request rate (req/s) | Requests per second by method, URI, status (actuator excluded) | Follows usage |
| 2 | 5xx error rate | Share of requests failing with 5xx (red line 5% = High5xxRate) | 0 |
| 3 | p95 latency | 95th percentile latency, overall and per URI (red line 500 ms = HighP95Latency) | Well under 500 ms |
| 4 | JVM heap | Used / committed / max heap | Used stays well below max (container limit 1 GB, heap 75%) |
| 5 | DB connection pool (HikariCP) | Active, idle, pending, max connections | `pending` 0 |
| 6 | Approval queue size by step | Pending MANAGER / AUDITOR / FINANCE_HEAD / SAMPLE_AUDIT steps | Stable or falling |
| 7 | Oldest pending approval age | Age of the oldest pending step per step type; dashed red line = threshold | Below the line |

### Alerts

| Alert | Fires when | Severity | Meaning | Likely causes | First 3 checks |
|---|---|---|---|---|---|
| **AppDown** | Prometheus can't scrape `backend:8080` for 30 s | critical | The backend process is down or unreachable | Container crashed or stopped, OOM kill, failed start (migration error, missing `SEED_USER_PASSWORD`) | 1. `docker compose ps backend` 2. capture the exit state (section 3, "crash or stop?") 3. `docker compose logs --tail=200 backend` |
| **ReadinessDown** | `app_readiness == 0` for 30 s | critical | Process is up but not ready, usually the DB | Postgres down or restarting, network, pool exhausted | 1. `docker compose ps postgres` 2. `curl -s localhost:8080/actuator/health/readiness` 3. `docker compose logs --tail=100 postgres` |
| **High5xxRate** | > 5% of requests are 5xx for 1 m | warning | Requests are failing on the server | Bug after a deploy, DB errors, disk full (receipts) | 1. Panel 2 + `docker compose logs backend \| grep '"level":"ERROR"'` 2. Take a `requestId` from an error and grep it 3. `docker compose exec postgres pg_isready` |
| **HighP95Latency** | p95 > 500 ms for 2 m | warning | The API is slow | DB slow or pool saturated (panel 5), heap pressure / GC (panel 4), heavy list or dashboard queries | 1. Panel 3 per URI 2. Panels 4 and 5 3. `docker stats --no-stream` |
| **OldestPendingApprovalTooOld** | Oldest pending approval older than the policy's `overdueThresholdHours` (48 h by default) for 5 m; stays firing (`keep_firing_for: 10m`) until it drops below | warning | Approvals are stuck: employees wait | Approver on leave without a delegate, auditor or finance-head pool unstaffed, inactive approver | 1. Panel 7: which step type 2. `GET /api/dashboard` → `oldestPending.claimNumber` 3. Check that step's approver: active? on leave? (F5 users, M4 delegations) |

The seeded demo data contains approvals older than 48 h, so **OldestPendingApprovalTooOld is expected to fire on a fresh demo stack**. The threshold is configuration: publishing a policy version with a different `overdueThresholdHours` (F4) moves it without touching Prometheus.

## 3. Recover

### First: crash or stop? Capture before restarting

Restarting wipes the evidence. Run this **before** `restart` or `up`:

```bash
mkdir -p incident
docker inspect -f 'exit={{.State.ExitCode}} oom={{.State.OOMKilled}} status={{.State.Status}} restarts={{.RestartCount}} finished={{.State.FinishedAt}} error={{.State.Error}}' manthan-w2-a-team25-backend-1 | tee incident/backend-state-$(date +%Y%m%d-%H%M%S).txt
docker compose logs --no-color --tail=1000 backend > incident/backend-$(date +%Y%m%d-%H%M%S).log
```

| `exit` / `oom` | Meaning |
|---|---|
| `0` | Clean stop (someone ran stop/down, or the app shut down normally) |
| `143` | Stopped with SIGTERM (`docker stop` / `compose stop`): a stop, not a crash |
| `137` with `oom=true` | Killed for memory: the container hit `mem_limit` (1 GB) |
| `137` with `oom=false` | SIGKILL from outside (`docker kill`, or the stop timeout expired) |
| `1` (or another non-zero) | The app exited with an error. Read the end of the log (startup failure, migration error, missing env) |

`restart: unless-stopped` restarts crashed containers by itself. A rising `restarts=` count means a crash loop. `incident/` is gitignored.

### App down (AppDown)

1. Capture the state (above).
2. `docker compose up -d backend`, then wait for `healthy` (`docker compose ps`).
3. If it exits again, read the log tail. Missing `.env` values, a failed migration or `JWT_SECRET` under 32 bytes stop startup with a clear message.
4. OOM (`137`/`oom=true`): check panel 4 before the crash. If it was a real leak or load, raise `mem_limit` in `docker-compose.yml` (heap is 75% of it).

Status: **drilled 2026-11-27** on the local stack (`docker compose stop backend`). The capture showed `exit=143 oom=false` (a stop, not a crash); AppDown fired after about 42 s; `docker compose start backend` was healthy at about 54 s and AppDown cleared. Crash and OOM exits (`137`, `1`) were not reproduced: those rows of the table are **not yet drilled**.

### DB down (ReadinessDown)

1. `docker compose ps postgres`, then `docker compose logs --tail=100 postgres`.
2. `docker compose up -d postgres` and wait for `healthy`. The backend reconnects by itself (Hikari): readiness goes back to UP without restarting the backend.
3. If Postgres won't start, check disk space and the `pgdata` volume. Don't run `down -v`: it deletes the data.

Status: **drilled 2026-11-27** (`docker compose stop postgres`). Readiness returned 503 within about 6 s while liveness stayed 200, so AppDown correctly did not fire. ReadinessDown fired after about 84 s: longer than its `for: 30s`, because each readiness check waits for the 5 s DB connection timeout. After `docker compose start postgres`, readiness was 200 again at about 97 s with **no backend restart** (same start time, 0 restarts), and sign-in worked. The "Postgres won't start" branch is **not yet drilled**.

### High 5xx (High5xxRate)

1. Find failing requests: `docker compose logs backend | grep '"level":"ERROR"'`. Each line has a `requestId`, also returned to clients in `X-Request-Id`.
2. If a deploy just happened, roll back to the previous image or commit and `docker compose up --build -d backend`.
3. DB errors: follow "DB down". Disk full: check the `receipts` volume and free space.

Status: **not yet drilled**.

### High latency (HighP95Latency)

1. Panel 3 per URI: one endpoint, or everything?
2. Panel 5: `pending > 0` means the pool is saturated, so look at slow queries (`docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "select pid, now()-query_start as age, state, left(query,80) from pg_stat_activity where state <> 'idle' order by age desc"`).
3. Panel 4: heap near max means GC pressure. `docker compose restart backend` buys time; capture first.

Status: **not yet drilled**.

### Old pending approvals (OldestPendingApprovalTooOld)

1. `GET /api/dashboard?from=...&to=...` (auditor or finance head): `oldestPending` gives the claim number and step type, `queues` the backlog per step.
2. MANAGER step: is the manager active and present? If on leave, they (or the finance head via F5) set a delegate (`POST /api/delegations`). The delegate sees the items at once. If the manager left, the finance head changes the employee's manager (`PATCH /api/users/{id}`). Pending steps are not moved automatically.
3. AUDITOR / FINANCE_HEAD / SAMPLE_AUDIT steps: these are role pools. Make sure at least one active user holds the role (F5) and works the A1 queue or A4 sample audits.
4. If 48 h is the wrong expectation, publish a policy version with a new `overdueThresholdHours` (F4). The alert and the Overdue flags follow it.

Status: **not yet drilled**.
