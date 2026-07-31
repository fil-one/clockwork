# Offboarding

Use this runbook for cancellation, non-renewal, partner-requested end-client
termination, partner default, or material breach. Ending service is a recorded
commercial and data-lifecycle operation; payment failure alone does not
authorize deletion.

## Preconditions

- Identify the account, order, invoicing party, pinned agreement and KeyTerms,
  reason, effective date, final-billing state, data-retrieval window, maximum
  Object Lock retention date, and partner/Novation context.
- Confirm the requester's account scope and `destructive:request` permission.
  The request operation is `POST /v1/lifecycle/terminations` and requires recent
  AuthKit authentication and a mutation idempotency key.
- Confirm notice evidence and InboundNotice records. On resale, the partner
  initiates end-client termination; lapse of a partner agreement never stops an
  in-flight service by itself.
- Check `EXT-TEARDOWN-01` in `/internal/gates`. While it is blocked, automated
  commerce teardown remains disabled; use the documented manual safe path and
  retain all confirmation evidence.

## Plan and approve

1. Calculate the effective date under the agreement and record final invoice or
   credit treatment, egress terms, retrieval deadline, deletion schedule, and
   retention-liability rule. Do not shorten an Object Lock date.
2. Enumerate every tenant object and the entitlement's maximum retention date.
   Split deletable objects from retained exclusions, including each exclusion's
   retention expiry and legal-hold state.
3. Notify the invoiced party and product-required contacts through the correct
   routing. A resale end client receives only product, pass-through, breach, and
   retrieval communications allowed by the agreement; it never receives partner
   economics.
4. Obtain two decisions through
   `POST /v1/lifecycle/terminations/{terminationId}/approvals`. Approvers must
   be distinct from one another, recently authenticated, authorized for
   `destructive:approve`, and distinct from the requester where separation of
   duties requires it. Each decision includes a meaningful reason and immutable
   evidence document.
5. Complete the retrieval window and final billing before moving to
   `ready_for_teardown`. A rejection or changed scope returns the plan for a new
   version; it never mutates issued evidence.

## Execute

1. Run the teardown simulator with the exact production-shaped scope and retain
   its exclusion list. Confirm one-approver, retained-object,
   stale-authentication, and disabled-feature-flag cases all deny.
2. If automated teardown is externally authorized, send the stable teardown
   command through the provisioning adapter with the two approvals and retained
   exclusions. Never call the provider directly or remove exclusions to make the
   command pass.
3. Treat the verified orchestrator confirmation as the teardown result. A
   timeout follows [stuck-provisioning.md](./stuck-provisioning.md) with the
   original teardown idempotency key; no second destructive command is created.
4. Issue the deletion certificate only after confirmation. It lists scope,
   method, dates, provider operation, and every retained exclusion with its
   expiry. The certificate and offboarding record are content-addressed,
   object-locked, and retained for the contract retention period.

## Partner default and Novation

Evaluate the partner agreement's surviving terms and step-in right before any
service change. A Novation requires a new direct agreement and billing identity
and preserves the organization, tenant, entitlements, and service continuity.
Re-establish direct pricing without exposing the former partner's transfer price
or margin.

## Closure evidence

- Effective date, final invoice/credit, retrieval evidence, two approvals,
  simulator result, provider confirmation, exclusions, and certificate hash are
  present in the append-only timeline.
- No retained object was deleted, no running end-client service was suspended
  solely because of partner default, and no provider action preceded approval.
- Entitlement and portal status agree. Future release or deletion of retained
  exclusions remains scheduled through
  `lifecycle-offboarding-retention-release-v1`.
