# Stuck provisioning

Use this runbook when an accepted order, POC conversion, sandbox, or teardown
command has not reached a terminal provider confirmation. The commerce order,
entitlement, audit event, and outbox record remain authoritative; the provider
is never used as the commercial source of truth.

## Safety rules

- Work from `/internal/provisioning` as an internal operator with
  `system:operate` and recent AuthKit authentication. Record the incident or
  ticket reference and request ID.
- Do not create a replacement order, entitlement, tenant, invoice, or provider
  command. Recovery must retain the original provisioning idempotency key.
- Do not mark an order active or bill it until a verified
  `order.provisioning_confirmed` event has committed.
- A POC conversion must upgrade the existing organization and tenant in place.
  Never migrate or re-upload its data as a recovery technique.
- A teardown is not an ordinary provisioning recovery. Follow
  [offboarding.md](./offboarding.md); `EXT-TEARDOWN-01` and two distinct,
  recently authenticated approvers still apply.

## Triage

1. In `/internal/provisioning`, capture the command ID, order and organization
   IDs, command mode (`provision`, `upgrade_poc`, `sandbox`, or `teardown`),
   aggregate version, original idempotency key, provider operation ID, workflow
   run ID, attempt history, and last request ID.
2. Confirm the accepted order and pinned agreement still exist and that the
   target entitlement has not already reached the requested state. Check the
   account and invoicing party: direct and referral bill the end client; resale
   bills only the partner.
3. Inspect the audit/outbox history. Distinguish:
   - pending or retrying: a bounded retry is already scheduled;
   - transient exhausted: the provider may be recovered and explicitly
     re-driven;
   - permanent failure: correct the owned exception first;
   - confirmation received but projection incomplete: recover the confirmation
     workflow, not the provider command;
   - duplicate or out-of-order confirmation: no provider re-drive is needed;
   - payload or idempotency conflict: stop and escalate to engineering.
4. Check `EXT-PROVISION-01` in `/internal/gates`. Missing production credentials
   or an inactive provider contract is an activation gate, not a reason to
   bypass the adapter.

## Recover

1. Correct only the diagnosed input or provider condition. Do not edit commerce
   rows or outbox state with raw SQL.
2. If the original command is safe to re-drive, use the recovery action in
   `/internal/provisioning`. The API operation is
   `POST /v1/lifecycle/provisioning/{commandId}/recover`; it requires the
   original command ID, a meaningful reason of at least eight characters, a new
   request idempotency key, `system:operate`, and recent authentication.
3. The recovery must claim the existing durable operation and reuse the
   downstream idempotency key. A duplicate provider acceptance is expected to
   resolve to the same operation ID.
4. If only the confirmation path failed, replay the stored, signature-verified
   confirmation through `lifecycle-provisioning-confirmation-ingestion-v1`.
   Never reconstruct webhook bytes or disable signature verification.
5. For a permanent failure, leave the command in its owned exception queue until
   the cause, operator, reason, and evidence are recorded. Then perform the
   explicit replay; do not increase retry limits ad hoc.

## Verify and close

- One provider operation and one entitlement mapping exist for the order.
- A verified confirmation committed once; duplicates are recorded as duplicates
  and stale confirmations did not regress state.
- The order and entitlement reached the requested state. For POC conversion, the
  organization, tenant, resource IDs, and stored data are unchanged.
- Billing started only after confirmation and the invoice went to the legally
  correct party. Consolidated resale billing retains end-client grouping but
  exposes no partner economics to the end client.
- The audit timeline contains actual/effective actor, reason, request ID,
  original idempotency key, workflow run, provider operation ID, and final
  outcome. Close the exception and incident only after the portal projection
  matches the source records.

## Escalation

Escalate immediately for cross-account mapping, a second tenant or invoice,
idempotency-key reuse with different bytes, an unverifiable callback, or any
attempt to provision while partner credit or restricted-party policy blocks new
service. Keep running service intact while investigating partner credit or
default; those conditions never authorize automated end-client suspension.
