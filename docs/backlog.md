# Commerce backlog

This is the canonical Clockwork commerce backlog. `main` is the only active
branch. Historical lane names and tips are provenance only. The current state is
`post-merge-pre-qualification`: the work recorded in P0-01 through P0-39 is
accepted, and P0-40 through P0-46 are repository findings that no external input
can close. This is not an RC or launch declaration.

Status markers mean:

- `[COMPLETE]`: repository implementation and direct acceptance evidence are
  complete;
- `[OPEN]`: the requirement is not met in this repository, and closing it is
  repository work;
- `[EXTERNAL-ONLY]`: repository controls, deterministic simulator, fail-closed
  enforcement, and activation test are complete; only a named external input or
  live evidence remains.

External inputs never excuse missing repository work.

## P0 — repository-critical work

- **P0-01 — Capture every outstanding source change `[COMPLETE]`:** repeated
  tracked, untracked, worktree, and ref inventories reconciled every accepted
  delta into `main`; preservation commits and rejected disposable output are
  recorded in the consolidation report.
- **P0-02 — Canonical production specification and traceability `[COMPLETE]`:**
  `commerce_platform_spec.md` and the 312-row checked-in ledger are reconciled
  against implementation, tests, handoffs, ADRs, launch controls, and external
  gates with zero unmapped or internally partial requirements.
- **P0-03 — Single-main history consolidation `[COMPLETE]`:** the commercial,
  runtime, and experience lanes were merged with explicit two-parent commits in
  the required order; their tips and accepted preservation commits are
  represented by `main`.
- **P0-04 — Clean-main parity and requalification `[COMPLETE]`:** the pinned
  Node/pnpm clean-checkout design, generated-drift checks, reset, static,
  database, provider, document, UI, build, serial/debug, parallel, and stress
  suites are repository-controlled and accepted. The clean isolated UI
  regression at `9464bab` passed Storybook 5/5 and Playwright 79/79 with zero
  skip, flake, retry, or cache reuse; commit-addressed archival evidence is
  emitted after the documentation commit.
- **P0-05 — Recoverable legacy preservation and retirement `[COMPLETE]`:** the
  ancestry, clean-worktree, fsck, annotated-tag, all-refs-bundle, restore-drill,
  and safe-ref-retirement procedure is complete. Final commit/tag/bundle
  identifiers are necessarily written post-commit to the tag annotation and
  ignored archive manifest, not represented here as unfinished source work.
- **P0-06 — Partner order submission `[COMPLETE]`:** referral, resale, and
  distributor commands load governing parties and agreements from persisted
  truth, preserve confidential partner economics, and pass stale/concurrent and
  legal-party routing tests.
- **P0-07 — Lifecycle task execution `[COMPLETE]`:** all 24 lifecycle task IDs
  execute persisted planners, transitions, provider boundaries, recovery, audit,
  and outbox behavior.
- **P0-08 — Default-runtime activation proof `[COMPLETE]`:** production
  discovery composes persisted external-gate state, bounded provider probes,
  durable checkpoints, and crash recovery.
- **P0-09 — Exception ownership resolution `[COMPLETE]`:** affected-account
  queues resolve from the persisted qualified roster with requester exclusion,
  backup ownership, reassignment, and escalation evidence.
- **P0-10 — Scheduled core operations `[COMPLETE]`:** overage, dunning,
  partner-credit, usage, reconciliation, and report schedules have registered
  Trigger submitter/outbox paths and recovery tests.
- **P0-11 — Database gate failures `[COMPLETE]`:** RLS, canonical fixtures,
  buyer/MoR identities, migration reset, and full pgTAP pass fail closed.
- **P0-12 — Repository integration regressions `[COMPLETE]`:** lifecycle
  dead-letter and external-gate optimistic-version regressions retain focused
  integration coverage.
- **P0-13 — Collections hardening `[COMPLETE]`:** finance grants are narrow,
  acting-user audit visibility is scoped, and source currency/order/amount
  constraints are enforced.
