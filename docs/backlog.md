# Commerce backlog

This file is the single canonical commerce backlog. Until consolidation it is
owned on `commerce/integration`; afterward `main` is its only authoritative
branch. Lane and feature worktrees may contain inherited snapshots, but backlog
changes must be made here and merged outward rather than maintained
independently.

This backlog records work that is not part of the committed release-candidate
proof. An item may move out of P0 only when its implementation and acceptance
test pass. External inputs must not be used to relabel unfinished repository
work as blocked.

## P0 — release-critical internal work

- **Capture every outstanding source change:** before merging, cleaning a
  worktree, or deleting a branch, preserve and review every tracked/untracked
  delta in named commits whose hashes are recorded in the release report. The
  July 31 inventory includes the 513-addition/335-deletion production-spec
  rewrite in `commerce/foundation`, five UX-only commits on `ux/integration`, 42
  additional modified UX files plus one later test edit (43 total), including
  four visual baselines, and this canonical backlog update on
  `commerce/integration`; rerun the inventory at execution time so later edits
  are included. Do not rely on a stash or reflog as the only copy. Nothing may
  be discarded as generated, obsolete, or duplicative until its semantic changes
  and tests are either present on the final mainline or explicitly rejected with
  recorded rationale.
- **Canonical production specification and traceability:** merge the current
  `commerce_platform_spec.md` rewrite into the consolidation line, resolve it
  against implementation and launch documents, and make one reviewed version the
  product contract on `main`. Build a checked-in traceability ledger mapping
  every normative launch requirement and acceptance-matrix row to its domain,
  API, database, workflow/provider, portal/document implementation, tests,
  external gate if genuinely required, and P0 item if unfinished. Resolve stale
  deferrals and contradictions across the spec, sprint checklist, handoffs,
  ADRs, external-gate register, launch checklist, release report, and this
  backlog; zero unmapped or falsely completed requirements may remain.
- **Single-main history consolidation:** create `main` from the integration
  lineage and merge every preserved source ref—including `commerce/integration`,
  the complete `ux/integration` history, the captured foundation specification,
  and all subsequently captured dirty-work commits—without losing commit
  provenance or semantic changes. Resolve conflicts from source ownership and
  the canonical contracts rather than by choosing an entire side. Regenerate
  derived artifacts only after sources settle, record the source/final hashes,
  and prove with `git merge-base --is-ancestor` plus tree/diff manifests that
  every retired branch tip and accepted preservation commit is represented by
  `main`.
- **Clean-main parity and requalification:** from a new clean checkout of the
  final `main` SHA with caches disabled, reproduce the frozen install,
  generation, migration reset, builds, maximum-parallel test matrix, and a
  serial/debug confirmation path. Compare route, schema/migration, OpenAPI,
  workflow/task, document, environment-variable, and visual-scenario manifests
  against the preserved pre-merge refs so integration cannot silently drop a
  capability or test. Update the release-candidate report with exact commands,
  counts, timings, SHA/hash provenance, resolved conflicts, and remaining P1
  gates; any failure, drift, skipped suite, or unexplained manifest difference
  keeps consolidation P0 open.
- **Recoverable worktree and branch retirement:** delete no worktree or branch
  until it is clean, has no untracked files, its tip is an ancestor of the
  verified `main`, and repository integrity checks pass. Create and verify a
  durable pre-deletion tag and Git bundle (and push them plus `main` to the
  approved remote when one exists), update CI/default-branch settings and remove
  stale branch/worktree instructions from active documentation, then remove
  linked worktrees before using safe branch deletion. Finish with exactly one
  active development branch, `main`, one canonical backlog, no orphaned commits,
  and a documented restore drill; never force-delete a ref that fails these
  checks.
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
- **Authoritative order transitions and offboarding:** remove the generic core
  commands that let ordinary account or partner roles directly mark an accepted
  order provisioning, active, completed, cancelled, or terminated. Route each
  transition through persisted lifecycle state: only provider-confirmed
  provisioning may activate service, cancellation/non-renewal must create the
  recoverable offboarding and final-billing plan, and teardown must remain gated
  by two distinct approvals. Test forged direct transitions, every source state,
  stale/replayed commands, self-approval, crash recovery, and provider/local
  convergence.
- **Pre-provisioning collection and partner-credit holds:** lock and evaluate
  the billing account's `new_service_blocked` state and the partner's aggregate
  exposure/payment-history policy in the order-acceptance transaction before
  persisting or enqueueing new or expansion service. A rejected order must
  create an owned review without a provisioning outbox; running service remains
  unaffected. Prove concurrent orders cannot exceed credit and that direct,
  referral, and resale orders fail closed until an authoritative hold release.
