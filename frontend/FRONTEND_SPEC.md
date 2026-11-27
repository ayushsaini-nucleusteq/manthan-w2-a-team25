# ExpenseFlow frontend spec (source of truth for the UI build)

React 19, Vite 8, plain JS/JSX (no TypeScript), `react-router-dom` v7 (already installed). No other runtime dependencies: no UI kit, no chart library. Hand-written CSS with tokens. Everything runs on **mock data** behind an async API layer that mirrors the real REST contract, so it can be swapped for `fetch` later.

Lint rule to respect: `eslint-plugin-react-refresh` warns when a `.jsx` module exports anything other than components. Put hooks, contexts, constants and utils in separate `.js` files.

---

## 1. Visual design

The style takes inspiration from a corporate-finance reference site: crisp white surfaces on a light-grey page, a strong royal-blue primary, a deep-navy accent, rounded cards with soft shadows, blue gradient "hero" bands with a subtle pattern, numbered step circles, an info banner with a blue outline, and an accordion FAQ. **Do not use any real brand's name, logo, card imagery or copy.** Our brand is **ExpenseFlow**, with its own logo mark: a blue rounded square containing a white "EF" monogram, followed by the wordmark.

Make it **vibrant and interactive**: hover lifts on cards, animated focus rings, smooth 150–200 ms transitions, colourful status chips, animated progress for steps, skeleton loaders, toasts that slide in, and a gentle gradient hero on landing pages. Respect `prefers-reduced-motion`.

### Tokens (`src/styles/tokens.css`, defined on `:root`)
```
--brand-900:#00175A  (deep navy: hero text bg, footer)
--brand-700:#0049B8
--brand-600:#0061C2
--brand-500:#006FCF  (PRIMARY: buttons, links, active nav)
--brand-400:#2B8CEB
--brand-100:#E6F1FC  (selected rows, info banner bg)
--brand-50:#F2F8FE
--bg:#F4F6F8         (page background)
--surface:#FFFFFF
--surface-2:#F7F8F9  (table header, subtle panels)
--border:#D7DBE0
--border-strong:#A7ADB4
--text:#1F2933
--text-muted:#53606C
--text-inverse:#FFFFFF
--disabled-bg:#A7A9AC --disabled-text:#55595E   (grey disabled button, as in the reference login)
--success:#00875A --success-bg:#E3F6EE
--warning:#B76E00 --warning-bg:#FFF3DC
--danger:#C62828  --danger-bg:#FDECEC
--info:#007C89    --info-bg:#E0F5F7
--purple:#6B4EFF  --purple-bg:#EEEAFF   (sample-audit tag)
--radius-sm:6px --radius:10px --radius-lg:14px --radius-pill:999px
--shadow-1:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.10)
--shadow-2:0 4px 12px rgba(16,24,40,.10)
--shadow-3:0 12px 32px rgba(0,23,90,.18)
--font: "Source Sans 3", "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif
--mono: ui-monospace, "Cascadia Code", Consolas, monospace
--nav-h:64px
```
Load Google Font `Source Sans 3` (400, 600, 700) in `index.html`, with the system fallback. Set the page title to "ExpenseFlow".

### Layout patterns
- **Top navbar** (white, bottom border, sticky, height `--nav-h`). Left: logo + wordmark. Next to it: primary links for the active role, in blue text, with a 3 px underline on the active link. Right: a search-style icon button (optional), a notifications bell with an unread badge, the **role switch** (segmented pill, shown only when the user holds more than one role; the active segment is a filled blue pill), the user's name and role, and a filled **Log out** button. Below 900 px the links collapse into a hamburger that opens a slide-down panel.
- **Sub-nav** (second row, white, blue links) where a section has tabs, e.g. the M1 inbox tabs and the auditor Queue/Sample audit tabs.
- **Page header band**: blue gradient (`--brand-500` → `--brand-700`) with a faint repeating pattern (CSS `repeating-radial-gradient`, about 6 % white), a white H1 and a subtitle. It is used on landing screens (E1, M1, A1, F1). Other screens get a plain H1 with breadcrumbs ("Home / My claims / EXP-2026-000123").
- **Content**: max-width 1280 px, centred, 24 px gutter (16 px on mobile). Cards are white, `--radius-lg`, `--shadow-1`, and lift to `--shadow-2` with a 2 px translateY on hover when they are clickable.
- **Info banner**: rounded box with a 1.5 px `--brand-500` border and a circled "i" icon. Use it for policy notes and offline notices.
- **Step indicator**: numbered circles (2 px blue ring, blue number). A completed step is a filled blue circle with a white tick, and connecting lines fill blue as you progress.
- **Accordion**: rounded white items with a blue chevron. Used for "How policy rules work" help on E4/E6 and F4.
- **Floating help button**: bottom-right filled blue pill ("Need help?") that opens a small panel listing the policy limits. Shown on employee screens.
- **Buttons**: primary (filled `--brand-500`, white text, `--radius-sm`, hover `--brand-600`); secondary (white with a blue border and blue text); ghost (blue text); danger (filled `--danger`); disabled (`--disabled-bg`, `--disabled-text`, not-allowed cursor). Sizes sm/md/lg. A loading state shows a spinner inside the button and disables it.
- **Inputs**: 48 px height, 1 px `--border-strong` border, `--radius-sm`, optional left icon, a blue 3 px focus ring (`box-shadow: 0 0 0 3px var(--brand-100)` plus a blue border). Errors get a red border and a red helper text with an icon. Labels go above the field, and required fields get a red `*`.
- **Status chips** (pill, 12 px, semibold). Each status maps to a colour and a human label:
  DRAFT "Draft" (grey) · SUBMITTED "Submitted" (blue) · AUTO_APPROVED "Auto-approved" (green) · PENDING_MANAGER "Pending manager" (amber) · PENDING_AUDITOR "Pending auditor" (amber) · PENDING_FINANCE_HEAD "Pending head" (amber) · APPROVED "Approved" (green) · SENT_BACK "Sent back" (purple) · REJECTED "Rejected" (red) · AUTO_REJECTED "Auto-rejected" (red) · IN_BATCH "In batch" (teal) · PAID "Paid" (navy filled).
