# Commerce backlog

This is the canonical Clockwork commerce backlog. `main` is the only active
branch. Historical lane names and tips are provenance only. This is not an RC or
launch declaration.

Every marker below was re-derived against `main` at `5cc5fdd` on 2026-08-14 by
an independent audit. Forty-nine held; the rest are corrected under "Corrections
to markers recorded before this audit". Two facts govern how the rest of this
file should be read. First, `main` has never had a green continuous-integration
run, all five pull requests were merged red, and no branch protection gates a
merge — see P0-47 and P0-48. Second, the "Accepted verification evidence" block
below is a local capture taken at `9464bab` on 2026-08-01, before two
experience-wide redesigns landed on 2026-08-02; it has never been reproduced by
CI, and per P0-47 the CI configuration cannot run the suite it describes. Treat
it as provenance, not as a gate.

P0-47 onward are repository findings from that audit. Each survived an
adversarial pass whose default was to refute, and none depends on an external
input.

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
- **P0-40 — Authoritative events for six portal aggregates `[COMPLETE]`:** the
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

## P0 — findings from the 2026-08-14 independent audit

These entries are new repository findings from an independent audit of `main` at
`5cc5fdd`. Every one names the file and line that carries the defect and the
concrete failure it produces, and every one survived an adversarial pass whose
default was to refute. None depends on an external input.

- **P0-47 — The release gate cannot pass and one browser suite never runs
  `[OPEN]`:** `RELEASE_SUITE_NAMES` in `scripts/release-artifacts.mjs:6` names
  seven suites — `static`, `unit`, `integration`, `build`, `ui`, `demo`, `proof`
  — while the matrix in `.github/workflows/ci.yml:36-51` defines six shards and
  omits `demo`. `scripts/release-suites.mjs:860` runs exactly one suite per
  `--shard`, so CI emits six summaries, and
  `scripts/validate-release-join.mjs:95` requires
  `summaries.length === RELEASE_SUITE_NAMES.length` before it will set
  `report.accepted`. Six is not seven, so the job whose step is named "Require
  every shard, isolation contract, and 30-minute budget" exits non-zero even
  when every shard is green. The failure is currently masked because that job
  first asserts `RELEASE_SHARDS_RESULT = success`, which the shard defects in
  P0-48 already break. The absent shard also means `apps/web/e2e/demo.spec.ts`
  never executes in CI, and its tests are the only coverage of the demo password
  gate, including the wrong-password refusal and the return-path retention — a
  public-internet access-control boundary with no continuous verification. Add
  the `demo` shard on its own port, or drop `demo` from `RELEASE_SUITE_NAMES`
  and fold `demo-chromium` into `ui`; then assert in
  `scripts/release-artifacts.test.mjs` that the workflow's shard list equals
  `RELEASE_SUITE_NAMES`, because nothing currently holds those two in agreement.
  The README also still describes five shards where the workflow runs six.

- **P0-48 — `main` has no green continuous-integration run `[OPEN]`:** every run
  of the CI workflow on `main` has failed, and all five pull requests were
  merged red. `main` carries no branch protection, so no status check gates a
  merge. The most recent run (`5cc5fdd`, 2026-08-10, id 31346389931) never
  executed — all seven jobs stopped within twelve seconds reporting that account
  payments had failed or the spending limit needed raising, which is a billing
  condition rather than a repository defect and is fixed outside this
  repository. The last run that did execute (`e7ff479`, 2026-08-05,
  id 31055082144) failed on five independent repository defects. The `static`
  shard exhausts the V8 heap and aborts with exit 134, because
  `eslint.config.mjs:27` enables `parserOptions.projectService` for type-aware
  linting across the whole workspace and no `NODE_OPTIONS` heap ceiling is set
  anywhere in the repository. The `integration` shard fails
  `supabase db reset --local --version 001230` with
  `column "amount_paid_minor" of relation "invoices" does not exist`, because
  the populated-upgrade fixtures are written against head schema while the drill
  replays them against `001230_experience_delivery.sql` and `amount_paid_minor`
  arrives four migrations later in `001340_invoice_partial_payments.sql`. The
  same shard fails `packages/documents/src/semantic-pdf.integration.test.ts:101`
  with `spawn pdftotext ENOENT`, because the semantic-PDF verification of all
  fifteen artifact kinds shells out to Poppler and no workflow step installs it.
  The `proof` shard fails both authorization proofs at
  `apps/web/e2e/production-proof.spec.ts:863` and `:923`, so the assertion that
  a partner cannot read customer truth does not currently execute. The `ui`
  shard fails three tests and leaves nineteen unrun, including the mobile drawer
  navigating nowhere. Docker Hub returns `toomanyrequests: Rate exceeded` on the
  unauthenticated image pulls that start the database for `integration` and
  `proof`.

- **P0-49 — Accepted amendments persist no money `[OPEN]`:** `mutateAmendment`
  in `packages/db/src/repositories/core/database-finance.ts:3882` calls
  `createAmendment`, which computes `quantityDelta`, `fullPeriodPriceDelta`,
  `proratedPriceDelta` and `supersededLineIds`, and then persists only the
  header — an `amendments` row carrying `kind`, `effectiveOn`, `prorationMethod`
  and `documentId` — before setting the order status to `amended`. Nothing else
  is written. `amendment_lines` has no writer anywhere in the tree;
  `core_amendment_financial_terms`
  (`packages/db/src/schema/core/finance.ts:493`, which holds
  `forecastDeltaMinor` and `monthlyDeltaMinor`) has no writer;
  `core_amendment_line_supersessions` (`:526`, which holds `netQuantityDelta`
  and `netRevenueDeltaMinor`) is referenced only by the reader at
  `packages/db/src/repositories/core/invoice-derivation.ts:147`; and
  `order_lines.superseded_by_amendment_id` is never assigned in TypeScript or
  SQL. Both invoice writers meanwhile bill the untouched original —
  `packages/workflows/src/core/core-dispatch.ts:255` and
  `database-finance.ts:4441` both insert `amountMinor: quote.totalMinor`. A
  customer who accepts an upgrade signs the document, receives a 200, and is
  never billed for it; a downgrade is never credited and the customer keeps
  paying the higher amount. `deriveInvoice`
  (`packages/domain/src/core/derivation/index.ts:534`) computes
  `supersessionMinor` from an always-empty supersession set, so the derivation
  view added for P1 reports the amended order as unamended with zero variance
  and the discrepancy is invisible to finance. Write the lines, financial terms
  and supersessions inside the same transaction as the header, set the
  superseding identifier on each superseded order line, and make both invoice
  writers add the net revenue delta for effective amendments instead of
  hardcoding the quote total. Spec §12.

