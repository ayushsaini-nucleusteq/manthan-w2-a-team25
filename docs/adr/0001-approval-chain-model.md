# ADR 0001: Approval chains as rows created at submit

- Status: accepted (implemented in slice 1, extended in the full backend)
- Date: 2026-11-27

## Context

A claim goes through manager, then auditor above ₹25,000, then finance head above ₹1,00,000. Approvers can approve, reject (final), send back (the claim returns to the same approver) or delegate while on leave. Nobody approves their own claim. Owners with no manager go to the finance head. A random 10% of auto-approved claims need an auditor's sample audit before payout. Every decision must be traceable, and concurrent decisions must not double-approve.

## Decision

1. **One `approval_step` row per stage, created when the claim is submitted**, with `sequence`, `step_type` (`MANAGER`, `AUDITOR`, `FINANCE_HEAD`, `SAMPLE_AUDIT`), `required_role` and status (`WAITING` → `PENDING` → `APPROVED` / `REJECTED` / `SENT_BACK` / `CANCELLED`). The chain is decided once from the total (strictly greater than the thresholds); the claim status mirrors the pending step (`PENDING_MANAGER`...).
2. **Named step or role pool.** The MANAGER step is assigned to the owner's first active manager up the hierarchy, or to the FINANCE_HEAD pool when there is none. AUDITOR, FINANCE_HEAD and SAMPLE_AUDIT steps are pools (`assignee_id` null), and any holder of the role except the owner may act.
3. **Delegation is resolved when someone acts**, not stored on the step. A delegate may act on a named step while today is within an active delegation from the assignee and the delegate holds the step's role. The decision records `acted_by` and `acted_on_behalf_of`. Delegations therefore start and end by themselves.
4. **Send back keeps the chain.** The sending step becomes `SENT_BACK` with `sent_back_by`. On resubmit the same step returns to `PENDING`, routed to whoever sent it back (or their manager / the pool if they are now inactive). Missing later steps are appended if the total crossed a threshold. Steps are never removed.
5. **Sample audit is a step too** (`SAMPLE_AUDIT` on an `AUTO_APPROVED` claim). It never appears in the manager inbox or the A1 queue, only in A4.
6. **Correctness lives in the database**: the claim row is locked for every decision; the step update is a compare-and-set (`WHERE status = 'PENDING'`); a partial unique index allows one `PENDING` step per claim; `UNIQUE (claim_id, step_type)`; a trigger rejects `acted_by` = claim owner; the client sends the claim `version` and a stale one is a 409.

## Alternatives considered

- **A workflow/BPMN engine** (e.g. Flowable): flexible, but heavy for a fixed three-step chain. It would also put the state of record outside our tables, which makes the audit trail and SQL reporting harder.
- **Compute the chain on the fly from the total and the claim status, with no step rows**: less storage, but nowhere to record who acted on behalf of whom per step, "return to the same approver", or appended steps. Concurrency guards would also be code-only.
- **Store the delegate on the step when the delegation is created**: would need jobs to re-assign and un-assign as delegations start and end.

## Consequences

- Inbox and queue are plain SQL over `approval_step` (indexed by assignee, role and pending time). Overdue and oldest-pending come straight from `pending_since`, which also feeds the US18 metrics.
- Changing a manager doesn't move steps that are already pending (documented). Pending named steps of a deactivated approver need a delegate, or wait for a resubmit to re-route.
- A new kind of approval stage needs a new `step_type` and a migration.
- Proven by `ApprovalChainIT`, `DelegationIT`, `AuditorIT` and `ConcurrencyIT`.