- **Policy outcome badges**: AUTO_APPROVE "Auto-approve" (green, tick icon) · ROUTE "Route for approval" (amber, arrow icon) · AUTO_REJECT "Reject" (red, cross icon). Flag tags: WEEKEND "Weekend", DUPLICATE "Possible duplicate", SOFT_LIMIT "Over limit", SAMPLE "Sample audit" (purple), DELEGATED "Delegated", OVERDUE "Overdue" (red).
- **Data tables (dense, scannable)**: sticky header on `--surface-2`, 40 px rows, zebra on hover only, right-aligned tabular-num money columns, sortable headers with an arrow, a row checkbox column for bulk actions, a selected row shown in `--brand-100`, and a sticky **bulk action bar** that slides up from the bottom showing "N selected" and the action buttons. Below 720 px each row renders as a card (label: value pairs) with its checkbox kept.
- **Money**: always `₹` with Indian grouping (`₹1,20,000.00`, via `Intl.NumberFormat('en-IN', {style:'currency', currency:'INR'})`). Use `font-variant-numeric: tabular-nums`.
- **Dates**: `27 Nov 2026`; date-times `27 Nov 2026, 14:05`; relative ages "3 d 4 h".
- Icons: inline SVG components in `src/components/icons.jsx` (stroke 1.75, currentColor). No icon library.

### Required states everywhere
Every list, table, detail page and dashboard handles:
- **loading**: skeleton rows or cards, or a centred `Spinner` with a label;
- **empty**: illustration-style icon, a message and a call to action;
- **error with retry**: message plus a "Try again" button that re-runs the request;
- **no permission**: shown as **"Not found"**, never "forbidden" (US4-AC3). The API's 403 and 404 both map to `<NotFound/>`.
Global pieces: `ErrorBoundary` with a friendly crash page ("Something went wrong", reload button, error id); a 404 page for unknown routes; a toasts provider for success and error feedback; an offline banner when `navigator.onLine` is false.

### Responsive
Breakpoints are 480 / 720 / 900 / 1200 px. Mobile-first claim capture: full-width cards, sticky bottom action bar, large tap targets (min 44 px), the camera opens first. Tablet: two columns where useful. Approver review screens use a **side-by-side layout** on ≥ 900 px (lines left, receipt right, resizable or 55/45) and stack on smaller screens with a "View receipt" toggle.

### Multi-step forms (IMPORTANT: user requirement)
Don't put every input in one long form. Split it into **2–3 columns on a single page** (desktop/tablet ≥ 900 px). Each column is a "step panel" with a numbered circle header. **A column is disabled (dimmed, `aria-disabled`, inputs disabled, overlay message "Complete step N first") until the previous column passes all validations.** Under 900 px the columns become a stepper: one panel at a time, with Next/Back, and Next is enabled only when the current panel is valid. Validation is inline, runs on blur and on change after the first blur, and the messages say exactly what is needed. The shared `StepColumns` component implements this.

Applies to:
- **New/Edit claim (E2–E6)**: Column 1 "Claim details" (title*, purpose, trip start/end dates; INR shown fixed) → Column 2 "Line items" (list of line cards with a running total; the "Add line" button opens the Line editor) → Column 3 "Review & submit" (E6 pre-submit check: per-line outcome, findings with rule name and limit, submit blockers naming the lines; the Submit button is enabled only when there are no blockers; also has a Save draft button).
- **Line editor (E4 + E5)** in a modal or bottom sheet on mobile, with 2 columns: A "Expense" (category*, amount*, date*, vendor*, notes; plus city* and nights* when the category is Hotel; live policy hints from `policyPreview`) → B "Receipt" (enabled when A is valid; required when amount > receipt threshold; the camera opens first on mobile; shows upload progress, failure with retry while keeping the line, preview, SHA-256, and an optional blur warning).
- **Delegation (M4)**: 1 "Choose delegate" → 2 "Leave dates & reason" → 3 "Confirm".
- **Policy configuration (F4)**: 1 "Spending limits" (soft/hard per rule, receipt threshold, weekend flag toggle, overdue threshold hours, sample percent) → 2 "Tier-1 cities" (chips, add/remove) → 3 "Review & publish" (diff vs current version, change note*, publish).
- **Payout (F2→F3)**: 1 "Select approved claims" → 2 "Review batch" (count, total) → 3 "Export & mark paid".

---

## 2. Routes and file paths (fixed; agents must use exactly these)

`src/App.jsx` defines all routes. Pages are default exports.

