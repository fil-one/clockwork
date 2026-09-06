# Scheduled price-book activation

At `/internal/price-books`, finance can propose a validated draft with a future
UTC effective date. A different finance approver with recent MFA can approve its
schedule. Approval retains the exact book version and effective window; the book
remains a draft and current active pricing stays in place until execution.
Rates, discounts, dates, and catalog mappings remain frozen while the schedule
is approved.

Only one approved schedule per currency is allowed. Cancel it explicitly before
approving a replacement schedule or immediately activating another version in
that currency. **Cancel approved schedule** requires direct finance authority
and a reason. Cancellation unlocks the draft, preserves the incumbent and audit
history, and requires a new proposal and distinct approval before activation.

Before approving, inspect the impact panel and economics comparison. Retained
quote/order economics are unchanged, but retiring the incumbent prevents its
remaining draft quotes from being issued or revised through the old book.

## Execution and recovery

Deploy the worker and database migration `001435` together using the
[Trigger worker bootstrap](trigger-worker-bootstrap.md). Confirm task
`core.schedule.price-book-activation.v1` is deployed and its UTC schedule is
enabled for the intended staging or production environment. Its cron runs every
minute. A saved approval alone cannot execute a change if the worker is not
deployed or running. The fictional demo illustrates approval and cancellation;
it does not run the production scheduler.

Approved database rows form the durable queue. Each sweep selects due schedules,
then serializes execution by currency and locks the approved version. Execution
uses the actual current time, refreshed after lock waits; the original Trigger
occurrence timestamp is diagnostic metadata, not authority to backdate a retry.
The effective end date is inclusive in UTC.

Before activation, the worker rechecks the retained two-person approval, both
users' persisted finance authority and MFA enrollment, and the enabled
`new_business` capability. Those checks stay locked through the transaction.
Scheduling does not enable that capability or replace its external evidence
gates. Missing authority, disabled capability, or changed evidence leaves the
schedule approved and pricing untouched. Inspect the task result's `blocked`
status and reason, resolve the control through its normal authorized workflow,
or cancel and obtain a new approval. The next sweep retries approved due rows;
task-level failures also use the shared durable retry policy.

Successful execution retires the incumbent and activates the approved candidate
atomically, preserving the candidate's end date. Repeated execution of a
terminal schedule is a no-op. If the approved window has already expired, the
worker marks the schedule `expired`, unlocks its draft, and retains the
incumbent; it never activates expired pricing to catch up. An independently
expired incumbent is not extended by this process.

The page shows approved, cancelled, executed, or expired schedule status and
retained completion reasons. Worker audit/outbox events identify the schedule,
approval, and retained approver. Use Trigger task results for transient blocking
reasons; they are not persisted as a new schedule status. Do not edit queue rows
or bypass capability controls to force execution.
