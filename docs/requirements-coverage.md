# Requirements coverage

Every requirement sentence in the BA sources, mapped to what implements it and the test that proves it.

Sources, all read in full: `requirements/track-a-usecase.md` (UC), `requirements/screen-list.md` (screens SL, flows FL, UI states UI), `requirements/ExpenseFlow_Stories_and_Acceptance_Criteria.xlsx` (all 54 AC rows), `requirements/ExpenseFlow_Stage_Wireframes_v4.html` (WF, every screen).

Status:
- **DONE**: built in this repo and proven by the named test or check.
- **FRONTEND-ONLY**: purely client behaviour; any API support it needs is DONE.
- **GAP**: not done. All GAPs left are team or process activities, not backend code (see the summary).

Test names refer to `backend/src/test/java/com/team25/backend/`. Detailed AC rows (endpoint, field, rule) are in [`api/ac-traceability.md`](api/ac-traceability.md).

## Summary

| Source | Items | DONE | FRONTEND-ONLY | GAP |
|---|---|---|---|---|
| Use case (UC) | 42 | 37 | 2 | 3 |
| Screen list: screens (SL) | 23 | 23 | 0 | 0 |
| Screen list: flows (FL) | 6 | 6 | 0 | 0 |
| Screen list: UI states (UI) | 5 | 3 | 2 | 0 |
| Acceptance criteria (AC) | 54 | 50 | 4 | 0 |
| Wireframes v4 (WF) | 21 | 18 | 3 | 0 |
| **Total** | **151** | **137** | **11** | **3** |

**GAPs left (none are backend code):**
- UC-26: the team times the approver flow with a stopwatch (needs the frontend and people).
- UC-29: tests written *before* the policy engine. The engine came first in this build; its unit tests exist now (`PolicyEngineTest`), but the order can't be changed after the fact.
- UC-42: the team validates the alert thresholds (the threshold is configuration, 48 h by default; the team has to agree the value).

