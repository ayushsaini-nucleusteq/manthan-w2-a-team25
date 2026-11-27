# Acceptance-criteria traceability

Source: `docs/requirements/ExpenseFlow_Stories_and_Acceptance_Criteria.xlsx` (18 stories, 54 ACs, all rows read).
Contract: `openapi.yaml`, `../data-model.md`. Status key:

- **API**: the contract fully supports it.
- **API + UI**: the contract supplies what's needed; the behaviour itself is in the client.
- **UI only**: purely client behaviour; nothing in the API is needed beyond normal endpoints.
- **Outside API**: lives in monitoring/deploy, not in this contract.
- **Conflict**: the AC disagrees with the use case, screen list or an instruction; see the Conflicts section.

| AC | Criterion (short) | Status | Endpoint(s) | Field / rule |
|---|---|---|---|---|
| US1-AC1 | Line requires category, amount, date, vendor | API | `POST /claims/{id}/lines`, `PUT …/lines/{lineId}`, `POST /claims` | `ExpenseLineRequest.required = [category, amount, expenseDate, vendor]`; 400 otherwise |
| US1-AC2 | Receipt required above ₹500 | API | `POST /claims/{id}/submit`, `policy-preview` | `PolicySettings.receiptThreshold` (seed 500.00, strictly above); 422 `RECEIPT_REQUIRED` |
| US1-AC3 | Saved draft reopens with same content in My claims | API | `GET /claims?scope=mine`, `GET /claims/{id}` | Draft persisted server-side; `ClaimDetail` returns all header and line fields |
| US1-AC4 | Submit blocked while a receipt is missing; blocked line named | API | `POST /claims/{id}/submit` | 422 `ApiError.errors[]` with `lineId`, `lineNo`, `code: RECEIPT_REQUIRED`; also `policy-preview.submitBlockers` |
| US2-AC1 | Each line shows outcome with rule name and limit | API | `POST /claims/{id}/policy-preview` (E4/E6), `GET /claims/{id}` | `PolicyFinding.ruleCode`, `ruleName`, `limit`, `excess`, `outcome` (WITHIN_LIMIT findings carry the limit too) |
| US2-AC2 | Duplicate line shows the earlier line it matches | API | same as above | `PolicyFinding.matchedClaimId`, `matchedClaimNumber`, `matchedLineId`, `matchedLineNo`. A receipt-hash match on another employee's claim shows a message only, never ids (decision D7) |
| US2-AC3 | Weekend line flagged and still submits | API | `policy-preview`, `submit` | `WEEKEND_EXPENSE` is ROUTE only, never a 422 blocker |
| US3-AC1 | Camera opens first | UI only | `PUT …/receipt` | Client behaviour (E5) |
| US3-AC2 | Failed upload shows retry and keeps the line | API + UI | `PUT …/receipt` | PUT is idempotent, so retry is safe; the line already exists server-side |
| US3-AC3 | Offline draft syncs when the connection returns | API + UI | `POST /claims`, `POST /claims/{id}/lines` | Optional client `id`; same id + same content → 200 with the existing record, no duplicate; same id + different content → 409 (D8). Local storage and sync queue are client-side |
| US4-AC1 | Claim detail shows status history and every comment | API | `GET /claims/{id}`, `GET /claims/{id}/audit-trail` | `ClaimDetail.statusHistory[]`, `ClaimDetail.comments[]` (comments, send-back comments, reject reasons, replies, sample notes) |
| US4-AC2 | Replying to a send-back resubmits to the same approver | API | `POST /claims/{id}/submit` with `comment` | Sent-back step returns to `PENDING`, routed at that moment to whoever sent it back (active delegation applies; if they are deactivated: their manager for a manager step, the role pool for auditor/head) (D4). A sample-audit send-back goes back to the same auditor only if still clean and ≤ 25000; otherwise it enters the normal chain (D5) |
| US4-AC3 | Someone else's claim shows "not found" | API | `GET /claims/{id}` (and all claim sub-resources) | 404 for claims the caller can't see |
| US5-AC1 | Inbox lists oldest pending first | API | `GET /approvals/inbox` | Ordered by `pendingSince` ascending |
| US5-AC2 | Approve takes one tap | API + UI | `POST /claims/{id}/approve` | Only `version` required; comment optional |
| US5-AC3 | Send back needs a comment; reject needs a reason | API | `POST …/send-back`, `POST …/reject` | `SendBackRequest.comment` and `RejectRequest.reason` required, minLength 1 |
| US5-AC4 | Each decision in the audit trail | API | `GET /claims/{id}/audit-trail`, `GET /audit-events` | `APPROVED`, `REJECTED`, `SENT_BACK` events written in the same transaction |
| US6-AC1 | Weekend lines show a flag in review | API | `GET /claims/{id}` | Line `findings` with `WEEKEND_EXPENSE`; claim `flags` |
| US6-AC2 | A flag does not block approval | API | `POST …/approve` | Approve checks only status, role and ownership |
| US6-AC3 | Duplicate flag names the earlier line | API | `GET /claims/{id}` | `PolicyFinding.matched*` (as US2-AC2). Vendor+amount+date duplicates are always the same employee's, so they are always named |
| US7-AC1 | Set a delegate with start and end dates | API | `POST /delegations` | `delegateId`, `startsOn`, `endsOn` |
| US7-AC2 | Claims arriving during leave go to the delegate, show "Delegated" | API | `GET /approvals/inbox` | `InboxItem.delegated`, `onBehalfOf`; audit `onBehalfOf`. Note: the delegator can still act too (your instruction 15) |
| US7-AC3 | Delegation ends automatically on the end date | API | `GET /delegations`, inbox | `active` computed from dates on every read; no job needed |
| US8-AC1 | Above ₹25,000 → Pending auditor after manager | API | `POST …/approve` | Chain: AUDITOR step when total > `auditorAboveTotal` |
| US8-AC2 | Exactly ₹25,000 does not route to auditor | API | submit | Strictly greater-than |
| US8-AC3 | Below threshold not in auditor queue | API | `GET /auditor/queue` | Queue = `PENDING_AUDITOR` only |
| US9-AC1 | Filters combine | API | `GET /auditor/queue` | `amountBand`, `departmentId`, `flag`, `minAgeHours` ANDed |
| US9-AC2 | Selection count; bulk acts only on selected rows | API + UI | `POST /auditor/queue/bulk-approve` | Acts only on `claimIds`; count is client-side |
| US9-AC3 | One failed row doesn't stop others; failure shows reason | API | `POST /auditor/queue/bulk-approve` | One transaction per claim; `BulkActionResponse.results[].error.message` |
| US10-AC1 | Receipt beside the lines, zoomable | API + UI | `GET …/receipt` | Served `inline` at full resolution; layout and zoom are client-side |
| US10-AC2 | Send back from the viewer | API | `POST /claims/{id}/send-back` | Same endpoint from A2 |
| US11-AC1 | Exactly 10% of auto-approved claims tagged, at random | API | `POST …/submit` | `sample_audit_block`: one random position per block of 10. See open item O1 |
| US11-AC2 | Tagged claims only in the sample audit worklist | API (**Conflict** C1) | `GET /auditor/sample-audits` | Excluded from `/auditor/queue` and `/approvals/inbox` |
| US11-AC3 | Each audit result records auditor name and time | API | `POST /auditor/sample-audits/{id}/clear\|reject\|send-back` | `sampleAuditedBy`, `sampleAuditedAt`, `sampleAuditStatus` |
| US12-AC1 | Above ₹1,00,000 needs head approval after auditor | API | `GET /approvals/inbox`, `POST …/approve\|reject\|send-back` | FINANCE_HEAD step when total > `financeHeadAboveTotal`; the head uses M1–M3, which is US12's "Approval queue" (D1) |
| US12-AC2 | Exactly ₹1,00,000 doesn't need the head | API | submit | Strictly greater-than |
| US13-AC1 | Only Approved claims can be batched | **Conflict** C4 | `GET /payouts/eligible-claims`, `POST /payouts` | Contract also allows AUTO_APPROVED with no pending sample audit |
| US13-AC2 | Totals in ₹ with Indian grouping | UI only | `GET /payouts/{id}` | API returns decimal strings; UI formats `en-IN` |
| US13-AC3 | CSV in mock bank format; claims move to In batch | API | `GET /payouts/{id}/export` | CSV columns in the example; first export → claims `IN_BATCH` |
| US14-AC1 | Mark Paid asks for a separate confirmation | API + UI | `POST /payouts/{id}/mark-paid` | `confirm: true` required (400 otherwise); the dialog is client-side |
| US14-AC2 | All claims → Paid; employee notified | API | `POST /payouts/{id}/mark-paid` | Claims → `PAID`; `PAYOUT_DONE` notification per owner |
| US14-AC3 | Already-paid batch can't be marked again | API | `POST /payouts/{id}/mark-paid` | 409 when status is `PAID` |
| US15-AC1 | Limits editable on F4 (meals, hotel, cab, receipt threshold, weekend rule) | API | `POST /policy/versions` | `rules[]` soft/hard limits, `tier1Cities`, `settings.receiptThreshold`, `settings.weekendFlagEnabled` |
| US15-AC2 | Each change versioned with date and author | API | `GET /policy/versions` | `versionNo`, `createdAt`, `createdBy` |
| US15-AC3 | Changes apply to new lines only; no re-runs | API (**Conflict** C6) | submit, preview | Only `needs_evaluation` lines are evaluated; others keep `policyVersionNo` and findings |
| US16-AC1 | Spend by category, department, month | API | `GET /dashboard` | `spendByCategory`, `spendByDepartment`, `spendByMonth` |
| US16-AC2 | Violation count and average approval time | API | `GET /dashboard` | `policyViolations.totalFindings`, `approvalTime.averageHours` |
| US16-AC3 | Oldest pending approval visible | API | `GET /dashboard` | `oldestPending` |
| US17-AC1 | Entry records who, when, what changed | API | `GET /claims/{id}/audit-trail`, `GET /audit-events` | `actor`, `onBehalfOf`, `occurredAt`, `fromStatus`/`toStatus`, `details.changes` |
| US17-AC2 | No screen can edit or delete an entry | API | n/a | No write endpoints for events; DB triggers and grants block UPDATE/DELETE |
| US17-AC3 | Employee sees trail only for own claims | API | `GET /claims/{id}/audit-trail` | Same visibility as the claim (404 otherwise); `/audit-events` is AUDITOR/FINANCE_HEAD only |
| US18-AC1 | Age threshold set in configuration | API | `POST /policy/versions`, `GET /dashboard` | `settings.overdueThresholdHours` → `approvalAgeAlert.thresholdHours` |
| US18-AC2 | Alert fires once per breach, not on every refresh | **To build in backend/deploy** | `/actuator/prometheus` | Not in the API contract. See "To build in backend/deploy" below |
| US18-AC3 | Dashboard shows queue size and approval age with the alert | API | `GET /dashboard` | `queues[]`, `oldestPending.ageHours`, `approvalAgeAlert` |

