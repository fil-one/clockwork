# Commerce backlog

This backlog records work that is not part of the committed release-candidate
proof. An item may move out of P0 only when its implementation and acceptance
test pass. External inputs must not be used to relabel unfinished repository
work as blocked.

## P0 — release-critical internal work

- **Partner order submission:** complete the persisted referral/resale/
  distributor order command composition so the buyer and partner governing
  agreements are loaded from authoritative database state without granting an
  end client access to confidential partner account fields. Add the real portal
  order form and database integration tests for valid referral/resale orders,
  forged counterparties, stale/concurrent acceptance, and legal-party invoice
  routing.
- **Lifecycle task execution:** replace the remaining 24 candidate-ID lifecycle
  handlers with authoritative planner/state-transition/provider-effect execution
  and persisted recovery tests. Candidate discovery alone is not a completed
  domain workflow.
- **Default-runtime activation proof:** add an end-to-end test that starts
  default Trigger discovery from persisted external-gate state, performs the
  bounded provider HTTP activation probe, and proves the resulting durable task
  can recover after a crash.
- **Exception ownership resolution:** resolve queue ownership from the affected
  aggregate/account and persisted roster instead of the current static
  queue-to-account environment mapping.
- **Scheduled core operations:** turn the documentation-only
  `coreWorkflowDispatchPlan` into registered Trigger schedules and durable
  submitter/outbox paths for overage sync, dunning, partner-credit review, usage
  reconciliation, monthly platform/Stripe/QBO tie-out, and report export.
  Definitions without runnable registration are not release wiring.
- **Database gate failures:** restore fail-closed resale quote privacy after the
  buyer-identity correction (two RLS assertions currently expose a resale quote
  to its end client); update pgTAP fixtures that now collide with the canonical
  commercial-profile/commitment seed; align distributor and marketplace test
  identities with the buyer/MoR contract. The final run is 159/169, not green.
- **Repository integration regressions:** fix and retain coverage for the
  lifecycle dead-letter audit aggregate-version collision and the external-gate
  activation expected-version mismatch found by the pre-freeze integration run.
- **Collections hardening:** grant the narrowly authorized finance role the
  required `core_collection_cases` write privilege; the final focused suite is
  1/2 because its dunning insert is denied. Narrow finance audit-event
  visibility to the acting finance user/adjustment aggregate and require source
  currency and order identity in addition to the locked amount ceiling.
- **Moderate transitive advisories:** upgrade the Drizzle authoring chain off
  `esbuild@0.18.20` (GHSA-67mh-4wv8-2f99) and Trigger's telemetry chain off
  `@opentelemetry/core@2.7.1` (CVE-2026-54285), then rerun build and provider
  replay tests. The high/critical audit gate passes, but these remain internal
  dependency work rather than external blockers.
- **Release-gate closure:** resolve every internal failure from the final frozen
  install, static, database, unit/integration, provider replay, document/UI,
  build, migration, demo-safety, and security scan. Record commands and exact
  counts in `docs/release-candidate-report.md`.
- **Canonical generated artifacts:** after schemas stop changing, regenerate one
  canonical Drizzle migration/snapshot from the source schema, regenerate the
  OpenAPI document and client types, and prove `git diff --check` plus generated
  artifact drift checks are clean.

## P1 — external activation and approval gates

Each item already has its owner, required input, simulator, admin state, and
activation test in `docs/external-gates.md`.

- `EXT-ACC-01` — production/staging projects, scoped credentials, WorkOS policy,
  and provider webhook subscriptions.
- `EXT-LEGAL-01` — counsel-approved agreements, thresholds, retention, claims,
  screening, country variants, and re-execution policy.
- `EXT-COMMERCIAL-01` — signed price books, floors, transfer/commission tiers,
  credit inputs, commitment/overage rates, and approved claims wording.
- `EXT-PROVIDER-01` — provider selections, contracts, and production
  configurations for e-sign, notifications, CRM, screening, support, and QBO.
- `EXT-PROVISION-01` — live provisioning/usage/teardown contracts, credentials,
  and SKU-entitlement mappings.
- `EXT-TAX-01` — approved tax, exemption, accounting, revenue-recognition,
  credit, dunning, country, and payment-term policies/mappings.
- `EXT-DOMAIN-01` — production/preview/custom domains, DNS, TLS, callbacks,
  webhook URLs, and sender authentication.
- `EXT-BRAND-01` — final licensed assets and claims/legal-approved brand copy.
- `EXT-APPROVERS-01` — named primary/backup approvers, queue owners, targets,
  escalation contacts, and on-call roster.
- `EXT-TEARDOWN-01` — written product/security/legal activation decision and
  approved scope for automated teardown; the feature flag remains off.
- `EXT-MARKETPLACE-01` — AWS/Azure/GCP enrollment, seller/payout/tax profiles,
  permissions, settlement feeds, credentials, and commercial approval.
- `EXT-MIGRATION-01` — production source snapshot/access, quiet window,
  approvals, data-handling decision, and customer communication timing.

## P2 — post-spec expansion

- Add optional shared-session/account linking with the existing Fil One product;
  launch intentionally uses a standalone AuthKit session boundary.
- Translate portal and document content beyond English using the existing
  localization-ready structure and add locale-specific legal review.
- Extend the deliberately two-tier partner model to deeper distribution trees
  only if a future channel program requires them.
- Add currencies, payment rails, marketplaces, and provider implementations
  beyond the launch set after commercial, tax, and operational approval.
- Add bidirectional CRM editing or write-enabled support tooling only with a new
  ownership/security ADR; launch projections are intentionally one-way and the
  support feed is read-only.