- **P0-50 — Customer self-service forms demand identifiers no customer can
  obtain `[OPEN]`:** `apps/web/src/features/surfaces/workflow-panel.tsx:61-65`
  computes `demoFallbackAllowed` from `NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV` or
  `NODE_ENV` being `development` or `test`, and `demoValue` at `:102-104`
  returns the seeded identifier when that holds and an empty string otherwise.
  Every identifier field in the panel is a `required` input whose `defaultValue`
  is `demoValue(...)` — renewal's account and order identifiers at `:530-540`,
  the invite organization and account at `:854-865`, the account row version at
  `:822-829`. The panel is mounted on real customer routes including
  `/orders/[id]`, `/account`, `/account/users`, `/account/procurement`,
  `/pocs/[id]` and `/partner/portfolio/[id]`, and none of them pass the record
  they have already resolved — `orders/[id]/page.tsx:23` renders the renewal
  panel with no props while `id` and `record` are in scope in the same file. In
  a production build the fallback is off, so the customer sees empty required
  fields for raw UUIDs that are never surfaced anywhere in the interface,
  `form.checkValidity()` at `:1082` blocks submission, and renewal, decline,
  user invitation and procurement update are simply unavailable. Development and
  CI populate the same fields, so no test observes it. Pass the resolved
  identifiers in as props and render them read-only or hidden, as
  `agreement-acceptance.tsx` and `order-acceptance.tsx` already do, and delete
  `demoValue`.

- **P0-51 — E-sign binding writes the envelope's version as the agreement's
  aggregate version `[OPEN]`:** `persistProviderBinding` in
  `packages/db/src/repositories/system/providers.ts:436` updates
  `lifecycle_signature_envelopes` and then appends an audit event with
  `aggregateType: "agreement"`, `aggregateId: envelope.agreementDraftId` and
  `aggregateVersion: updated.rowVersion`, where `updated` is the envelope row
  rather than the agreement draft. Every other agreement event sources its
  version from `lifecycle_agreement_drafts.rowVersion` through
  `bumpDraftVersion`, so two independent counters feed one aggregate sequence
  that `supabase/migrations/000001_foundation.sql:869` declares unique on
  `(aggregate_type, aggregate_id, aggregate_version)`. In the counter-signed
  flow the draft reaches version 2 when the envelope is created, the envelope's
  own version trigger then sets its row version to 2 on the binding update, and
  the audit insert collides on the unique index. Postgres raises 23505, the
  internal transaction aborts, and the signing session fails after the external
  envelope has already been created at the provider, leaving orphaned provider
  state. No test exercises `persistProviderBinding`; it has one caller and no
  coverage. Read the draft's version inside the same transaction and use that.

- **P0-52 — The invoice payment surface is bound to one fixture invoice
  `[OPEN]`:** `PaymentHandoff` in
  `apps/web/src/features/customer-partner/commercial/payment-handoff.tsx`
  accepts no props. It requests a payment session for the literal
  `accountId: "11111111-1111-4111-8111-111111111111"` and
  `invoiceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"` at `:29-30`, and renders
  `$15,400.00` at `:55` and `Aug 8, 2026` at `:63` as literal markup.
  `record-detail.tsx:271` mounts it for every open invoice on `/billing/[id]`,
  so every invoice a customer opens states the same amount and due date, and
  submitting requests a session bound to a seed identifier rather than the
  record on screen. `CommercialRecordDetail` already holds the loaded record, so
  `record.aggregateId`, `record.value` and `record.dateLabel` can be passed down
  and the literals deleted. A regression test should render two distinct
  invoices and require the panels to differ.

- **P0-53 — Nothing prevents several full-value invoices for one order
  `[OPEN]`:** `mutateInvoice` at
  `packages/db/src/repositories/core/database-finance.ts:4433` accepts a
  caller-supplied identifier and performs a plain insert with
  `amountMinor: acceptedQuote.totalMinor`. It never looks for an existing
  invoice on the order, there is no `onConflictDoNothing`, and no unique
  constraint exists — `invoices_order_idx`
  (`supabase/migrations/000001_foundation.sql:890`) is a plain btree and no
  trigger bounds cardinality. `invoices: create` is an allowed action at
  `packages/api/src/routes/core/service.ts:142`, so two posts with different
  identifiers and fresh idempotency keys both succeed and produce two draft
  invoices for the same order at the full quote total; if the workflow has
  already written its deterministic initial invoice, three. Each is
  independently issuable, so the customer is billed two or three times, and
  because credit-note capacity is computed per invoice against
  `invoices.amount_minor`
  (`supabase/migrations/001000_commercial_database_integrity.sql:1686`) each
  duplicate also unlocks a fresh full-invoice credit allowance. The workflow
  writer takes the opposite approach at
  `packages/workflows/src/core/core-dispatch.ts:252`, deriving the identifier
  deterministically with `onConflictDoNothing`, so the two writers disagree.
  Adopt the deterministic identifier, or add a unique index on `order_id`.

- **P0-54 — Commitment and price-book commands set the service role on the
  tenant connection `[OPEN]`:** `database-finance.ts:1649` routes `commitments`
  and `price_books` through `withInternalTransaction(this.options.database, …)`,
  where `this.options.database` is the runtime pool —
  `apps/web/app/api/[[...route]]/hono-app.ts:223-225` wires
  `database: runtimeDatabase, pricingDatabase: serviceDatabase`, and
  `packages/db/src/client.ts:22-29` asserts in production that the runtime URL
  authenticates as `clockwork_runtime`. `withInternalTransaction` opens with
  `set local role clockwork_service` (`packages/db/src/transaction.ts:111`), and
  the only role-membership grant in the tree is
  `grant clockwork_runtime, clockwork_service to postgres`
  (`supabase/migrations/000001_foundation.sql:17`), so the runtime role holds no
  membership in the service role. In production the statement raises SQLSTATE
  42501, and every commitment-ledger and price-book command returns 500 —
  including the price-book activation path that the P1 "Price-book activation"
  entry records as resolved. Every other internal transaction in the same file
  correctly targets `this.options.pricingDatabase`; this one call site does not.
  The defect is invisible to the suite because
  `packages/db/src/repositories/core/price-books.integration.test.ts:29-38`
  constructs the repository with `database: db, pricingDatabase: db` over a
  single superuser connection, where the role change always succeeds. Change the
  call to use `pricingDatabase`, and do **not** grant the runtime role
  membership in the service role: `app_is_internal()` is literally
  `current_user = 'clockwork_service'` (`000001_foundation.sql:1138-1140`), so
  that grant would hand the tenant-facing pool a standing escalation out of
  row-level security. Add an assertion that no `withInternalTransaction` call
  receives `options.database`. Spec §18.

