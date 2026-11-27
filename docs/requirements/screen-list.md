Screen list

Shared

S1 Sign-in / role switch: pick a user; the role sets the home screen.
S2 Notifications: approvals waiting, sent-back claims, payout done.
S3 Audit trail (per claim): read-only, append-only timeline.
Employee

E1 My claims: own claims only; status chips and filters.
E2 New / edit claim header: title, purpose, trip dates; INR fixed.
E3 Line items: cards on mobile; add, edit, delete; running total.
E4 Line editor: category, amount, date, vendor, notes, receipt; live policy hints.
E5 Receipt capture: camera first on mobile; upload; preview; file hash.
E6 Pre-submit check: per-line result (auto-approve, route, reject).
E7 Claim detail: status, comments, send-back reply, timeline.
Line manager

M1 Approval inbox: oldest first.
M2 Claim review: lines, receipts in a side panel, policy and weekend flags.
M3 Decision bar: approve (one tap), send back (comment), reject (reason).
M4 Delegation: delegate and leave dates.
Finance auditor

A1 Review queue: dense table; filters (amount band, department, flags, age, sample tag); bulk actions.
A2 Side-by-side viewer: claim lines left, receipt right.
A3 Bulk action bar: approve or send back selected rows.
A4 Sample audit: the random 10% of auto-approved claims.
Finance head / admin

F1 Dashboard: spend by category, department and month; violations; average approval time; queue size; oldest pending approval.
F2 Payout batch builder: select approved claims; totals in ₹.
F3 Batch export: mock bank-file CSV; mark Paid after a confirm.
F4 Policy configuration: limits, city tiers, receipt threshold, weekend rule; versioned.
F5 Users and hierarchy: reporting lines and delegations.
F6 Global audit log: search all actions; read-only.


User flows

Submit: E1 → E2 → E3/E4 → E5 receipts → E6 check → submit → E7.
Policy outcome: auto-approve if within limits; route if over a soft limit or flagged (weekend, sample tag); auto-reject for duplicates or hard breaches, with a reason.
Approval chain: manager (M3) → auditor if above ₹25,000 (A1/A2) → head if above ₹1,00,000. Send back returns the claim to the employee to edit and resubmit to the same approver.
Delegation: M4 sets a delegate; items route during leave and are tagged in the audit trail.
Audit review: filter A1, bulk approve (A3), check receipts in A2, work A4 separately.
Payout: F2 batch → F3 export → Paid; the employee is notified.


UI states
Claim status: Draft → Submitted → (policy) → Auto-approved, or Pending manager → Pending auditor (above ₹25k) → Pending head (above ₹1L) → Approved → In batch → Paid. Side states: Sent back (editable), Rejected, Auto-rejected (both final with reason).
Line: Draft; Valid; Receipt missing (above ₹500, blocks submit); Over limit (cap and excess shown); Duplicate (same vendor, amount and date, or same receipt hash); Weekend (flag only).
Approver item: Pending, Overdue (past the age threshold), Delegated, Sent back, Decided. Sample-audit tag on auto-approved claims.
Every list and dashboard: loading, empty, error with retry, no permission (shown as “not found”).
Mobile capture: offline draft saved locally; upload in progress; upload failed with retry; optional blur warning.