- **P0-14 — Dependency advisories `[COMPLETE]`:** the authoring and telemetry
  dependency chains are updated; the accepted audit has no unexplained advisory
  or retry-masked provider/build failure.
- **P0-15 — Release-gate closure `[COMPLETE]`:** all repository-controlled
  frozen-install, static, database, unit, integration, provider-replay,
  document, migration, telemetry-redaction, security, build, browser, visual,
  accessibility, and demo-safety gates are represented by accepted evidence.
  Failed isolated browser diagnostics remain visible, and their replacement pass
  at `9464bab` executed all 79 Playwright tests without retry masking.
- **P0-16 — Canonical generated artifacts `[COMPLETE]`:** Drizzle
  `0004_nosy_valkyrie` covers 116 tables and OpenAPI exposes 56 paths, including
  seven experience paths; schema/client generation and drift checks pass.
- **P0-17 — Authoritative order transitions and offboarding `[COMPLETE]`:**
  provider-confirmed lifecycle transitions, recoverable cancellation/final
  billing, and two-person teardown replace direct caller-controlled status
  changes.
- **P0-18 — Pre-provisioning collection and partner-credit holds `[COMPLETE]`:**
  authoritative holds are locked in the acceptance transaction, denied orders
  create owned review without provider work, and concurrency cannot exceed
  credit.
- **P0-19 — Provider-authoritative credits and refunds `[COMPLETE]`:** provider
  acceptance and replay checkpoints precede local issued truth; persisted
  invoice/payment/currency/amount bindings and aggregate balance caps reject
  forged or duplicate adjustments.
- **P0-20 — Stripe adjustment projection correctness `[COMPLETE]`:** signed
  provider status and per-adjustment watermarks preserve pending/failure/success
  ordering and commission compensation without lost events.
- **P0-21 — Commission settlement integrity `[COMPLETE]`:** persisted partner
  and QBO vendor identity bind replay-safe bills/postings, included lines,
  accrual settlement, audit, and outbox state.
- **P0-22 — POC partner-relationship authorization `[COMPLETE]`:** partner
  identity derives from an approved persisted relationship and cross-tenant POC
  or evidence access fails closed; success-test targets are nonblank and
  database-enforced.
- **P0-23 — Gate-page credential containment `[COMPLETE]`:** internal gate
  access is server-bound and exact-origin checks prevent hostile, preview, or
  malformed origins from receiving a request, session cookie, or CSRF token.
- **P0-24 — Persistent assisted-session identity and exit `[COMPLETE]`:** the
  immutable staff actor, effective account, reason, expiry, exit path, audit,
  destructive controls, and global banner remain consistent across navigation.
- **P0-25 — Production identity, audience, and organization routing
  `[COMPLETE]`:** AuthKit sessions resolve persisted memberships and actual
  customer, partner, or internal homes; switching and forged-account denial are
  server-authoritative.
- **P0-26 — Authoritative portal projections and record-bound actions
  `[COMPLETE]`:** production collections/details/actions use scoped persisted
  projections, optimistic source versions, durable receipts, authoritative
  command execution, rematerialization, and replay-safe audit/outbox joins.
- **P0-27 — Authoritative e-sign completion `[COMPLETE]`:** persisted agreement,
  signer, document, opaque return correlation, provider/webhook reconciliation,
  terminal states, and verified signed-document readback replace query-derived
  success.
- **P0-28 — Evidence ingestion and quarantine `[COMPLETE]`:** durable create,
  complete, scan/quarantine, immutable promotion, retention, ownership, expiry,
  replay, and scoped download contracts cover all required journeys.
- **P0-29 — Complete immutable-document pipeline and delivery `[COMPLETE]`:**
  authoritative persisted sources, render-request CAS/redrive, immutable
  storage, safe public/private retrieval, generated clients, and corrupt/scope
  denial cover all fifteen artifact kinds.