- **P0-55 — Every WorkOS webhook delivery fails verification `[OPEN]`:**
  `WorkosWebhookVerifier.verify` in
  `packages/integrations/src/system/webhook-verifiers.ts:48` passes the captured
  raw `Uint8Array` to the vendor SDK's `constructEvent`, which computes its HMAC
  over `` `${timestamp}.${JSON.stringify(payload)}` ``. `JSON.stringify` of a
  `Uint8Array` produces an index-keyed object rather than the delivered bytes,
  so the comparison can never match. The same call passes `tolerance: 300` where
  that SDK expresses tolerance in milliseconds, so even a correctly serialized
  payload is rejected unless it arrives within 300ms. Every WorkOS delivery
  therefore returns 401 `WEBHOOK_SIGNATURE_INVALID`, no role-synchronisation
  event is ever ingested, and because the claim never happens the failure leaves
  no row for the operator replay surface to display. Unlike its neighbour
  `StripeWebhookVerifier`, which `packages/testing/src/stripe/verifier.test.ts`
  exercises against a real signature, this class has no test at all. Decode and
  parse the verified bytes before handing them to the SDK, or HMAC the raw bytes
  directly as the e-sign and provisioning verifiers already do, and convert the
  tolerance to milliseconds.

- **P0-56 — Operator webhook replay clears the processed marker and enqueues a
  task no worker implements `[OPEN]`:** `DatabaseCoreFinanceService.replay` at
  `database-finance.ts:5377` sets `processedAt` and `processingError` to null on
  the inbox row and writes a `workflow_runs` row with
  `taskIdentifier = "webhook-replay:${provider}"`. No task with that identifier
  exists — the production modules imported by
  `packages/workflows/src/trigger/discovery.ts` declare only the `core.*`,
  `system.outbox.dispatch.v1`, `external-gate-activation.*` and lifecycle
  identifiers, and both readers of `workflow_runs`
  (`packages/db/src/repositories/system/outbox.ts:303` and
  `packages/db/src/repositories/workflows/core.ts:366`) filter on identifiers
  that do not include it.
  `apps/web/src/features/internal-ops/webhook-replay/actions.ts:95` reports
  `started: true` to the operator, so an incident is closed as handled while
  nothing executes. Worse, the row is now permanently reclassified as
  unprocessed and its dedupe guard is gone, so a provider redelivery of the same
  event identifier is claimed rather than rejected and the projection is
  re-entered. Either register a task that re-runs the stored verified payload
  and clears the marker inside its own transaction, or fail the command closed
  until such a task exists. Do not mutate the inbox row before a consumer is
  guaranteed to pick it up.

- **P0-57 — `mfaVerified` records an environment allow-list, not a second factor
  `[OPEN]`:** `apps/web/src/auth/session.ts:408-422` derives `mfaVerified` by
  testing whether the session's organization identifier appears in the
  comma-separated `WORKOS_MFA_POLICY_ORGANIZATION_IDS`. It never consults an
  authentication-factor or assurance-level claim, so it answers whether an
  organization is configured to require a second factor rather than whether this
  session completed one. `checkRecentAuth` at `:423` bounds recency, not
  assurance. The boolean gates every privileged role through
  `assertPrivilegedMfa` and `packages/domain/src/authorization.ts:45-52`, and it
  is persisted to `experience_projection_action_requests.mfa_verified`
  (`apps/web/src/features/experience-server/repository.ts:524`) where the
  asynchronous executor re-trusts it without rechecking
  (`packages/db/src/repositories/experience/authoritative-command.ts:264-270`).
  If an organization's factor policy is relaxed, or an organization is added to
  the variable before its policy is configured, every owner, admin, partner
  admin, internal operator, finance approver, legal approver and
  destructive-action approver in it continues to pass on a single-factor
  session, including assisted-session start and destructive approval. Read the
  assurance claim from AuthKit and require it directly; keep the organization
  list only as a further restriction.

- **P0-58 — Ten lifecycle tasks are never enqueued and execute inside the outbox
  cron `[OPEN]`:** `createLifecycleTaskOutboxHandlers` in
  `packages/workflows/src/system/lifecycle-task-dispatch.ts:34` defaults its
  submission port to `{ submit: executeLifecycleTask }`, and
  `packages/workflows/src/runtime/production-adapter-factory.ts:420` calls it
  with no argument. Provisioning command dispatch, provisioning confirmation
  ingestion, envelope dispatch, agreement evidence ingestion, POC conversion,
  teardown, teardown confirmation, exception human decision, migration discovery
  and migration review wait therefore run inline inside `outboxDispatcherTask`
  (`packages/workflows/src/system/tasks.ts:6`), a one-minute cron with a
  one-minute time-to-live that drains up to a hundred messages per run. The only
  three production `tasks.trigger` call sites are
  `packages/workflows/src/runtime/environment-production-adapters.ts:178`,
  `packages/workflows/src/system/gate-activation-tasks.ts:43` and
  `packages/workflows/src/system/dead-letter-redrive.ts:83`, none of which reach
  these ten. `LIFECYCLE_RETRY_POLICY` and each task's queue and concurrency
  configuration are consequently inert, one slow provisioning call starves every
  message behind it in the same run, and the synthesized `outbox:${messageId}`
  run identifier means the provider dashboard shows one run for a hundred
  effects, so `docs/operations/stuck-provisioning.md` and
  `docs/operations/workflow-recovery.md` cannot locate a per-effect run. Pass a
  real submitter, and assert that every identifier in
  `lifecycleWorkflowRegistry` reaches `tasks.trigger`. Spec §18.

- **P0-59 — The portal offers five commands that are not implemented `[OPEN]`:**
  `actionsFor` in
  `packages/workflows/src/experience/projection-definitions.ts:188` returns
  `price`, `issue` and `revise` for a draft quote, `void`, `mark_uncollectible`
  and `evaluate_dunning` for an open invoice at `:196`, and `apply` and
  `prepare_artifact` for a draft amendment at `:201`; `actionsByResource` at
  `:114` admits all of them, `projection-action-buttons.tsx:25-54` has
  translated labels for each, and `authoritative-command.ts:60-64` even assigns
  `void` and `mark_uncollectible` a permission. But `mutateQuote` branches only
  on `create`, `prepare_artifact`, `issue`, `expire`, `approve_exception` and
  `reject_exception` before throwing `INVALID_STATE` at
  `database-finance.ts:3460`; `mutateInvoice` handles only `create`,
  `evaluate_dunning` and `issue` before throwing at `:4601`; and
  `mutateAmendment` throws for anything but `create` and `prepare_artifact` at
  `:3772`. `reviseQuote` (`packages/domain/src/core/quotes/index.ts:191`) has no
  reference anywhere including tests, and `invoices.consolidate` is advertised
  at `packages/api/src/routes/core/service.ts:136-145` with no implementation.
  Because the primary next action is the first entry, an internal operator
  opening a draft quote is shown "Price" as the headline action and receives an
  unsupported-transition error. Either implement the branches or remove the
  verbs from both the projection definition and the service catalogue, and
  assert that every advertised action has a reachable branch. The README
  advertises "Revise, duplicate, or expire versions".