| Route | Page file | Screen | Roles |
|---|---|---|---|
| `/login` | `src/pages/shared/LoginPage.jsx` | S1 Sign-in: pick a user (backend contract) | public |
| `/signed-out` | `src/pages/shared/SignedOutPage.jsx` | "You have been logged out" | public |
| `/` | redirect to the active role's home | | any |
| `/notifications` | `src/pages/shared/NotificationsPage.jsx` | S2 | any |
| `/claims/:id/audit` | `src/pages/shared/ClaimAuditTrailPage.jsx` | S3 | owner or approver/auditor/head |
| `/claims` | `src/pages/employee/MyClaimsPage.jsx` | E1 | EMPLOYEE |
| `/claims/new` | `src/pages/employee/ClaimFormPage.jsx` | E2–E6 | EMPLOYEE |
| `/claims/:id/edit` | `src/pages/employee/ClaimFormPage.jsx` | E2–E6 (draft / sent back) | EMPLOYEE owner |
| `/claims/:id` | `src/pages/employee/ClaimDetailPage.jsx` | E7 | EMPLOYEE owner |
| `/approvals` | `src/pages/manager/ApprovalInboxPage.jsx` | M1 (also used by finance head for US12) | MANAGER, FINANCE_HEAD |
| `/approvals/:claimId` | `src/pages/manager/ClaimReviewPage.jsx` | M2 + M3 decision bar | MANAGER, FINANCE_HEAD |
| `/delegation` | `src/pages/manager/DelegationPage.jsx` | M4 | MANAGER, AUDITOR, FINANCE_HEAD |
| `/audit/queue` | `src/pages/auditor/ReviewQueuePage.jsx` | A1 + A3 | AUDITOR |
| `/audit/claims/:claimId` | `src/pages/auditor/ReceiptViewerPage.jsx` | A2 | AUDITOR |
| `/audit/samples` | `src/pages/auditor/SampleAuditPage.jsx` | A4 (list + inline review) | AUDITOR |
| `/finance/dashboard` | `src/pages/finance/DashboardPage.jsx` | F1 | FINANCE_HEAD |
| `/finance/payouts` | `src/pages/finance/PayoutsPage.jsx` | F2 (batch list + builder stepper) | FINANCE_HEAD |
| `/finance/payouts/:batchId` | `src/pages/finance/PayoutBatchPage.jsx` | F3 | FINANCE_HEAD |
| `/finance/policy` | `src/pages/finance/PolicyConfigPage.jsx` | F4 | FINANCE_HEAD |
| `/finance/users` | `src/pages/finance/UsersPage.jsx` | F5 | FINANCE_HEAD |
| `/finance/audit-log` | `src/pages/finance/AuditLogPage.jsx` | F6 | FINANCE_HEAD, AUDITOR |
| `*` | `src/pages/shared/NotFoundPage.jsx` | 404 | any |

Home per active role: EMPLOYEE → `/claims`, MANAGER → `/approvals`, AUDITOR → `/audit/queue`, FINANCE_HEAD → `/finance/dashboard`.

Nav links per active role:
- EMPLOYEE: My claims, New claim, Notifications.
- MANAGER: Approvals, Delegation, Notifications.
- AUDITOR: Review queue, Sample audit, Audit log, Delegation.
- FINANCE_HEAD: Dashboard, Approvals, Payouts, Policy, Users, Audit log.

Route guard `RequireAuth` redirects to `/login?next=…` when signed out. `RequireRole roles=[…]` renders `<NotFoundPage/>` if the user holds none of the roles. If the user holds the role but a different one is active, it switches the active role automatically. Lazy-load the pages (`React.lazy` + `Suspense` with `PageLoader`).

---

## 3. Shared frontend modules (foundation; built first)

```
src/main.jsx                      BrowserRouter + ErrorBoundary + ToastProvider + AuthProvider + App
src/App.jsx                       routes (lazy pages), AppShell layout route
src/styles/tokens.css             tokens above
src/styles/base.css               reset, typography, links, focus, utilities (.sr-only, .stack, .row, .grid, .muted, .num)
src/styles/components.css         styles for all shared components
src/auth/authContext.js           createContext
src/auth/AuthProvider.jsx         holds {user, roles, activeRole, token}; loadPickerUsers(q), login(userId), logout(), switchRole(role); default activeRole = the role for `homeScreen` from /me (highest role); persists the session in sessionStorage
src/auth/useAuth.js               hook
src/auth/RequireAuth.jsx, src/auth/RequireRole.jsx
src/components/AppShell.jsx       navbar + sub-nav slot + <Outlet/> + offline banner + floating help (employee)
src/components/NavBar.jsx, RoleSwitch.jsx, NotificationBell.jsx, Logo.jsx, LogoutDialog.jsx
src/components/Button.jsx, Spinner.jsx, PageLoader.jsx, Skeleton.jsx
src/components/ErrorState.jsx (message + retry), EmptyState.jsx, NotFound.jsx (reusable "Not found" block)
src/components/ErrorBoundary.jsx
src/components/StatusChip.jsx, OutcomeBadge.jsx, FlagTag.jsx, Money.jsx
src/components/Modal.jsx (focus trap, Esc, bottom sheet on mobile), ConfirmDialog.jsx
src/components/toast/ToastProvider.jsx + src/components/toast/useToast.js + toastContext.js
src/components/DataTable.jsx      columns [{key, header, render?, align?, sortable?, width?, mobileLabel?}], rows, rowKey, selectable, selectedIds, onSelectionChange, isRowSelectable(row) → bool|string (string = reason, shown as a tooltip), sort, onSortChange, loading, error, onRetry, empty, dense, onRowClick; renders skeleton/error/empty states; card layout under 720 px
src/components/BulkActionBar.jsx  sticky bar: "N selected", children buttons, clear selection
src/components/FormField.jsx      label, required, hint, error; renders children
src/components/TextInput.jsx, Select.jsx, TextArea.jsx, DateInput.jsx, Checkbox.jsx, Toggle.jsx
src/components/StepColumns.jsx    props: steps [{id, title, description, valid:boolean, content:ReactNode}], onComplete?; desktop columns with gating, mobile stepper with Next/Back; numbered circle headers
src/components/StepIndicator.jsx  numbered circles
src/components/InfoBanner.jsx, Accordion.jsx, Tabs.jsx (sub-nav style, with counts), Breadcrumbs.jsx, PageHeader.jsx (hero band variant + plain variant), Card.jsx, StatTile.jsx
src/components/ReceiptViewer.jsx  image/pdf preview, zoom in/out/reset, rotate, fit; loading/error states; for PDFs (mock) show the image placeholder
src/components/Timeline.jsx       status history + comments merged chronologically
src/components/FilterBar.jsx      wraps filter controls, "Clear all"
src/components/icons.jsx          named icon components
src/hooks/useAsync.js             (fn, deps) → {data, error, loading, reload, setData}
src/hooks/useOnlineStatus.js, useMediaQuery.js, useDebounce.js
src/utils/format.js               formatMoney, formatDate, formatDateTime, formatAge(hours|ms), statusLabel, outcomeLabel
src/utils/constants.js            STATUS, STATUS_META (label, tone), ROLES, ROLE_LABEL, ROLE_HOME, NAV_BY_ROLE, CATEGORY_META
src/utils/validation.js           validators for claim header, line, delegation, policy
```