- **P0-30 — Server-enforced activation and kill switches `[COMPLETE]`:** one
  persisted audited capability matrix is rechecked at command and last-mile
  provider boundaries; production simulators are forbidden and emergency disable
  creates no new effect.
- **P0-31 — Production-shaped browser release proof `[COMPLETE]`:** the
  production bundle drives a persisted issued-quote action through dispatcher,
  authoritative mutation, terminal receipt, audit/outboxes, rematerialized
  readback, exact replay, and stale-key denial without first-party interception.
- **P0-32 — Maximum safe test parallelization `[COMPLETE]`:** isolated shards,
  maximum-parallel orchestration, readable results, serial/debug parity, stress
  repetition, cache-disable controls, and 30-minute CI/45-minute local budgets
  are encoded and qualified.
- **P0-33 — Production telemetry and live alerting `[EXTERNAL-ONLY]`:** client,
  server, API, workflow, provider, webhook, queue, database, and web-vitals
  telemetry; correlation; redaction; dashboards; alerts; synthetics; runbooks;
  exporters; and tests are complete. Only selection of the hosted
  collector/backend, scoped credentials, verified signal/page delivery, and the
  staging-soak record remain under `EXT-ACC-01`.
- **P0-34 — Task-led, brand-distinct frontend redesign `[COMPLETE]`:** customer,
  partner, and operator information architecture, state gallery, 320px/reflow,
  Axe, visual, semantic task flows, and reject-list evidence have no remaining
  repository finding. Licensed assets remain `EXT-BRAND-01`; user-entered human
  design approval is future launch-only and is not claimed or required here.
- **P0-35 — Exact marketplace quantity boundary `[COMPLETE]`:** canonical
  nonnegative `numeric(38,18)` strings and lossless last-mile conversion reject
  numeric, exponent, range, scale, and round-trip loss.
- **P0-36 — UUIDv7 database generation `[COMPLETE]`:** RFC 9562 timestamp and
  independent rand-b mapping, secret-token separation, grants/search paths,
  defaults, rollback/same-tick behavior, and persisted producers are verified.
- **P0-37 — Provider callback contract parity `[COMPLETE]`:** exact marketplace
  and support provider paths, strict raw verification, durable binding/dedupe,
  safe metadata, production composition, OpenAPI, clients, and replay tests
  agree.
- **P0-38 — Marketplace persistence exactness `[COMPLETE]`:** PostgreSQL
  `bigint` money bounds and canonical nonnegative quantity parsing reject
  overflow, negative, exponent, and over-precision input before persistence.
- **P0-39 — Populated portal-projection upgrade safety `[COMPLETE]`:** the
  exact-toolchain populated upgrade preserves a millisecond-matched source
  version, strips legacy mutation authority, terminalizes queued actions without
  inventing replay truth, fails closed on mismatch, restores canonical state,
  and was accepted in 93.813 seconds.
- **P0-40 — Authoritative events for six portal aggregates `[RESOLVED]`:** the
  `agreement`, `poc`, `exception_case`, `approval`, `provider_operation`, and
  `termination` write paths appended audit rows without publishing an
  authoritative outbox event, so those channels stayed empty on every audience
  whatever the materializer did. `lifecycleEventTopics` in
  `packages/workflows/src/experience/projection-definitions.ts` now registers
  the topics whose audit rows already bind to an aggregate the state loader can
  resolve, and a test pins the excluded set: topics bound to a satellite row
  (agreement drafts, signature envelopes, provisioning attempts, roster entries)
  would dead-letter rather than populate a channel, so they stay out
  deliberately. Where a rebinding would have rewritten an existing audit row's
  identity, an event was added alongside it instead: `exception_case.opened`
  beside the provider-operation event, `agreement.executed` beside the envelope
  events guarded by the insert result, and `approval.decided` off the returned
  row. `poc.activated` took its version from the provisioning attempt rather
  than the POC and is corrected in place; the expiry branch published nothing at
  all, so `poc.expired` is new.