**Open risks** from the approval-bypass review (not requirements, recorded in [`architecture.md`](architecture.md#ways-to-bypass-approvals-skeptical-finance-auditor-review)): splitting one expense into several claims at or below 25,000 to skip the auditor is not detected; two colluding managers; no four-eyes control on finance-head policy and user changes; logout doesn't revoke tokens.

## Use case (track-a-usecase.md)

| # | Requirement | Implemented by | Proof | Status |
|---|---|---|---|---|
| UC-1 | Employee creates a claim with several line items (category, amount, date, receipt upload), saves a draft and submits | `POST /api/claims`, `/lines`, `/receipt`, `/submit` | `ClaimDraftIT.US1_AC3_...`, `SubmitPolicyIT.cleanClaim...` | DONE |
| UC-2 | Policy engine checks every line: auto-approve, route, or auto-reject with a reason | `PolicyEngine`, submit | `PolicyEngineTest`, `SubmitPolicyIT.overSoftLimitRoutesToManagerAndHardLimitAutoRejectsWithReason` | DONE |
| UC-3 | Chain: manager, auditor above 25,000, finance head above 1,00,000 | `ApprovalRouting.createChain` | `ApprovalChainIT.US8_*`, `US12_*` | DONE |
| UC-4 | Approvers comment, send back, delegate while on leave | `/comments`, `/send-back`, `/api/delegations` | `ApprovalChainIT.US4_AC1_...`, `DelegationIT.US7_*` | DONE |
| UC-5 | Auditor review queue with filters and bulk approve | `/api/auditor/queue`, `/bulk-approve` | `AuditorIT.US9_*` | DONE |
| UC-6 | Random 10% of auto-approved claims flagged for sample audit | `SampleAuditSampler` (one per block of 10), A4 endpoints | `SeedDataIT.US11_AC1_...`, `AuditorIT.US11_*` | DONE |
| UC-7 | Approved claims → payout batch → mock bank-file CSV → Paid | `/api/payouts`, `/export`, `/mark-paid` | `PayoutIT` | DONE |
| UC-8 | Dashboard: spend by category, department, month; violations; average approval time | `GET /api/dashboard` | `DashboardIT.US16_*` | DONE |
| UC-9 | Append-only audit trail records every action | `AuditService`, DB triggers | `AuditTrailIT.US17_*` | DONE |
| UC-10 | Employee sees only their own claims | `ClaimRepository.canView` (404) | `AuditTrailIT.US4_AC3_...` | DONE |
| UC-11 | Policy rules seeded as configuration, not hard-coded | `policy_version` / `policy_rule` (Flyway V2), F4 | `PolicyConfigIT` | DONE |
| UC-12 | Meals up to 1,500 per day | rule `MEALS_DAILY` (PER_DAY across claims) | `PolicyEngineTest.meals*`, `SubmitPolicyIT.mealsCapIsPerEmployeePerDayAcrossClaims` | DONE |
| UC-13 | Hotel up to 6,000/night tier-1, 4,000 others | `HOTEL_NIGHTLY_TIER1` / `_OTHER`, tier-1 city list | `PolicyEngineTest.hotel*` | DONE |
| UC-14 | Local cab up to 2,000 per trip | `LOCAL_CAB_TRIP` | `PolicyEngineTest.cabBoundariesAt2000And4000` | DONE |
| UC-15 | Receipt mandatory above 500 | submit blocker (422) | `SubmitPolicyIT.US1_AC2_...`, `US1_AC4_...` | DONE |
| UC-16 | Duplicate: same vendor+amount+date as an earlier line, or same receipt hash | engine DUPLICATE (route) / DUPLICATE_RECEIPT (auto-reject) | `SubmitPolicyIT.US2_AC2_...`, `sameReceiptHash...`, `PolicyEngineTest` | DONE |
| UC-17 | Weekend spend flagged for manager attention | `WEEKEND_EXPENSE` (route) | `SubmitPolicyIT.US2_AC3_...`, `ApprovalChainIT.US6_AC1_US6_AC3_...` | DONE |
| UC-18 | 150 employees in 8 departments with a reporting hierarchy | `DemoDataSeeder` | `SeedDataIT.seed_organisation...` | DONE |
| UC-19 | 3,000 historical claims incl. planted duplicates and limit breaches | `DemoDataSeeder` (through the real engine) | `SeedDataIT.seed_3000Claims...` | DONE |
| UC-20 | Architecture: context and container diagram | `docs/architecture.md` | review | DONE |
| UC-21 | Claim state machine | `docs/data-model.md` (Mermaid) | review | DONE |
| UC-22 | Policy-as-configuration design | `docs/architecture.md#policy-as-configuration` | review | DONE |
| UC-23 | ADR on how approval chains are modelled | `docs/adr/0001-approval-chain-model.md` | review | DONE |
| UC-24 | Review the design as a skeptical finance auditor; list ways to bypass approvals | `docs/architecture.md` bypass table (11 attempts, 4 open risks) | review | DONE |
| UC-25 | UI: mobile claim capture, side-by-side receipt viewer, dense tables with bulk actions | API: inline receipts, bulk endpoints, paging | frontend | FRONTEND-ONLY |
| UC-26 | Team tests the approver flow with a stopwatch | n/a | n/a | GAP (team activity) |
| UC-27 | Working app with full chain, policy engine and payout export | backend | all ITs; Phase 6 smoke | DONE |
| UC-28 | CLAUDE.md with business rules | `CLAUDE.md` "Business rules" | review | DONE |
| UC-29 | Tests written before the policy engine | n/a (process order) | n/a | GAP (process) |
| UC-30 | Unit tests for every policy rule | `PolicyEngineTest` (15 tests) | `mvnw verify` | DONE |
| UC-31 | Tests for approval thresholds and delegation | `ApprovalChainIT`, `DelegationIT` | `mvnw verify` | DONE |
| UC-32 | 10 written end-to-end cases | `docs/testing.md` E2E-1..10 | Phase 6 smoke | DONE |
| UC-33 | Defect log | `docs/testing.md` D-01..D-10 | review | DONE |
| UC-34 | Basic security checklist run | `docs/testing.md` checklist, `docs/security.md` | review + curl/grep checks | DONE |
| UC-35 | Rule-by-rule cases; code reviewed against common web vulnerabilities | `PolicyEngineTest`; security checklist | `mvnw verify` | DONE |
| UC-36 | Docker Compose | `docker-compose.yml` | Phase 6 fresh start | DONE |
| UC-37 | CI with tests and a dependency check | `.github/workflows/backend-ci.yml` (verify, promtool, dependency review on PRs, .env guard) | YAML validated locally; **not yet run on GitHub** | DONE |
| UC-38 | Seeded demo environment from one command | `docker compose up --build -d` | Phase 6: healthy in ~24 s with seed | DONE |
| UC-39 | Secrets are not committed | `.gitignore`, CI guard | `git check-ignore`, grep (Phase 6) | DONE |
| UC-40 | Metrics for queue size, approval age and page latency | `expenseflow_*` gauges and timer, `http_server_requests` | `MetricsIT` | DONE |
| UC-41 | Dashboard, alert, runbook | Grafana panels 1–7, `OldestPendingApprovalTooOld`, `docs/runbook.md` | promtool tests, Phase 6 checks, 2 drills | DONE |
| UC-42 | Team validates the alert thresholds | threshold = policy `overdueThresholdHours` | n/a | GAP (team activity) |

UC-25 also covers "dense but scannable data tables" (FRONTEND-ONLY). The problem statement and personas are context, not separate requirements.

## Screen list: screens

| Screen | Backend endpoints | Proof | Status |
|---|---|---|---|
| S1 Sign-in / role switch | `POST /api/auth/login`, `/me`, `/logout` (role switch inside one account is client-side) | `AuthIT` | DONE |
| S2 Notifications | `/api/notifications`, `/unread-count`, `/{id}/read`, `/read-all` | `NotificationIT` | DONE |
| S3 Audit trail (per claim) | `/api/claims/{id}/audit-trail` | `AuditTrailIT` | DONE |
| E1 My claims | `GET /api/claims` (+ `statusCounts`, `q`) | `ClaimDraftIT.US1_AC3_...`, `W4_...` | DONE |
| E2 Claim header | `POST/PATCH/DELETE /api/claims` | `ClaimDraftIT` | DONE |
| E3 Line items | `/lines` CRUD | `ClaimDraftIT`, `AuditTrailIT.US17_AC1_...` | DONE |
| E4 Line editor + live hints | `/policy-preview` with an unsaved line | `SubmitPolicyIT.US2_AC1_...` | DONE |
| E5 Receipt capture | `PUT/GET .../receipt` (hash, type, size) | `ClaimDraftIT.US3_AC2_...` | DONE |
| E6 Pre-submit check | `/policy-preview`, `/submit` (422) | `SubmitPolicyIT.US1_AC4_...` | DONE |
| E7 Claim detail | `GET /api/claims/{id}` (history, comments, steps), resubmit | `ApprovalChainIT.US4_*` | DONE |
| M1 Approval inbox | `/api/approvals/inbox` | `ApprovalChainIT.US5_AC1_...`, `W5_...` | DONE |
| M2 Claim review | claim detail + receipt | `ApprovalChainIT.US6_AC1_US6_AC3_...` | DONE |
| M3 Decision bar | `/approve`, `/send-back`, `/reject` | `ApprovalChainIT.US5_*` | DONE |
| M4 Delegation | `/api/delegations` | `DelegationIT` | DONE |
| A1 Review queue | `/api/auditor/queue` | `AuditorIT.US9_AC1_...` | DONE |
| A2 Side-by-side viewer | claim detail, inline receipt, decisions | `ApprovalChainIT.US4_AC2_...` | DONE |
| A3 Bulk action bar | `/bulk-approve`, `/bulk-send-back` | `AuditorIT` | DONE |
| A4 Sample audit | `/api/auditor/sample-audits` (+ clear/reject/send-back) | `AuditorIT.US11_*` | DONE |
| F1 Dashboard | `/api/dashboard` | `DashboardIT` | DONE |
| F2 Payout batch builder | `/api/payouts/eligible-claims`, `POST /api/payouts` | `PayoutIT.US13_*` | DONE |
| F3 Batch export | `/export`, `/mark-paid` | `PayoutIT.US13_AC3`, `US14_*` | DONE |
| F4 Policy configuration | `/api/policy/current`, `/versions` | `PolicyConfigIT` | DONE |
| F5 Users and hierarchy | `/api/users`, `PATCH /api/users/{id}`, `/api/delegations?scope=all` | `UsersAndAuditLogIT.F5_*`, `DelegationIT` | DONE |
| F6 Global audit log | `/api/audit-events` | `UsersAndAuditLogIT.F6_...` | DONE |

## Screen list: user flows

| Flow | Proof | Status |
|---|---|---|
| FL-1 Submit: E1 → E2 → E3/E4 → E5 → E6 → submit → E7 | `ClaimDraftIT`, `SubmitPolicyIT`; Phase 6 smoke | DONE |
| FL-2 Policy outcome: auto-approve / route (soft limit, flags) / auto-reject (duplicates, hard breaches) with reason | `PolicyEngineTest`, `SubmitPolicyIT` (sample tag is not a route reason, per US11-AC2; conflict C1) | DONE |
| FL-3 Chain: manager → auditor above 25,000 → head above 1,00,000; send back returns to the same approver | `ApprovalChainIT` | DONE |
| FL-4 Delegation: items route during leave, tagged in the audit trail | `DelegationIT.US7_AC1_US7_AC2_...` | DONE |
| FL-5 Audit review: filter A1, bulk approve (A3), receipts (A2), A4 separately | `AuditorIT` | DONE |
| FL-6 Payout: F2 → F3 export → Paid; employee notified | `PayoutIT`, `NotificationIT` | DONE |

## Screen list: UI states

| State | Backend support | Proof | Status |
|---|---|---|---|
| UI-1 Claim status chain + side states, both finals with reason | 12 statuses, `decisionReason` | `ApprovalChainIT`, `SubmitPolicyIT` | DONE |
| UI-2 Line states: draft, valid, receipt missing (blocks), over limit (cap + excess), duplicate, weekend | findings + `submitBlockers` | `SubmitPolicyIT`, `PolicyEngineTest` | DONE |
| UI-3 Approver item: pending, overdue, delegated, sent back, decided; sample tag | inbox `state`, `overdue`, `delegated`, `sampleAudit` | `DelegationIT.overdue...`, `DelegationIT.US7_*` | DONE |
| UI-4 Lists: loading, empty, error with retry, no permission shown as "not found" | 403/404 `ApiError` | client | FRONTEND-ONLY |
| UI-5 Mobile capture: offline draft, upload in progress, failed with retry, blur warning | idempotent client ids, PUT receipt | client (API: `ClaimDraftIT.US3_AC3_...`) | FRONTEND-ONLY |

## Acceptance criteria (all 54)

| AC | Implemented by | Test | Status |
|---|---|---|---|
| US1-AC1 | Line validation (400) | `ClaimDraftIT.US1_AC1_eachLineRequiresCategoryAmountDateAndVendor` | DONE |
| US1-AC2 | Receipt threshold blocker | `SubmitPolicyIT.US1_AC2_receiptRequiredAbove500Only` | DONE |
| US1-AC3 | Drafts persisted | `ClaimDraftIT.US1_AC3_savedDraftAppearsInMyClaimsWithTheSameContent` | DONE |
| US1-AC4 | 422 `errors[]` with line | `SubmitPolicyIT.US1_AC4_submitIsBlockedAndTheLineMissingAReceiptIsNamed` | DONE |
| US2-AC1 | Findings with rule name, limit, excess | `SubmitPolicyIT.US2_AC1_previewShowsEachLinesOutcomeWithRuleNameLimitAndExcess` | DONE |
| US2-AC2 | Matched claim/line on duplicates | `SubmitPolicyIT.US2_AC2_duplicateVendorAmountDateRoutesAndNamesTheEarlierLine` | DONE |
| US2-AC3 | Weekend = route flag | `SubmitPolicyIT.US2_AC3_weekendLineIsFlaggedAndStillSubmits` | DONE |
| US3-AC1 | Camera first | client | FRONTEND-ONLY |
| US3-AC2 | Retry keeps the line (PUT is idempotent) | client (API: `ClaimDraftIT.US3_AC2_...`) | FRONTEND-ONLY |
| US3-AC3 | Client ids, idempotent replay | `ClaimDraftIT.US3_AC3_offlineReplayReturnsExistingClaimAndLineAndDifferentContentConflicts` | DONE |
| US4-AC1 | `statusHistory`, `comments` | `ApprovalChainIT.US4_AC1_claimDetailShowsStatusHistoryAndEveryComment` | DONE |
| US4-AC2 | Resubmit to the same approver | `ApprovalChainIT.US4_AC2_replyingToASendBackResubmitsToTheSameApprover` | DONE |
| US4-AC3 | 404 for others' claims | `AuditTrailIT.US4_AC3_openingAClaimThatIsNotMineShowsNotFound` | DONE |
| US5-AC1 | Inbox oldest first | `ApprovalChainIT.US5_AC1_inboxListsTheOldestPendingClaimFirst` | DONE |
| US5-AC2 | Approve needs only `version` | `ApprovalChainIT.US5_AC2_approveTakesOnlyTheVersion` | DONE |
| US5-AC3 | Comment / reason required | `ApprovalChainIT.US5_AC3_sendBackRequiresACommentAndRejectRequiresAReason` | DONE |
| US5-AC4 | Decisions audited | `ApprovalChainIT.US5_AC4_everyDecisionAppearsInTheAuditTrail` | DONE |
| US6-AC1 | Weekend flag in review | `ApprovalChainIT.US6_AC1_US6_AC3_managerReviewShowsWeekendFlagAndNamesTheMatchedDuplicateLine` | DONE |
| US6-AC2 | Flags don't block approval | `ApprovalChainIT.US6_AC2_flagsDoNotBlockApproval` | DONE |
| US6-AC3 | Duplicate names the earlier line | `ApprovalChainIT.US6_AC1_US6_AC3_...` | DONE |
| US7-AC1 | Create delegation | `DelegationIT.US7_AC1_US7_AC2_delegateSeesItemsMarkedDelegatedAndApprovesOnBehalf` | DONE |
| US7-AC2 | Delegated items | `DelegationIT.US7_AC1_US7_AC2_...` | DONE |
| US7-AC3 | Auto-end | `DelegationIT.US7_AC3_delegationEndsAutomaticallyAfterItsEndDate` | DONE |
| US8-AC1 | Auditor above 25,000 | `ApprovalChainIT.US8_AC1_above25000MovesToPendingAuditorAfterManagerApproval` | DONE |
| US8-AC2 | Exactly 25,000 not routed | `ApprovalChainIT.US8_AC2_exactly25000DoesNotRouteToAuditor` | DONE |
| US8-AC3 | Not in auditor queue | `AuditorIT.US8_AC3_queueHoldsOnlyAuditorStageClaims` | DONE |
| US9-AC1 | Filters combine | `AuditorIT.US9_AC1_queueFiltersCombineAndListOldestFirst` | DONE |
| US9-AC2 | Bulk on selected rows | `AuditorIT.US9_AC2_US9_AC3_bulkApproveActsOnlyOnSelectedRowsAndReportsFailedRowsWithReasons` | DONE |
| US9-AC3 | Failed row reason, others succeed | same | DONE |
| US10-AC1 | Receipt beside lines, zoom (API serves inline) | client | FRONTEND-ONLY |
| US10-AC2 | Send back from the viewer | `ApprovalChainIT.US4_AC2_...` | DONE |
| US11-AC1 | Exactly 10% | `SeedDataIT.US11_AC1_exactlyOneInEveryTenAutoApprovedClaimsIsSampleTagged` | DONE |
| US11-AC2 | Only in A4 | `AuditorIT.US11_AC2_taggedClaimsAppearOnlyInTheSampleAuditWorklist` | DONE |
| US11-AC3 | Auditor and time stored | `AuditorIT.US11_AC3_clearRecordsTheAuditorAndTime` | DONE |
| US12-AC1 | Head above 1,00,000 | `ApprovalChainIT.US12_AC1_above100000NeedsFinanceHeadAfterAuditor` | DONE |
| US12-AC2 | Exactly 1,00,000 not routed | `ApprovalChainIT.US12_AC2_exactly100000DoesNotNeedFinanceHead` | DONE |
| US13-AC1 | Eligibility | `PayoutIT.US13_AC1_onlyApprovedOrClearedClaimsAreEligibleAndCanBeBatched` | DONE |
| US13-AC2 | ₹ with Indian grouping (API sends decimal strings) | client | FRONTEND-ONLY |
| US13-AC3 | CSV + IN_BATCH | `PayoutIT.US13_AC2_US13_AC3_batchTotalsCsvExportMovesClaimsToInBatch` | DONE |
| US14-AC1 | `confirm=true` | `PayoutIT.US14_AC1_US14_AC2_US14_AC3_...` | DONE |
| US14-AC2 | PAID + notify | same; `NotificationIT.S2_...` | DONE |
| US14-AC3 | 409 when already paid | same | DONE |
| US15-AC1 | Limits editable | `PolicyConfigIT.US15_AC1_US15_AC2_financeHeadPublishesAVersionWithAuthorAndDate` | DONE |
| US15-AC2 | Version author and date | same | DONE |
| US15-AC3 | New lines only | `PolicyConfigIT.US15_AC3_changesApplyToNewLinesOnlyAndPastDecisionsKeepTheirVersion` | DONE |
| US16-AC1 | Spend breakdowns | `DashboardIT.US16_AC1_spendByCategoryDepartmentAndMonthAddUpToTheTotal` | DONE |
| US16-AC2 | Violations, approval time | `DashboardIT.US16_AC2_violationsAndAverageApprovalTime` | DONE |
| US16-AC3 | Oldest pending | `DashboardIT.US16_AC3_US18_AC3_oldestPendingQueueSizesAndAgeAlert` | DONE |
| US17-AC1 | Who, when, what | `AuditTrailIT.US17_AC1_eachEntryRecordsWhoWhenAndWhatChanged` | DONE |
| US17-AC2 | No edit or delete | `AuditTrailIT.US17_AC2_auditEntriesCannotBeEditedOrDeleted` | DONE |
| US17-AC3 | Own trail only | `AuditTrailIT.US17_AC3_employeeSeesTheTrailOnlyForTheirOwnClaims` | DONE |
| US18-AC1 | Threshold in configuration | `MetricsIT.US18_AC1_queueSizeOldestPendingAndConfiguredThresholdAreExported` | DONE |
| US18-AC2 | Fires once per breach | `deploy/prometheus/alert-rules.test.yml` (promtool) | DONE |
| US18-AC3 | Queue size and age with the alert | `DashboardIT.US16_AC3_US18_AC3_...`; Grafana panels 6–7 | DONE |

## Wireframes v4

| # | Wireframe element | Backend | Proof | Status |
|---|---|---|---|---|
| WF-1 | Login with work email + password only; screen doesn't show who signs in | `POST /api/auth/login`, no user list | `AuthIT.W1_*`, `W2_noPublicUserList...` | DONE |
| WF-2 | Wrong details: "Email or password is incorrect." | same 401 for both | `AuthIT.W1_wrongPasswordAndUnknownEmailGetTheSameMessage` | DONE |
| WF-3 | Log out confirmation ("unsaved drafts will be lost") and logged-out screen | `POST /api/auth/logout` (audited) | dialog is client; API `AuthIT.W2_...` | FRONTEND-ONLY |
| WF-4 | Role switch for multi-role accounts changes screens, not the account; current role highlighted | JWT and `/me` carry all roles + `homeScreen` | client | FRONTEND-ONLY |
| WF-5 | Single-role top bar: name and role | `/api/auth/me` | `AuthIT.W1_homeScreenFollowsTheHighestRole` | DONE |
| WF-6 | New claim: category, date, vendor, amount, description; receipt required above 500; policy limits shown | lines (`notes` = description), `/api/policy/current` | `ClaimDraftIT`, `SubmitPolicyIT.US1_AC2_...` | DONE |
| WF-7 | Policy error: "Cab is over the 2,000 limit for one trip" (still submittable) | preview finding (limit, excess); ROUTE | `SubmitPolicyIT.US2_AC1_...`, `PolicyEngineTest.cabBoundaries...` | DONE |
| WF-8 | My claims: claim, amount, stage | `GET /api/claims` | `ClaimDraftIT.US1_AC3_...` | DONE |
| WF-9 | Sent back: approver's comment, Resubmit | `comments`, `/submit` | `ApprovalChainIT.US4_AC1_...` | DONE |
| WF-10 | Manager queue: filter department and band; columns claim, employee, amount, flags | inbox `departmentId`, `minAmount`, `maxAmount`; `flags` | `ApprovalChainIT.W5_inboxFiltersByDepartmentAndAmountBand` | DONE |
| WF-11 | Claim review: weekend flag, receipt preview, approve / send back | claim detail, receipt, decisions | `ApprovalChainIT.US6_AC1_US6_AC3_...` | DONE |
| WF-12 | Send back with a comment (prototype uses fixed text; API takes free text) | `/send-back` | `ApprovalChainIT.US5_AC3_...` | DONE |
| WF-13 | Manager's own claim goes to their own manager | routing | `ApprovalChainIT.nobodyApprovesTheirOwnClaim` | DONE |
| WF-14 | Auditor queue: pending auditor (above 25,000) | `/api/auditor/queue` | `AuditorIT.US9_AC1_...` | DONE |
| WF-15 | Auditor review shows "Manager approved: Ravi" | `approvalSteps[].approverName` | `ApprovalChainIT.W6_...` | DONE |
| WF-16 | Sample audit tab (prototype: fixed sample; backend: random 10%) | A4 endpoints | `AuditorIT.US11_*`, `SeedDataIT.US11_AC1_...` | DONE |
| WF-17 | Finance head queue: pending head (above 1,00,000) | inbox for FINANCE_HEAD | `ApprovalChainIT.US12_AC1_...` | DONE |
| WF-18 | Head review shows "Auditor approved: Meera" | `approverName` | `ApprovalChainIT.W6_...` | DONE |
| WF-19 | Payout: approved claims ready to pay (incl. a cleared sample), export CSV, mark paid | `/api/payouts/*` | `PayoutIT` | DONE |
| WF-20 | Dashboard overview: pending manager / auditor / head counts, approved count | dashboard `queues`; `GET /api/claims?scope=all` `statusCounts` | `DashboardIT.wireframeOverview_...` | DONE |
| WF-21 | Amounts in INR with ₹ formatting | decimal strings, currency INR | client formatting | FRONTEND-ONLY |

WF-4 supersedes the earlier decision D3 ("role switch = sign in as another user"); the backend needed no change because the JWT already carries all roles. WF-19 lists a cleared sample claim as ready to pay, which supports conflict decision C4 (cleared AUTO_APPROVED claims are payable).