---

## 4. Mock API contract (`src/api/`)

All functions are **async**, add a simulated latency of 250–700 ms, and **throw `ApiError`** (`src/api/errors.js`: `class ApiError extends Error {status, code, details}`) on failure. Status codes are 400, 401, 404 (also used for not-yours), 409 (version/state conflict) and 422 (blocked, with `details`). The session token comes from `src/api/session.js` (`getSession()/setSession()/clearSession()`). The mock reads the current user from it and enforces permissions exactly like the server would: an employee sees only their own claims, approval actions only work for the current assignee, pool member or active delegate, and nobody acts on their own claim.

Persistence: the in-memory store is seeded on first load and saved to `localStorage` key `expenseflow.mock.v1` (wrapped in try/catch). `resetMockData()` re-seeds it. Failure injection: if `localStorage['expenseflow.mock.failRate']` is set (0–1), requests fail randomly with a 500 `ApiError` so error states can be demoed. A small "Demo tools" item in the user menu sets the fail rate (0 / 0.3) and resets the data.

Switching to the real backend later: `src/api/index.js` re-exports from `./mock/*.js`. Put a comment explaining how to swap to an `http.js` implementation (`import.meta.env.VITE_API_BASE_URL`).

### Backend contract wins
The backend team's endpoint map (below) is authoritative. Each mock function has a JSDoc line naming the endpoint it mirrors. Where anything else in this spec disagrees with the map, follow the map.
- S1: `GET /api/auth/users` (public picker, `q` search) · `POST /api/auth/login` (`userId` → 8 h JWT, `LOGIN` audited) · `GET /api/auth/me` (`homeScreen` = highest role). Only when `DEMO_LOGIN_ENABLED=true`, which is a demo-only limitation. **There are no passwords.** The JWT carries all of the user's roles. The in-app role switch (wireframes) only changes which screens are shown, and "Switch user" signs out back to the picker.
- S2: `GET /api/notifications?unread=` · `GET /api/notifications/unread-count` · `POST /api/notifications/{id}/read` · `POST /api/notifications/read-all`. S3: `GET /api/claims/{id}/audit-trail`.
- E1: `GET /api/claims?scope=mine&status=&q=` (`statusCounts`). E2: `POST /api/claims` (optional client `id`) · `PATCH /api/claims/{id}` · `DELETE /api/claims/{id}` · `GET /api/claims/{id}`. E3: `POST /api/claims/{id}/lines` (optional client `id`) · `PUT /api/claims/{id}/lines/{lineId}` · `DELETE …/lines/{lineId}` (each returns the claim with `totalAmount`). E4: `GET /api/expense-categories` · `GET /api/policy/current` · `POST /api/claims/{id}/policy-preview` `{line, lineId, hasReceipt}`. E5: `PUT /api/claims/{id}/lines/{lineId}/receipt` (returns `sha256`; a retry is safe) · `GET …/receipt`. E6: `POST /api/claims/{id}/policy-preview` (no body) → per-line `findings`, `submitBlockers`, then `POST /api/claims/{id}/submit` (422 names the blocked lines). E7: `GET /api/claims/{id}` (`statusHistory`, `comments`, `approvalSteps`, `decisionReason`) · `POST /api/claims/{id}/submit` with `comment` (a reply resubmits to the same approver) · `POST /api/claims/{id}/comments`.
- M1: `GET /api/approvals/inbox?state=PENDING|OVERDUE|SENT_BACK|DECIDED` (items carry `overdue`, `delegated`, `onBehalfOf`). M2: `GET /api/claims/{id}` + receipt. M3: `POST /api/claims/{id}/approve|send-back|reject` · `POST /api/claims/{id}/comments`. M4: `GET /api/users?role=MANAGER` · `GET /api/delegations?scope=given` · `POST /api/delegations` · `DELETE /api/delegations/{id}`.
- A1: `GET /api/auditor/queue?amountBand=&departmentId=&flag=&minAgeHours=` · `GET /api/departments` (**no sample-tag filter**: tagged claims are only in A4). A2: claim + receipt + approve/send-back/reject. A3: `POST /api/auditor/queue/bulk-approve` · `POST /api/auditor/queue/bulk-send-back` (per-row results). A4: `GET /api/auditor/sample-audits?status=` · `POST /api/auditor/sample-audits/{id}/clear|reject|send-back`.
- F1: `GET /api/dashboard?from=&to=&departmentId=` (`queues`, `oldestPending`, `approvalAgeAlert`). F2: `GET /api/payouts/eligible-claims` · `POST /api/payouts` `{claimIds}` · `GET /api/payouts`. F3: `GET /api/payouts/{id}` · `GET /api/payouts/{id}/export` (claims → IN_BATCH) · `POST /api/payouts/{id}/mark-paid` `{confirm: true}`. F4: `GET /api/policy/current` · `GET /api/policy/versions` · `GET /api/policy/versions/{n}` · `POST /api/policy/versions` · `GET /api/expense-categories`. F5: `GET /api/users` · `PATCH /api/users/{id}` (manager, roles, active) · `GET /api/delegations?scope=all` · `DELETE /api/delegations/{id}`. F6: `GET /api/audit-events?claimId=&actorId=&action=&entityType=&from=&to=`.
- The finance head approves from the same inbox as managers (M1–M3). A claim you can't see returns 404 and is shown as "Not found". Money is a string such as "1500.00".

