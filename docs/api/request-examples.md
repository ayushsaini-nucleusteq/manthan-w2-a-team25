# ExpenseFlow API: request and response examples

For the frontend. Generated from [`openapi.yaml`](openapi.yaml) (spec version 0.3.0); every example is copied from the spec and converted to JSON. When the spec and this page disagree, the spec wins. Regenerate this page whenever the spec changes.

## Read this first

- Base URL `http://localhost:8080`; all paths start with `/api`.
- Sign in with `POST /api/auth/login` (`email` + `password`). Send `Authorization: Bearer <accessToken>` on everything else. Tokens last 8 hours and there is no refresh token, so sign in again. `POST /api/auth/logout` records the logout; the client discards the token.
- Wrong email or wrong password both return **401** with `"Email or password is incorrect"`.
- Roles: `EMPLOYEE` (everyone), `MANAGER`, `AUDITOR`, `FINANCE_HEAD`. `ANY` = any signed-in user.
- Money is a **string** with two decimals: `"1500.00"`. Never send a number.
- Timestamps are ISO-8601 UTC. Business dates (`expenseDate`, trip and delegation dates) are `YYYY-MM-DD`.
- **`version`**: state-changing calls on claims, users and payout batches send the `version` you last read (a new policy version sends `basedOnVersionNo`). A stale one returns **409**; reload and retry.
- Lists take `page` (0-based), `size` (default 20, max 100) and `sort=field,asc|desc`, and return `items`, `page`, `size`, `totalItems`, `totalPages`.
- Claim numbers look like `CL-000123`. Every claim list accepts `q` to search them (and titles).
- Show **403 and 404 both as "not found"** in the UI.
- Offline drafts: `POST /api/claims` and `POST /api/claims/{id}/lines` accept your own UUID `id`. Sending the same id and content again returns 200 with the existing record; the same id with different content returns 409.

## Contents

