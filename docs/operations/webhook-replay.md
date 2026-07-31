# Webhook replay

Use this runbook for delayed, duplicated, reordered, or failed Stripe, e-sign,
provisioning, WorkOS, or marketplace callbacks. Provider signatures are verified
against the untouched raw request body before a delivery is claimed or
acknowledged. Replay never bypasses that boundary.

## Safety rules

- Use an internal operator identity with `system:operate`, recent AuthKit
  authentication, a reason, and an incident or ticket reference.
- Never paste a webhook secret into a command, ticket, or log. Never edit the
  payload, timestamp, signature header, provider event ID, or stored hash.
- Never delete an inbox claim to force another delivery. Provider event ID plus
  payload hash is the replay identity; the same ID with different bytes is a
  security conflict, not a duplicate.
- Replayed events may advance state but must not regress newer Stripe,
  agreement, provisioning, entitlement, or marketplace state.

## Triage

1. Identify provider, event ID, stored payload hash, original received time,
   signature-verification result, claim status, aggregate ID/version, workflow
   run, attempt count, and last error. Preserve the request ID.
2. Compare the commerce timeline with provider state through the selected
   adapter. Decide whether the delivery is duplicate, late but applicable,
   stale, still in progress, transiently failed, permanently failed, or a
   payload conflict.
3. Confirm the appropriate external gate is active in `/internal/gates`. A
   missing credential, webhook subscription, endpoint, or provider account is
   not repaired by manufacturing a callback.
4. If a transaction rolled back before the inbox claim and state transition
   committed, the original signed delivery may be retried. If the claim
   committed, recover the durable consumer from that claim.

## Replay by provider

### Stripe and core financial providers

Use the internal replay action backed by
`POST /v1/core/replays/{provider}/{eventId}`. The route requires
`system:operate` and recent authentication and idempotently returns its workflow
run. The processor reads the stored verified event; it does not accept amended
bytes. Verify payment, invoice, receipt, credit, refund, dispute, commission,
and reconciliation projections together.

### E-sign and WorkOS

Ask the configured sandbox or production provider to redeliver the original
signed event, or recover the durable consumer of the already verified inbox
record. E-sign completion is valid only when envelope binding, exact document
hash, signed PDF, and completion certificate agree. WorkOS identity or role
events only link or revoke identities; they never grant a commerce role by
themselves.

### Provisioning

If a verified confirmation is stored, recover
`lifecycle-provisioning-confirmation-ingestion-v1`. If the provider command
itself failed, follow [stuck-provisioning.md](./stuck-provisioning.md) and use
the provisioning recovery endpoint with the original command ID and downstream
key.

### Marketplaces

Replay the stored signature-verified entitlement or settlement delivery through
the appropriate lifecycle or core consumer. Reconcile the normalized order,
entitlement, fee, invoice, refund, disbursement, and settlement records; do not
infer settlement from entitlement activation.

## Verify and close

- The replay is linked to the original event ID and hash and records operator,
  reason, request ID, workflow run, and outcome.
- Duplicate processing produced no second order, entitlement, invoice, payment,
  commission, marketplace financial entry, or notification.
- Late or reordered events did not regress state. Any negative credit, refund,
  or chargeback adjustment also produced the required negative commission
  accrual.
- The account timeline, provider projection, reports, and exception queue agree.
  Run the affected provider contract/replay test before closing an incident
  caused by a code change.

Escalate as a security incident when signature verification fails, an event ID
is reused with different bytes, the endpoint accepted a callback before
verification, or logs contain payload secrets or unnecessary PII.