### Money is a string (backend contract)
Every money field in every shape (`amount`, `totalAmount`, `limitValue`, `actualValue`, `excessValue`, policy limits and thresholds, dashboard amounts, batch totals) is a **decimal string with 2 places**, for example `"1500.00"`, exactly as the real backend sends it. Requests send money as strings too. Never do float maths on money. `src/utils/money.js` provides `toPaise(str|number) → integer`, `fromPaise(int) → "1500.00"`, `addMoney(...strs) → string`, `compareMoney(a, b) → -1|0|1` and `parseMoneyInput(userText) → string|null`. `formatMoney` accepts a string or a number. The mock stores and returns strings and uses paise integers internally.

### Shapes
```
User { id, email, fullName, employeeCode, departmentId, departmentName, managerId, managerName, roles: string[], active }
Session { token, user: User, expiresAt }
Category { code: 'MEALS'|'HOTEL'|'LOCAL_CAB'|'AIRFARE'|'TRAIN'|'OTHER', name, requiresHotelDetails }
Receipt { id, fileName, contentType, sizeBytes, sha256, url, uploadedAt }   // url = object URL or data: SVG for seeds
Finding { ruleCode, ruleName, reasonCode, outcome: 'AUTO_APPROVE'|'ROUTE'|'AUTO_REJECT', message,
          limitType: 'SOFT'|'HARD'|null, unit: 'PER_DAY'|'PER_NIGHT'|'PER_TRIP'|null,
          limitValue, actualValue, excessValue, matchedClaimNumber|null, matchedLineNo|null }
Line { id, lineNo, category, amount, expenseDate, vendor, notes, city, nights, receipt: Receipt|null,
       policyOutcome|null, findings: Finding[], flags: string[] /* WEEKEND, DUPLICATE, SOFT_LIMIT */ }
ApprovalStep { id, sequence, stepType: 'MANAGER'|'AUDITOR'|'FINANCE_HEAD'|'SAMPLE_AUDIT', requiredRole,
               assigneeName|null, status: 'WAITING'|'PENDING'|'APPROVED'|'REJECTED'|'SENT_BACK'|'CANCELLED',
               pendingSince|null, actedByName|null, onBehalfOfName|null, actedAt|null, comment|null }
HistoryEntry { at, fromStatus|null, toStatus, actorName|null, onBehalfOfName|null, note|null }
Comment { id, at, authorName, authorRole, kind: 'COMMENT'|'SEND_BACK'|'REPLY'|'REJECT_REASON'|'APPROVE_NOTE', text }
Claim { id, claimNumber, employeeId, employeeName, departmentId, departmentName, title, purpose,
        tripStartDate, tripEndDate, currency: 'INR', status, totalAmount, submissionNo, policyOutcome|null,
        decisionReason|null, sampleAudit: boolean, sampleAuditStatus: null|'PENDING'|'CLEARED'|'REJECTED'|'SENT_BACK',
        submittedAt|null, decidedAt|null, paidAt|null, createdAt, updatedAt, version,
        lines: Line[], approvalSteps: ApprovalStep[], statusHistory: HistoryEntry[], comments: Comment[],
        flags: string[], currentStep: ApprovalStep|null, editable: boolean }
ClaimSummary { id, claimNumber, title, employeeName, departmentName, status, totalAmount, lineCount, submittedAt, updatedAt, flags, sampleAudit }
InboxItem { claimId, claimNumber, title, employeeName, departmentName, totalAmount, stepType, pendingSince,
            ageHours, overdue, delegated, onBehalfOfName|null, flags: string[], status, decision|null, decidedAt|null }
PolicyVersion { versionNo, changeNote, createdByName|null, createdAt, receiptThreshold, weekendFlagEnabled,
                overdueThresholdHours, autoApproveMaxTotal, auditorAboveTotal, financeHeadAboveTotal, samplePercent,
                submissionWindowDays, rules: [{code, name, category, unit, cityTier|null, softLimit, hardLimit}],
                tier1Cities: string[] }
Delegation { id, delegatorId, delegatorName, delegateId, delegateName, startsOn, endsOn, reason, active, revokedAt|null, createdAt }
Notification { id, type: 'APPROVAL_WAITING'|'SENT_BACK'|'PAYOUT_DONE'|'CLAIM_DECIDED', title, message, claimId|null, payoutBatchId|null, createdAt, readAt|null }
PayoutBatch { id, batchNumber, status: 'CREATED'|'EXPORTED'|'PAID', claimCount, totalAmount, createdByName, createdAt,
              exportedAt|null, fileSha256|null, paidAt|null, paidByName|null, bankReference|null, version,
              items: [{claimId, claimNumber, employeeName, employeeCode, amount, bankAccountMasked, ifscCode}] }
AuditEvent { id, occurredAt, actorName|null, onBehalfOfName|null, action, entityType, entityId, claimId|null, claimNumber|null,
             fromStatus|null, toStatus|null, comment|null, details: object|null }
Dashboard { spendByCategory: [{category, amount}], spendByDepartment: [{departmentName, amount}],
            spendByMonth: [{month:'2026-06', amount}], violations: {total, byReason: [{reasonCode, label, count}]},
            avgApprovalHours, queues: {manager, auditor, financeHead, sampleAudit, total},
            oldestPending: {claimId, claimNumber, stepType, assigneeName, pendingSince, ageHours}|null,
            approvalAgeAlert: {active, thresholdHours, openedAt|null, claimNumber|null} }
```