- **P0-60 — Updating a procurement profile erases its certificates `[OPEN]`:**
  `mutateProcurement` at `database-finance.ts:2597` never reads `input.action`
  except to reject a duplicate create. It builds a complete value set —
  `poRequired`, `exemptions`, `supplierPortalStatus`, `supplierDocuments` — from
  the payload alone, defaulting each absent key, and unconditionally updates the
  whole row at `:2597-2625`. The API advertises `add_certificate` and
  `record_supplier_document` as distinct actions at
  `packages/api/src/routes/core/service.ts:104-109`. A customer adding one
  exemption certificate therefore replaces the entire exemptions array, deleting
  every previously validated certificate, resets `poRequired` to false because
  the payload omitted it, and empties `supplierDocuments`. Tax-exempt status and
  purchase-order policy are silently lost and the next invoice is issued against
  the wrong profile. `assessExemptionCertificates`
  (`packages/domain/src/core/procurement/index.ts:139`) has no production
  caller. Branch on the action, append rather than replace, patch only the keys
  present, and reject unknown verbs. Spec §4, §19.

- **P0-61 — No tax is calculated or stored anywhere `[OPEN]`:** `TaxPort`
  (`packages/contracts/src/providers.ts:130`) declares `validateTaxId` and
  `calculate`, and `ProviderPorts` at `:206` requires a tax slot, but the only
  implementation is `FakeTaxAdapter`
  (`packages/integrations/src/fakes/providers.ts:131`).
  `createEnvironmentWorkflowAdapterFactory`
  (`packages/workflows/src/runtime/environment-production-adapters.ts:330-400`)
  composes billing, accounting, notifications, usage, identity, evidence,
  provisioning, screening and signature and has no tax slot, and no tax provider
  variable exists anywhere. There is nowhere to put a result either: no tax
  amount, rate or total column appears in `packages/db/src`, `packages/api/src`
  or `supabase/migrations`, and the `invoices` table
  (`000001_foundation.sql:390-405`) carries only currency and an amount. A
  customer in a tax-bearing jurisdiction accepts a quote and receives an order
  form, invoice and receipt at net with no tax, so the customer is
  under-invoiced and the merchant-of-record obligation is unmet. P0-45 admits
  only that `validateTaxId` is unwired; the calculation half and the absent
  schema are admitted nowhere. Add the columns and the provider slot, call
  `calculate` in quote pricing and invoice creation, and until that exists gate
  acceptance for tax-bearing jurisdictions behind an external gate rather than
  issuing zero-tax invoices. Spec §10, §19.

- **P0-62 — The partner quote builder carries a fabricated deal, a fixed partner
  identity, and an expiry default that lapses on 2026-08-31 `[OPEN]`:**
  `apps/web/app/(experience)/(partner)/partner/quotes/new/page.tsx` renders
  `ResaleQuoteBuilder` with no session, partner or account. `initialDraft` at
  `apps/web/src/features/customer-partner/partner/resale-quote-builder.tsx:25-34`
  pre-fills a resale price against a named end client, the summary rail states
  `Meridian Channel Group` as merchant of record at `:449`, and `:462` prints a
  fixed partner identifier. Offer and end-client options are seed identifiers in
  `resale-quote-model.ts:3-25`. Whoever signs in sees another party's merchant
  boundary and commercial terms on the surface that converts partner deals.
  Separately the draft's `expiresAt` default of `2026-08-31T17:00` is validated
  against the current time at `resale-quote-model.ts:71-73`, so from 2026-09-01
  an untouched form fails validation on its first submission with "Choose an
  expiry after the current time." Resolve the partner membership and merchant
  boundary from the session, load offers and end clients from the price book and
  portfolio projections, and start the draft empty.

- **P0-63 — Internal surfaces render fixtures beneath explicit provenance claims
  `[OPEN]`:** `/internal`, `/internal/renewals`, `/internal/collections`,
  `/internal/provisioning`, `/internal/migrations`, `/internal/reports`,
  `/internal/agreements` and `/internal/approvals` read constants from
  `apps/web/src/features/internal-ops/finance-lifecycle/lifecycle-data.ts`,
  `apps/web/src/features/internal-ops/administration-safety/data.ts` and
  `apps/web/src/features/internal-ops/copy.ts:56-131`; none of their page
  components awaits a loader, in contrast to `/internal/queues`,
  `/internal/recovery` and `/internal/webhook-replay`, which do. The aggravating
  factor is the framing rather than the fixtures: `collections-view.tsx:19`
  prioritises a checked-in array of named accounts and dollar amounts while the
  page frame prints "Collections ledger refreshed 3 minutes ago" and "Source:
  Invoices, disputes, promises to pay, and receipts"
  (`finance-lifecycle/copy.ts:16-17`) inside a block labelled as provenance
  (`page-frame.tsx:32-35`); `internal-ops/copy.ts:13` always reads "Operational
  snapshot refreshed 4 minutes ago" over frozen observation timestamps; and
  `provisioning-view.tsx:77` renders the string "operations · live provider
  state". A finance approver can hold or escalate a real customer on figures
  that came from a TypeScript literal and will read identically in a year. The
  operator brief's first reject-list rule forbids exactly this. Wire these views
  to a loader, or delete the freshness and source strings and render an
  unmissable unwired state; a provenance claim beside unwired data is worse than
  no data.

- **P0-64 — The downloadable CSV escapes fewer formula prefixes than the
  workflow export, and the test that proves otherwise runs against dead code
  `[OPEN]`:** `packages/api/src/routes/core/index.ts:444` guards `/^[=+@-]/`
  while `packages/workflows/src/core/csv.ts:4` guards
  `/^(?:[=+\-@]|\s+[=+\-@])/`. Spreadsheet applications strip leading whitespace
  before evaluating a cell, so a persisted value beginning with a space and then
  a formula character is neutralised in the workflow export and passes through
  unescaped in the response to `GET /v1/core/reports/{report}?format=csv`, which
  is the download a user actually receives. The assertion that establishes
  formula safety, `packages/domain/src/core/core-finance.test.ts:1019`,
  exercises `toCsv` in `packages/domain/src/core/reports/index.ts:357`, whose
  only references in the repository are that test file's import and assertion;
  no test covers the API route's CSV path. Collapse the writers onto `renderCsv`
  and move the assertion to an integration test over the HTTP response body,
  including the whitespace-prefixed case. Spec §17.

- **P0-65 — Unauthenticated idempotency records share one namespace and replay
  whole responses `[OPEN]`:** `packages/api/src/middleware/idempotency.ts:188`
  derives its scope as `${authorization?.userId ?? "anonymous"}:${path}`.
  `WorkosNextSessionResolver.resolve` returns null for
  `POST /v1/lifecycle/registrations` (`apps/web/src/auth/session.ts:479-483`)
  and the middleware order in `packages/api/src/app.ts:57-68` resolves the
  session before idempotency, so every caller of the one route reachable without
  a session shares the scope `anonymous:/v1/lifecycle/registrations`. The store
  persists the status, all response headers and the full response body at
  `:226-232`, and `claimIdempotencyKey` replays them for twenty-four hours
  (`packages/db/src/repositories/idempotency.ts:34-42`, `:52`). A caller who
  reuses another registrant's key with a byte-identical body receives that
  registrant's response, including the new account, organization and user
  identifiers; a caller who reuses it with a different body burns the key for
  twenty-four hours behind a hard conflict at `:190-198`. Derive the scope for
  unauthenticated routes from a request-bound secret, and refuse to serve a
  cached body when the principal is anonymous.