- **P0-41 — Commitment ledger write path `[OPEN]`:** `createCommitmentPeriod`
  and `appendLedgerCorrection` in `packages/db/src/repositories/core/finance.ts`
  have no production caller, and `decideCommitmentOverage` and
  `reconcileCommitmentToSource` are reached only from
  `packages/domain/src/core/core-finance.test.ts`. Nothing inserts
  `commitment_ledgers` or `usage_events`, so the overage-sync and
  usage-reconciliation schedules read tables that are never populated. Spec §4
  step 10 and §10.
- **P0-42 — Missing reporting-layer reports `[OPEN]`:** the report catalog in
  `packages/contracts/src/schemas.ts` and the report functions in
  `packages/domain/src/core/reports/index.ts` cover seven of the ten §17
  reports. ARR and MRR, billing and collections, and commission and settlement
  have no report function, no catalog entry, and no API report key.
- **P0-43 — Missing exception queues and split queue vocabulary `[OPEN]`:**
  `exceptionQueues` in `packages/domain/src/exceptions/index.ts` names seven of
  the ten §16 queues; provisioning recovery, migration review, and
  offboarding/destructive are absent. A second `ExceptionQueue` union in
  `packages/workflows/src/core/ports.ts` names six queues that appear in neither
  the domain vocabulary nor §16, so a workflow-raised exception cannot resolve
  an owner or backup from the roster.
- **P0-44 — CRM projection has no runtime caller `[OPEN]`:** `CrmProjectionPort`
  and `OutboundCrmProjectionAdapter` in `packages/integrations/src/crm/index.ts`
  are reached only from `crm.contract.test.ts`. No production composition
  constructs the adapter, no outbox consumer projects to CRM, and
  `accounts.crm_record_id` is never written. Spec §15.
- **P0-45 — Tax identifier validation and reverse charge `[OPEN]`:**
  `TaxPort.validateTaxId` in `packages/contracts/src/providers.ts` has no caller
  outside the deterministic fake, so a tax identifier entered at registration is
  persisted without verification. `reverse_charge_eligible` is created by
  `supabase/migrations/000100_core_finance.sql` and never set, and no code
  determines EU or UK reverse-charge treatment. Spec §4, §10 and §19.
- **P0-46 — Notification delivery record `[OPEN]`:** no table records a
  notification recipient, template, or delivery outcome; a lifecycle
  notification effect leaves only a generic `provider_operations` row. The
  generated OpenAPI contract exposes no notification operation, so the §18 API
  catalog claim is unmet and the account surface has no notification preferences
  to manage. Quote expiry has an authoritative command and no schedule that
  fires it. The renewal term-alert, renewal notice-window, and POC milestone
  schedules are registered and route through the notification provider. Spec §4,
  §11, §12 and §18.

## Accepted verification evidence

- Canonical Drizzle SQL SHA-256:
  `ae5872e0deff09115d847268c3acb7f97cfd828e9773887cfb99d268330de70c`; snapshot
  SHA-256: `151ae01460e7def205349285df4b268f5c73ace79d17f275ef5a917d453bba35`.
- Generated OpenAPI SHA-256:
  `d1dcb164ab834ae12e065ce934ae665520cbefa1f1b2e7d2406e854477ecff18`; generated
  schema SHA-256:
  `a87b32a07841531447c0d34e24b0a137cd5288ff31470f1425edddcad0579784`.
- Dependency lock SHA-256:
  `6bc939e90cdba4cb8d055c4903bc49d0371d077780b8bfaffed97d952ea3e5fc`; the
  clean-install helper edge reuses the already locked Next version and adds no
  package resolution or integrity record.
- Populated upgrade: accepted on Node `24.18.1` / pnpm `10.34.5` in 93.813
  seconds. Zero reset plus pgTAP: 16 files / 431 assertions. Full workspace
  typecheck: 10/10 packages in 45.593 seconds. Focused security,
  telemetry-redaction, migration, provider, controller, artifact, and workflow
  suites pass without skipped or retry-masked failures.