- **Provider-authoritative credits and refunds:** stop accepting caller-supplied
  Stripe credit-note/refund IDs or writing locally issued truth before Stripe
  has accepted an idempotent provider operation. Derive invoice, payment,
  customer, amount, currency, and provider bindings from persisted state; cap
  individual and aggregate adjustments to the eligible balance; reconcile signed
  webhooks. Test forged IDs, over/duplicate/concurrent refunds, amount/currency
  mismatch, provider timeouts, and crash-after-success replay.
- **Stripe adjustment projection correctness:** derive every refund state from
  the signed provider status instead of treating `refund.created` as succeeded,
  compensate any commission effect after failure/cancellation, and watermark
  each credit-note/refund object rather than sharing one invoice/payment-intent
  checkpoint. Replay tests must preserve pending-to-failed and
  pending-to-succeeded sequences plus reordered events for multiple adjustments
  without lost events or duplicate clawbacks.
- **Commission settlement integrity:** carry the persisted partner identity
  through the accounting contract and verified QBO vendor mapping instead of
  posting to `unspecified`. In one replay-safe projection, bind the provider
  bill or posting, settle exactly the included statement lines and accruals, and
  emit audit/outbox records. Reject cross-partner and mixed-state lines and
  prove crash, replay, and concurrency cannot double-pay or leave an external
  bill paired with draft local state.
- **POC partner-relationship authorization:** never persist a caller-selected
  `partnerAccountId` after checking only the buyer account. Derive it from an
  authoritative approved relationship or deal registration and reject unrelated
  tenants before POC/evidence RLS can grant visibility. Add API, repository, and
  pgTAP coverage for forged partners, valid relationships, and cross-tenant POC
  and evidence isolation.
- **Gate-page credential containment:** replace the internal gate page's
  `NEXT_PUBLIC_APP_URL` fetch with a server-internal call, or require exact
  canonical same-origin equality before forwarding a WorkOS session cookie.
  Malformed, preview, or hostile configured origins must fail closed and receive
  neither a request nor credentials; retain a regression test for that
  invariant.
- **Persistent assisted-session identity and exit:** when impersonation is
  active, render the authoritative effective account, immutable staff actor,
  reason, and expiry in a global banner across every internal route, and provide
  a real server-backed exit that refreshes the session. Render no banner when
  inactive, and test navigation, expiry, exit, destructive actions, and audit
  records so both actors remain visible and no hard-coded identity can create a
  confused-deputy path.
- **Production identity, audience, and organization routing:** after AuthKit
  callback, resolve permitted organization/account memberships and route each
  customer, partner, or internal audience to its actual home instead of always
  entering the customer dashboard. Organization switching must enumerate only
  authorized memberships, persist the WorkOS/account-selection transition, and
  refresh server context; forged accounts must fail. Replace fictional profile,
  notification, and demo shell data in production and cover first login,
  multi-role/multi-org switching, and cross-account denial in browser tests.
- **Authoritative portal projections and record-bound actions:** put all
  Northstar/Meridian fixtures behind an explicit non-production adapter and load
  launch customer, partner, and operator collections, details, selectors, and
  queues from session-scoped database projections with pagination, freshness,
  empty, and error states. Bind mutations to the selected server record rather
  than constants or free-form UUIDs, and wire review-only internal decisions to
  real commands. Prove reload/readback, stale-version handling, forged IDs,
  tenant/partner confidentiality, and every channel path end to end.
- **Authoritative e-sign completion:** launch signing only from an authorized
  persisted agreement/envelope with immutable signer and document data. Use an
  opaque correlation state and a server status read to reconcile callback and
  provider webhook order, presenting pending, completed, declined, expired, and
  failed states; production success must never be inferred from demo query
  parameters. Cover altered state/envelope/hash, cross-account access,
  callback-before-return, return-before-callback, duplicate callbacks, refresh,
  and signed-document readback.
- **Evidence ingestion and quarantine:** expose authorized create, complete, and
  download contracts for the existing evidence-storage provider instead of
  requiring users and lifecycle commands to arrive with pre-existing document
  UUIDs. Persist pending uploads durably; enforce ownership, size, MIME, hash,
  quarantine, malware scanning, immutable promotion, retention, and short-lived
  downloads. Integrate customer paper, POC, procurement, exception, and approval
  journeys and test poisoned files, replay, expiry, and cross-account access.