- **P0-66 — The telemetry ingest is unauthenticated, unmetered, and accepts
  caller-chosen trace parentage `[OPEN]`:**
  `apps/web/app/api/telemetry/route.ts:83-105` gates on `csrfAuthorized()` alone
  — `sec-fetch-site`, `origin`, and a double-submit of the `clockwork-csrf`
  cookie that `apps/web/proxy.ts:170-180` mints for any request, authenticated
  or not. There is no session requirement and no rate limit anywhere in the
  repository. An anonymous caller can read the cookie from an unauthenticated
  page load and post accepted records in a loop, each forwarded to the
  configured collector at `:207`, so third-party ingest cost is drivable without
  an account. `trace.parentSpanId` is validated only as sixteen non-zero
  hexadecimal characters at `:63-67`, so forged `browser.error` spans can be
  attached to a real user's trace, which corrupts incident timelines and the
  `runtime-auth-anomaly` signal the P1 list depends on. The same file returns
  six errors as bare `application/json` rather than RFC 9457, as does
  `apps/web/app/sign-in/route.ts:17`, against §18. Require a session or a signed
  short-lived ingest token, meter it, and reject a parent span this server did
  not emit.

- **P0-67 — Currency and money sign are unconstrained on ten commerce tables
  `[OPEN]`:** `supabase/migrations/000001_foundation.sql` declares
  `currency text not null` on eleven tables and constrains the vocabulary on
  one, `accounts` at `:41`. `commission_accruals`, `cost_records`,
  `credit_notes`, `dispute_cases`, `invoices`, `payments`, `pocs`, `price_books`
  (`:560`), `quotes` and `refunds` carry no vocabulary check, and no later
  migration adds one. `price_books` is the root of the currency chain, so the
  constraint is missing where it would do the most work. Money columns are
  similarly unconstrained: the amounts on `invoices`, `payments`, `refunds`,
  `credit_notes`, `commission_accruals`, `dispute_cases`, `order_lines`,
  `quote_lines`, `pocs`, `rate_cards`, `amendment_lines`, `key_terms` and
  `memberships` have no non-negativity check, while
  `quote_lines.unit_price_minor` and `quotes.total_minor` do, so the omissions
  are inconsistent rather than deliberate. ISO 4217 is therefore enforced only
  by `packages/contracts/src/primitives.ts:114`, on paths that traverse the API,
  while the commitment-ledger writes, the Stripe projection and the accounting
  export all write through the service role. One mis-cased code or one negative
  settled amount is durable, and `core_three_way_tie_out` groups by currency, so
  it reports two rows for one currency without detecting the split. Spec §18,
  §19.

- **P0-68 — Three customer and partner journeys have no working path `[OPEN]`:**
  order acceptance is a two-pass command whose second pass depends on
  `orderFormDocumentId`, computed server-side at render
  (`apps/web/app/(experience)/(customer)/orders/accept/page.tsx:69-77`), and the
  first pass sets a message that disables the submit control at
  `apps/web/src/features/customer-partner/commercial/order-acceptance.tsx:386`
  with no refresh or polling, so the customer must navigate away and re-enter
  the purchase order, service start and authority title to complete the
  commitment. `recordRoute` in
  `apps/web/src/features/experience-server/portal-view-loader.ts:59-65` returns
  `/services` for the services channel and no `services/[id]` route exists, so
  every row on the live-entitlements surface links to itself. Nine of the
  eighteen workflows implemented in
  `apps/web/src/features/surfaces/workflow-panel.tsx` are mounted on no route,
  including `registration` at `:620` and `:1216`, so `/partner/registrations`
  lists deal registrations while describing itself as the place to create them
  and the command palette offers "Register a deal" as a link to that page. The
  polling receipt loop at
  `apps/web/src/features/surfaces/projection-action-buttons.tsx:130-168` is the
  working pattern for the first of these. Spec §4, §12, §14.

- **P0-69 — An error on any partner or internal route destroys the application
  shell `[OPEN]`:** there is no layout at `apps/web/app/(experience)`, so
  `(experience)/error.tsx` sits above the customer, partner and internal layouts
  and any error not caught below it replaces the whole shell — navigation,
  organization switcher, command palette and banner — with a card offering only
  Retry. The `(partner)` and `(internal)` groups contain no `error.tsx` at all,
  and neither do the customer `dashboard`, `account`, `amendments`,
  `marketplace` and `support` segments; fifty-five pages are served by seventeen
  state files in total. No segment declares `not-found.tsx`, and
  `loadCommercialRecord` (`portal-view-loader.ts:186-199`) never returns null —
  a missing or foreign record raises "Projection record omitted title" — so an
  unknown identifier produces an internal string in the error boundary rather
  than a not-found response, and the "Record not found" branch already written
  at `record-detail.tsx:129-146` is unreachable.

- **P0-70 — Migration start is reachable by a customer owner or admin
  `[OPEN]`:** the handler at `packages/api/src/routes/lifecycle/index.ts:1881`
  is `requirePermission(context, "destructive:request")` followed by
  `requireRecentAuthentication(context)`, with no account scope and no
  internal-staff check, and `packages/contracts/src/auth.ts` grants
  `destructive:request` to `owner` and `admin` — ordinary tenant roles. The
  repository does not compensate: `command-repository.ts:726-734` routes
  `start_migration` to the service transaction only when the caller is internal
  staff and otherwise falls through, and `startMigration` at `:4514` asserts
  recency but never staff. A customer owner with a fresh session can therefore
  post a discovery run with a chosen snapshot hash and drive an authenticated
  outbound request from the platform into the legacy source system before the
  `lifecycle_migration_internal` row policy finally blocks the insert and the
  request fails. Gate the route on internal staff explicitly, assert the same at
  the top of `startMigration` before any source load, and consider a dedicated
  permission rather than one held by tenants. Spec §21.

- **P0-71 — The traceability ledger cites unreachable code as evidence
  `[OPEN]`:** fifteen rows of `docs/traceability/launch-requirements.json` were
  checked against implementation rather than against their own prose, and the
  `domain` and `tests` citation columns repeatedly name symbols no production
  path reaches. `SPEC-17-R02` and `SPEC-17-11` cite `capacityPlanning` and
  `weeklyScorecard` in `packages/domain/src/core/reports/index.ts`, which have
  no references and no tests, while the reports that ship are SQL views in
  `supabase/migrations/000100_core_finance.sql:697-863` served through
  `packages/api/src/routes/core/service.ts:25`; seven of the ten functions in
  that module are unreferenced, and `threeWayTieOut` collides with a live name
  in `packages/integrations/src/core/accounting/adapter.ts:296`, so a reader who
  greps it concludes the domain function is live. `SPEC-17-12` and
  `SPEC-18-VAL-02` are false in effect, per P0-64 and P0-47. `SPEC-15-02`
  records the CRM projection as implemented while P0-44 records the same code as
  open, so the two documents contradict each other. `pnpm check:traceability`
  cannot detect any of this: `scripts/validate-traceability.mjs` validates the
  file against its schema, not its citations against the tree. Extend it to
  require that every cited symbol resolves to a definition reachable from
  production.