Totals: 54 ACs (matches the spreadsheet; none missing). 42 API, 6 API + UI, 2 UI only, 1 to build in backend/deploy (US18-AC2), and 3 linked to a conflict that you decided to keep as is (C1 → US11-AC2 and C6 → US15-AC3 are supported as written; C4 → US13-AC1 is deliberately broader than its literal text).

## Conflicts (sources disagree; I did not guess)

| # | Conflict | Sources | What the contract does now |
|---|---|---|---|
| C1 | **Sample tag in A1.** Screen list A1 filters include "sample tag", and the screen-list policy flow treats sample tag as a route reason. US11-AC2 and your instruction say tagged claims appear only in A4. | screen-list A1 + "Policy outcome" flow vs US11-AC2 + your instruction 3 | Follows US11-AC2: no sample filter on A1; tagged claims stay `AUTO_APPROVED` |
| C2 | **Duplicate outcome.** Screen list says "auto-reject for duplicates"; your earlier point 4 said duplicate → AUTO_REJECTED. Your latest instruction 1 splits them: hash → AUTO_REJECTED, vendor+amount+date → ROUTE. The use case only says "flagged". | screen-list flow, earlier point 4 vs latest instruction 1, US6 | Follows the latest instruction |
| C3 | **Exactly 10%.** "Exactly" can only hold per complete block of 10; at any moment the open block may have 0 tags. | US11-AC1 | One random pick per block of 10 |
| C4 | **What can be batched.** US13-AC1 and F2 say only *Approved* claims. Your earlier point 5 says eligible = APPROVED **or** AUTO_APPROVED with no pending sample audit. The use case says "Approved claims go into a payout batch". | US13-AC1 vs earlier point 5 | Keeps earlier point 5. If US13-AC1 is literal, auto-approved claims could never be paid |
| C5 | **Delegation routing.** US7-AC2 says claims "go to the delegate"; your point 15 says the delegator can still act. US7-AC2 also says claims *arriving* during leave, but the contract shows the delegate everything pending while the delegation is active, including items from before the leave. | US7-AC2 vs point 15 | Both can act; delegate sees all pending items during leave |
| C6 | **Policy version per claim vs per line.** Your point 13 says each claim stores the version it was checked against. US15-AC3 and your latest instruction 5 say unchanged lines keep their own version, so one claim can mix versions. | point 13 vs US15-AC3 | Both: per line (`policyVersionNo`), plus the claim keeps the version used at its latest submit for claim-level thresholds |
| C7 | **Notification types.** S2 lists approvals waiting, sent-back, payout done. Your point 7 adds `CLAIM_DECIDED`. | screen-list S2 vs point 7 | Includes `CLAIM_DECIDED` (it's a superset, so no screen breaks) |

Status: you reviewed C1–C7 and kept all of them as they are.

## Decisions applied

| # | Was | Decision | Where in the contract |
|---|---|---|---|
| D1 | G1 | Finance head approves through the same inbox and decision endpoints as M1–M3; US12 "Approval queue" = M1–M3 for the finance head | `GET /approvals/inbox` description; `screen-map.md` |
| D2 | G2 | US18-AC2 is backend + deploy work (below) | this file |
| D3 | G3 | S1 role switch = sign in as a different user; home screen = highest role; JWT carries all roles | `POST /auth/login`, `GET /auth/me` |
| D4 | O2 | Resubmit goes to the step that sent it back, routed by normal rules at that moment: active delegation applies; if the approver is deactivated, a manager step goes to their manager, an auditor/head step to the role pool | `POST /claims/{id}/submit`; `approval_step.sent_back_by` and resubmit routing in `data-model.md` |
| D5 | O3 | Sample-audit resubmit reruns policy: still clean and ≤ 25000 → back to the same auditor's A4 list; otherwise loses AUTO_APPROVED and goes through the normal chain from the manager | `submit`, `/auditor/sample-audits/{id}/send-back`; state machine |
| D6 | O4 | Owner with no manager: manager step goes to the finance head | `submit`; `approval_step.required_role` |
| D7 | O5 | Cross-employee receipt-hash duplicate: message only, never the other claim's ids (for every caller) | `PolicyFinding` description |
| D8 | O6 | Offline replay: same id + same content → existing record (200); same id + different content → 409 | `POST /claims`, `POST /claims/{id}/lines`; Conventions in `data-model.md` |
| D9 | O7 | Duplicate scope: earlier lines of the same employee in claims SUBMITTED or later (incl. SENT_BACK), excluding DRAFT, AUTO_REJECTED, REJECTED, plus earlier lines in the same claim | `submit`; "Lines in scope" in `data-model.md` |
| D10 | O8 | Passwordless sign-in is demo only, behind `DEMO_LOGIN_ENABLED` (default true in docker-compose, false otherwise); when off, `/auth/users` and `/auth/login` return 404 | "Known limitations" in `openapi.yaml` |

## To build in backend/deploy (US18-AC2)

Not part of the API contract. Listed for the backend/deploy owners; this session did not edit those folders.

| Where | What |
|---|---|
| backend | Gauge `expenseflow_oldest_pending_approval_age_seconds`: age of the oldest `approval_step` with `status = 'PENDING'` (0 when none), with label `step_type`. Exposed at `/actuator/prometheus`. |
| backend | Gauge `expenseflow_approval_age_threshold_seconds` = current policy `overdueThresholdHours × 3600`, so the alert threshold comes from configuration (US18-AC1). |
| backend | Gauge `expenseflow_pending_approvals{step_type}`: queue size per step (US18-AC3 / SRE metrics). |
| deploy (Prometheus rule) | `OldestPendingApprovalTooOld`: `max(expenseflow_oldest_pending_approval_age_seconds) > max(expenseflow_approval_age_threshold_seconds)` with `for: 5m`, severity `warning`, linking to the runbook. |
| deploy (Alertmanager) | Route with `group_by: [alertname]`, `group_wait: 30s`, and `repeat_interval` long (e.g. `24h`), with `send_resolved: true`. One notification per breach, not on every scrape or dashboard refresh (US18-AC2). |
| deploy (Grafana) | Panel next to the alert: queue size per step and oldest pending age (US18-AC3 also served by `GET /api/dashboard`). |

## Still open

| # | Item |
|---|---|
| O1 | **Exactly-10% blocks** are global across the company. Should they be per department or per month instead? (Not covered by the decisions; the contract stays global.) |