### Functions (module: export)
- `auth.js` (BACKEND CONTRACT, S1): `listLoginUsers({q})` mirrors `GET /api/auth/users?q=` (public, no token) → `[{id, fullName, employeeCode, departmentName, roles}]`, active users only, matched case-insensitively on name or employee code, max 50, sorted by name; `login(userId)` mirrors `POST /api/auth/login {userId}` → Session `{token, user, expiresAt (now + 8 h), homeScreen: 'F1'|'A1'|'M1'|'E1'}` (404 unknown or inactive user; a `LOGIN` audit event is written); `me()` mirrors `GET /api/auth/me` → `{...User, homeScreen}`; `logout()` (client-side only: clears the session). When `isDemoLoginEnabled()` (reads `import.meta.env.VITE_DEMO_LOGIN_ENABLED`, default true) is false, both throw 403 `DEMO_LOGIN_DISABLED`. homeScreen = highest role: FINANCE_HEAD→F1, AUDITOR→A1, MANAGER→M1, else E1.
- `claims.js`: `listMyClaims({status, q})` → `{items: ClaimSummary[], statusCounts: {STATUS: n}}`; `getClaim(id)` → Claim (404 if not visible); `createClaim({id?, title, purpose, tripStartDate, tripEndDate})` → Claim; `updateClaim(id, patch)`; `deleteClaim(id)` (draft never submitted only); `addLine(claimId, {id?, category, amount, expenseDate, vendor, notes, city, nights})` → Claim; `updateLine(claimId, lineId, patch)` → Claim; `deleteLine(claimId, lineId)` → Claim; `uploadReceipt(claimId, lineId, file, {onProgress})` → Receipt (computes SHA-256 with `crypto.subtle`; simulates progress; a file > 5 MB or of the wrong type → 400); `removeReceipt(claimId, lineId)`; `policyPreview(claimId, {line?, lineId?, hasReceipt?})` → `{lines: [{lineId, lineNo, outcome, findings}], claimOutcome, totalAmount, submitBlockers: [{lineId, lineNo, code: 'RECEIPT_REQUIRED'|'FUTURE_DATE'|'TOO_OLD'|'MISSING_FIELDS', message}], routePreview: ['MANAGER','AUDITOR',…]}` (when `line` is given, it evaluates just that draft line for live hints); `submitClaim(id, {comment?})` → Claim (422 with `details.blockers` if blocked); `addComment(id, text)` → Claim; `getAuditTrail(claimId)` → AuditEvent[].
- `approvals.js`: `getInbox({state: 'PENDING'|'OVERDUE'|'SENT_BACK'|'DECIDED'})` → `{items: InboxItem[], counts}` (oldest first for PENDING/OVERDUE); `getReviewClaim(claimId)` → Claim (visible to the current approver); `approve(claimId, {comment?, version})`; `sendBack(claimId, {comment, version})` (comment required, else 400); `reject(claimId, {reason, version})` (reason required). Each returns the Claim. Decisions are audited.
- `delegations.js`: `listDelegateCandidates({q})` mirrors `GET /api/users?role=MANAGER` (returns UserSummary without bank details; excludes self; for auditors/heads also include users holding the same role); `listDelegations({scope: 'given'|'received'|'all'})`; `createDelegation({delegateId, startsOn, endsOn, reason})` (409 if overlapping); `revokeDelegation(id)`.
- `auditor.js`: `getAuditorQueue({amountBand: 'ALL'|'25K_50K'|'50K_1L'|'1L_PLUS', departmentId, flag, minAgeHours, q})` → `{items: InboxItem[]}`; `bulkApprove(claimIds)` → `{results: [{claimId, claimNumber, ok, error|null}]}` (rows with a ROUTE finding fail with "Needs individual review: has policy flags"); `bulkSendBack(claimIds, comment)` → same shape; `listSampleAudits({status: 'PENDING'|'DONE'})` → `{items: ClaimSummary & {sampleAuditStatus, sampledAt, auditedByName, auditedAt}}`; `clearSample(claimId)`, `rejectSample(claimId, reason)`, `sendBackSample(claimId, comment)` → Claim.
- `reference.js`: `listCategories()`, `listDepartments()`, `getCurrentPolicy()` → PolicyVersion.
- `policy.js`: `listPolicyVersions()` → PolicyVersion[] (newest first); `getPolicyVersion(n)`; `publishPolicyVersion({basedOnVersionNo, changeNote, ...fields})` → PolicyVersion (409 if `basedOnVersionNo` is stale).
- `dashboard.js`: `getDashboard({from, to, departmentId})` → Dashboard.
- `payouts.js`: `listEligibleClaims()` → ClaimSummary[] (APPROVED, or AUTO_APPROVED with no pending sample audit, not already reserved); `createBatch(claimIds)` → PayoutBatch; `listBatches()`; `getBatch(id)`; `exportBatch(id)` → `{fileName, csv, sha256, batch}` (CREATED→EXPORTED, claims → IN_BATCH; a re-export returns the same file); `markPaid(id, {confirm: true, bankReference})` → PayoutBatch (409 if already PAID; claims → PAID, employees notified). (No cancel endpoint exists in the backend contract, so do not build one.)
- `users.js`: `listUsers({q, role, departmentId})` → User[]; `updateUser(id, {managerId, roles, active})` → User (cycle → 422; can't remove the last FINANCE_HEAD → 422; audited).
- `notifications.js`: `listNotifications({unread})`, `unreadCount()`, `markRead(id)`, `markAllRead()`.
- `audit.js`: `listAuditEvents({claimId, actorQ, action, entityType, from, to, page, pageSize})` → `{items, total}`.
- `index.js`: `export * as authApi from './mock/auth.js'` etc. Pages import `{ claimsApi } from '../../api'`.
- `mock/devtools.js`: `resetMockData()`, `setFailRate(n)`, `getFailRate()`.

### Business rules the mock must implement (from the agreed architecture)
- Policy (seed version 1): receipt threshold ₹500. `MEALS_DAILY` soft ₹1,500 / hard ₹3,000 per day (summed across the employee's in-scope lines for that date). `HOTEL_NIGHTLY_TIER1` ₹6,000/₹12,000 per night. `HOTEL_NIGHTLY_OTHER` ₹4,000/₹8,000. `LOCAL_CAB_TRIP` ₹2,000/₹4,000 per trip. AIRFARE, TRAIN and OTHER have no rule, so they ROUTE with `NO_POLICY_RULE`. Tier-1 cities: Ahmedabad, Bengaluru, Chennai, Delhi, Hyderabad, Kolkata, Mumbai, Pune. Weekend flag on. Overdue threshold 48 h. Auto-approve max total ₹25,000. Auditor above ₹25,000. Head above ₹1,00,000. Sample 10 %. Submission window 60 days.
- Outcomes: over soft → ROUTE `SOFT_LIMIT_EXCEEDED` (with the excess); over hard → AUTO_REJECT `HARD_LIMIT_EXCEEDED`; same receipt SHA-256 on any other in-scope line (any employee) → AUTO_REJECT `DUPLICATE_RECEIPT` (the matched claim number is shown only if it is the same employee's, otherwise "matches a receipt on another employee's claim"); same vendor (case/space-normalised) + amount + date as another in-scope line of the same employee → ROUTE `DUPLICATE` with the matched claim number and line no; Saturday/Sunday → ROUTE `WEEKEND_EXPENSE` (flag only); within limit → AUTO_APPROVE `WITHIN_LIMIT`. A line's outcome is its worst finding; the claim's outcome is its worst line.
- Submit blockers (422, never findings): missing receipt when amount > threshold (names the line), future date, date older than 60 days, missing required fields, zero lines.
- After submit: any AUTO_REJECT → `AUTO_REJECTED` (final; `decisionReason` summarises the findings). On first submit, if every line is AUTO_APPROVE and the total ≤ auto-approve max → `AUTO_APPROVED`, and the sample block decides the tag: exactly 1 per block of 10, at a random position chosen when the block opens. The finance head's own claims are always sampled. Otherwise the chain is MANAGER (+ AUDITOR if total > 25,000; + FINANCE_HEAD if total > 1,00,000) → status PENDING_MANAGER.
- Approver resolution: MANAGER step → the owner's manager. If the owner has no manager: when the owner is a FINANCE_HEAD → an AUDITOR step as the final approver plus forced sample; otherwise → the FINANCE_HEAD pool. AUDITOR and FINANCE_HEAD steps are role pools that exclude the owner. One person cannot act on two steps of the same claim (they get 409 "You already acted on this claim"). Active delegations (today within the inclusive starts_on–ends_on dates, not revoked, non-transitive) let the delegate act for the delegator, recorded as `onBehalfOf`; such inbox items show "Delegated".
- Approve moves to the next step or to APPROVED. Send back (comment required) → SENT_BACK, the claim becomes editable, and the employee is notified. Reject (reason required) → REJECTED (final).
- Resubmit after a send-back: the lines hash is compared with the last submission. If the lines changed (amount/category/date/vendor/city/nights, or lines added or removed), policy re-runs and the chain restarts at MANAGER. Otherwise it goes back to the approver who sent it back. The reply comment is stored as kind REPLY.
- Sample audit: a tagged AUTO_APPROVED claim appears only in A4 and can't be paid until cleared. Reject → REJECTED. Send back → SENT_BACK.
- Payout eligibility as above. A claim can be in only one batch. The CSV format (mock bank file) has header `RECORD_TYPE,BATCH_NO,CLAIM_NO,EMPLOYEE_CODE,EMPLOYEE_NAME,ACCOUNT_NO,IFSC,AMOUNT,NARRATION`, then `H` (header), `D` (detail) and `T` (trailer with count and control total) rows; amounts have 2 decimals and no grouping.
- Every state change writes an AuditEvent (actor, onBehalfOf, from/to, comment, details `{changes}`), and the trail is append-only (no update/delete functions exist). Employees see the trail only for their own claims. In details shown to an employee, matched claim IDs that belong to other employees are stripped.
- Notifications are created for APPROVAL_WAITING (assignees/pool + delegates), SENT_BACK (owner), CLAIM_DECIDED (owner), and PAYOUT_DONE (owner).

### Seed data (deterministic: seeded PRNG, e.g. mulberry32(2026))
- 8 departments: Engineering, Sales, Marketing, Finance, HR, Operations, Customer Success, Legal.
- About 60 users with a hierarchy: 1 finance head (no manager), 3 auditors, 8 managers (one per department, reporting to the finance head), and the rest employees reporting to their department's manager. Everyone has EMPLOYEE. Managers also have MANAGER. Auditors have AUDITOR + EMPLOYEE (report to the finance head). The finance head has FINANCE_HEAD + EMPLOYEE.
- **Demo accounts (no passwords: S1 signs in by picking a user; the login page highlights these as "Quick demo personas"):** `employee@expenseflow.test` (Priya Nair, Engineering), `manager@expenseflow.test` (Ravi Kumar, Engineering manager; MANAGER + EMPLOYEE), `auditor@expenseflow.test` (Meera Iyer; AUDITOR + EMPLOYEE), `head@expenseflow.test` (Vikram Shah; FINANCE_HEAD + EMPLOYEE). Also `manager2@expenseflow.test` (Sabita Rao, Sales manager).
- About 220 claims spread over the last 6 months, covering every status: drafts, auto-approved (some sampled with sample audit pending or cleared), pending manager (some overdue > 48 h, some with weekend/duplicate/soft-limit flags), pending auditor (25k–1L), pending head (> 1L), sent back (with comments), rejected, auto-rejected (hard limit, receipt duplicate), approved, in batch, and paid. Make sure Priya has at least one of each status, Ravi's inbox has ≥ 8 pending items, the auditor queue has ≥ 12 items across departments and bands, A4 has ≥ 6 pending samples, the finance head has ≥ 2 pending-head items, and there are 2 historical payout batches (1 PAID, 1 EXPORTED) plus ≥ 10 eligible claims. Plant duplicates and limit breaches.
- One active delegation: Sabita (manager2) → Ravi from yesterday to +5 days, so Ravi's inbox shows "Delegated" items.
- Seed receipts: generated SVG data URLs that look like printed receipts (vendor, date, line items, total in a monospace font, slight tilt). Generate SHA-256 values deterministically (a hex string derived from the seed).
- Policy versions: v1 (seed) and v2 (created by Vikram, two months ago: raised the cab hard limit). The current version is v2.

---

## 5. Keyboard accessibility (REQUIRED on every screen; user requirement)
Every feature must be usable with the keyboard alone (Tab, Shift+Tab, Enter, Space, Esc, arrow keys). It is checked in review.
- **Native first.** Use `<button>` for actions and `<a>`/`<Link>` for navigation, never a clickable `<div>`/`<span>`. Clickable table rows and cards must be keyboard-reachable: put a real link or button on the claim number or title (preferred), or give the row `tabIndex=0` with Enter/Space handlers and `role="link"`.
- **Visible focus everywhere.** Use `:focus-visible` with a 3 px `--brand-100` ring plus a `--brand-500` outline, with enough contrast on both blue and white backgrounds. Never `outline: none` without a replacement.
- **Skip link.** "Skip to main content" is the first focusable element and targets `<main id="main" tabIndex="-1">`. On route change, move focus to the page `<h1>` (or main) and announce the page title.
- **Logical tab order.** DOM order matches visual order; no positive `tabIndex`. Sticky bars (decision bar, bulk action bar) come after the content they act on.
- **Modals and drawers** trap focus, focus the first field (or the dialog title) on open, close on Esc, return focus to the trigger on close, and use `role="dialog"` + `aria-modal` + `aria-labelledby`. The bottom sheet on mobile behaves the same.
- **Menus and the role switch.** The role switch is a `radiogroup`, or buttons with `aria-pressed`, operated with arrow keys. The user menu and hamburger use `aria-expanded`, open with Enter/Space/↓, use arrow keys between items, and close with Esc, returning focus.
- **Tabs** (sub-nav, inbox states) follow the WAI-ARIA tabs pattern (roving tabindex, ←/→ and Home/End) when they switch content in place. When they are route links, use plain links with `aria-current="page"`.
- **Data tables.** Header sort buttons are `<button>` elements with `aria-sort` on the `<th>`. Row checkboxes are real checkboxes labelled "Select EXP-…". The header checkbox has an indeterminate state and the label "Select all". The bulk bar announces "N selected" via `aria-live="polite"`, and per-row bulk results are announced.
- **StepColumns.** Locked columns are `inert` (or have all controls disabled) with an `aria-disabled` explanation. "Next" moves focus to the newly enabled column's heading. Validation errors are linked via `aria-describedby`, the first invalid field gets focus on a failed submit, and an error summary uses `role="alert"`.
- **Forms.** Every input has a `<label>`, required fields have `aria-required`, and errors use `aria-invalid` plus a message. The amount field uses `inputMode="decimal"`. Date fields are native date inputs. Search inputs submit on Enter.
- **Custom widgets.** The login user picker is a listbox/combobox (↑/↓ moves, Enter selects, typing filters, `aria-activedescendant`). The receipt viewer zoom/rotate controls are buttons with `aria-label` and the shortcuts + / − / 0 / R, and arrow keys pan when zoomed. The accordion headers are buttons with `aria-expanded`. Toggles use `role="switch"`.
- **Shortcuts** (M2/A2: A approve, S send back, R reject, J/K next/previous; viewer ←/→ receipts) are ignored while typing in an input or textarea and are listed in a "Keyboard shortcuts" help popover (opened with `?`). Destructive shortcuts still open their confirmation or comment modal.
- **Live regions.** Toasts use `role="status"` (errors use `role="alert"`). Loading states expose `aria-busy` and a visually hidden "Loading…". Async results such as policy hints, upload progress (`role="progressbar"` with a value) and offline/sync status are announced politely.
- Icon-only buttons get an `aria-label`. Decorative SVGs get `aria-hidden="true"`. Colour is never the only signal: status chips and flags include text and an icon.
- Charts (F1) have an accessible title and description, plus a visually hidden data table or `aria-label` per bar. Bars are focusable, with the tooltip shown on focus.
- Respect `prefers-reduced-motion`. Target sizes are at least 44×44 px on touch.