### Corrections to markers recorded before this audit

Every `[COMPLETE]` and `[OPEN]` marker in this file was re-derived against
`main` on 2026-08-14. Forty-nine held. The following did not.

- **P0-02 `[COMPLETE]` claims "zero unmapped or internally partial
  requirements".** `docs/traceability/launch-requirements.json` holds 312 rows —
  183 implemented, 105 external-gated, 12 historical and **12 `partial`** (at
  `:1196`, `:1811`, `:2411`, `:2546`, `:2561`, `:2576`, `:2591`, `:2711`,
  `:2726`, `:2741`, `:3041`, `:3651`) — while the file's own policy at `:46`
  states that at repository-qualified review partial and unimplemented are
  forbidden. The row count and the specification hash do check out. Two of the
  twelve rationales are themselves stale: `SPEC-10-02` says no production caller
  creates a commitment period and `SPEC-18-API-08` says no table records a
  notification delivery, both now false.
- **P0-04 and P0-15 `[COMPLETE]` rest on evidence captured before the tree
  changed.** The cited commit `9464bab` is real and dated 2026-08-01; the two
  experience-wide redesign merges `1a9dd86` and `9309764` landed on 2026-08-02,
  after this file's last substantive edit at `b460396`, and together rewrote
  `packages/ui/src/styles.css`, `packages/ui/src/components/shell.tsx`, all four
  story files and fourteen visual baselines. The repository's own regenerated
  manifest now disagrees with the recorded figures:
  `docs/baseline/tests-baseline-artifacts.json` records `storybookFiles: 4`,
  `playwrightSpecFiles: 8` and `browserExpandedExecutableTests: 91` against the
  entries' "Storybook 5/5" and "Playwright 79/79". The evidence describes an
  earlier tree.
- **P0-16 `[COMPLETE]` names the wrong generated artifact.** The entry cites
  Drizzle `0004_nosy_valkyrie` and 116 tables;
  `packages/db/drizzle/meta/_journal.json` has nine entries with head
  `0008_complete_captain_stacy`, and `meta/0008_snapshot.json` holds **118**
  tables. `docs/baseline/database.json` and `docs/baseline/schema.json` agree
  with the tree, not with this entry. The OpenAPI half is correct and current —
  56 paths, seven under `/api/experience`, at the recorded hash.
- **P0-34 `[COMPLETE]` claims "no remaining repository finding"** in the
  redesigned experience. Two redesign merges landed after that closure was
  asserted, and a finding remains open in exactly that surface: the mobile
  drawer at `packages/ui/src/components/shell.tsx:258-261` closes synchronously
  inside the navigation click handler, so the portal unmounts the link before
  the route commits and the drawer navigates nowhere.
- **P0-39 `[COMPLETE]`, "accepted in 93.813 seconds", is broken on `main`** —
  see P0-48. Its fixture is also a single account, projection, audit event,
  outbox message and two action requests
  (`scripts/qualify-populated-upgrade.mjs:101-165`), and it measures elapsed
  time and nothing about locks, so it does not establish what the entry claims.
- **P0-41 `[OPEN]` is stale; the commitment ledger write path is wired.**
  `supabase/migrations/001320_commitment_ledger_write_path.sql` adds the
  correction and allowance-adjustment streams; `database-finance.ts:4020`
  inserts `commitment_ledgers` and `:4018` calls `createCommitmentPeriod` from
  the production create path, `:4249` from renewal; `usage_events` are written
  at `:4153` and `packages/db/src/repositories/core/commitments.ts:406`; and
  `decideCommitmentOverage` and `reconcileCommitmentToSource` are reached from
  production at `commitments.ts:204` and `:480`. The verbs are admitted over the
  API at `packages/api/src/routes/core/service.ts:134`. Close it — but note that
  P0-54 makes every one of those commands fail in production.
- **P0-46 `[OPEN]` is stale on its lead claim.**
  `supabase/migrations/001330_notification_deliveries.sql` creates
  `notification_deliveries` with recipient array, template, alert kind, provider
  message identifier, failure code and an append-only trigger, written on every
  lifecycle notification effect at
  `packages/db/src/repositories/workflows/lifecycle.ts:1152` and
  `packages/db/src/repositories/workflows/core.ts:773`. The quote-expiry
  sub-claim is also stale: `packages/workflows/src/quotes/tasks.ts:4` registers
  `quoteExpiryAlertsTask` on cron `45 * * * *`. One sub-claim survives —
  `packages/api/src/generated/openapi.json` contains no notification operation,
  so the §18 API-catalogue claim is genuinely unmet and there are still no
  preferences to manage. Reduce the entry to that residue.
- **The P1 "No operator surface for outbox and dead-letter recovery" entry is
  resolved.** `apps/web/app/(experience)/(internal)/internal/recovery/page.tsx`
  renders dead-lettered work with its failure reason, and
  `apps/web/src/features/internal-ops/recovery/actions.ts:48` gates retry and
  abandon behind a role recheck with a reason and an audit row;
  `.../internal/webhook-replay/page.tsx` covers replay. Its counts are stale
  too: `main` has seventeen internal pages, not fifteen, and `docs/operations`
  holds eighteen procedures, not thirteen. Note that P0-56 makes the replay
  control report success without doing anything.
- **The P1 "No derivation view for a computed figure" entry is resolved.**
  `packages/domain/src/core/derivation/index.ts:503` exports `deriveInvoice`,
  `packages/db/src/repositories/core/invoice-derivation.ts:67` and `:95` load
  the chain from persisted rows, and it is mounted read-only on the internal
  account timeline at
  `apps/web/app/(experience)/(internal)/internal/accounts/[id]/page.tsx:24`.
  Note that P0-49 makes it report every amended order as unamended.
- **The P1 "Recurring runbooks are prose rather than actions" entry is largely
  resolved.** Four of the six named runbooks now have operator surfaces:
  `docs/operations/dead-letter-recovery.md:14-18` maps `/internal/recovery` onto
  the outbox, provisioning-attempt and workflow-run engines behind
  `queue-outbox-health.md`, `stuck-provisioning.md` and `workflow-recovery.md`,
  and `/internal/webhook-replay` covers `webhook-replay.md`. The residue is
  `unhandled-errors.md` and `billing-reconciliation.md`. Do not read the
  finance-lifecycle pages as closure:
  `apps/web/src/features/internal-ops/finance-lifecycle/review-action.tsx:75-79`
  is review-only and applies nothing.