| Method | Path | Roles | Summary |
|---|---|---|---|
| `POST` | [`/api/auth/login`](#post-apiauthlogin) | PUBLIC | Sign in with email and password; returns an 8-hour JWT |
| `POST` | [`/api/auth/logout`](#post-apiauthlogout) | ANY | Sign out (audited) |
| `GET` | [`/api/auth/me`](#get-apiauthme) | ANY | Current user, roles and home screen |
| `GET` | [`/api/notifications`](#get-apinotifications) | ANY | My notifications, newest first |
| `GET` | [`/api/notifications/unread-count`](#get-apinotificationsunread-count) | ANY | Badge count |
| `POST` | [`/api/notifications/{notificationId}/read`](#post-apinotificationsnotificationidread) | ANY | Mark one notification read (idempotent) |
| `POST` | [`/api/notifications/read-all`](#post-apinotificationsread-all) | ANY | Mark all my notifications read |
| `GET` | [`/api/users`](#get-apiusers) | MANAGER, AUDITOR, FINANCE_HEAD | List users with manager, roles and active flag |
| `PATCH` | [`/api/users/{userId}`](#patch-apiusersuserid) | FINANCE_HEAD | Set manager, roles or active flag |
| `GET` | [`/api/departments`](#get-apidepartments) | ANY | List departments |
| `GET` | [`/api/expense-categories`](#get-apiexpense-categories) | ANY | List expense categories |
| `GET` | [`/api/policy/current`](#get-apipolicycurrent) | ANY | The policy version in force |
| `GET` | [`/api/policy/versions`](#get-apipolicyversions) | ANY | Version history, newest first |
| `POST` | [`/api/policy/versions`](#post-apipolicyversions) | FINANCE_HEAD | Publish a new policy version |
| `GET` | [`/api/policy/versions/{versionNo}`](#get-apipolicyversionsversionno) | ANY | One policy version in full |
| `GET` | [`/api/delegations`](#get-apidelegations) | MANAGER, AUDITOR, FINANCE_HEAD | Delegations I gave, I received, or all (FINANCE_HEAD) |
| `POST` | [`/api/delegations`](#post-apidelegations) | MANAGER, AUDITOR, FINANCE_HEAD | Delegate my approvals for a date range |
| `DELETE` | [`/api/delegations/{delegationId}`](#delete-apidelegationsdelegationid) | MANAGER, AUDITOR, FINANCE_HEAD | Revoke a delegation (soft) |
| `GET` | [`/api/claims`](#get-apiclaims) | ANY | List claims, with counts for the status chips |
| `POST` | [`/api/claims`](#post-apiclaims) | ANY | Create a draft claim |
| `GET` | [`/api/claims/{claimId}`](#get-apiclaimsclaimid) | EMPLOYEE, MANAGER, AUDITOR, FINANCE_HEAD | Claim with lines, findings, steps and allowed actions |
| `PATCH` | [`/api/claims/{claimId}`](#patch-apiclaimsclaimid) | EMPLOYEE | Edit the claim header |
| `DELETE` | [`/api/claims/{claimId}`](#delete-apiclaimsclaimid) | EMPLOYEE | Delete a never-submitted draft |
| `POST` | [`/api/claims/{claimId}/lines`](#post-apiclaimsclaimidlines) | EMPLOYEE | Add a line item |
| `PUT` | [`/api/claims/{claimId}/lines/{lineId}`](#put-apiclaimsclaimidlineslineid) | EMPLOYEE | Replace a line item (receipt stays attached) |
| `DELETE` | [`/api/claims/{claimId}/lines/{lineId}`](#delete-apiclaimsclaimidlineslineid) | EMPLOYEE | Remove a line item |
| `PUT` | [`/api/claims/{claimId}/lines/{lineId}/receipt`](#put-apiclaimsclaimidlineslineidreceipt) | EMPLOYEE | Upload or replace the line's receipt |
| `GET` | [`/api/claims/{claimId}/lines/{lineId}/receipt`](#get-apiclaimsclaimidlineslineidreceipt) | EMPLOYEE, MANAGER, AUDITOR, FINANCE_HEAD | Get the receipt file (side panel M2, viewer A2, preview E5) |
| `POST` | [`/api/claims/{claimId}/policy-preview`](#post-apiclaimsclaimidpolicy-preview) | EMPLOYEE | Live policy hints (E4); no state change, not audited |
| `POST` | [`/api/claims/{claimId}/submit`](#post-apiclaimsclaimidsubmit) | EMPLOYEE | Submit, or resubmit after send-back |
| `GET` | [`/api/claims/{claimId}/audit-trail`](#get-apiclaimsclaimidaudit-trail) | EMPLOYEE, MANAGER, AUDITOR, FINANCE_HEAD | Timeline of one claim, oldest first |
| `GET` | [`/api/approvals/inbox`](#get-apiapprovalsinbox) | MANAGER, AUDITOR, FINANCE_HEAD | Approver inbox, oldest first |
| `POST` | [`/api/claims/{claimId}/approve`](#post-apiclaimsclaimidapprove) | MANAGER, AUDITOR, FINANCE_HEAD | Approve the current chain step |
| `POST` | [`/api/claims/{claimId}/reject`](#post-apiclaimsclaimidreject) | MANAGER, AUDITOR, FINANCE_HEAD | Reject (final); reason required |
| `POST` | [`/api/claims/{claimId}/send-back`](#post-apiclaimsclaimidsend-back) | MANAGER, AUDITOR, FINANCE_HEAD | Send back for clarification; comment required |
| `POST` | [`/api/claims/{claimId}/comments`](#post-apiclaimsclaimidcomments) | EMPLOYEE, MANAGER, AUDITOR, FINANCE_HEAD | Comment without changing status |
| `GET` | [`/api/auditor/queue`](#get-apiauditorqueue) | AUDITOR | Auditor work queue (A1), oldest first |
| `POST` | [`/api/auditor/queue/bulk-approve`](#post-apiauditorqueuebulk-approve) | AUDITOR | Approve the selected queue rows (A3) |
| `POST` | [`/api/auditor/queue/bulk-send-back`](#post-apiauditorqueuebulk-send-back) | AUDITOR | Send the selected queue rows back (A3) |
| `GET` | [`/api/auditor/sample-audits`](#get-apiauditorsample-audits) | AUDITOR | Sample-audit worklist (A4) |
| `POST` | [`/api/auditor/sample-audits/{claimId}/clear`](#post-apiauditorsample-auditsclaimidclear) | AUDITOR | Clear a sample audit (claim becomes payout-eligible) |
| `POST` | [`/api/auditor/sample-audits/{claimId}/reject`](#post-apiauditorsample-auditsclaimidreject) | AUDITOR | Reject a sampled claim (final); reason required |
| `POST` | [`/api/auditor/sample-audits/{claimId}/send-back`](#post-apiauditorsample-auditsclaimidsend-back) | AUDITOR | Send a sampled claim back; comment required |
| `GET` | [`/api/payouts/eligible-claims`](#get-apipayoutseligible-claims) | FINANCE_HEAD | Claims ready for payout |
| `GET` | [`/api/payouts`](#get-apipayouts) | FINANCE_HEAD | List payout batches |
| `POST` | [`/api/payouts`](#post-apipayouts) | FINANCE_HEAD | Create a batch from eligible claims |
| `GET` | [`/api/payouts/{batchId}`](#get-apipayoutsbatchid) | FINANCE_HEAD | Batch with its items |
| `GET` | [`/api/payouts/{batchId}/export`](#get-apipayoutsbatchidexport) | FINANCE_HEAD | Download the bank CSV |
| `POST` | [`/api/payouts/{batchId}/mark-paid`](#post-apipayoutsbatchidmark-paid) | FINANCE_HEAD | Mark batch paid; claims -> PAID |
| `GET` | [`/api/dashboard`](#get-apidashboard) | AUDITOR, FINANCE_HEAD | Spend, violations, approval time and queue health |
| `GET` | [`/api/audit-events`](#get-apiaudit-events) | AUDITOR, FINANCE_HEAD | Search the whole audit trail |

**[Errors](#errors)** | **[Appendix: ClaimDetail examples](#appendix-claimdetail-examples)**


---

# Auth

<a id="post-apiauthlogin"></a>

## POST /api/auth/login

**Sign in with email and password; returns an 8-hour JWT.** Roles: PUBLIC.

Roles: public. Email (case-insensitive) + password, checked against a BCrypt hash.
Unknown email, wrong password and inactive user all return **401** with the same message,
"Email or password is incorrect", so the response never reveals which accounts exist.
"Role switch" (wireframes v4) happens inside one account: the frontend switches screens between the roles in the JWT; it does not change the account. The JWT carries **all** of the user's
roles; there is no active-role selection. Every success writes a `LOGIN` audit event and every
failure a `LOGIN_FAILED` event (attempted email in `details`, never the password).

**Request** (`application/json`):

```json
{
  "email": "asha.verma@expenseflow.test",
  "password": "<password>"
}
```

**200**: Signed in

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMTkzNWYyYS0xYzAwLTcwMDAtODAwMC0wMDAwMDAwMDAxMDEifQ.sig",
  "tokenType": "Bearer",
  "expiresIn": 28800,
  "user": {
    "id": "01935f2a-1c00-7000-8000-000000000101",
    "fullName": "Asha Verma",
    "email": "asha.verma@expenseflow.test",
    "employeeCode": "E1001",
    "roles": [
      "EMPLOYEE"
    ],
    "department": {
      "id": "01935f2a-1c00-7000-8000-000000000201",
      "code": "ENG",
      "name": "Engineering"
    },
    "manager": {
      "id": "01935f2a-1c00-7000-8000-000000000102",
      "fullName": "Ravi Kumar"
    },
    "homeScreen": "E1",
    "delegationsReceived": []
  }
}
```

Errors: **400**, **401** (shape below).

<a id="post-apiauthlogout"></a>

## POST /api/auth/logout

**Sign out (audited).** Roles: ANY.

Roles: ANY. Writes a `LOGOUT` audit event and returns 204. The client discards the token;
the server does not revoke it (see Known limitations).

**204**: Signed out


Errors: **401** (shape below).

<a id="get-apiauthme"></a>

## GET /api/auth/me

**Current user, roles and home screen.** Roles: ANY.

Roles: ANY. `roles` lists every role the user holds (same as the JWT). `homeScreen` is the
landing screen for the highest role held: FINANCE_HEAD -> `F1`, AUDITOR -> `A1`, MANAGER -> `M1`,
otherwise `E1`.

**200**: The caller

Example `manager`:

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000106",
  "fullName": "Kiran Rao",
  "email": "kiran.rao@expenseflow.test",
  "employeeCode": "E1006",
  "roles": [
    "EMPLOYEE",
    "MANAGER"
  ],
  "department": {
    "id": "01935f2a-1c00-7000-8000-000000000201",
    "code": "ENG",
    "name": "Engineering"
  },
  "manager": {
    "id": "01935f2a-1c00-7000-8000-000000000104",
    "fullName": "Arjun Shah"
  },
  "homeScreen": "M1",
  "delegationsReceived": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000801",
      "delegator": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "delegate": {
        "id": "01935f2a-1c00-7000-8000-000000000106",
        "fullName": "Kiran Rao"
      },
      "roles": [
        "MANAGER"
      ],
      "startsOn": "2026-11-20",
      "endsOn": "2026-11-30",
      "reason": "Annual leave",
      "active": true,
      "createdAt": "2026-11-19T07:30:00Z",
      "revokedAt": null
    }
  ]
}
```

Errors: **401** (shape below).


---

# Notifications

<a id="get-apinotifications"></a>

## GET /api/notifications

**My notifications, newest first.** Roles: ANY.

Roles: ANY (own notifications only).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `unread` | query | no | boolean. true = unread only. |
| `page` | query | no | integer. 0-based page index. Default `0`. |
| `size` | query | no | integer. Default `20`. |

**200**: Page of notifications

```json
{
  "items": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000901",
      "type": "APPROVAL_WAITING",
      "title": "Claim waiting for your approval",
      "message": "CL-000123 from Asha Verma, 14050.00 INR",
      "claimId": "01935f2a-1c00-7000-8000-000000000301",
      "claimNumber": "CL-000123",
      "payoutBatchId": null,
      "read": false,
      "readAt": null,
      "createdAt": "2026-11-20T09:15:02Z"
    }
  ],
  "page": 0,
  "size": 20,
  "totalItems": 1,
  "totalPages": 1
}
```

Errors: **400**, **401** (shape below).

<a id="get-apinotificationsunread-count"></a>

## GET /api/notifications/unread-count

**Badge count.** Roles: ANY.

Roles: ANY.

**200**: Count

```json
{
  "unread": 3
}
```

Errors: **401** (shape below).

<a id="post-apinotificationsnotificationidread"></a>

## POST /api/notifications/{notificationId}/read

**Mark one notification read (idempotent).** Roles: ANY.

Roles: ANY; recipient only (others get 404).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `notificationId` | path | yes | string.  |

**200**: The notification

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000901",
  "type": "APPROVAL_WAITING",
  "title": "Claim waiting for your approval",
  "message": "CL-000123 from Asha Verma, 14050.00 INR",
  "claimId": "01935f2a-1c00-7000-8000-000000000301",
  "claimNumber": "CL-000123",
  "payoutBatchId": null,
  "read": true,
  "readAt": "2026-11-20T10:00:00Z",
  "createdAt": "2026-11-20T09:15:02Z"
}
```

Errors: **401**, **404** (shape below).

<a id="post-apinotificationsread-all"></a>

## POST /api/notifications/read-all

**Mark all my notifications read.** Roles: ANY.

Roles: ANY.

**200**: How many changed

```json
{
  "updated": 3
}
```

Errors: **401** (shape below).


---

# Users

<a id="get-apiusers"></a>

## GET /api/users

**List users with manager, roles and active flag.** Roles: MANAGER, AUDITOR, FINANCE_HEAD.

Roles: MANAGER, AUDITOR, FINANCE_HEAD. FINANCE_HEAD uses it for F5; approvers use it to pick a
delegate (`role=` filter). Sort: `fullName` (default), `employeeCode`.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `role` | query | no | `EMPLOYEE|MANAGER|AUDITOR|FINANCE_HEAD`.  |
| `departmentId` | query | no | string.  |
| `managerId` | query | no | string.  |
| `active` | query | no | boolean. Omit for all users. |
| `q` | query | no | string. Case-insensitive match on name, email or employee code. |
| `page` | query | no | integer. 0-based page index. Default `0`. |
| `size` | query | no | integer. Default `20`. |
| `sort` | query | no | string. `field,asc` or `field,desc`; allowed fields are listed per operation, anything else is 400. |

**200**: Page of users

```json
{
  "items": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000101",
      "employeeCode": "E1001",
      "fullName": "Asha Verma",
      "email": "asha.verma@expenseflow.test",
      "roles": [
        "EMPLOYEE"
      ],
      "department": {
        "id": "01935f2a-1c00-7000-8000-000000000201",
        "code": "ENG",
        "name": "Engineering"
      },
      "manager": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "active": true,
      "version": 0
    }
  ],
  "page": 0,
  "size": 20,
  "totalItems": 1,
  "totalPages": 1
}
```

Errors: **400**, **401**, **403** (shape below).

<a id="patch-apiusersuserid"></a>

## PATCH /api/users/{userId}

**Set manager, roles or active flag.** Roles: FINANCE_HEAD.

Roles: FINANCE_HEAD. Only fields sent change; `EMPLOYEE` is always kept in `roles`.
400: manager is the user themself, would create a reporting cycle, or is inactive.
409: stale `version`; a FINANCE_HEAD removing their own FINANCE_HEAD role or deactivating
themself; removing the last active FINANCE_HEAD or AUDITOR. Changing a manager does not move
steps that are already pending. Audited as `USER_UPDATED`.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `userId` | path | yes | string.  |

**Request** (`application/json`):

```json
{
  "version": 0,
  "managerId": "01935f2a-1c00-7000-8000-000000000106",
  "roles": [
    "EMPLOYEE",
    "MANAGER"
  ]
}
```

**200**: Updated user

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000101",
  "employeeCode": "E1001",
  "fullName": "Asha Verma",
  "email": "asha.verma@expenseflow.test",
  "roles": [
    "EMPLOYEE",
    "MANAGER"
  ],
  "department": {
    "id": "01935f2a-1c00-7000-8000-000000000201",
    "code": "ENG",
    "name": "Engineering"
  },
  "manager": {
    "id": "01935f2a-1c00-7000-8000-000000000106",
    "fullName": "Kiran Rao"
  },
  "active": true,
  "version": 1
}
```

Errors: **400**, **401**, **403**, **404**, **409** (shape below).


---

# Reference data

<a id="get-apidepartments"></a>

## GET /api/departments

**List departments.** Roles: ANY.

Roles: ANY.

**200**: Departments

```json
[
  {
    "id": "01935f2a-1c00-7000-8000-000000000201",
    "code": "ENG",
    "name": "Engineering"
  },
  {
    "id": "01935f2a-1c00-7000-8000-000000000202",
    "code": "SALES",
    "name": "Sales"
  },
  {
    "id": "01935f2a-1c00-7000-8000-000000000203",
    "code": "FIN",
    "name": "Finance"
  }
]
```

Errors: **401** (shape below).

<a id="get-apiexpense-categories"></a>

## GET /api/expense-categories

**List expense categories.** Roles: ANY.

Roles: ANY. `coveredByPolicy` is computed from the current policy version; lines in an
uncovered category are routed with the `NO_POLICY_RULE` flag.

**200**: Categories

```json
[
  {
    "code": "MEALS",
    "name": "Meals",
    "requiresHotelDetails": false,
    "coveredByPolicy": true
  },
  {
    "code": "HOTEL",
    "name": "Hotel",
    "requiresHotelDetails": true,
    "coveredByPolicy": true
  },
  {
    "code": "LOCAL_CAB",
    "name": "Local cab",
    "requiresHotelDetails": false,
    "coveredByPolicy": true
  },
  {
    "code": "AIRFARE",
    "name": "Airfare",
    "requiresHotelDetails": false,
    "coveredByPolicy": false
  },
  {
    "code": "OTHER",
    "name": "Other",
    "requiresHotelDetails": false,
    "coveredByPolicy": false
  }
]
```

Errors: **401** (shape below).


---

# Policy

<a id="get-apipolicycurrent"></a>

## GET /api/policy/current

**The policy version in force.** Roles: ANY.

Roles: ANY (employees see caps; E4 hints use it).

**200**: Current version

Example `v1`:

```json
{
  "versionNo": 1,
  "current": true,
  "changeNote": "Initial seed",
  "createdBy": null,
  "createdAt": "2026-11-01T00:00:00Z",
  "settings": {
    "receiptThreshold": "500.00",
    "weekendFlagEnabled": true,
    "overdueThresholdHours": 48,
    "autoApproveMaxTotal": "25000.00",
    "auditorAboveTotal": "25000.00",
    "financeHeadAboveTotal": "100000.00",
    "sampleAuditPercent": 10
  },
  "rules": [
    {
      "code": "MEALS_DAILY",
      "category": "MEALS",
      "unit": "PER_DAY",
      "cityTier": null,
      "softLimit": "1500.00",
      "hardLimit": "3000.00"
    },
    {
      "code": "HOTEL_NIGHTLY_TIER1",
      "category": "HOTEL",
      "unit": "PER_NIGHT",
      "cityTier": "TIER1",
      "softLimit": "6000.00",
      "hardLimit": "12000.00"
    },
    {
      "code": "HOTEL_NIGHTLY_OTHER",
      "category": "HOTEL",
      "unit": "PER_NIGHT",
      "cityTier": "OTHER",
      "softLimit": "4000.00",
      "hardLimit": "8000.00"
    },
    {
      "code": "LOCAL_CAB_TRIP",
      "category": "LOCAL_CAB",
      "unit": "PER_TRIP",
      "cityTier": null,
      "softLimit": "2000.00",
      "hardLimit": "4000.00"
    }
  ],
  "tier1Cities": [
    "Ahmedabad",
    "Bengaluru",
    "Chennai",
    "Delhi",
    "Hyderabad",
    "Kolkata",
    "Mumbai",
    "Pune"
  ]
}
```

Errors: **401** (shape below).

<a id="get-apipolicyversions"></a>

## GET /api/policy/versions

**Version history, newest first.** Roles: ANY.

Roles: ANY.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `page` | query | no | integer. 0-based page index. Default `0`. |
| `size` | query | no | integer. Default `20`. |

**200**: Page of version summaries

```json
{
  "items": [
    {
      "versionNo": 2,
      "current": true,
      "changeNote": "Raise meals cap for Q4",
      "createdBy": {
        "id": "01935f2a-1c00-7000-8000-000000000104",
        "fullName": "Arjun Shah"
      },
      "createdAt": "2026-11-25T06:00:00Z"
    },
    {
      "versionNo": 1,
      "current": false,
      "changeNote": "Initial seed",
      "createdBy": null,
      "createdAt": "2026-11-01T00:00:00Z"
    }
  ],
  "page": 0,
  "size": 20,
  "totalItems": 2,
  "totalPages": 1
}
```

Errors: **400**, **401** (shape below).

<a id="post-apipolicyversions"></a>

## POST /api/policy/versions

**Publish a new policy version.** Roles: FINANCE_HEAD.

Roles: FINANCE_HEAD. The body is the complete configuration (rules, tier-1 cities, receipt
threshold, weekend rule, overdue threshold, chain thresholds); it becomes version N+1 and current
immediately. Earlier versions are never changed. Claims already evaluated keep their version;
later submits and resubmits use the new one.
400: `hardLimit < softLimit`, duplicate rule code, unknown category, percent outside 0-100,
`financeHeadAboveTotal < auditorAboveTotal`. 409: `basedOnVersionNo` is not the current version
(someone published in between). Audited as `POLICY_VERSION_CREATED`.

**Request** (`application/json`):

```json
{
  "basedOnVersionNo": 1,
  "changeNote": "Raise meals cap for Q4",
  "settings": {
    "receiptThreshold": "500.00",
    "weekendFlagEnabled": true,
    "overdueThresholdHours": 48,
    "autoApproveMaxTotal": "25000.00",
    "auditorAboveTotal": "25000.00",
    "financeHeadAboveTotal": "100000.00",
    "sampleAuditPercent": 10
  },
  "rules": [
    {
      "code": "MEALS_DAILY",
      "category": "MEALS",
      "unit": "PER_DAY",
      "cityTier": null,
      "softLimit": "1800.00",
      "hardLimit": "3600.00"
    },
    {
      "code": "HOTEL_NIGHTLY_TIER1",
      "category": "HOTEL",
      "unit": "PER_NIGHT",
      "cityTier": "TIER1",
      "softLimit": "6000.00",
      "hardLimit": "12000.00"
    },
    {
      "code": "HOTEL_NIGHTLY_OTHER",
      "category": "HOTEL",
      "unit": "PER_NIGHT",
      "cityTier": "OTHER",
      "softLimit": "4000.00",
      "hardLimit": "8000.00"
    },
    {
      "code": "LOCAL_CAB_TRIP",
      "category": "LOCAL_CAB",
      "unit": "PER_TRIP",
      "cityTier": null,
      "softLimit": "2000.00",
      "hardLimit": "4000.00"
    }
  ],
  "tier1Cities": [
    "Ahmedabad",
    "Bengaluru",
    "Chennai",
    "Delhi",
    "Hyderabad",
    "Kolkata",
    "Mumbai",
    "Pune"
  ]
}
```

**201**: New current version

Example `v2`:

```json
{
  "versionNo": 2,
  "current": true,
  "changeNote": "Raise meals cap for Q4",
  "createdBy": {
    "id": "01935f2a-1c00-7000-8000-000000000104",
    "fullName": "Arjun Shah"
  },
  "createdAt": "2026-11-25T06:00:00Z",
  "settings": {
    "receiptThreshold": "500.00",
    "weekendFlagEnabled": true,
    "overdueThresholdHours": 48,
    "autoApproveMaxTotal": "25000.00",
    "auditorAboveTotal": "25000.00",
    "financeHeadAboveTotal": "100000.00",
    "sampleAuditPercent": 10
  },
  "rules": [
    {
      "code": "MEALS_DAILY",
      "category": "MEALS",
      "unit": "PER_DAY",
      "cityTier": null,
      "softLimit": "1800.00",
      "hardLimit": "3600.00"
    },
    {
      "code": "HOTEL_NIGHTLY_TIER1",
      "category": "HOTEL",
      "unit": "PER_NIGHT",
      "cityTier": "TIER1",
      "softLimit": "6000.00",
      "hardLimit": "12000.00"
    },
    {
      "code": "HOTEL_NIGHTLY_OTHER",
      "category": "HOTEL",
      "unit": "PER_NIGHT",
      "cityTier": "OTHER",
      "softLimit": "4000.00",
      "hardLimit": "8000.00"
    },
    {
      "code": "LOCAL_CAB_TRIP",
      "category": "LOCAL_CAB",
      "unit": "PER_TRIP",
      "cityTier": null,
      "softLimit": "2000.00",
      "hardLimit": "4000.00"
    }
  ],
  "tier1Cities": [
    "Ahmedabad",
    "Bengaluru",
    "Chennai",
    "Delhi",
    "Hyderabad",
    "Kolkata",
    "Mumbai",
    "Pune"
  ]
}
```

Errors: **400**, **401**, **403**, **409** (shape below).

<a id="get-apipolicyversionsversionno"></a>

## GET /api/policy/versions/{versionNo}

**One policy version in full.** Roles: ANY.

Roles: ANY (claim detail links to the version a claim was checked against).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `versionNo` | path | yes | integer.  |

**200**: Version

Example `v1`:

```json
{
  "versionNo": 1,
  "current": true,
  "changeNote": "Initial seed",
  "createdBy": null,
  "createdAt": "2026-11-01T00:00:00Z",
  "settings": {
    "receiptThreshold": "500.00",
    "weekendFlagEnabled": true,
    "overdueThresholdHours": 48,
    "autoApproveMaxTotal": "25000.00",
    "auditorAboveTotal": "25000.00",
    "financeHeadAboveTotal": "100000.00",
    "sampleAuditPercent": 10
  },
  "rules": [
    {
      "code": "MEALS_DAILY",
      "category": "MEALS",
      "unit": "PER_DAY",
      "cityTier": null,
      "softLimit": "1500.00",
      "hardLimit": "3000.00"
    },
    {
      "code": "HOTEL_NIGHTLY_TIER1",
      "category": "HOTEL",
      "unit": "PER_NIGHT",
      "cityTier": "TIER1",
      "softLimit": "6000.00",
      "hardLimit": "12000.00"
    },
    {
      "code": "HOTEL_NIGHTLY_OTHER",
      "category": "HOTEL",
      "unit": "PER_NIGHT",
      "cityTier": "OTHER",
      "softLimit": "4000.00",
      "hardLimit": "8000.00"
    },
    {
      "code": "LOCAL_CAB_TRIP",
      "category": "LOCAL_CAB",
      "unit": "PER_TRIP",
      "cityTier": null,
      "softLimit": "2000.00",
      "hardLimit": "4000.00"
    }
  ],
  "tier1Cities": [
    "Ahmedabad",
    "Bengaluru",
    "Chennai",
    "Delhi",
    "Hyderabad",
    "Kolkata",
    "Mumbai",
    "Pune"
  ]
}
```

Errors: **401**, **404** (shape below).


---

# Delegations

<a id="get-apidelegations"></a>

## GET /api/delegations

**Delegations I gave, I received, or all (FINANCE_HEAD).** Roles: MANAGER, AUDITOR, FINANCE_HEAD.

Roles: MANAGER, AUDITOR, FINANCE_HEAD for `scope=given` (default) and `scope=received`;
FINANCE_HEAD only for `scope=all` (403 otherwise). Sort: `startsOn` (default desc).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `scope` | query | no | `given|received|all`. Default `given`. |
| `activeOn` | query | no | string. Only non-revoked delegations whose range contains this date. |
| `page` | query | no | integer. 0-based page index. Default `0`. |
| `size` | query | no | integer. Default `20`. |
| `sort` | query | no | string. `field,asc` or `field,desc`; allowed fields are listed per operation, anything else is 400. |

**200**: Page of delegations

```json
{
  "items": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000801",
      "delegator": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "delegate": {
        "id": "01935f2a-1c00-7000-8000-000000000106",
        "fullName": "Kiran Rao"
      },
      "roles": [
        "MANAGER"
      ],
      "startsOn": "2026-11-20",
      "endsOn": "2026-11-30",
      "reason": "Annual leave",
      "active": true,
      "createdAt": "2026-11-19T07:30:00Z",
      "revokedAt": null
    }
  ],
  "page": 0,
  "size": 20,
  "totalItems": 1,
  "totalPages": 1
}
```

Errors: **400**, **401**, **403** (shape below).

<a id="post-apidelegations"></a>

## POST /api/delegations

**Delegate my approvals for a date range.** Roles: MANAGER, AUDITOR, FINANCE_HEAD.

Roles: MANAGER, AUDITOR, FINANCE_HEAD.
While active (today within `[startsOn, endsOn]`, not revoked) the delegate sees and may act on steps
assigned to the delegator, for the approver roles the delegator holds **and** the delegate also
holds (returned as `roles`). The delegator can still act. No re-delegation: a delegate cannot pass
delegated work on. Audit and inbox show `onBehalfOf`.
400: delegate is self, `endsOn < startsOn`, `endsOn` in the past, or the delegate holds none of the
delegator's approver roles. 404: delegate unknown or inactive. 409: overlaps another non-revoked
delegation by the same delegator.

**Request** (`application/json`):

```json
{
  "delegateId": "01935f2a-1c00-7000-8000-000000000106",
  "startsOn": "2026-11-20",
  "endsOn": "2026-11-30",
  "reason": "Annual leave"
}
```

**201**: Created

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000801",
  "delegator": {
    "id": "01935f2a-1c00-7000-8000-000000000102",
    "fullName": "Ravi Kumar"
  },
  "delegate": {
    "id": "01935f2a-1c00-7000-8000-000000000106",
    "fullName": "Kiran Rao"
  },
  "roles": [
    "MANAGER"
  ],
  "startsOn": "2026-11-20",
  "endsOn": "2026-11-30",
  "reason": "Annual leave",
  "active": true,
  "createdAt": "2026-11-19T07:30:00Z",
  "revokedAt": null
}
```

Errors: **400**, **401**, **403**, **404**, **409** (shape below).

<a id="delete-apidelegationsdelegationid"></a>

## DELETE /api/delegations/{delegationId}

**Revoke a delegation (soft).** Roles: MANAGER, AUDITOR, FINANCE_HEAD.

Roles: the delegator, or FINANCE_HEAD. Sets `revokedAt`; the row stays. Already revoked or ended: 409.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `delegationId` | path | yes | string.  |

**204**: Revoked


Errors: **401**, **403**, **404**, **409** (shape below).


---

# Claims

<a id="get-apiclaims"></a>

## GET /api/claims

**List claims, with counts for the status chips.** Roles: ANY.

Roles: ANY for `scope=mine` (default, own claims). `scope=all` is AUDITOR or FINANCE_HEAD (403
otherwise). `statusCounts` counts every status for the same scope and filters **except** `status`,
so chips stay stable while one is selected; statuses with no claims appear with 0.
Sort: `updatedAt` (default desc), `submittedAt`, `totalAmount`, `claimNumber`.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `scope` | query | no | `mine|all`. Default `mine`. |
| `status` | query | no | array. Repeatable. |
| `employeeId` | query | no | string. `scope=all` only. |
| `departmentId` | query | no | string. `scope=all` only. |
| `q` | query | no | string. Case-insensitive search on claim number (e.g. `CL-000123` or `000123`) and title. |
| `page` | query | no | integer. 0-based page index. Default `0`. |
| `size` | query | no | integer. Default `20`. |
| `sort` | query | no | string. `field,asc` or `field,desc`; allowed fields are listed per operation, anything else is 400. |

**200**: Page of claims plus status counts

```json
{
  "items": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000301",
      "claimNumber": "CL-000123",
      "title": "Client visit - Mumbai",
      "status": "PENDING_MANAGER",
      "employee": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "department": {
        "id": "01935f2a-1c00-7000-8000-000000000201",
        "code": "ENG",
        "name": "Engineering"
      },
      "tripStartDate": "2026-11-16",
      "tripEndDate": "2026-11-18",
      "currency": "INR",
      "totalAmount": "14050.00",
      "lineCount": 2,
      "policyOutcome": "ROUTE",
      "flags": [
        "SOFT_LIMIT_EXCEEDED"
      ],
      "sampleAudit": false,
      "sampleAuditStatus": null,
      "sampleAuditedBy": null,
      "sampleAuditedAt": null,
      "submittedAt": "2026-11-20T09:15:02Z",
      "decidedAt": null,
      "updatedAt": "2026-11-20T09:15:02Z"
    }
  ],
  "page": 0,
  "size": 20,
  "totalItems": 1,
  "totalPages": 1,
  "statusCounts": {
    "DRAFT": 2,
    "SUBMITTED": 0,
    "AUTO_APPROVED": 3,
    "AUTO_REJECTED": 1,
    "PENDING_MANAGER": 1,
    "PENDING_AUDITOR": 0,
    "PENDING_FINANCE_HEAD": 0,
    "SENT_BACK": 0,
    "REJECTED": 0,
    "APPROVED": 4,
    "IN_BATCH": 1,
    "PAID": 6
  }
}
```

Errors: **400**, **401**, **403** (shape below).

<a id="post-apiclaims"></a>

## POST /api/claims

**Create a draft claim.** Roles: ANY.

Roles: ANY (everyone can file claims). Caller becomes the owner; status `DRAFT`.
Lines may be included or added later. 400: `tripEndDate < tripStartDate`, or a line fails validation
(future `expenseDate`, amount <= 0, bad category, hotel fields wrong).
**Idempotent with a client `id`** (offline drafts, US3-AC3): if a claim with that `id` already exists,
belongs to the caller and the request has the same content (header and any `lines`), it is returned
unchanged with **200**. The same `id` with different content, or owned by someone else, returns 409.

**Request** (`application/json`):

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000301",
  "title": "Client visit - Mumbai",
  "purpose": "On-site workshop with Acme Retail",
  "tripStartDate": "2026-11-16",
  "tripEndDate": "2026-11-18",
  "currency": "INR",
  "lines": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000401",
      "category": "HOTEL",
      "amount": "13200.00",
      "expenseDate": "2026-11-17",
      "vendor": "Hotel Sea View",
      "notes": "2 nights",
      "city": "Mumbai",
      "nights": 2
    },
    {
      "id": "01935f2a-1c00-7000-8000-000000000402",
      "category": "MEALS",
      "amount": "850.00",
      "expenseDate": "2026-11-17",
      "vendor": "Cafe Madras",
      "notes": "Dinner"
    }
  ]
}
```

**200**: Replay of an `id` the caller already created; existing claim returned unchanged

- `application/json`: see [ClaimDraft](#claimdraft) in the appendix.

**201**: Created

- `application/json`: see [ClaimDraft](#claimdraft) in the appendix.

Errors: **400**, **401**, **409** (shape below).

<a id="get-apiclaimsclaimid"></a>

## GET /api/claims/{claimId}

**Claim with lines, findings, steps and allowed actions.** Roles: EMPLOYEE, MANAGER, AUDITOR, FINANCE_HEAD.

Roles: the owner; anyone who holds, held or (as active delegate) can act on a step of the claim;
any AUDITOR; any FINANCE_HEAD. Everyone else: 404.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |

**200**: Claim

- `application/json`: see [ClaimPendingManager](#claimpendingmanager) in the appendix.
- `application/json`: see [ClaimAutoRejected](#claimautorejected) in the appendix.

Errors: **401**, **404** (shape below).

<a id="patch-apiclaimsclaimid"></a>

## PATCH /api/claims/{claimId}

**Edit the claim header.** Roles: EMPLOYEE.

Roles: owner. Only in `DRAFT` or `SENT_BACK` (409 otherwise: locked after submit).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |

**Request** (`application/json`):

```json
{
  "version": 2,
  "purpose": "Workshop and contract review",
  "tripEndDate": "2026-11-19"
}
```

**200**: Updated

- `application/json`: see [ClaimDraft](#claimdraft) in the appendix.

Errors: **400**, **401**, **403**, **404**, **409** (shape below).

<a id="delete-apiclaimsclaimid"></a>

## DELETE /api/claims/{claimId}

**Delete a never-submitted draft.** Roles: EMPLOYEE.

Roles: owner. `DRAFT` with `submissionNo = 0` only (409 otherwise). A `CLAIM_DELETED` audit event is kept.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |

**204**: Deleted


Errors: **401**, **403**, **404**, **409** (shape below).

<a id="post-apiclaimsclaimidlines"></a>

## POST /api/claims/{claimId}/lines

**Add a line item.** Roles: EMPLOYEE.

Roles: owner; claim in `DRAFT` or `SENT_BACK` (409 otherwise; also 409 above 50 lines).
400 (US1-AC1): missing category, amount, expenseDate or vendor; `expenseDate` in the future; amount
<= 0 or too large; unknown category; `HOTEL` without `city`/`nights` or a non-hotel line with them.
**Idempotent with a client `id`** (US3-AC3): a line `id` already on this claim with the same content
returns the claim unchanged with **200**; the same `id` with different content, or used on another
claim, returns 409.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |

**Request** (`application/json`):

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000403",
  "category": "LOCAL_CAB",
  "amount": "640.00",
  "expenseDate": "2026-11-18",
  "vendor": "Uber",
  "notes": "Hotel to client office"
}
```

**200**: Replay of an existing line `id`; claim returned unchanged

- `application/json`: see [ClaimDraft](#claimdraft) in the appendix.

**201**: Updated claim (new total)

- `application/json`: see [ClaimDraft](#claimdraft) in the appendix.

Errors: **400**, **401**, **403**, **404**, **409** (shape below).

<a id="put-apiclaimsclaimidlineslineid"></a>

## PUT /api/claims/{claimId}/lines/{lineId}

**Replace a line item (receipt stays attached).** Roles: EMPLOYEE.

Roles: owner; same states and validation as add. An edited line is re-evaluated against the current policy version at the next submit (US15-AC3); unchanged lines keep their stored result.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |
| `lineId` | path | yes | string.  |

**Request** (`application/json`):

```json
{
  "category": "MEALS",
  "amount": "780.00",
  "expenseDate": "2026-11-17",
  "vendor": "Cafe Madras",
  "notes": "Dinner (corrected)"
}
```

**200**: Updated claim

- `application/json`: see [ClaimDraft](#claimdraft) in the appendix.

Errors: **400**, **401**, **403**, **404**, **409** (shape below).

<a id="delete-apiclaimsclaimidlineslineid"></a>

## DELETE /api/claims/{claimId}/lines/{lineId}

**Remove a line item.** Roles: EMPLOYEE.

Roles: owner; claim in `DRAFT` or `SENT_BACK`.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |
| `lineId` | path | yes | string.  |

**200**: Updated claim

- `application/json`: see [ClaimDraft](#claimdraft) in the appendix.

Errors: **401**, **403**, **404**, **409** (shape below).

<a id="put-apiclaimsclaimidlineslineidreceipt"></a>

## PUT /api/claims/{claimId}/lines/{lineId}/receipt

**Upload or replace the line's receipt.** Roles: EMPLOYEE.

Roles: owner; claim in `DRAFT` or `SENT_BACK`. PDF, JPEG or PNG up to 5 MB (type sniffed from
content; 400 otherwise). The server computes SHA-256. A hash already used on a counted claim is
accepted here and auto-rejected as a duplicate at submit.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |
| `lineId` | path | yes | string.  |

**Request** (`multipart/form-data`):

Multipart form with one field `file` (PDF, JPEG or PNG, max 5 MB).

**200**: Stored

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000501",
  "fileName": "hotel-invoice.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 184220,
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "uploadedAt": "2026-11-19T12:01:00Z"
}
```

Errors: **400**, **401**, **403**, **404**, **409** (shape below).

<a id="get-apiclaimsclaimidlineslineidreceipt"></a>

## GET /api/claims/{claimId}/lines/{lineId}/receipt

**Get the receipt file (side panel M2, viewer A2, preview E5).** Roles: EMPLOYEE, MANAGER, AUDITOR, FINANCE_HEAD.

Roles: same as `GET /api/claims/{claimId}`. 404 when the line has no receipt.
Served at full resolution with `Content-Disposition: inline` so the viewer can display and zoom it
(US10-AC1); `?download=true` switches to `attachment`.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |
| `lineId` | path | yes | string.  |
| `download` | query | no | boolean. Default `False`. |

**200**: The file

`application/pdf`: binary file.
`image/jpeg`: binary file.
`image/png`: binary file.

Errors: **401**, **404** (shape below).

<a id="post-apiclaimsclaimidpolicy-preview"></a>

## POST /api/claims/{claimId}/policy-preview

**Live policy hints (E4); no state change, not audited.** Roles: EMPLOYEE.

Roles: owner; claim in `DRAFT` or `SENT_BACK`. Used by E4 (live hints) and E6 (pre-submit check).
- No body (or no `line`): previews the saved claim, line by line (E6, US2-AC1).
- With `line`: also evaluates that **unsaved** line as if it were in the claim (replacing `lineId`
  when editing an existing line) and returns its findings in `line` (E4). `hasReceipt` says whether
  the form has a file attached, so the receipt blocker can be shown.
New and edited lines are evaluated with the current policy version; lines already evaluated and
unchanged show their stored result and version (US15-AC3). Every finding carries `ruleCode`,
`ruleName`, `limit`, `excess`; duplicates carry the matched claim and line (US2-AC2).
`submitBlockers` lists what would make submit return 422. Sample audit is not rolled in a preview.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |

**Request** (`application/json`):

```json
{
  "lineId": null,
  "hasReceipt": false,
  "line": {
    "category": "LOCAL_CAB",
    "amount": "2600.00",
    "expenseDate": "2026-11-22",
    "vendor": "Ola",
    "notes": "Airport drop"
  }
}
```

**200**: Preview

```json
{
  "policyVersionNo": 1,
  "line": {
    "outcome": "ROUTE",
    "findings": [
      {
        "ruleCode": "LOCAL_CAB_TRIP",
        "ruleName": "Local cab per trip",
        "reasonCode": "SOFT_LIMIT_EXCEEDED",
        "outcome": "ROUTE",
        "message": "Cab 2600.00 exceeds the 2000.00 per-trip limit by 600.00",
        "limitType": "SOFT",
        "unit": "PER_TRIP",
        "limit": "2000.00",
        "actual": "2600.00",
        "excess": "600.00"
      },
      {
        "ruleCode": "WEEKEND",
        "ruleName": "Weekend spend",
        "reasonCode": "WEEKEND_EXPENSE",
        "outcome": "ROUTE",
        "message": "2026-11-22 is a Sunday",
        "limit": null,
        "excess": null
      },
      {
        "ruleCode": "DUPLICATE",
        "ruleName": "Duplicate vendor, amount and date",
        "reasonCode": "DUPLICATE",
        "outcome": "ROUTE",
        "message": "Same vendor, amount and date as line 2 of CL-000118",
        "limit": null,
        "excess": null,
        "matchedClaimId": "01935f2a-1c00-7000-8000-000000000298",
        "matchedClaimNumber": "CL-000118",
        "matchedLineId": "01935f2a-1c00-7000-8000-000000000398",
        "matchedLineNo": 2
      }
    ],
    "submitBlockers": [
      {
        "lineId": null,
        "lineNo": null,
        "field": "receipt",
        "code": "RECEIPT_REQUIRED",
        "message": "Receipt required for amounts above 500.00"
      }
    ]
  },
  "claim": {
    "outcome": "ROUTE",
    "totalAmount": "16650.00",
    "projectedSteps": [
      "MANAGER"
    ],
    "lines": [
      {
        "lineId": "01935f2a-1c00-7000-8000-000000000401",
        "policyVersionNo": 1,
        "outcome": "ROUTE",
        "findings": [
          {
            "ruleCode": "HOTEL_NIGHTLY_TIER1",
            "ruleName": "Hotel per night (tier-1 city)",
            "reasonCode": "SOFT_LIMIT_EXCEEDED",
            "outcome": "ROUTE",
            "message": "6600.00/night in Mumbai exceeds the 6000.00 tier-1 limit by 600.00/night",
            "limitType": "SOFT",
            "unit": "PER_NIGHT",
            "limit": "6000.00",
            "actual": "6600.00",
            "excess": "600.00"
          }
        ]
      },
      {
        "lineId": "01935f2a-1c00-7000-8000-000000000402",
        "policyVersionNo": 1,
        "outcome": "AUTO_APPROVE",
        "findings": [
          {
            "ruleCode": "MEALS_DAILY",
            "ruleName": "Meals per day",
            "reasonCode": "WITHIN_LIMIT",
            "outcome": "AUTO_APPROVE",
            "message": "Meals 850.00 on 2026-11-17 within the 1500.00 daily limit",
            "limitType": "SOFT",
            "unit": "PER_DAY",
            "limit": "1500.00",
            "actual": "850.00",
            "excess": "0.00"
          }
        ]
      }
    ],
    "claimFindings": []
  },
  "submitBlockers": []
}
```

Errors: **400**, **401**, **403**, **404**, **409** (shape below).

<a id="post-apiclaimsclaimidsubmit"></a>

## POST /api/claims/{claimId}/submit

**Submit, or resubmit after send-back.** Roles: EMPLOYEE.

Roles: owner. From `DRAFT` or `SENT_BACK` (409 otherwise).

**422** (nothing changes) when the claim has no lines, a line above the receipt threshold has no
receipt, or a line's `expenseDate` is in the future. `errors` lists every problem per line.

Otherwise, in one transaction, status -> `SUBMITTED` and the policy engine runs on **new and edited
lines only**, with the current policy version (stored per line). Lines already evaluated and unchanged
keep their result and version; past decisions are never re-run (US15-AC3). Then:
**Duplicate scope** (both kinds): earlier lines in *counted claims*, meaning claims in `SUBMITTED` or
any later status, including `SENT_BACK` (not `DRAFT`, `AUTO_REJECTED`, `REJECTED`), plus earlier lines
(lower `lineNo`) in the same claim.
- any line over a hard limit, or whose receipt SHA-256 matches a line in scope (any employee) ->
  `AUTO_REJECTED` (final; `decisionReason` set);
- same vendor + amount + date as an in-scope line of the same employee -> `DUPLICATE` flag (ROUTE),
  finding names the matched claim and line;
- first submit, every line `AUTO_APPROVE` and total <= 25000 -> `AUTO_APPROVED`. Exactly one claim in
  each consecutive block of 10 auto-approved claims (position chosen at random when the block opens)
  is tagged `sampleAudit=true` and appears only in the A4 worklist (US11);
- first submit otherwise -> steps created (MANAGER; + AUDITOR if total > 25000; + FINANCE_HEAD if
  total > 100000; exactly 25000 / 100000 do not add the step) and status -> `PENDING_MANAGER`. The
  MANAGER step goes to the owner's manager; an owner with no manager gets the FINANCE_HEAD pool
  (minus the owner) at that step;
- **resubmit after a chain send-back** -> back to the step that sent it back (US4-AC2), which becomes
  `PENDING` again and is routed by normal rules at that moment: to the approver who sent it back
  (or the step's assignee, if a delegate sent it), with any active delegation applying. If that
  approver is now deactivated, a MANAGER step goes to *their* manager and an AUDITOR / FINANCE_HEAD
  step goes to the role pool. If the new total now crosses 25000 or 100000, the missing later steps
  are appended. Existing steps are never removed.
- **resubmit after a sample-audit send-back** -> policy reruns. If every line is still
  `AUTO_APPROVE` and total <= 25000: back to `AUTO_APPROVED` with `sampleAuditStatus=PENDING`,
  assigned to the same auditor (or the AUDITOR pool if deactivated). Otherwise it loses
  `AUTO_APPROVED` and the sample tag and goes through the normal chain from `PENDING_MANAGER`
  (or `AUTO_REJECTED` on a hard breach or receipt-hash duplicate).
`comment` is stored as the employee's reply (`RESUBMITTED` audit event, also in `comments`).
Notifications: `APPROVAL_WAITING` to whoever can act next, `CLAIM_DECIDED` to the owner on
auto-approve/auto-reject.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |

**Request** (`application/json`):

```json
{
  "version": 6,
  "comment": "Attached the itemised hotel bill"
}
```

**200**: Final status after policy and routing

- `application/json`: see [ClaimPendingManager](#claimpendingmanager) in the appendix.
- `application/json`: see [ClaimAutoRejected](#claimautorejected) in the appendix.

Errors: **400**, **401**, **403**, **404**, **409**, **422** (shape below).


---

# Audit trail

<a id="get-apiclaimsclaimidaudit-trail"></a>

## GET /api/claims/{claimId}/audit-trail

**Timeline of one claim, oldest first.** Roles: EMPLOYEE, MANAGER, AUDITOR, FINANCE_HEAD.

Roles: same as `GET /api/claims/{claimId}`. Includes comments, send-back reasons and replies.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |
| `page` | query | no | integer. 0-based page index. Default `0`. |
| `size` | query | no | integer. Default `50`. |

**200**: Page of events, ascending by time then id

```json
{
  "items": [
    {
      "id": 1041,
      "occurredAt": "2026-11-20T09:15:02Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null,
      "action": "SUBMITTED",
      "entityType": "CLAIM",
      "entityId": "01935f2a-1c00-7000-8000-000000000301",
      "claimId": "01935f2a-1c00-7000-8000-000000000301",
      "fromStatus": "DRAFT",
      "toStatus": "SUBMITTED",
      "comment": null,
      "details": {
        "policyVersionNo": 1
      }
    },
    {
      "id": 1042,
      "occurredAt": "2026-11-20T09:15:02Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null,
      "action": "ROUTED",
      "entityType": "CLAIM",
      "entityId": "01935f2a-1c00-7000-8000-000000000301",
      "claimId": "01935f2a-1c00-7000-8000-000000000301",
      "fromStatus": "SUBMITTED",
      "toStatus": "PENDING_MANAGER",
      "comment": null,
      "details": {
        "flags": [
          "SOFT_LIMIT_EXCEEDED"
        ]
      }
    },
    {
      "id": 1057,
      "occurredAt": "2026-11-21T05:02:40Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000106",
        "fullName": "Kiran Rao"
      },
      "onBehalfOf": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "action": "SENT_BACK",
      "entityType": "CLAIM",
      "entityId": "01935f2a-1c00-7000-8000-000000000301",
      "claimId": "01935f2a-1c00-7000-8000-000000000301",
      "fromStatus": "PENDING_MANAGER",
      "toStatus": "SENT_BACK",
      "comment": "Please attach the itemised hotel bill",
      "details": {
        "stepType": "MANAGER"
      }
    }
  ],
  "page": 0,
  "size": 50,
  "totalItems": 3,
  "totalPages": 1
}
```

Errors: **401**, **404** (shape below).


---

# Approvals

<a id="get-apiapprovalsinbox"></a>

## GET /api/approvals/inbox

**Approver inbox, oldest first.** Roles: MANAGER, AUDITOR, FINANCE_HEAD.

Roles: MANAGER, AUDITOR, FINANCE_HEAD. This is M1 for managers and also the finance head's
"Approval queue" (US12): FINANCE_HEAD steps, and MANAGER steps for owners with no manager, appear
here for finance heads and are decided with the same approve/reject/send-back endpoints (M2/M3).
`state`:
- `PENDING` (default): current steps I can act on: manager steps assigned to me, AUDITOR /
  FINANCE_HEAD pool steps for roles I hold, and the same for anyone with an active delegation to
  me (for roles I also hold), marked `delegated=true` with `onBehalfOf` (US7-AC2). A delegation is
  active only while today is within its dates, so it ends by itself after `endsOn` (US7-AC3).
  Never my own claims, and never sample-audit items (those are only in A4).
- `OVERDUE`: the `PENDING` items older than the policy's `overdueThresholdHours`.
- `SENT_BACK`: claims I (or a delegate for me) sent back that are still waiting for the employee.
- `DECIDED`: steps I approved or rejected, directly or on someone's behalf.
Ordered by `pendingSince` ascending (oldest first) for PENDING/OVERDUE, by action time descending
for SENT_BACK/DECIDED.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `state` | query | no | `PENDING|OVERDUE|SENT_BACK|DECIDED`. Default `PENDING`. |
| `stepType` | query | no | `MANAGER|AUDITOR|FINANCE_HEAD|SAMPLE_AUDIT`.  |
| `departmentId` | query | no | string.  |
| `minAmount` | query | no | string. Claim total at least this amount (inclusive). |
| `maxAmount` | query | no | string. Claim total at most this amount (inclusive). 400 if below `minAmount`. |
| `q` | query | no | string. Case-insensitive search on claim number (e.g. `CL-000123` or `000123`) and title. |
| `page` | query | no | integer. 0-based page index. Default `0`. |
| `size` | query | no | integer. Default `20`. |

**200**: Page of inbox items

Example `delegatedOverdue`:

```json
{
  "items": [
    {
      "stepId": "01935f2a-1c00-7000-8000-000000000601",
      "stepType": "MANAGER",
      "state": "PENDING",
      "pendingSince": "2026-11-20T09:15:02Z",
      "ageHours": 52.3,
      "overdue": true,
      "delegated": true,
      "onBehalfOf": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "myAction": null,
      "claim": {
        "id": "01935f2a-1c00-7000-8000-000000000301",
        "claimNumber": "CL-000123",
        "title": "Client visit - Mumbai",
        "status": "PENDING_MANAGER",
        "employee": {
          "id": "01935f2a-1c00-7000-8000-000000000101",
          "fullName": "Asha Verma"
        },
        "department": {
          "id": "01935f2a-1c00-7000-8000-000000000201",
          "code": "ENG",
          "name": "Engineering"
        },
        "tripStartDate": "2026-11-16",
        "tripEndDate": "2026-11-18",
        "currency": "INR",
        "totalAmount": "14050.00",
        "lineCount": 2,
        "policyOutcome": "ROUTE",
        "flags": [
          "SOFT_LIMIT_EXCEEDED"
        ],
        "sampleAudit": false,
        "sampleAuditStatus": null,
        "sampleAuditedBy": null,
        "sampleAuditedAt": null,
        "submittedAt": "2026-11-20T09:15:02Z",
        "decidedAt": null,
        "updatedAt": "2026-11-20T09:15:02Z"
      }
    }
  ],
  "page": 0,
  "size": 20,
  "totalItems": 1,
  "totalPages": 1
}
```

Errors: **400**, **401**, **403** (shape below).

<a id="post-apiclaimsclaimidapprove"></a>

## POST /api/claims/{claimId}/approve

**Approve the current chain step.** Roles: MANAGER, AUDITOR, FINANCE_HEAD.

Roles: whoever can act on the current `PENDING_MANAGER` / `PENDING_AUDITOR` /
`PENDING_FINANCE_HEAD` step (assignee, pool member with the role, or active delegate holding the
role). One call, `version` is the only required field (one-tap approve, US5-AC2). Flags (weekend,
duplicate, over soft limit) never block approval (US6-AC2). Moves to the next step, or `APPROVED`
after the last one (`CLAIM_DECIDED` to the owner). Writes an `APPROVED` audit event (US5-AC4).
Sample audits use the `/api/auditor/sample-audits` endpoints instead.
403: caller owns the claim or cannot act on this step. 409: no pending chain step, or stale `version`.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |

**Request** (`application/json`):

```json
{
  "version": 5,
  "comment": "Rate OK for that week"
}
```

**200**: Updated claim

- `application/json`: see [ClaimApproved](#claimapproved) in the appendix.

Errors: **400**, **401**, **403**, **404**, **409** (shape below).

<a id="post-apiclaimsclaimidreject"></a>

## POST /api/claims/{claimId}/reject

**Reject (final); reason required.** Roles: MANAGER, AUDITOR, FINANCE_HEAD.

Roles: as approve. Status -> `REJECTED` (final), `decisionReason` = `reason`, later steps -> `CANCELLED`, `CLAIM_DECIDED` to the owner.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |

**Request** (`application/json`):

```json
{
  "version": 5,
  "reason": "Personal travel, not reimbursable"
}
```

**200**: Updated claim

- `application/json`: see [ClaimRejected](#claimrejected) in the appendix.

Errors: **400**, **401**, **403**, **404**, **409** (shape below).

<a id="post-apiclaimsclaimidsend-back"></a>

## POST /api/claims/{claimId}/send-back

**Send back for clarification; comment required.** Roles: MANAGER, AUDITOR, FINANCE_HEAD.

Roles: as approve. Usable from M3 and from the A2 viewer (US10-AC2). Status -> `SENT_BACK`; the
acting step is marked `SENT_BACK` and records who sent it back; on resubmit the claim returns to that
step, routed by normal rules at that moment (see submit; US4-AC2). `SENT_BACK` notification to the owner.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |

**Request** (`application/json`):

```json
{
  "version": 5,
  "comment": "Please attach the itemised hotel bill"
}
```

**200**: Updated claim

- `application/json`: see [ClaimSentBack](#claimsentback) in the appendix.

Errors: **400**, **401**, **403**, **404**, **409** (shape below).

<a id="post-apiclaimsclaimidcomments"></a>

## POST /api/claims/{claimId}/comments

**Comment without changing status.** Roles: EMPLOYEE, MANAGER, AUDITOR, FINANCE_HEAD.

Roles: anyone who can see the claim; not on `DRAFT`. Stored as a `COMMENTED` audit event.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |

**Request** (`application/json`):

```json
{
  "comment": "Was the client dinner pre-approved?"
}
```

**201**: The stored event

```json
{
  "id": 1060,
  "occurredAt": "2026-11-21T06:00:00Z",
  "actor": {
    "id": "01935f2a-1c00-7000-8000-000000000102",
    "fullName": "Ravi Kumar"
  },
  "onBehalfOf": null,
  "action": "COMMENTED",
  "entityType": "CLAIM",
  "entityId": "01935f2a-1c00-7000-8000-000000000301",
  "claimId": "01935f2a-1c00-7000-8000-000000000301",
  "fromStatus": "PENDING_MANAGER",
  "toStatus": "PENDING_MANAGER",
  "comment": "Was the client dinner pre-approved?",
  "details": null
}
```

Errors: **400**, **401**, **404**, **409** (shape below).


---

# Auditor

<a id="get-apiauditorqueue"></a>

## GET /api/auditor/queue

**Auditor work queue (A1), oldest first.** Roles: AUDITOR.

Roles: AUDITOR. `PENDING_AUDITOR` claims only, excluding the caller's own. Claims at or below
25000 never reach this queue (US8-AC3). Sample-tagged claims are **not** here; they appear only in
A4 (`GET /api/auditor/sample-audits`, US11-AC2). All filters combine with AND (US9-AC1); `flag` is
repeatable and matches claims with at least one line finding of any listed reason. `minAgeHours`
filters on time waiting at this step.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `amountBand` | query | no | `UP_TO_25K|FROM_25K_TO_100K|ABOVE_100K`.  |
| `q` | query | no | string. Case-insensitive search on claim number (e.g. `CL-000123` or `000123`) and title. |
| `departmentId` | query | no | string.  |
| `flag` | query | no | array.  |
| `minAgeHours` | query | no | integer.  |
| `page` | query | no | integer. 0-based page index. Default `0`. |
| `size` | query | no | integer. Default `20`. |

**200**: Page of queue items

Example `queue`:

```json
{
  "items": [
    {
      "stepId": "01935f2a-1c00-7000-8000-000000000602",
      "stepType": "AUDITOR",
      "state": "PENDING",
      "pendingSince": "2026-11-23T06:00:00Z",
      "ageHours": 20.0,
      "overdue": false,
      "delegated": false,
      "onBehalfOf": null,
      "myAction": null,
      "claim": {
        "id": "01935f2a-1c00-7000-8000-000000000302",
        "claimNumber": "CL-000131",
        "title": "Bengaluru offsite",
        "status": "PENDING_AUDITOR",
        "employee": {
          "id": "01935f2a-1c00-7000-8000-000000000105",
          "fullName": "Neha Singh"
        },
        "department": {
          "id": "01935f2a-1c00-7000-8000-000000000201",
          "code": "ENG",
          "name": "Engineering"
        },
        "tripStartDate": "2026-11-19",
        "tripEndDate": "2026-11-21",
        "currency": "INR",
        "totalAmount": "38400.00",
        "lineCount": 6,
        "policyOutcome": "ROUTE",
        "flags": [
          "WEEKEND_EXPENSE"
        ],
        "sampleAudit": false,
        "sampleAuditStatus": null,
        "sampleAuditedBy": null,
        "sampleAuditedAt": null,
        "submittedAt": "2026-11-22T04:10:00Z",
        "decidedAt": null,
        "updatedAt": "2026-11-23T06:00:00Z"
      }
    }
  ],
  "page": 0,
  "size": 20,
  "totalItems": 1,
  "totalPages": 1
}
```

Errors: **400**, **401**, **403** (shape below).

<a id="post-apiauditorqueuebulk-approve"></a>

## POST /api/auditor/queue/bulk-approve

**Approve the selected queue rows (A3).** Roles: AUDITOR.

Roles: AUDITOR. Acts only on the 1-100 `claimIds` sent (the selected rows, US9-AC2). Each claim
is approved like `POST /api/claims/{id}/approve` in its own transaction, so one failure does not
stop the others; a failed row carries its reason (US9-AC3). 200 whenever the request is valid.

**Request** (`application/json`):

```json
{
  "claimIds": [
    "01935f2a-1c00-7000-8000-000000000302",
    "01935f2a-1c00-7000-8000-000000000308",
    "01935f2a-1c00-7000-8000-000000000303"
  ],
  "comment": "Spot-checked receipts"
}
```

**200**: Per-claim results

```json
{
  "succeeded": 2,
  "failed": 1,
  "results": [
    {
      "claimId": "01935f2a-1c00-7000-8000-000000000302",
      "outcome": "SUCCEEDED",
      "newStatus": "APPROVED",
      "error": null
    },
    {
      "claimId": "01935f2a-1c00-7000-8000-000000000308",
      "outcome": "SUCCEEDED",
      "newStatus": "PENDING_FINANCE_HEAD",
      "error": null
    },
    {
      "claimId": "01935f2a-1c00-7000-8000-000000000303",
      "outcome": "FAILED",
      "newStatus": null,
      "error": {
        "status": 403,
        "message": "You cannot act on your own claim"
      }
    }
  ]
}
```

Errors: **400**, **401**, **403** (shape below).

<a id="post-apiauditorqueuebulk-send-back"></a>

## POST /api/auditor/queue/bulk-send-back

**Send the selected queue rows back (A3).** Roles: AUDITOR.

Roles: AUDITOR. Screen-list A3 offers "approve or send back selected rows". Same per-claim
semantics as bulk approve; one comment (required) is sent to every claim.

**Request** (`application/json`):

```json
{
  "claimIds": [
    "01935f2a-1c00-7000-8000-000000000302"
  ],
  "comment": "Please attach itemised hotel bills"
}
```

**200**: Per-claim results

```json
{
  "succeeded": 1,
  "failed": 0,
  "results": [
    {
      "claimId": "01935f2a-1c00-7000-8000-000000000302",
      "outcome": "SUCCEEDED",
      "newStatus": "SENT_BACK",
      "error": null
    }
  ]
}
```

Errors: **400**, **401**, **403** (shape below).

<a id="get-apiauditorsample-audits"></a>

## GET /api/auditor/sample-audits

**Sample-audit worklist (A4).** Roles: AUDITOR.

Roles: AUDITOR. The only place sample-tagged claims appear (US11-AC2). `status=PENDING` (default)
lists tagged `AUTO_APPROVED` claims waiting for an auditor (excluding the caller's own); other values
show history with `sampleAuditedBy` / `sampleAuditedAt`. Sort: `submittedAt` (default asc).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `status` | query | no | `PENDING|CLEARED|REJECTED|SENT_BACK`.  |
| `departmentId` | query | no | string.  |
| `q` | query | no | string. Case-insensitive search on claim number (e.g. `CL-000123` or `000123`) and title. |
| `page` | query | no | integer. 0-based page index. Default `0`. |
| `size` | query | no | integer. Default `20`. |
| `sort` | query | no | string. `field,asc` or `field,desc`; allowed fields are listed per operation, anything else is 400. |

**200**: Page of claims

```json
{
  "items": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000305",
      "claimNumber": "CL-000135",
      "title": "Team lunch",
      "status": "AUTO_APPROVED",
      "employee": {
        "id": "01935f2a-1c00-7000-8000-000000000105",
        "fullName": "Neha Singh"
      },
      "department": {
        "id": "01935f2a-1c00-7000-8000-000000000201",
        "code": "ENG",
        "name": "Engineering"
      },
      "tripStartDate": null,
      "tripEndDate": null,
      "currency": "INR",
      "totalAmount": "1320.00",
      "lineCount": 1,
      "policyOutcome": "AUTO_APPROVE",
      "flags": [],
      "sampleAudit": true,
      "sampleAuditStatus": "PENDING",
      "sampleAuditedBy": null,
      "sampleAuditedAt": null,
      "submittedAt": "2026-11-24T08:00:00Z",
      "decidedAt": "2026-11-24T08:00:00Z",
      "updatedAt": "2026-11-24T08:00:00Z"
    }
  ],
  "page": 0,
  "size": 20,
  "totalItems": 1,
  "totalPages": 1
}
```

Errors: **400**, **401**, **403** (shape below).

<a id="post-apiauditorsample-auditsclaimidclear"></a>

## POST /api/auditor/sample-audits/{claimId}/clear

**Clear a sample audit (claim becomes payout-eligible).** Roles: AUDITOR.

Roles: AUDITOR, not the owner. Status stays `AUTO_APPROVED`; `sampleAuditStatus` -> `CLEARED`; `sampleAuditedBy` and `sampleAuditedAt` record the auditor and time (US11-AC3). 409 if no pending sample audit or stale `version`.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |

**Request** (`application/json`):

```json
{
  "version": 3,
  "comment": "Receipt matches"
}
```

**200**: Updated claim

- `application/json`: see [ClaimSampleCleared](#claimsamplecleared) in the appendix.

Errors: **400**, **401**, **403**, **404**, **409** (shape below).

<a id="post-apiauditorsample-auditsclaimidreject"></a>

## POST /api/auditor/sample-audits/{claimId}/reject

**Reject a sampled claim (final); reason required.** Roles: AUDITOR.

Roles: AUDITOR, not the owner. Status `AUTO_APPROVED` -> `REJECTED` (final, `decisionReason` = `reason`), `sampleAuditStatus` -> `REJECTED`, auditor and time recorded, `CLAIM_DECIDED` to the owner.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |

**Request** (`application/json`):

```json
{
  "version": 3,
  "reason": "Receipt belongs to a different trip"
}
```

**200**: Updated claim

- `application/json`: see [ClaimRejected](#claimrejected) in the appendix.

Errors: **400**, **401**, **403**, **404**, **409** (shape below).

<a id="post-apiauditorsample-auditsclaimidsend-back"></a>

## POST /api/auditor/sample-audits/{claimId}/send-back

**Send a sampled claim back; comment required.** Roles: AUDITOR.

Roles: AUDITOR, not the owner. Status `AUTO_APPROVED` -> `SENT_BACK`, `sampleAuditStatus` ->
`SENT_BACK`, auditor and time recorded. On resubmit policy reruns: if still all within limits and
total <= 25000 it returns to the same auditor's A4 list as `AUTO_APPROVED` with
`sampleAuditStatus=PENDING`; otherwise it loses `AUTO_APPROVED` and the tag and goes through the
normal chain from `PENDING_MANAGER` (or `AUTO_REJECTED`).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | path | yes | string.  |

**Request** (`application/json`):

```json
{
  "version": 3,
  "comment": "Please upload a legible receipt"
}
```

**200**: Updated claim

- `application/json`: see [ClaimSentBack](#claimsentback) in the appendix.

Errors: **400**, **401**, **403**, **404**, **409** (shape below).


---

# Payouts

<a id="get-apipayoutseligible-claims"></a>

## GET /api/payouts/eligible-claims

**Claims ready for payout.** Roles: FINANCE_HEAD.

Roles: FINANCE_HEAD. Eligible = not already in a batch and either `APPROVED`, or `AUTO_APPROVED`
with no pending sample audit (`sampleAudit=false` or `sampleAuditStatus=CLEARED`). See the conflict
with US13-AC1 ("only Approved claims") in `docs/api/ac-traceability.md`.
Sort: `decidedAt` (default asc), `totalAmount`.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `departmentId` | query | no | string.  |
| `q` | query | no | string. Case-insensitive search on claim number (e.g. `CL-000123` or `000123`) and title. |
| `page` | query | no | integer. 0-based page index. Default `0`. |
| `size` | query | no | integer. Default `20`. |
| `sort` | query | no | string. `field,asc` or `field,desc`; allowed fields are listed per operation, anything else is 400. |

**200**: Page of claims

```json
{
  "items": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000304",
      "claimNumber": "CL-000140",
      "title": "Pune client visit",
      "status": "AUTO_APPROVED",
      "employee": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "department": {
        "id": "01935f2a-1c00-7000-8000-000000000201",
        "code": "ENG",
        "name": "Engineering"
      },
      "tripStartDate": "2026-11-23",
      "tripEndDate": "2026-11-24",
      "currency": "INR",
      "totalAmount": "6200.00",
      "lineCount": 3,
      "policyOutcome": "AUTO_APPROVE",
      "flags": [],
      "sampleAudit": false,
      "sampleAuditStatus": null,
      "sampleAuditedBy": null,
      "sampleAuditedAt": null,
      "submittedAt": "2026-11-24T10:00:00Z",
      "decidedAt": "2026-11-24T10:00:00Z",
      "updatedAt": "2026-11-24T10:00:00Z"
    }
  ],
  "page": 0,
  "size": 20,
  "totalItems": 1,
  "totalPages": 1
}
```

Errors: **400**, **401**, **403** (shape below).

<a id="get-apipayouts"></a>

## GET /api/payouts

**List payout batches.** Roles: FINANCE_HEAD.

Roles: FINANCE_HEAD. Sort: `createdAt` (default desc).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `status` | query | no | `CREATED|EXPORTED|PAID`.  |
| `page` | query | no | integer. 0-based page index. Default `0`. |
| `size` | query | no | integer. Default `20`. |
| `sort` | query | no | string. `field,asc` or `field,desc`; allowed fields are listed per operation, anything else is 400. |

**200**: Page of batches

```json
{
  "items": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000701",
      "batchNumber": "PAY-2026-0007",
      "status": "CREATED",
      "claimCount": 1,
      "totalAmount": "6200.00",
      "createdBy": {
        "id": "01935f2a-1c00-7000-8000-000000000104",
        "fullName": "Arjun Shah"
      },
      "createdAt": "2026-11-27T09:30:00Z",
      "exportedAt": null,
      "paidAt": null,
      "bankReference": null,
      "version": 0
    }
  ],
  "page": 0,
  "size": 20,
  "totalItems": 1,
  "totalPages": 1
}
```

Errors: **400**, **401**, **403** (shape below).

<a id="post-apipayouts"></a>

## POST /api/payouts

**Create a batch from eligible claims.** Roles: FINANCE_HEAD.

Roles: FINANCE_HEAD. With `claimIds`, exactly those (F2 selection); without, all eligible claims.
Claims are reserved for this batch (no longer eligible elsewhere) but keep their status until export.
Bank account and IFSC are snapshotted. Totals are decimal strings; the UI formats them in ₹ with
Indian grouping (US13-AC2). 409: a listed claim is not eligible, an employee has no bank details,
or nothing is eligible. Batches cannot be cancelled.

**Request** (`application/json`):

```json
{
  "claimIds": [
    "01935f2a-1c00-7000-8000-000000000304"
  ]
}
```

**201**: Created

Example `created`:

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000701",
  "batchNumber": "PAY-2026-0007",
  "status": "CREATED",
  "claimCount": 1,
  "totalAmount": "6200.00",
  "createdBy": {
    "id": "01935f2a-1c00-7000-8000-000000000104",
    "fullName": "Arjun Shah"
  },
  "createdAt": "2026-11-27T09:30:00Z",
  "exportedAt": null,
  "paidAt": null,
  "bankReference": null,
  "version": 0,
  "items": [
    {
      "claimId": "01935f2a-1c00-7000-8000-000000000304",
      "claimNumber": "CL-000140",
      "employee": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "employeeCode": "E1001",
      "amount": "6200.00",
      "bankAccountNumber": "000111222333",
      "ifscCode": "HDFC0001234"
    }
  ]
}
```

Errors: **400**, **401**, **403**, **409** (shape below).

<a id="get-apipayoutsbatchid"></a>

## GET /api/payouts/{batchId}

**Batch with its items.** Roles: FINANCE_HEAD.

Roles: FINANCE_HEAD.

| Parameter | In | Required | Notes |
|---|---|---|---|
| `batchId` | path | yes | string.  |

**200**: Batch

Example `created`:

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000701",
  "batchNumber": "PAY-2026-0007",
  "status": "CREATED",
  "claimCount": 1,
  "totalAmount": "6200.00",
  "createdBy": {
    "id": "01935f2a-1c00-7000-8000-000000000104",
    "fullName": "Arjun Shah"
  },
  "createdAt": "2026-11-27T09:30:00Z",
  "exportedAt": null,
  "paidAt": null,
  "bankReference": null,
  "version": 0,
  "items": [
    {
      "claimId": "01935f2a-1c00-7000-8000-000000000304",
      "claimNumber": "CL-000140",
      "employee": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "employeeCode": "E1001",
      "amount": "6200.00",
      "bankAccountNumber": "000111222333",
      "ifscCode": "HDFC0001234"
    }
  ]
}
```

Errors: **401**, **403**, **404** (shape below).

<a id="get-apipayoutsbatchidexport"></a>

## GET /api/payouts/{batchId}/export

**Download the bank CSV.** Roles: FINANCE_HEAD.

Roles: FINANCE_HEAD. First download moves the batch `CREATED -> EXPORTED` and every claim in it to
`IN_BATCH` (US13-AC3), audited; later downloads return the same content. Mock bank-file format:
UTF-8, header row, one row per claim, two-decimal amounts. Cells starting with `=`, `+`, `-`, `@`
are prefixed with `'` (CSV injection).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `batchId` | path | yes | string.  |

**200**: CSV file

`text/csv`:
```
batch_number,claim_number,employee_code,employee_name,bank_account_number,ifsc_code,amount,currency,narration
PAY-2026-0007,CL-000140,E1001,Asha Verma,000111222333,HDFC0001234,6200.00,INR,CL-000140 reimbursement
```

Errors: **401**, **403**, **404** (shape below).

<a id="post-apipayoutsbatchidmark-paid"></a>

## POST /api/payouts/{batchId}/mark-paid

**Mark batch paid; claims -> PAID.** Roles: FINANCE_HEAD.

Roles: FINANCE_HEAD. Requires `confirm: true` (the separate confirmation, US14-AC1; anything
else is 400). Only from `EXPORTED`; a batch already `PAID` returns 409 (US14-AC3). Every claim in the
batch -> `PAID` and each owner gets a `PAYOUT_DONE` notification (US14-AC2).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `batchId` | path | yes | string.  |

**Request** (`application/json`):

```json
{
  "version": 1,
  "confirm": true,
  "bankReference": "UTR2026112700042",
  "paidOn": "2026-11-27"
}
```

**200**: Paid batch

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000701",
  "batchNumber": "PAY-2026-0007",
  "status": "PAID",
  "claimCount": 1,
  "totalAmount": "6200.00",
  "createdBy": {
    "id": "01935f2a-1c00-7000-8000-000000000104",
    "fullName": "Arjun Shah"
  },
  "createdAt": "2026-11-27T09:30:00Z",
  "exportedAt": "2026-11-27T09:35:00Z",
  "paidAt": "2026-11-27T10:00:00Z",
  "bankReference": "UTR2026112700042",
  "version": 2,
  "items": [
    {
      "claimId": "01935f2a-1c00-7000-8000-000000000304",
      "claimNumber": "CL-000140",
      "employee": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "employeeCode": "E1001",
      "amount": "6200.00",
      "bankAccountNumber": "000111222333",
      "ifscCode": "HDFC0001234"
    }
  ]
}
```

Errors: **400**, **401**, **403**, **404**, **409** (shape below).


---

# Dashboard

<a id="get-apidashboard"></a>

## GET /api/dashboard

**Spend, violations, approval time and queue health.** Roles: AUDITOR, FINANCE_HEAD.

Roles: AUDITOR, FINANCE_HEAD.
- Spend: lines of claims in `APPROVED`, `AUTO_APPROVED` (not rejected after sample audit),
  `IN_BATCH`, `PAID`, bucketed by line `expenseDate` within `[from, to]`.
- Violations: findings other than WITHIN_LIMIT from each claim's latest evaluation, for claims submitted in range.
- Approval time: latest submission -> final approval (`APPROVED`), human-approved claims only
  (auto-approved excluded), for claims approved in range.
- `queues`, `oldestPending` and `approvalAgeAlert` are live (ignore the date range; respect
  `departmentId`). The alert threshold is the policy's `overdueThresholdHours` (US18-AC1); the
  Prometheus alert itself (fire once per breach, US18-AC2) is built on the
  `expenseflow_oldest_pending_approval_age_seconds` gauge, outside this API.
Range up to 366 days (400 otherwise).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `from` | query | yes | string.  |
| `to` | query | yes | string.  |
| `departmentId` | query | no | string.  |

**200**: Dashboard data

```json
{
  "from": "2026-06-01",
  "to": "2026-11-30",
  "totalSpend": "412530.00",
  "spendByCategory": [
    {
      "category": "HOTEL",
      "amount": "210400.00",
      "lineCount": 38
    },
    {
      "category": "MEALS",
      "amount": "96130.00",
      "lineCount": 141
    }
  ],
  "spendByDepartment": [
    {
      "departmentId": "01935f2a-1c00-7000-8000-000000000201",
      "departmentName": "Engineering",
      "amount": "250000.00",
      "claimCount": 41
    }
  ],
  "spendByMonth": [
    {
      "month": "2026-10",
      "amount": "88200.00",
      "claimCount": 17
    },
    {
      "month": "2026-11",
      "amount": "102300.00",
      "claimCount": 22
    }
  ],
  "policyViolations": {
    "totalFindings": 57,
    "autoRejectedClaims": 6,
    "routedClaims": 31,
    "byReason": [
      {
        "reasonCode": "WEEKEND_EXPENSE",
        "outcome": "ROUTE",
        "count": 22
      },
      {
        "reasonCode": "HARD_LIMIT_EXCEEDED",
        "outcome": "AUTO_REJECT",
        "count": 4
      }
    ]
  },
  "approvalTime": {
    "claimCount": 48,
    "averageHours": 30.5
  },
  "queues": [
    {
      "stepType": "MANAGER",
      "pending": 7,
      "overdue": 2
    },
    {
      "stepType": "AUDITOR",
      "pending": 4,
      "overdue": 0
    },
    {
      "stepType": "FINANCE_HEAD",
      "pending": 1,
      "overdue": 1
    },
    {
      "stepType": "SAMPLE_AUDIT",
      "pending": 3,
      "overdue": 0
    }
  ],
  "oldestPending": {
    "claimId": "01935f2a-1c00-7000-8000-000000000306",
    "claimNumber": "CL-000101",
    "stepType": "FINANCE_HEAD",
    "pendingSince": "2026-11-21T04:00:00Z",
    "ageHours": 150.5
  },
  "approvalAgeAlert": {
    "thresholdHours": 48,
    "breached": true,
    "breachedSince": "2026-11-23T04:00:00Z"
  }
}
```

Errors: **400**, **401**, **403** (shape below).


---

# Audit trail

<a id="get-apiaudit-events"></a>

## GET /api/audit-events

**Search the whole audit trail.** Roles: AUDITOR, FINANCE_HEAD.

Roles: AUDITOR, FINANCE_HEAD. Read-only; nothing can change or delete events. Sort: `occurredAt` (default desc).

| Parameter | In | Required | Notes |
|---|---|---|---|
| `claimId` | query | no | string.  |
| `actorId` | query | no | string.  |
| `action` | query | no | `LOGIN|LOGIN_FAILED|LOGOUT|CLAIM_CREATED|CLAIM_UPDATED|CLAIM_DELETED|LINE_ADDED|LINE_UPDATED|LINE_REMOVED|RECEIPT_UPLOADED|SUBMITTED|RESUBMITTED|POLICY_EVALUATED|AUTO_APPROVED|AUTO_REJECTED|ROUTED|STEPS_ADDED|SAMPLE_AUDIT_SELECTED|SAMPLE_AUDIT_CLEARED|APPROVED|REJECTED|SENT_BACK|COMMENTED|ADDED_TO_BATCH|PAYOUT_BATCH_CREATED|PAYOUT_EXPORTED|PAYOUT_PAID|DELEGATION_CREATED|DELEGATION_REVOKED|POLICY_VERSION_CREATED|USER_UPDATED`.  |
| `entityType` | query | no | `CLAIM|EXPENSE_LINE|PAYOUT_BATCH|DELEGATION|POLICY_VERSION|USER`.  |
| `from` | query | no | string.  |
| `to` | query | no | string.  |
| `page` | query | no | integer. 0-based page index. Default `0`. |
| `size` | query | no | integer. Default `20`. |
| `sort` | query | no | string. `field,asc` or `field,desc`; allowed fields are listed per operation, anything else is 400. |

**200**: Page of events

```json
{
  "items": [
    {
      "id": 1099,
      "occurredAt": "2026-11-27T08:59:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000104",
        "fullName": "Arjun Shah"
      },
      "onBehalfOf": null,
      "action": "LOGIN",
      "entityType": "USER",
      "entityId": "01935f2a-1c00-7000-8000-000000000104",
      "claimId": null,
      "fromStatus": null,
      "toStatus": null,
      "comment": null,
      "details": null
    }
  ],
  "page": 0,
  "size": 20,
  "totalItems": 1,
  "totalPages": 1
}
```

Errors: **400**, **401**, **403** (shape below).


---

# Errors

Every error uses the same shape. `errors` appears only on 422 from submit.

**BadRequest**: Validation failed or malformed request

```json
{
  "timestamp": "2026-11-27T09:00:00Z",
  "status": 400,
  "error": "Bad Request",
  "message": "Validation failed: amount: must be greater than 0; expenseDate: must not be in the future",
  "path": "/api/claims/01935f2a-1c00-7000-8000-000000000301/lines",
  "requestId": "6f1c2a9e-4b7d-4c1e-9a55-2f0d8c3b7e10"
}
```

**Unauthorized**: Missing, invalid or expired token; or unknown/inactive user at sign-in

```json
{
  "timestamp": "2026-11-27T09:00:00Z",
  "status": 401,
  "error": "Unauthorized",
  "message": "Authentication required",
  "path": "/api/claims",
  "requestId": "6f1c2a9e-4b7d-4c1e-9a55-2f0d8c3b7e11"
}
```

**Forbidden**: Role not allowed, or not allowed on this resource (e.g. own claim)

```json
{
  "timestamp": "2026-11-27T09:00:00Z",
  "status": 403,
  "error": "Forbidden",
  "message": "You cannot act on your own claim",
  "path": "/api/claims/01935f2a-1c00-7000-8000-000000000301/approve",
  "requestId": "6f1c2a9e-4b7d-4c1e-9a55-2f0d8c3b7e12"
}
```

**NotFound**: Does not exist, or not visible to the caller

```json
{
  "timestamp": "2026-11-27T09:00:00Z",
  "status": 404,
  "error": "Not Found",
  "message": "Claim not found",
  "path": "/api/claims/01935f2a-1c00-7000-8000-000000000399",
  "requestId": "6f1c2a9e-4b7d-4c1e-9a55-2f0d8c3b7e13"
}
```

**Conflict**: Conflicts with current state (wrong status, stale version, overlap, duplicate)

```json
{
  "timestamp": "2026-11-27T09:00:00Z",
  "status": 409,
  "error": "Conflict",
  "message": "Claim is locked after submit (status PENDING_MANAGER)",
  "path": "/api/claims/01935f2a-1c00-7000-8000-000000000301/lines",
  "requestId": "6f1c2a9e-4b7d-4c1e-9a55-2f0d8c3b7e14"
}
```

**SubmitBlocked**: Claim cannot be submitted as it stands; `errors` lists each problem

```json
{
  "timestamp": "2026-11-27T09:00:00Z",
  "status": 422,
  "error": "Unprocessable Content",
  "message": "Claim cannot be submitted (2 problems)",
  "path": "/api/claims/01935f2a-1c00-7000-8000-000000000301/submit",
  "requestId": "6f1c2a9e-4b7d-4c1e-9a55-2f0d8c3b7e15",
  "errors": [
    {
      "lineId": "01935f2a-1c00-7000-8000-000000000401",
      "lineNo": 1,
      "field": "receipt",
      "code": "RECEIPT_REQUIRED",
      "message": "Receipt required for amounts above 500.00"
    },
    {
      "lineId": "01935f2a-1c00-7000-8000-000000000403",
      "lineNo": 3,
      "field": "receipt",
      "code": "RECEIPT_REQUIRED",
      "message": "Receipt required for amounts above 500.00"
    }
  ]
}
```


---

# Appendix: ClaimDetail examples

<a id="claimdraft"></a>

## ClaimDraft

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000301",
  "claimNumber": "CL-000123",
  "title": "Client visit - Mumbai",
  "status": "DRAFT",
  "employee": {
    "id": "01935f2a-1c00-7000-8000-000000000101",
    "fullName": "Asha Verma"
  },
  "department": {
    "id": "01935f2a-1c00-7000-8000-000000000201",
    "code": "ENG",
    "name": "Engineering"
  },
  "tripStartDate": "2026-11-16",
  "tripEndDate": "2026-11-18",
  "currency": "INR",
  "totalAmount": "14050.00",
  "lineCount": 2,
  "policyOutcome": null,
  "flags": [],
  "sampleAudit": false,
  "sampleAuditStatus": null,
  "sampleAuditedBy": null,
  "sampleAuditedAt": null,
  "submittedAt": null,
  "decidedAt": null,
  "updatedAt": "2026-11-19T12:00:00Z",
  "purpose": "On-site workshop with Acme Retail",
  "submissionNo": 0,
  "policyVersionNo": null,
  "decisionReason": null,
  "editable": true,
  "lines": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000401",
      "lineNo": 1,
      "category": "HOTEL",
      "amount": "13200.00",
      "expenseDate": "2026-11-17",
      "vendor": "Hotel Sea View",
      "notes": "2 nights",
      "city": "Mumbai",
      "nights": 2,
      "receipt": null,
      "policyOutcome": null,
      "policyVersionNo": null,
      "findings": []
    },
    {
      "id": "01935f2a-1c00-7000-8000-000000000402",
      "lineNo": 2,
      "category": "MEALS",
      "amount": "850.00",
      "expenseDate": "2026-11-17",
      "vendor": "Cafe Madras",
      "notes": "Dinner",
      "city": null,
      "nights": null,
      "receipt": null,
      "policyOutcome": null,
      "policyVersionNo": null,
      "findings": []
    }
  ],
  "latestEvaluation": null,
  "approvalSteps": [],
  "statusHistory": [
    {
      "fromStatus": null,
      "toStatus": "DRAFT",
      "at": "2026-11-19T11:40:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    }
  ],
  "comments": [],
  "allowedActions": [
    "EDIT",
    "DELETE",
    "SUBMIT"
  ],
  "version": 2,
  "createdAt": "2026-11-19T11:40:00Z"
}
```

<a id="claimpendingmanager"></a>

## ClaimPendingManager

Hotel over the tier-1 soft cap; routed to the manager

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000301",
  "claimNumber": "CL-000123",
  "title": "Client visit - Mumbai",
  "status": "PENDING_MANAGER",
  "employee": {
    "id": "01935f2a-1c00-7000-8000-000000000101",
    "fullName": "Asha Verma"
  },
  "department": {
    "id": "01935f2a-1c00-7000-8000-000000000201",
    "code": "ENG",
    "name": "Engineering"
  },
  "tripStartDate": "2026-11-16",
  "tripEndDate": "2026-11-18",
  "currency": "INR",
  "totalAmount": "14050.00",
  "lineCount": 2,
  "policyOutcome": "ROUTE",
  "flags": [
    "SOFT_LIMIT_EXCEEDED"
  ],
  "sampleAudit": false,
  "sampleAuditStatus": null,
  "sampleAuditedBy": null,
  "sampleAuditedAt": null,
  "submittedAt": "2026-11-20T09:15:02Z",
  "decidedAt": null,
  "updatedAt": "2026-11-20T09:15:02Z",
  "purpose": "On-site workshop with Acme Retail",
  "submissionNo": 1,
  "policyVersionNo": 1,
  "decisionReason": null,
  "editable": false,
  "lines": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000401",
      "lineNo": 1,
      "category": "HOTEL",
      "amount": "13200.00",
      "expenseDate": "2026-11-17",
      "vendor": "Hotel Sea View",
      "notes": "2 nights",
      "city": "Mumbai",
      "nights": 2,
      "receipt": {
        "id": "01935f2a-1c00-7000-8000-000000000501",
        "fileName": "hotel-invoice.pdf",
        "contentType": "application/pdf",
        "sizeBytes": 184220,
        "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        "uploadedAt": "2026-11-19T12:01:00Z"
      },
      "policyOutcome": "ROUTE",
      "policyVersionNo": 1,
      "findings": [
        {
          "ruleCode": "HOTEL_NIGHTLY_TIER1",
          "ruleName": "Hotel per night (tier-1 city)",
          "reasonCode": "SOFT_LIMIT_EXCEEDED",
          "outcome": "ROUTE",
          "message": "6600.00/night in Mumbai exceeds the 6000.00 tier-1 limit by 600.00/night",
          "limitType": "SOFT",
          "unit": "PER_NIGHT",
          "limit": "6000.00",
          "actual": "6600.00",
          "excess": "600.00"
        }
      ]
    },
    {
      "id": "01935f2a-1c00-7000-8000-000000000402",
      "lineNo": 2,
      "category": "MEALS",
      "amount": "850.00",
      "expenseDate": "2026-11-17",
      "vendor": "Cafe Madras",
      "notes": "Dinner",
      "city": null,
      "nights": null,
      "receipt": {
        "id": "01935f2a-1c00-7000-8000-000000000502",
        "fileName": "dinner.jpg",
        "contentType": "image/jpeg",
        "sizeBytes": 90412,
        "sha256": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
        "uploadedAt": "2026-11-19T12:03:00Z"
      },
      "policyOutcome": "AUTO_APPROVE",
      "policyVersionNo": 1,
      "findings": [
        {
          "ruleCode": "MEALS_DAILY",
          "ruleName": "Meals per day",
          "reasonCode": "WITHIN_LIMIT",
          "outcome": "AUTO_APPROVE",
          "message": "Meals 850.00 on 2026-11-17 within the 1500.00 daily limit",
          "limitType": "SOFT",
          "unit": "PER_DAY",
          "limit": "1500.00",
          "actual": "850.00",
          "excess": "0.00"
        }
      ]
    }
  ],
  "latestEvaluation": {
    "submissionNo": 1,
    "policyVersionNo": 1,
    "evaluatedAt": "2026-11-20T09:15:02Z",
    "outcome": "ROUTE",
    "totalAmount": "14050.00",
    "claimFindings": [],
    "lines": [
      {
        "lineId": "01935f2a-1c00-7000-8000-000000000401",
        "policyVersionNo": 1,
        "outcome": "ROUTE",
        "findings": [
          {
            "ruleCode": "HOTEL_NIGHTLY_TIER1",
            "ruleName": "Hotel per night (tier-1 city)",
            "reasonCode": "SOFT_LIMIT_EXCEEDED",
            "outcome": "ROUTE",
            "message": "6600.00/night in Mumbai exceeds the 6000.00 tier-1 limit by 600.00/night",
            "limitType": "SOFT",
            "unit": "PER_NIGHT",
            "limit": "6000.00",
            "actual": "6600.00",
            "excess": "600.00"
          }
        ]
      },
      {
        "lineId": "01935f2a-1c00-7000-8000-000000000402",
        "policyVersionNo": 1,
        "outcome": "AUTO_APPROVE",
        "findings": [
          {
            "ruleCode": "MEALS_DAILY",
            "ruleName": "Meals per day",
            "reasonCode": "WITHIN_LIMIT",
            "outcome": "AUTO_APPROVE",
            "message": "Meals 850.00 on 2026-11-17 within the 1500.00 daily limit",
            "limitType": "SOFT",
            "unit": "PER_DAY",
            "limit": "1500.00",
            "actual": "850.00",
            "excess": "0.00"
          }
        ]
      }
    ]
  },
  "approvalSteps": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000601",
      "sequence": 1,
      "stepType": "MANAGER",
      "assignee": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "status": "PENDING",
      "pendingSince": "2026-11-20T09:15:02Z",
      "overdue": false,
      "approverName": "Ravi Kumar",
      "onBehalfOfName": null,
      "decidedAt": null,
      "actedBy": null,
      "onBehalfOf": null,
      "actedAt": null,
      "comment": null
    }
  ],
  "statusHistory": [
    {
      "fromStatus": null,
      "toStatus": "DRAFT",
      "at": "2026-11-19T11:40:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "DRAFT",
      "toStatus": "SUBMITTED",
      "at": "2026-11-20T09:15:02Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "SUBMITTED",
      "toStatus": "PENDING_MANAGER",
      "at": "2026-11-20T09:15:02Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    }
  ],
  "comments": [],
  "allowedActions": [
    "COMMENT"
  ],
  "version": 5,
  "createdAt": "2026-11-19T11:40:00Z"
}
```

<a id="claimautorejected"></a>

## ClaimAutoRejected

Cab over the hard limit; final

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000307",
  "claimNumber": "CL-000150",
  "title": "Airport transfers",
  "status": "AUTO_REJECTED",
  "employee": {
    "id": "01935f2a-1c00-7000-8000-000000000101",
    "fullName": "Asha Verma"
  },
  "department": {
    "id": "01935f2a-1c00-7000-8000-000000000201",
    "code": "ENG",
    "name": "Engineering"
  },
  "tripStartDate": null,
  "tripEndDate": null,
  "currency": "INR",
  "totalAmount": "4500.00",
  "lineCount": 1,
  "policyOutcome": "AUTO_REJECT",
  "flags": [
    "HARD_LIMIT_EXCEEDED"
  ],
  "sampleAudit": false,
  "sampleAuditStatus": null,
  "sampleAuditedBy": null,
  "sampleAuditedAt": null,
  "submittedAt": "2026-11-26T07:00:00Z",
  "decidedAt": "2026-11-26T07:00:00Z",
  "updatedAt": "2026-11-26T07:00:00Z",
  "purpose": null,
  "submissionNo": 1,
  "policyVersionNo": 2,
  "decisionReason": "Line 1: cab 4500.00 exceeds the 4000.00 per-trip hard limit",
  "editable": false,
  "lines": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000410",
      "lineNo": 1,
      "category": "LOCAL_CAB",
      "amount": "4500.00",
      "expenseDate": "2026-11-25",
      "vendor": "Ola",
      "notes": "Airport round trip",
      "city": null,
      "nights": null,
      "receipt": {
        "id": "01935f2a-1c00-7000-8000-000000000510",
        "fileName": "ola.png",
        "contentType": "image/png",
        "sizeBytes": 50211,
        "sha256": "fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9",
        "uploadedAt": "2026-11-26T06:58:00Z"
      },
      "policyOutcome": "AUTO_REJECT",
      "policyVersionNo": 2,
      "findings": [
        {
          "ruleCode": "LOCAL_CAB_TRIP",
          "ruleName": "Local cab per trip",
          "reasonCode": "HARD_LIMIT_EXCEEDED",
          "outcome": "AUTO_REJECT",
          "message": "Cab 4500.00 exceeds the 4000.00 per-trip hard limit by 500.00",
          "limitType": "HARD",
          "unit": "PER_TRIP",
          "limit": "4000.00",
          "actual": "4500.00",
          "excess": "500.00"
        }
      ]
    }
  ],
  "latestEvaluation": null,
  "approvalSteps": [],
  "statusHistory": [
    {
      "fromStatus": null,
      "toStatus": "DRAFT",
      "at": "2026-11-26T06:50:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "DRAFT",
      "toStatus": "SUBMITTED",
      "at": "2026-11-26T07:00:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "SUBMITTED",
      "toStatus": "AUTO_REJECTED",
      "at": "2026-11-26T07:00:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    }
  ],
  "comments": [],
  "allowedActions": [],
  "version": 3,
  "createdAt": "2026-11-26T06:50:00Z"
}
```

<a id="claimapproved"></a>

## ClaimApproved

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000301",
  "claimNumber": "CL-000123",
  "title": "Client visit - Mumbai",
  "status": "APPROVED",
  "employee": {
    "id": "01935f2a-1c00-7000-8000-000000000101",
    "fullName": "Asha Verma"
  },
  "department": {
    "id": "01935f2a-1c00-7000-8000-000000000201",
    "code": "ENG",
    "name": "Engineering"
  },
  "tripStartDate": "2026-11-16",
  "tripEndDate": "2026-11-18",
  "currency": "INR",
  "totalAmount": "14050.00",
  "lineCount": 2,
  "policyOutcome": "ROUTE",
  "flags": [
    "SOFT_LIMIT_EXCEEDED"
  ],
  "sampleAudit": false,
  "sampleAuditStatus": null,
  "sampleAuditedBy": null,
  "sampleAuditedAt": null,
  "submittedAt": "2026-11-21T09:00:00Z",
  "decidedAt": "2026-11-21T11:30:00Z",
  "updatedAt": "2026-11-21T11:30:00Z",
  "purpose": "On-site workshop with Acme Retail",
  "submissionNo": 2,
  "policyVersionNo": 1,
  "decisionReason": null,
  "editable": false,
  "lines": [],
  "latestEvaluation": null,
  "approvalSteps": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000601",
      "sequence": 1,
      "stepType": "MANAGER",
      "assignee": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "status": "APPROVED",
      "pendingSince": null,
      "overdue": false,
      "approverName": "Kiran Rao",
      "onBehalfOfName": "Ravi Kumar",
      "decidedAt": "2026-11-21T11:30:00Z",
      "actedBy": {
        "id": "01935f2a-1c00-7000-8000-000000000106",
        "fullName": "Kiran Rao"
      },
      "onBehalfOf": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "actedAt": "2026-11-21T11:30:00Z",
      "comment": "Rate OK for that week"
    }
  ],
  "statusHistory": [
    {
      "fromStatus": null,
      "toStatus": "DRAFT",
      "at": "2026-11-19T11:40:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "DRAFT",
      "toStatus": "SUBMITTED",
      "at": "2026-11-20T09:15:02Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "SUBMITTED",
      "toStatus": "PENDING_MANAGER",
      "at": "2026-11-20T09:15:02Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "PENDING_MANAGER",
      "toStatus": "SENT_BACK",
      "at": "2026-11-21T05:02:40Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000106",
        "fullName": "Kiran Rao"
      },
      "onBehalfOf": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      }
    },
    {
      "fromStatus": "SENT_BACK",
      "toStatus": "SUBMITTED",
      "at": "2026-11-21T09:00:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "SUBMITTED",
      "toStatus": "PENDING_MANAGER",
      "at": "2026-11-21T09:00:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "PENDING_MANAGER",
      "toStatus": "APPROVED",
      "at": "2026-11-21T11:30:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000106",
        "fullName": "Kiran Rao"
      },
      "onBehalfOf": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      }
    }
  ],
  "comments": [
    {
      "kind": "SEND_BACK",
      "text": "Please attach the itemised hotel bill",
      "author": {
        "id": "01935f2a-1c00-7000-8000-000000000106",
        "fullName": "Kiran Rao"
      },
      "onBehalfOf": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "at": "2026-11-21T05:02:40Z"
    },
    {
      "kind": "RESUBMIT_REPLY",
      "text": "Attached the itemised hotel bill",
      "author": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null,
      "at": "2026-11-21T09:00:00Z"
    },
    {
      "kind": "APPROVAL_NOTE",
      "text": "Rate OK for that week",
      "author": {
        "id": "01935f2a-1c00-7000-8000-000000000106",
        "fullName": "Kiran Rao"
      },
      "onBehalfOf": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "at": "2026-11-21T11:30:00Z"
    }
  ],
  "allowedActions": [
    "COMMENT"
  ],
  "version": 8,
  "createdAt": "2026-11-19T11:40:00Z"
}
```

<a id="claimrejected"></a>

## ClaimRejected

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000301",
  "claimNumber": "CL-000123",
  "title": "Client visit - Mumbai",
  "status": "REJECTED",
  "employee": {
    "id": "01935f2a-1c00-7000-8000-000000000101",
    "fullName": "Asha Verma"
  },
  "department": {
    "id": "01935f2a-1c00-7000-8000-000000000201",
    "code": "ENG",
    "name": "Engineering"
  },
  "tripStartDate": "2026-11-16",
  "tripEndDate": "2026-11-18",
  "currency": "INR",
  "totalAmount": "14050.00",
  "lineCount": 2,
  "policyOutcome": "ROUTE",
  "flags": [
    "SOFT_LIMIT_EXCEEDED"
  ],
  "sampleAudit": false,
  "sampleAuditStatus": null,
  "sampleAuditedBy": null,
  "sampleAuditedAt": null,
  "submittedAt": "2026-11-20T09:15:02Z",
  "decidedAt": "2026-11-21T05:02:40Z",
  "updatedAt": "2026-11-21T05:02:40Z",
  "purpose": "On-site workshop with Acme Retail",
  "submissionNo": 1,
  "policyVersionNo": 1,
  "decisionReason": "Personal travel, not reimbursable",
  "editable": false,
  "lines": [],
  "latestEvaluation": null,
  "approvalSteps": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000601",
      "sequence": 1,
      "stepType": "MANAGER",
      "assignee": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "status": "REJECTED",
      "pendingSince": null,
      "overdue": false,
      "approverName": "Ravi Kumar",
      "onBehalfOfName": null,
      "decidedAt": "2026-11-21T05:02:40Z",
      "actedBy": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "onBehalfOf": null,
      "actedAt": "2026-11-21T05:02:40Z",
      "comment": "Personal travel, not reimbursable"
    }
  ],
  "statusHistory": [
    {
      "fromStatus": null,
      "toStatus": "DRAFT",
      "at": "2026-11-19T11:40:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "DRAFT",
      "toStatus": "SUBMITTED",
      "at": "2026-11-20T09:15:02Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "SUBMITTED",
      "toStatus": "PENDING_MANAGER",
      "at": "2026-11-20T09:15:02Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "PENDING_MANAGER",
      "toStatus": "REJECTED",
      "at": "2026-11-21T05:02:40Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "onBehalfOf": null
    }
  ],
  "comments": [
    {
      "kind": "REJECT_REASON",
      "text": "Personal travel, not reimbursable",
      "author": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "onBehalfOf": null,
      "at": "2026-11-21T05:02:40Z"
    }
  ],
  "allowedActions": [
    "COMMENT"
  ],
  "version": 6,
  "createdAt": "2026-11-19T11:40:00Z"
}
```

<a id="claimsentback"></a>

## ClaimSentBack

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000301",
  "claimNumber": "CL-000123",
  "title": "Client visit - Mumbai",
  "status": "SENT_BACK",
  "employee": {
    "id": "01935f2a-1c00-7000-8000-000000000101",
    "fullName": "Asha Verma"
  },
  "department": {
    "id": "01935f2a-1c00-7000-8000-000000000201",
    "code": "ENG",
    "name": "Engineering"
  },
  "tripStartDate": "2026-11-16",
  "tripEndDate": "2026-11-18",
  "currency": "INR",
  "totalAmount": "14050.00",
  "lineCount": 2,
  "policyOutcome": "ROUTE",
  "flags": [
    "SOFT_LIMIT_EXCEEDED"
  ],
  "sampleAudit": false,
  "sampleAuditStatus": null,
  "sampleAuditedBy": null,
  "sampleAuditedAt": null,
  "submittedAt": "2026-11-20T09:15:02Z",
  "decidedAt": null,
  "updatedAt": "2026-11-21T05:02:40Z",
  "purpose": "On-site workshop with Acme Retail",
  "submissionNo": 1,
  "policyVersionNo": 1,
  "decisionReason": null,
  "editable": true,
  "lines": [],
  "latestEvaluation": null,
  "approvalSteps": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000601",
      "sequence": 1,
      "stepType": "MANAGER",
      "assignee": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "status": "SENT_BACK",
      "pendingSince": null,
      "overdue": false,
      "approverName": "Kiran Rao",
      "onBehalfOfName": "Ravi Kumar",
      "decidedAt": "2026-11-21T05:02:40Z",
      "actedBy": {
        "id": "01935f2a-1c00-7000-8000-000000000106",
        "fullName": "Kiran Rao"
      },
      "onBehalfOf": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "actedAt": "2026-11-21T05:02:40Z",
      "comment": "Please attach the itemised hotel bill"
    }
  ],
  "statusHistory": [
    {
      "fromStatus": null,
      "toStatus": "DRAFT",
      "at": "2026-11-19T11:40:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "DRAFT",
      "toStatus": "SUBMITTED",
      "at": "2026-11-20T09:15:02Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "SUBMITTED",
      "toStatus": "PENDING_MANAGER",
      "at": "2026-11-20T09:15:02Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000101",
        "fullName": "Asha Verma"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "PENDING_MANAGER",
      "toStatus": "SENT_BACK",
      "at": "2026-11-21T05:02:40Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000106",
        "fullName": "Kiran Rao"
      },
      "onBehalfOf": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      }
    }
  ],
  "comments": [
    {
      "kind": "SEND_BACK",
      "text": "Please attach the itemised hotel bill",
      "author": {
        "id": "01935f2a-1c00-7000-8000-000000000106",
        "fullName": "Kiran Rao"
      },
      "onBehalfOf": {
        "id": "01935f2a-1c00-7000-8000-000000000102",
        "fullName": "Ravi Kumar"
      },
      "at": "2026-11-21T05:02:40Z"
    }
  ],
  "allowedActions": [
    "COMMENT"
  ],
  "version": 6,
  "createdAt": "2026-11-19T11:40:00Z"
}
```

<a id="claimsamplecleared"></a>

## ClaimSampleCleared

```json
{
  "id": "01935f2a-1c00-7000-8000-000000000305",
  "claimNumber": "CL-000135",
  "title": "Team lunch",
  "status": "AUTO_APPROVED",
  "employee": {
    "id": "01935f2a-1c00-7000-8000-000000000105",
    "fullName": "Neha Singh"
  },
  "department": {
    "id": "01935f2a-1c00-7000-8000-000000000201",
    "code": "ENG",
    "name": "Engineering"
  },
  "tripStartDate": null,
  "tripEndDate": null,
  "currency": "INR",
  "totalAmount": "1320.00",
  "lineCount": 1,
  "policyOutcome": "AUTO_APPROVE",
  "flags": [],
  "sampleAudit": true,
  "sampleAuditStatus": "CLEARED",
  "sampleAuditedBy": {
    "id": "01935f2a-1c00-7000-8000-000000000103",
    "fullName": "Meera Iyer"
  },
  "sampleAuditedAt": "2026-11-25T10:00:00Z",
  "submittedAt": "2026-11-24T08:00:00Z",
  "decidedAt": "2026-11-24T08:00:00Z",
  "updatedAt": "2026-11-25T10:00:00Z",
  "purpose": "Sprint retro lunch",
  "submissionNo": 1,
  "policyVersionNo": 1,
  "decisionReason": null,
  "editable": false,
  "lines": [],
  "latestEvaluation": null,
  "approvalSteps": [
    {
      "id": "01935f2a-1c00-7000-8000-000000000610",
      "sequence": 1,
      "stepType": "SAMPLE_AUDIT",
      "assignee": null,
      "status": "APPROVED",
      "pendingSince": null,
      "overdue": false,
      "approverName": "Meera Iyer",
      "onBehalfOfName": null,
      "decidedAt": "2026-11-25T10:00:00Z",
      "actedBy": {
        "id": "01935f2a-1c00-7000-8000-000000000103",
        "fullName": "Meera Iyer"
      },
      "onBehalfOf": null,
      "actedAt": "2026-11-25T10:00:00Z",
      "comment": "Receipt matches"
    }
  ],
  "statusHistory": [
    {
      "fromStatus": null,
      "toStatus": "DRAFT",
      "at": "2026-11-24T07:50:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000105",
        "fullName": "Neha Singh"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "DRAFT",
      "toStatus": "SUBMITTED",
      "at": "2026-11-24T08:00:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000105",
        "fullName": "Neha Singh"
      },
      "onBehalfOf": null
    },
    {
      "fromStatus": "SUBMITTED",
      "toStatus": "AUTO_APPROVED",
      "at": "2026-11-24T08:00:00Z",
      "actor": {
        "id": "01935f2a-1c00-7000-8000-000000000105",
        "fullName": "Neha Singh"
      },
      "onBehalfOf": null
    }
  ],
  "comments": [
    {
      "kind": "SAMPLE_AUDIT_NOTE",
      "text": "Receipt matches",
      "author": {
        "id": "01935f2a-1c00-7000-8000-000000000103",
        "fullName": "Meera Iyer"
      },
      "onBehalfOf": null,
      "at": "2026-11-25T10:00:00Z"
    }
  ],
  "allowedActions": [
    "COMMENT"
  ],
  "version": 4,
  "createdAt": "2026-11-24T07:50:00Z"
}
```