- Clean isolated UI regression: `smoke-9464bab-ui4` on exact Node `24.18.1` /
  pnpm `10.34.5`, frozen store, Storybook 5/5, Playwright 79/79, zero skipped,
  flaky, unexpected, or retried tests, 140.241 seconds total. The retained
  `smoke-836a894-ui2` and `smoke-797a077-ui3` diagnostics document the fixed
  Next/pnpm helper and copied-external defects.
- Final commit SHA, non-RC annotated archival tag, verified all-refs bundle and
  SHA-256, restore output, and complete clean-checkout/serial/parallel
  wall-clock transcript are commit-addressed facts. They are populated after
  this documentation commit in the tag annotation and ignored
  `.clockwork-archives/` manifest; that required sequencing is not open
  repository work.

## P1 — open repository findings

These are quality and operability gaps rather than absent capability. No launch
requirement in the ledger depends on them, so they carry no P0 entry.

- **Auth-anomaly alert `[RESOLVED]`:** `runtime-auth-anomaly` filtered on codes
  nothing emitted, and the boundary ended every span `ok` because the framework
  converts a thrown denial into a returned response before the span closes.
  `packages/contracts` now owns the canonical denial union and a resolver that
  maps the boundary-specific codes onto it, so those keep their wire meaning.
  `RuntimeBoundaryInstrumentation.trace` takes an `onResult` hook, and
  `denialSpanAttributes` reads the problem document on a 401 or 403 and sets
  `error.code`, `clockwork.outcome`, and `http.response.status_code`. The alert
  file already named the canonical three and is unchanged;
  `operations-data.test.ts` now asserts its filter against the exported union so
  the two cannot drift apart again.
- **Telemetry receiver span `[RESOLVED]`:** `/api/telemetry` opens its own
  boundary span, parented on the incoming `traceparent`, leaving the browser
  span's own parentage untouched. The sink swallows delivery failures, so a
  typed error carries the failed outcome onto the span and the route maps it
  back to the same 503 body.
- **Unbound `fetch` `[RESOLVED]`:** four sites held `fetch` as a property and
  called it as a method, so an injected global receiver threw before the request
  was sent: `provider-transport.ts`, `telemetry/otlp.ts`, and
  `apps/web/src/features/experience-server/evidence-gateway.ts`, alongside the
  already-bound `client-telemetry.ts`. Each test now drives a fake that refuses
  any receiver other than `globalThis`, so the case fails against unfixed code.
  `esign/http-signing-client.ts` calls a bare local, where the receiver is
  undefined and `fetch` accepts it, and is deliberately unchanged.
- **`startAgreementEnvelope` `[RESOLVED]`:** removed. The live path through
  `experience-server/controller.ts` is unchanged.
- **Release benchmark budget `[RESOLVED]`:** re-measured on the reference
  machine at the end of this pass and written back to
  `scripts/benchmark-release.mjs` and `scripts/release-suites.mjs`.
- **Exemption certificate expiry `[RESOLVED]`:** expiry was evaluated once, at
  onboarding write time, and never again, so a lapsed certificate stayed valid
  at invoice time forever. A daily sweep re-reads the live
  `procurement_profiles.exemptions` and records each certificate, opening a
  billing-operations exception and requesting re-collection on lapse. Expiry
  flags rather than blocks; the notice window and the block/flag policy are
  named constants carrying their `EXT-TAX-01` reference, neither of them
  approved policy. The status vocabulary was never missing: `000100` has
  enforced it since the foundation migration and only the Drizzle model lacked
  it, so `001350` records the existing constraint rather than adding a second
  one. Two checks on a column AND together, so a second vocabulary would have
  forbidden the union of what each excluded. `expiring` is deliberately not
  among the persisted values: it is true only relative to the day you ask, so
  the row records whether a certificate has lapsed and nearness is recomputed on
  read.