- **The "Accepted verification evidence" block is stale against `main` in three
  places.** The dependency-lock hash is recorded as `6bc939e9…`;
  `pnpm-lock.yaml` on `main` hashes to
  `be9a9ddf5d712266206d15c9b0e6dc4f4874ea67b50b1817bf04f19d154f7c3e`, which is
  also what `docs/baseline/artifact-hashes.json` records. The canonical Drizzle
  SQL and snapshot hashes are those of `0004_nosy_valkyrie`, four migrations
  behind the journal head. The pgTAP figures are recorded as 16 files and 431
  assertions against the manifest's 22 and 488. The OpenAPI hash, the schema
  hash and the ten-package typecheck do still hold. Regenerate the block from
  `pnpm generate:baseline` rather than editing it by hand, and stop reading it
  as a release gate — it is a local capture, and per P0-47 the CI configuration
  cannot run the suite it describes.

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

## P1 — quality and operability findings from the 2026-08-14 audit

- **WorkOS role changes are acknowledged but never applied.**
  `packages/db/src/repositories/webhooks.ts:233` never writes
  `memberships.role`, and `:230` marks soft failures processed and returns 200
  with nothing in the tree reading the recorded error, so an identity-provider
  demotion leaves the old role in force.
- **Every production error discards its cause.** No `cause:` option is passed to
  any thrown error outside tests, and seventy-four bare `catch { … }` blocks
  rethrow typed errors without the original — `provider-transport.ts:186-192`
  and `production-adapter-factory.ts:231` are the pattern.
  `docs/operations/unhandled-errors.md` asks an operator to diagnose provider
  failures from telemetry that carries only a code.
- **No migration is written to survive a populated table.** No file under
  `supabase/migrations` uses `not valid`, `concurrently` or `lock_timeout`
  across eighty-one index creations and roughly fifteen check constraints.
  `001340_invoice_partial_payments.sql:5` adds a stored generated column to
  `invoices`, which rewrites the table under `access exclusive`.
- **Hot foreign keys and the dead-letter lookup have no index.** `quote_lines`,
  `order_lines`, `payments` and `entitlements` have no index on their parent key
  (`000001_foundation.sql:601`); cursor pagination filters on `account_id` but
  orders by `id` with no composite index (`database-finance.ts:5089`); and
  `packages/db/src/repositories/system/dead-letter-dispatch.ts:44-52` joins
  `audit_events` on `aggregate_id` and `event_type` without binding
  `aggregate_type`, so the unique index's leading column is unbound and the
  query scans the audit log during an incident.
- **Outbox messages with no registered handler are never claimed, retried or
  dead-lettered** (`packages/workflows/src/system/outbox-dispatcher.ts:39`), so
  an event whose handler is missing accumulates silently rather than surfacing.
- **The declared last-mile provider gate is never composed.**
  `GuardedProviderJsonTransport`
  (`packages/integrations/src/runtime/guarded-provider-transport.ts:21`) has no
  production composition, and the marketplace finance adapters
  (`packages/integrations/src/core/marketplaces/types.ts:69`, `adapters.ts:234`)
  have no transport implementation and are wired into nothing.
- **`HttpEsignSigningClient` calls the provider with no timeout, abort signal or
  response bound**
  (`packages/integrations/src/esign/http-signing-client.ts:50`), unlike
  `FetchJsonProviderTransport`, which does all three.
- **The Stripe ordering watermark ties on lexicographic event identifier**
  (`packages/db/src/repositories/system/providers.ts:791`), silently discarding
  same-second siblings.
- **`GET /v1/core/records/{resource}` is advertised for sixteen resources and
  implemented for seven** (`database-finance.ts:5203`), and `accounts` commands
  other than `create` are accepted, audited as successful, and do nothing
  (`:2537`).
- **Contractual renewal price protection is captured and validated but never
  enforced by any pricing path**
  (`packages/domain/src/agreements/index.ts:338`).
- **The commission clawback ceiling is an unlocked read-then-write**
  (`database-finance.ts:5025`), so concurrent clawbacks can exceed collected
  revenue.
- **White-label partner notification branding and end-client redaction are
  dead** (`packages/integrations/src/notifications/index.ts:75`); production
  hardcodes the first-party sender.
- **The authorization boundary is permissive by omission.**
  `packages/domain/src/authorization.ts:60` performs no tenant check when
  `accountId` is absent. The three current call sites are each independently
  backstopped, so this is not a live escalation, but a route added without the
  argument receives no scoping and neither the types, the lint configuration nor
  the middleware tests would notice.
- **One shared secret signs every marketplace and every support webhook**
  (`apps/web/app/api/[[...route]]/hono-app.ts:113-115`, `:118-120`). The payload
  is bound to the path segment and a persisted resource, but any holder of the
  key can sign for another provider's resources.
- **Idempotency caches failures for twenty-four hours.**
  `packages/api/src/middleware/idempotency.ts:222-232` completes the record with
  whatever status the response carried, so a 503 replays until the key expires.
