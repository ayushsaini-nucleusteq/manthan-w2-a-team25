# Screen → endpoint map

Screens and names are exactly those in `docs/requirements/screen-list.md`. Endpoints are in `openapi.yaml`.
For every list and dashboard, UI states (loading, empty, error with retry) are client-side; "no permission" is
shown as "not found" for both 403 and 404 responses.

## Shared

| Screen | Endpoints |
|---|---|
| **S1 Sign-in / role switch**: pick a user; the role sets the home screen | `GET /api/auth/users` (public picker, `q` search) · `POST /api/auth/login` (`userId` → 8 h JWT, `LOGIN` audited) · `GET /api/auth/me` (`homeScreen` = highest role: F1 / A1 / M1 / E1). Role switch = sign in again as a different user; the JWT carries all of that user's roles. Available only with `DEMO_LOGIN_ENABLED=true` (demo-only limitation). |
| **S2 Notifications**: approvals waiting, sent-back claims, payout done | `GET /api/notifications?unread=` · `GET /api/notifications/unread-count` · `POST /api/notifications/{id}/read` · `POST /api/notifications/read-all` |
| **S3 Audit trail (per claim)**: read-only, append-only timeline | `GET /api/claims/{id}/audit-trail` |

## Employee

| Screen | Endpoints |
|---|---|
| **E1 My claims**: own claims only; status chips and filters | `GET /api/claims?scope=mine&status=&q=` (`statusCounts` feeds the chips) |
| **E2 New / edit claim header**: title, purpose, trip dates; INR fixed | `POST /api/claims` (optional client `id` for offline drafts) · `PATCH /api/claims/{id}` · `DELETE /api/claims/{id}` (unsubmitted draft) · `GET /api/claims/{id}` |
| **E3 Line items**: cards on mobile; add, edit, delete; running total | `POST /api/claims/{id}/lines` (optional client `id`) · `PUT /api/claims/{id}/lines/{lineId}` · `DELETE /api/claims/{id}/lines/{lineId}` (each returns the claim with `totalAmount`) |
| **E4 Line editor**: category, amount, date, vendor, notes, receipt; live policy hints | `GET /api/expense-categories` · `GET /api/policy/current` · `POST /api/claims/{id}/policy-preview` with `{ line, lineId, hasReceipt }` |
| **E5 Receipt capture**: camera first on mobile; upload; preview; file hash | `PUT /api/claims/{id}/lines/{lineId}/receipt` (returns `sha256`; retry is safe, PUT replaces) · `GET …/receipt` (preview). Camera-first, offline queue and blur warning are client-side. |
| **E6 Pre-submit check**: per-line result (auto-approve, route, reject) | `POST /api/claims/{id}/policy-preview` (no body) → per-line `findings`, `submitBlockers` · then `POST /api/claims/{id}/submit` (422 names blocked lines) |
| **E7 Claim detail**: status, comments, send-back reply, timeline | `GET /api/claims/{id}` (`statusHistory`, `comments`, `approvalSteps`, `decisionReason`) · `POST /api/claims/{id}/submit` with `comment` (reply = resubmit to same approver) · `POST /api/claims/{id}/comments` · `GET /api/claims/{id}/audit-trail` (S3) |

## Line manager

| Screen | Endpoints |
|---|---|
| **M1 Approval inbox**: oldest first | `GET /api/approvals/inbox?state=PENDING\|OVERDUE\|SENT_BACK\|DECIDED` (items carry `overdue`, `delegated`, `onBehalfOf`) |
| **M2 Claim review**: lines, receipts in a side panel, policy and weekend flags | `GET /api/claims/{id}` (line `findings`, `flags`) · `GET /api/claims/{id}/lines/{lineId}/receipt` (inline) |
| **M3 Decision bar**: approve (one tap), send back (comment), reject (reason) | `POST /api/claims/{id}/approve` · `POST /api/claims/{id}/send-back` · `POST /api/claims/{id}/reject` · `POST /api/claims/{id}/comments` |
| **M4 Delegation**: delegate and leave dates | `GET /api/users?role=MANAGER` (pick delegate) · `GET /api/delegations?scope=given` · `POST /api/delegations` · `DELETE /api/delegations/{id}` |

## Finance auditor

| Screen | Endpoints |
|---|---|
| **A1 Review queue**: dense table; filters (amount band, department, flags, age, sample tag); bulk actions | `GET /api/auditor/queue?amountBand=&departmentId=&flag=&minAgeHours=` · `GET /api/departments`. **No sample-tag filter**: tagged claims are only in A4 (conflict, see ac-traceability). |
| **A2 Side-by-side viewer**: claim lines left, receipt right | `GET /api/claims/{id}` · `GET /api/claims/{id}/lines/{lineId}/receipt` (inline, full resolution) · `POST /api/claims/{id}/approve` · `POST /api/claims/{id}/send-back` · `POST /api/claims/{id}/reject` |
| **A3 Bulk action bar**: approve or send back selected rows | `POST /api/auditor/queue/bulk-approve` · `POST /api/auditor/queue/bulk-send-back` (per-row results) |
| **A4 Sample audit**: the random 10% of auto-approved claims | `GET /api/auditor/sample-audits?status=` · `POST /api/auditor/sample-audits/{id}/clear` · `…/reject` · `…/send-back` · `GET /api/claims/{id}` + receipt for review |

## Finance head / admin

| Screen | Endpoints |
|---|---|
| **F1 Dashboard**: spend by category, department and month; violations; average approval time; queue size; oldest pending approval | `GET /api/dashboard?from=&to=&departmentId=` (`queues`, `oldestPending`, `approvalAgeAlert`) · `GET /api/departments` |
| **F2 Payout batch builder**: select approved claims; totals in ₹ | `GET /api/payouts/eligible-claims` · `POST /api/payouts` with `claimIds` · `GET /api/payouts` |
| **F3 Batch export**: mock bank-file CSV; mark Paid after a confirm | `GET /api/payouts/{id}` · `GET /api/payouts/{id}/export` (claims → IN_BATCH) · `POST /api/payouts/{id}/mark-paid` with `confirm: true` |
| **F4 Policy configuration**: limits, city tiers, receipt threshold, weekend rule; versioned | `GET /api/policy/current` · `GET /api/policy/versions` · `GET /api/policy/versions/{n}` · `POST /api/policy/versions` · `GET /api/expense-categories` |
| **F5 Users and hierarchy**: reporting lines and delegations | `GET /api/users` · `PATCH /api/users/{id}` (manager, roles, active) · `GET /api/delegations?scope=all` · `DELETE /api/delegations/{id}` · `GET /api/departments` |
| **F6 Global audit log**: search all actions; read-only | `GET /api/audit-events?claimId=&actorId=&action=&entityType=&from=&to=` |

## Finance head approvals (US12 "Approval queue")

US12's "Approval queue" = **M1–M3 used by the finance head**. There is no separate screen. The finance head
opens M1 (`GET /api/approvals/inbox`), which shows FINANCE_HEAD steps and MANAGER steps for owners with no
manager. They review in M2 and decide in M3 (`/approve`, `/reject`, `/send-back`). Their home screen is
still F1.