- **Partial payment normalization `[RESOLVED]`:** invoice-category events now
  carry `amountDue`, `amountPaid`, and `amountRemaining` beside the coalesced
  `amount`, which keeps its previous meaning, and inbox rows written before the
  totals existed still parse. `invoices` carries `amount_paid_minor` and the
  stored generated `amount_remaining_minor`
  (`supabase/migrations/001340_invoice_partial_payments.sql`), and the Stripe
  projection advances the settled amount under the existing per-row watermark
  instead of rejecting any figure other than the full total. Evidence:
  `packages/integrations/src/core/stripe/webhooks.test.ts`,
  `packages/db/src/repositories/system/partial-payments.integration.test.ts`
  (underpayment, installments, overpayment, replay, late arrival, and a totals
  invariant that dead-letters), and
  `supabase/tests/1340_invoice_partial_payments.test.sql`.
- **Part-paid collection cases `[RESOLVED]`:** the status vocabulary is
  unchanged; "partially paid" is derived from an `open` invoice with a settled
  amount above zero. Full settlement resolves an `open`, `promised`, or
  `escalated` case inside the same projection transaction that records the
  money, appending one `collectionActions` row attributed to the case owner and
  no more on replay. A partial payment leaves the case and its aging alone, and
  the dunning sweep chases the remainder rather than the original total,
  skipping invoices with nothing outstanding. Evidence:
  `packages/db/src/repositories/system/partial-payments.integration.test.ts`,
  `packages/db/src/repositories/workflows/core-schedules.integration.test.ts`,
  and the collections cases in `packages/workflows/src/core/engine.test.ts`.

### Cost of operation

Recorded 2026-08-02. The entries above are defects; these four are improvement
work, kept in P1 for the same reason — no ledger launch requirement depends on
them. Each converts recurring engineering time into an operator action, which
matters because steady-state engineering cost, not vendor spend, dominates the
cost of running this platform. Each names the verified present state rather than
a desired capability.

- **Price-book activation `[RESOLVED]`.** Finance activates a price book from
  `/internal/price-books` without an engineer. One finance approver proposes an
  activation with a reason, a second decides it, and the persisted `approvals`
  row carries both identities under the `approvals_two_person_check` constraint
  that forbids them being the same person. Activation runs the domain
  `activatePriceBook`, so floors, currency, duplicate SKU and region, version
  uniqueness, and the effective date are revalidated against persisted truth,
  and the incumbent version of that currency is retired in the same transaction
  that activates its successor. `recordPriceBookActivation` is called on every
  transition and is no longer a definition without a caller. `add_rate` was
  allowlisted by the route while the repository rejected it as unsupported; it
  now inserts a rate card into a draft only when the resulting book still passes
  the guardrails whole. Two facts were blocking the path beneath the TypeScript:
  `price_books` row policies admit the service connection alone, so writes run
  there like the commitment ledger already does, and finance now holds a narrow
  read on drafts (`supabase/migrations/001360_price_book_activation_write.sql`);
  and the book carried only its published version number, which never moves, so
  it now also carries `row_version` for the audit chain and for
  `expectedVersion` conflict handling. Signed price content stays behind
  EXT-COMMERCIAL-01. Evidence:
  `packages/db/src/repositories/core/price-books.integration.test.ts`,
  `supabase/tests/1360_price_book_activation.test.sql`, and
  `apps/web/src/features/internal-ops/price-books/server-price-book-loader.test.ts`.
- **No operator surface for outbox and dead-letter recovery.** Dead-letter state
  is persisted and queryable in `packages/db/src/repositories/system/outbox.ts`,
  `packages/db/src/repositories/workflows/lifecycle.ts`, and
  `packages/db/src/repositories/workflows/core.ts`, and re-drive exists in the
  lifecycle events API, but no `/internal` route renders any of it — the fifteen
  internal pages cover accounts through search with no queue-health or
  dead-letter surface among them. The recovery procedures in
  `docs/operations/queue-outbox-health.md`, `workflow-recovery.md`,
  `webhook-replay.md`, and `stuck-provisioning.md` are therefore executed by an
  engineer with database access on every occurrence. Add an internal surface
  that lists dead-lettered work with its failure reason, and that permits
  inspect, retry, and abandon under the existing role and audit rules.