- **Open redirect in the demo password gate.** `safeDemoReturnPath` in
  `apps/web/src/auth/demo-access.ts:154-157` rejects `//` but not `/\`, and
  `apps/web/app/demo/access/submit/route.ts:53` emits the value as a raw
  `location` header, which browsers resolve as an absolute origin. The
  credential at risk is the shared demo password.
- **No Content-Security-Policy and no Strict-Transport-Security.**
  `apps/web/next.config.ts:19-35` sets four headers and neither of these. No
  injection point exists today — there is no `dangerouslySetInnerHTML` anywhere
  — but the application renders tenant-controlled strings throughout and frames
  a third-party signing origin.
- **`LocalSessionResolver` defaults to the most privileged role.**
  `packages/api/src/auth/session.ts:33` falls back to `internal_operator` when
  the persona header is absent, behind a single `NODE_ENV` signal, while the
  equivalent demo affordance at
  `apps/web/src/features/experience-server/dashboard-loader.ts:80` requires
  three.
- **Two assisted-session subsystems exist.**
  `packages/db/src/repositories/identity.ts:62` and `:132` have no references,
  but `impersonation_sessions` is still created, indexed, and carries a policy
  admitting any internal role (`000001_foundation.sql:1258`) while no code reads
  it.
- **Retries have no jitter** (`packages/workflows/src/policy.ts:21`,
  `packages/workflows/src/onboarding/durable.ts:3`), so after a provider outage
  every failed run retries in lockstep. Determinism is a test requirement;
  inject it rather than ship it.
- **Schedules are bound by array position**
  (`packages/workflows/src/core/scheduled-tasks.ts:29-53`), so inserting a
  definition silently rebinds every export after it and no test asserts the
  pairing.
- **Vocabularies are duplicated without drift tests.** The currency list appears
  in seven files and is enforced in none (P0-67); report keys, core resource
  names, document kinds, projection channels, internal roles, dead-letter
  sources and the localhost set are each defined two or three times. Only the
  external-gate unions have a drift test. The exception-queue vocabulary is
  worse than P0-43 records: there are four declarations —
  `packages/domain/src/exceptions/index.ts:3`,
  `packages/workflows/src/exceptions/index.ts:14`,
  `packages/db/src/repositories/lifecycle/authorization-scopes.ts:8` (which
  restates them again at `:18-27`) and `packages/workflows/src/core/ports.ts:53`
  — and the database enforces none, since `exception_cases.queue` has no check
  constraint and `system_exception_roster.queue` constrains shape only.
- **Drizzle drift from canonical SQL.**
  `packages/db/src/schema/experience/index.ts:412` models
  `experience_esign_return_correlations.accountId` as nullable where the SQL is
  `not null`, and `packages/db/drizzle/0006_glossy_mystique.sql:44` orders an
  index differently from `001330_notification_deliveries.sql:47`. ADR-0003 makes
  the SQL canonical; nothing checks the model against it.
- **The design system is a parallel catalogue.** Thirty of the fifty-three
  components exported from `packages/ui` have no use in `apps/web`, including
  `Input`, `Checkbox`, `Fieldset`, `ValidationSummary`, `LiveRegion`,
  `ProgressSteps`, `Table` and `Toast`, while the product hand-rolls each of
  their jobs — forty ad-hoc `role="alert"` paragraphs, nine ad-hoc live regions
  and two bespoke tables. Four story files cover fifty-three components, and
  `internal-projection-page.tsx` duplicates `projection-detail-page.tsx` and is
  imported by no route.
- **Mutation feedback is generic and does not refresh.**
  `apps/web/src/features/surfaces/workflow-panel.tsx:1382-1387` returns one of
  three sentences for fifteen mutations across ten routes, with no identifier,
  no version, no link and no revalidation. The same file remounts the
  confirmation dialog by key at `:1519-1541`, which defeats focus restoration,
  and calls `sendCoreCommand` without an idempotency key at `:1119` and `:1131`
  while leaving the confirm control enabled during submission. Legally
  consequential free text is pre-filled on production forms at `:551` and is not
  covered by the development-only guard.
- **Internal queue search drops typed characters** — a URL round trip per
  keystroke plus a resetting effect (`queue-workspace.tsx:246`).
- **No page-level pagination.** `portal-view-loader.ts:104-142` reads every page
  of a channel, up to a hundred sequential requests, on every render, and the
  component then slices to five, ten or twenty. `/dashboard` performs four of
  these loops and `/orders/accept` three. No `Suspense` boundary exists anywhere
  in `apps/web`.
- **Accessibility gaps the Axe run cannot see.** Forty-four `main` elements
  carry `id="main-content"` and none is focusable, so the skip link moves scroll
  but not focus; client-side navigation focuses and announces nothing; the
  operator queue table's scroll container has no `tabIndex`, role or name, and
  below 48rem `queue-search.module.css:933-960` sets `display: grid` on the
  table and hides `thead`, removing the table semantics and column headers the
  operator brief claims; `global-search.tsx:63-113` runs `aria-activedescendant`
  and real focus movement simultaneously.
- **Customer surfaces never disclose stale data.**
  `portal-view-loader.ts:137-141` returns `stale` and `generatedAt` and every
  customer collection page passes only the records, while `/internal/queues`
  renders a stale banner with a refresh control.
- **Dashboard copy and formatting are fixed.** `customer-partner/copy.ts:41`
  states "Four items need a decision or follow-up" above a variable-length list,
  and `customer-dashboard.tsx:111` renders every timestamp in `America/New_York`
  with no timezone label, against the specification's international-by-design
  premise.
- **No unsaved-changes protection anywhere.** `quote-builder.tsx:298` and the
  other multi-stage builders discard all input on a single stray click; no
  `beforeunload` handler exists in the repository.
- **No sortable columns, bulk actions or export.** No `aria-sort` appears
  anywhere in `apps/web` or `packages/ui`, and
  `packages/ui/src/components/table.tsx` has no sort interface, against the
  partner brief's "sortable work ledger". Saved views exist only on
  `/internal/queues`.
- **Test tooling ships in the application.** `apps/web/package.json` lists `msw`
  and `@clockwork/testing` as dependencies, `app/api/[[...route]]/demo-app.ts:3`
  imports from `msw`, and `app/layout.tsx:21` imports personas from the testing
  package.
- **Contract tests instantiate only the fake.** `OutboundCrmProjectionAdapter`,
  `EsignProviderAdapter`, `DeniedPartyScreeningAdapter`,
  `ReadOnlySupportFeedAdapter`, `MarketplacePlatformAdapter` and
  `LifecycleNotificationAdapter` have no references anywhere while each `Fake`
  sibling is exercised, so the `.contract.test.ts` naming holds one side of the
  contract.
- **No end-to-end coverage of settlement.** The money-adjacent browser tests
  assert a payment handoff, not a settlement. Invoice issuance through payment
  to receipt, dunning escalation, refunds, credit notes, disputes, commission
  settlement and any non-USD order have no browser coverage, as do POC
  conversion, amendment and co-termination, renewal decline, termination and
  teardown, migration runs, marketplace orders and tax exemption.
- **No `LICENSE` file**, so no rights are granted for any external review.

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

## Product surface gaps against the competitive set

These are absent capabilities rather than defects, recorded because the portal
is sold as a reason to buy and each gap is one a buyer or a buyer's agent meets
before a human does.

- **No trust, security or compliance surface.** `apps/web/app` declares no route
  publishing an attestation, subprocessor list, data-processing agreement or
  policy set. Enterprise security review now begins before first contact, and a
  self-serve evidence surface is reported to deflect between thirty and fifty
  per cent of questionnaire volume. Every question therefore arrives as email
  against the same people who would otherwise be selling.
- **No customer-facing API credential or documentation surface.** The tree
  generates fifty-six OpenAPI paths and a typed client, and neither is reachable
  by a customer: there is no credential management surface, no published
  reference and no sandbox. The programmatic buying path exists as an internal
  artifact rather than as product.
- **No machine-readable quote or price surface for a buyer's agent.** Agent-led
  purchasing now has published protocols, and industry forecasts put roughly a
  fifth of business sellers in front of agent-led quote negotiation before the
  end of 2026. The pricing engine, guardrails and quote lifecycle needed to
  answer such a request already exist; what is missing is a contract that
  presents them to a caller that is not a browser.
- **Accessibility is now a supervised obligation and the evidence is not
  reproducible.** The European Accessibility Act has applied since 28 June 2025,
  2026 is the first full year of national supervision, and EN 301 549 v4.1.1
  incorporating WCAG 2.2 is expected during 2026. The repository's Axe, reflow,
  text-spacing, zoom and reduced-motion coverage is more thorough than most
  commercial platforms ship, but the failing accessibility-adjacent browser
  tests in P0-48 and the structural gaps in the P1 list mean the claim cannot
  currently be demonstrated on demand.

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