- **Complete immutable-document pipeline and delivery:** provide the
  authenticated renderer runtime required by commercial-artifact and
  deletion-certificate workflows, store immutable version/hash metadata, and
  extend retrieval and generated clients beyond the current four of fifteen
  artifact kinds. Expose authorized portal downloads for all launch quotes,
  agreements, orders, invoices, receipts, partner statements, reports,
  renewals/declines, and deletion certificates with correct filename, MIME,
  `no-store`, and `nosniff`. Test pending, stored, missing, corrupt,
  cross-audience, mobile, and accessible download states.
- **Server-enforced activation and kill switches:** define one persisted,
  audited capability-to-external-gate matrix for new business, legal execution,
  paid provisioning/invoicing, partner paths, white-label, marketplace,
  teardown, and migration operations. Enforce it at every command and
  provider-effect boundary so direct API calls, assisted actions, stale clients,
  replays, and workflows cannot bypass missing, inactive, expired, or
  unavailable gates. Supply the production activation-test runner and authorized
  internal controls, keep the simulator disabled in production, and prove
  emergency disable creates no new effect or outbox while independently
  permitted recovery remains available.
- **Production-shaped browser release proof:** add a required CI phase that runs
  the production bundle against freshly migrated/seeded database roles and a
  production-equivalent authenticated session, with no first-party route
  interception or persona-header shortcut and with lane status required ready.
  Drive customer agreement-to-quote-to-order-to-artifact/payment, partner
  resale, and internal exception/recovery through the UI to rows, audit, and
  outbox, then reload and read back. Include cross-scope denial, stale conflict,
  and provider fake replay.
- **Maximum safe test parallelization:** configure every static, unit,
  integration, database, provider-replay, document, build, and browser suite to
  use the maximum concurrency available on local and CI runners without losing
  determinism. Run independent workspace tasks concurrently, shard large suites
  across workers/jobs, and give each worker isolated ports, databases or
  schemas, queues, provider fixtures, clocks, storage, and artifact paths so
  shared state cannot create flakes or hidden ordering dependencies. Preserve
  readable per-shard results, retries only for diagnosed infrastructure
  failures, and a reproducible serial/debug mode. Record suite and critical-path
  timings, enforce an agreed wall-clock budget, and add repeated parallel stress
  runs that prove the optimized configuration is faster than the serial baseline
  while producing identical assertions, coverage, generated artifacts, and
  failure semantics.
- **Production telemetry and live alerting:** export structured client, server,
  API, workflow, provider, webhook, queue, database, and web-vitals telemetry to
  the selected production backends with request/workflow/outbox correlation and
  secret/PII redaction. Provision dashboards, thresholds, synthetic failures,
  primary/backup paging routes, and linked runbooks for auth anomalies, DB/PITR,
  queue age/dead letters, outbox backlog, provisioning, billing/reconciliation,
  and unhandled errors; attach verified staging delivery evidence to the launch
  gate.
- **Task-led, brand-distinct frontend redesign (remove AI-template visual
  grammar):** replace the noun-swapped dashboard silhouette repeated across the
  customer, partner, and internal snapshots—oversized hero, all-caps eyebrow,
  four equal metrics, rounded panel grid, generic chart/activity rail, and long
  mobile card stack—with audience- and decision-specific information
  architecture. As of July 2026, use the diagnostic substitution test in
  [V-1's generic-AI UI research](https://v-1.design/blog/why-ai-built-apps-look-the-same),
  the hierarchy and metric guidance in
  [IBM Carbon's dashboard standard](https://carbondesignsystem.com/data-visualization/dashboards/),
  [Apple's June 2026 purpose, simplicity, and craft principles](https://developer.apple.com/design/human-interface-guidelines/design-principles),
  and [WCAG 2.2](https://www.w3.org/TR/WCAG22/) as the research baseline—not as
  a visual skin. A senior human product designer must approve a brief for each
  audience naming its user, moment, decision, primary task, density, content
  voice, and reject list; validate task-specific prototypes before
  implementation. Audit every card, chart, badge, eyebrow, radius, shadow,
  gradient, elevation, and line of explanatory copy, retaining only elements
  that communicate a real relationship, state, or action and preferring semantic
  tables, lists, and progressive disclosure for operational data. Codify one
  deliberate Fil One typography/grid/spacing/color/icon/motion system, pass WCAG
  2.2 AA at 320, 768, and 1440 pixels plus 200% text zoom/400% reflow/reduced
  motion, update visual baselines, and complete representative customer,
  partner, and operator task reviews with no critical/high findings before
  release. Final licensed marks remain `EXT-BRAND-01`; the internal redesign is
  not blocked on them.

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