- **No derivation view for a computed figure.** Nothing in `packages/domain` or
  `packages/api` exposes how a billed number was reached. Answering "why is this
  invoice this amount" means reading code and querying the database by hand,
  which routes ordinary customer and finance questions to an engineer. The
  inputs are already persisted — `orderLineSnapshots`, `quoteSnapshots`,
  `commitmentPeriods`, `commitmentAllowanceAdjustments`, `usageReconciliations`,
  and `amendmentLineSupersessions`. Expose the chain from order through
  entitlement, usage, commitment, and rate to invoice line as a read-only
  explain view on the internal account timeline, scoped by the same visibility
  rules as the objects it reads. Spec §17.
- **Recurring runbooks are prose rather than actions.** `docs/operations` holds
  thirteen procedures, of which `queue-outbox-health.md`,
  `stuck-provisioning.md`, `webhook-replay.md`, `workflow-recovery.md`,
  `unhandled-errors.md`, and `billing-reconciliation.md` describe steps taken
  during live incidents. Each is a document an engineer reads and then performs
  by hand. Convert the recurring six into operator actions behind
  `internal_operator`, each recording an audit entry and leaving the prose as
  reference. The dead-letter surface above is the first and largest of these;
  this entry covers the remainder and should follow it rather than run in
  parallel.

## P1 — external activation and approval gates

Each input below already has a repository control, deterministic simulator,
fail-closed enforcement boundary, and exact live activation test in
`docs/external-gates.md`.

- `EXT-ACC-01` — named hosted accounts/projects, scoped credentials, selected
  telemetry/paging backend and delivery proof, managed backup/PITR proof, and
  staging soak.
- `EXT-LEGAL-01` — counsel-approved exact agreements, thresholds, retention,
  claims, screening, country variants, and re-execution policy.
- `EXT-COMMERCIAL-01` — signed prices, floors, commitment/overage terms,
  transfer/commission tiers, credit inputs, and claims wording.
- `EXT-PROVIDER-01` — selected provider contracts, endpoints, credentials,
  sender/webhook configuration, and posting model.
- `EXT-PROVISION-01` — live provisioning/usage/teardown contract, credentials,
  and SKU-entitlement mappings.
- `EXT-TAX-01` — approved tax, exemption, accounting, recognition, credit,
  dunning, country, and payment-term policies/mappings.
- `EXT-DOMAIN-01` — production/preview/custom domains, DNS, TLS, callbacks,
  webhook URLs, and sender authentication.
- `EXT-BRAND-01` — final licensed assets and claims/legal-approved brand copy.
- `EXT-APPROVERS-01` — named qualified queue owners, primary/backup approvers,
  escalation contacts, response targets, and on-call roster.
- `EXT-TEARDOWN-01` — written activation authority and scope for automated
  teardown plus two distinct approvers; automation remains off.
- `EXT-MARKETPLACE-01` — AWS/Azure/GCP enrollment, seller/payout/tax profiles,
  permissions, feeds, credentials, and commercial approval.
- `EXT-MIGRATION-01` — immutable production snapshot/access, approved handling
  and quiet window, two approvers, communications, and rollback boundary.

## P2 — post-spec expansion

- Optional shared-session/account linking with the existing Fil One product.
- Additional locales, currencies, payment rails, marketplaces, and providers
  after their legal/commercial/operational approval.
- Deeper distribution trees if a future channel program requires them.
- Bidirectional CRM editing or write-enabled support only after a new
  ownership/security ADR; the current support feed is deliberately read-only.
- One shared exception-queue vocabulary declared in a single package, once P0-43
  has settled which queues exist.
- Reporting dimensions beyond the ten §17 reports, and any BI export, after
  P0-42 completes the ten.
- Per-user and per-account notification preferences, once P0-46 gives deliveries
  a record to reference.
- Usage ingestion from a second orchestrator source, after the first source
  contract is live under `EXT-PROVISION-01`.
