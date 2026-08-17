# Commerce backlog

This is the canonical Clockwork commerce backlog. `main` is the only active
branch. Historical lane names and tips are provenance only. This is not an RC or
launch declaration.

An independent audit re-derived every marker against `main` at `5cc5fdd` on
2026-08-14 and added twenty-five findings, P0-47 onward. Ten work-stream pull
requests have merged since — `#7` through `#16`, sixteen in total on `main` —
and this file has been rewritten against what they actually did. Read their
commit bodies alongside this file: they are the primary record and several of
them contradict the audit they were answering — but they are not uniformly
reliable in either direction. At least one body records work as undelivered that
its own diff delivered (deal-registration create, in `5897196`), and later
bodies do not mention several things their trees shipped (server-side sortable
columns and the customer freshness disclosure, both in `8c53747`). Where a body
and the tree disagree, the tree was re-checked and the tree is what this file
records.

Four facts govern how the rest of this file should be read.

First, a substantial minority of the audit's claims did not survive contact with
the code — roughly one in five, counting outright refutations together with
claims wrong in cause, scope or prescribed remedy. **Four** were refuted
outright: three described the **documented contract** as a defect and one did
not reproduce at all, and implementing two of the three was actively harmful —
one opened a privilege escalation, proven against the live database, and one
would have rolled back every subsequent order acceptance for a partner. Those
four are pinned under "Refuted findings — pinned, do not reimplement", each with
the test that fails if it is reimplemented. That section is not optional
reading. Roughly the same number again were real but wrong about something
material — P0-55's prescribed fix, P0-61's and P0-42's lead claims, P0-59's
count, P0-67's money half, P0-68's population, two of P0-48's five diagnoses,
and P0-71's prescribed remedy — and each of those entries says so where it says
it is closed.

Second, **all qualification evidence in this repository is local.** GitHub
Actions is billing-blocked on the organization: the last run that executed was
on 2026-08-05, the 2026-08-10 run stopped all seven jobs within twelve seconds
on a billing condition, and each of the ten work-stream pull requests records
that Actions was still blocked and that no CI run was observed. Every figure any
of them reports — the last records typecheck 10/10, `test:unit` 86,
`test:integration` 10/10, pgTAP 38 files / 785 assertions, drift, lint,
boundaries, secrets, format, and the figures move with every merge — was
produced on a developer machine. That is a billing condition rather than a
repository defect, and it is nearly the whole of what remains in P0-48, now
`[EXTERNAL-ONLY]` under `EXT-ACC-01`: the five repository defects that failed
the last run that did execute are fixed; the billing, one observed green run,
and the branch-protection administration `main` still lacks are the gate's named
inputs; and the last repository-side caveat — the workflow installed no Poppler
while the semantic-PDF integration test spawns `pdftotext` unguarded — is now
closed, so nothing repository-side remains behind that gate.

Third, the CI configuration can now run the suite it describes. P0-47 was exact
and is closed: the workflow matrix defines all seven shards
`RELEASE_SUITE_NAMES` declares, including `demo`, and
`scripts/release-artifacts.test.mjs` parses the workflow and asserts the two
lists are equal in name and order. Any statement elsewhere in this file that the
gate cannot be satisfied is superseded by that. Satisfiability was proved
locally by running `validate-release-join.mjs` over synthetic per-shard
summaries — not by a green run.

Fourth, the "Accepted verification evidence" block below is a local capture
taken at `9464bab` on 2026-08-01 and is now stale in more places than the audit
found. It has never been reproduced by CI. Treat it as provenance, not as a
gate; it is regenerated from `pnpm generate:baseline` in the final commit of
this pass, not edited by hand.

Status markers mean:

- `[COMPLETE]`: repository implementation and direct acceptance evidence are
  complete;
- `[OPEN]`: the requirement is not met in this repository, and closing it is
  repository work;
- `[EXTERNAL-ONLY]`: repository controls, deterministic simulator, fail-closed
  enforcement, and activation test are complete; only a named external input or
  live evidence remains.

External inputs never excuse missing repository work. Neither marker fits a
finding that was wrong: `[OPEN]` means "closing it is repository work", which
for a refuted finding is an instruction to do the harmful thing. Refuted
findings therefore carry no marker and live in their own section, where the
parser cannot see them and a reader cannot mistake them for work.

A green run of a checker proves what that checker checks and nothing more. Where
an entry below says something is closed only in part, the part that is open is
named.

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
  or retry-masked provider/build failure. This marker had regressed and was
  re-earned in `0f68e36`: the audit found 10 live advisories, 6 high. Upgrading
  `hono` to 4.12.34 and overriding `js-yaml` and `nanoid` closes 8. The
  remaining 2 are `image-size`, where every published version is vulnerable and
  npm reports the patched range as `<0.0.0`, reached only through Storybook
  build tooling; they are accepted in `pnpm.auditConfig.ignoreGhsas` with a
  written reason and bound by a test that fails if the manifest silences an
  advisory with no reason, if a new high advisory appears, or if `image-size`
  publishes above the 2.0.2 that justified the acceptance. A dependency marker
  is a claim about a moving external set, so it is true as of the last run and
  not durably.
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
- **P0-41 — Commitment ledger write path `[COMPLETE]`:** the write path exists
  and is reached from production, and the ledger row that held this open has
  been re-derived. `supabase/migrations/001320_commitment_ledger_write_path.sql`
  adds the correction and allowance-adjustment streams; `createCommitmentPeriod`
  is called from the production create path and from renewal; `usage_events` are
  written under the provider dedup index; and `decideCommitmentOverage` and
  `reconcileCommitmentToSource` are reached from production in
  `packages/db/src/repositories/core/commitments.ts` rather than only from a
  domain test. The verbs are admitted over the API, and P0-54's closure removed
  the failure that had made every one of those commands dead in production. The
  marker waited deliberately for `SPEC-10-02`: flipping a backlog entry to
  `COMPLETE` while a requirement row still references it is exactly what
  `TRACEABILITY_BACKLOG_COMPLETE_STILL_MAPPED` refuses, and that row was
  re-derived against this implementation in `5c0f727`. Spec §4 step 10 and §10.
- **P0-42 — Missing reporting-layer reports `[COMPLETE]`:** closed in `bd42c1b`,
  and the entry understated one half while overstating another. ARR/MRR already
  had a function (`recurringRevenue`); only its catalogue entry and API key were
  missing. Billing-and-collections and commission-and-settlement were genuinely
  absent and are now SQL views in
  `supabase/migrations/001396_reporting_layer_completion.sql` with pgTAP
  coverage in `supabase/tests/1396_reporting_layer_completion.test.sql`. The
  real defect was reach rather than absence: all three were in neither the
  `internalOnly` list nor the runtime grants, so a tenant holding `report:read`
  — an `owner` on a partner account is one — passed the account-scope check and
  hit a naked `42501 permission denied for view core_commission_settlement`
  rather than a typed refusal. `001397_report_audience_grants.sql` decides each
  of the three, and
  `supabase/tests/1397_report_reach_and_partner_credit.test.sql` pins the grant
  half against the refusal half so the two cannot disagree again.
- **P0-43 — Missing exception queues and split queue vocabulary `[COMPLETE]`:**
  closed in `bd42c1b`, and worse than the entry said. There were not two
  competing `ExceptionQueue` declarations but **four**, one of them a disjoint
  six-member union sharing exactly one value with the others, so a
  workflow-raised exception could not resolve an owner from the roster at all.
  One vocabulary now, bound behaviourally rather than by inspection, with a
  database check constraint in
  `supabase/migrations/001395_exception_queue_vocabulary.sql` and an integration
  test
  (`packages/db/src/repositories/lifecycle/exception-queue-vocabulary.integration.test.ts`)
  that reads an owner, backup and escalation contact back out of
  `exception_cases`. One overstatement not to repeat: the binding is
  behavioural, not structural. `packages/api/src/routes/lifecycle/types.ts` and
  `packages/db/src/repositories/lifecycle/schemas.ts` still carry hand-written
  subset literals that import nothing, so a drift there surfaces at runtime
  through the behavioural tests and the check constraint, not at compile time.
- **P0-44 — CRM projection has no runtime caller `[COMPLETE]`:** closed in
  `bd42c1b`. The outbox consumer and the `accounts.crm_record_id` write are
  composed in
  `packages/workflows/src/runtime/environment-production-adapters.ts`, behind
  `GuardedProviderJsonTransport` so the upsert is denied from persisted
  `EXT-ACC-01`/`EXT-PROVIDER-01` state before any network work. Be exact about
  what that means: the path is present and **inert** until the CRM provider gate
  is active, and it is tested against the deterministic fake
  (`packages/db/src/repositories/system/crm-projection.integration.test.ts`,
  `packages/integrations/src/crm/crm.contract.test.ts`), not against a provider.
  Live projection remains `EXT-PROVIDER-01`. Spec §15.
- **P0-45 — Tax identifier validation and reverse charge `[COMPLETE]`:** closed
  in `ca70c0c` together with P0-61, and completed later: `ca70c0c` gave
  `validateTaxId` a real production caller in `verifyRegistrationTaxIds` and a
  writer for `core_account_tax_identifiers`, but the only production
  construction of `DatabaseLifecycleCommandRepository` never passed the `tax`
  port, so every registration carrying a tax identifier threw
  `REGISTRATION_TAX_VERIFIER_UNAVAILABLE` **even with `TAX_PROVIDER_BASE_URL`
  and `TAX_PROVIDER_TOKEN` configured**, and that table had no reachable
  production writer at all. A real caller behind a port nothing injects is the
  shape this repository has now produced several times, and a green suite did
  not show it — only reading the composition did. The port is now injected from
  the same `composedTaxProvider()` instance the finance service receives. Where
  no verifier can answer, a registration **succeeds** and the identifier is
  recorded honestly as unverified — `validation_status` `pending`, null
  `validated_at`, never reverse-charge eligible — because a tax identifier on a
  registration is reference data rather than an authorization decision, and
  refusing would block every legitimate registration in a jurisdiction where no
  verifier exists. Nothing downstream mistakes that row for evidence:
  `identityIsVerified` refuses any unverified identifier and tax determination
  selects only `validation_status = 'valid'`. Two deliberate asymmetries, both
  typed refusals rather than bare throws: a provider that affirmatively rejects
  an identifier answers 422, since that is a wrong value rather than a missing
  verifier, and a transient provider failure answers a retryable 503, since one
  retry buys a verified row instead of permanently weaker evidence.
  Reverse-charge treatment is determined. No rate, country list or exemption
  rule is written into shipped code, and the mechanism that guarantees it has
  since changed in a way worth recording, because the earlier phrasing no longer
  describes the code. Determination was originally a provider port, refused
  fail-closed behind `EXT-TAX-01` so that an unconfigured provider could not
  issue a zero-tax invoice. It is now made by the engine in `@clockwork/domain`
  from `core_tax_rule_books` and `core_tax_registrations`. That is a stronger
  guarantee rather than a weaker one: an optional port is absent in production
  and silently zero everywhere else, whereas a missing rule book is a refusal
  that cannot be mistaken for a zero rate. Rates remain versioned data an
  authority supplies, never literals in shipped code, so `EXT-TAX-01` still
  names a real external input — the approved policy — and the port itself
  survives only as a vestigial optional field, documented as read by nothing,
  because three compositions outside that lane's scope still pass it. Spec §4,
  §10 and §19.
- **P0-46 — Notification delivery record `[COMPLETE]`:** closed across three
  commits, and the entry's lead claim was already stale when it was written.
  `supabase/migrations/001330_notification_deliveries.sql` creates
  `notification_deliveries` with recipient array, template, alert kind, provider
  message identifier, failure code and an append-only trigger, written on every
  lifecycle notification effect; `packages/workflows/src/quotes/tasks.ts:4`
  registers `quoteExpiryAlertsTask` on cron `45 * * * *`. The genuine residue
  was the §18 API catalogue and the account surface, both closed after it:
  `bd42c1b` added the notification operation and preferences with the generated
  OpenAPI regenerated rather than hand-edited, and `5897196` added the
  preferences page at
  `apps/web/app/(experience)/(customer)/account/notifications/`, without which
  this entry could not close. Spec §4, §11, §12 and §18.

## P0 — findings from the 2026-08-14 independent audit

These entries were new repository findings from an independent audit of `main`
at `5cc5fdd`. Each named a file and line and survived an adversarial pass whose
default was to refute. Ten work-stream pull requests then implemented them, and
the implementations disagreed with the audit often enough that the disagreements
are recorded here rather than smoothed over: four findings were refuted outright
and are pinned in their own section below, and several of the entries that were
real were wrong about scope, cause or blast radius in ways the closure notes
name.

- **P0-47 — The release gate cannot pass and one browser suite never runs
  `[COMPLETE]`:** closed in `0f68e36`. The entry was exact:
  `RELEASE_SUITE_NAMES` declared seven suites, the workflow matrix defined six,
  and `validate-release-join.mjs` requires the counts to agree before it sets
  `report.accepted`, so the gate job could not pass however green the shards
  were. The missing shard was `demo`, whose spec is the only coverage of the
  public demo password gate. `.github/workflows/ci.yml` now defines all seven,
  with `demo` on port 32006 pinned to `macos-15` because `playwright.config.ts`
  refuses that project off Darwin and its snapshots are darwin-only. The test
  that was actually missing is the binding: nothing held the workflow matrix and
  `RELEASE_SUITE_NAMES` in agreement, and `scripts/release-artifacts.test.mjs`
  now parses the workflow and asserts they are equal in name and order, verified
  by mutation. The README describes seven shards. A second instance of the same
  defect class was found and closed in `a1f89e6`: `pnpm test:unit` and the
  release `unit` shard were two independent lists of the same `node --test`
  files, so suites added locally would never have run in CI; the release suite
  now derives that list from `package.json` and the derivation is
  mutation-checked. What this does **not** establish is that the gate passes:
  satisfiability was proved by running `validate-release-join.mjs` over
  synthetic per-shard summaries, because Actions has not run — see P0-48.

- **P0-48 — `main` has no observed green continuous-integration run
  `[EXTERNAL-ONLY]`:** the five repository defects are fixed; the observation is
  not, and cannot be from inside this repository. Fixed in `0f68e36`, with two
  corrections to the entry. The heap ceiling was real —
  `NODE_OPTIONS=--max-old-space-size=3072` reproduces the SIGABRT locally with
  3047 MB live, so the type-aware lint peak is above 3 GB and the CI default is
  under it; the workflow now sets 6144. The registry was **not** Docker Hub:
  "toomanyrequests: Rate exceeded" is ECR Public's anonymous-pull message and
  the Supabase CLI defaults to `public.ecr.aws`, now pinned to `ghcr.io`, whose
  manifests are byte-identical for the images used. The integration failure was
  not in the migration fixtures either: `supabase/seed.sql` set
  `invoices.amount_paid_minor` unconditionally and the populated-upgrade drill
  replays that seed against `001230`, where the column does not yet exist, so
  the whole reset aborted on 42703; it is guarded on the column and the drill
  now runs and accepts. The two proof-shard authorization failures were test
  fixtures rather than product — hand-seeded partner payloads that did not
  satisfy the shape `dashboardRecord()` requires. The `ui` claim and the mobile
  drawer inside it did not reproduce at all; see the refuted section. Poppler
  exists on the qualification machine, which is where every recorded run of the
  semantic-PDF verification has happened, and the workflow itself installed
  none, while `packages/documents/src/semantic-pdf.integration.test.ts` spawns
  `pdftotext` unguarded — so the first observed `integration` shard would have
  died on a bare spawn `ENOENT` naming nothing. The shard now installs
  `poppler-utils` and asserts `pdftotext -v` answers, in a step conditioned on
  `integration` alone, placed so the failure names itself rather than surfacing
  as an unreadable test error. That was the last repository-side caveat behind
  `EXT-ACC-01`.

  What remains is external: **no CI run has been observed.** Actions is
  billing-blocked on the organization — the 2026-08-10 run (id 31346389931)
  stopped all seven jobs within twelve seconds reporting failed account payments
  or a spending limit, and nothing has executed since, so all ten work-stream
  pull requests were merged without a CI result and every figure they record is
  local. The `EXT-ACC-01` row now names this remainder exactly: Actions billing
  in good standing on the organization, one observed green run of the release
  workflow on `main`, and branch-protection administration to require that run
  before merge — none of which this account can supply, since it holds no
  organization admin. `SPEC-18-VAL-02` sits behind that gate. The activation
  test is the run itself: `scripts/release-artifacts.test.mjs` holds the
  workflow matrix equal to `RELEASE_SUITE_NAMES` by mutation-checked parsing,
  and `validate-release-join.mjs` refuses a partial shard set, so once billing
  is restored the observation either happens or fails loudly. No repository-side
  caveat remains: the Poppler step above was the last one.

- **P0-49 — Accepted amendments persist no money `[COMPLETE]`:** closed in
  `ca70c0c`, in four rounds, three of which shipped a control that then had to
  be repaired. All three tables now persist inside the header's transaction, the
  superseding identifier is set on each superseded order line, and both invoice
  writers add the net delta. Verified arithmetically against the database: +1
  unit at 10000 full-period, 333 of 364 days remaining, 9148 billable, invoice
  189148 = 180000 + 9148, run-rate 833; downgrades stay negative and unclamped.
  Two of the repairs were regressions this work introduced and are worth knowing
  about. `001390`'s constraint compared the invoice amount against a **live**
  sum of amendment deltas while `invoices_projection_truth` fires on UPDATE, so
  once any amendment landed after an invoice every later update to that row was
  rejected — including the Stripe settlement projection, which meant a customer
  paid, the payment could never be recorded, and the invoice went to dunning;
  `001393` stores the delta applied at write time so the predicate is invariant
  over the row's lifetime, and backfills rows already trapped. And validating a
  new amendment against the current amended state was right, but the fold ran
  twice and the second fold saw only the order's own lines, discarding revenue
  from an amendment-added line, so a legitimate line swap bricked the order for
  every later amendment including ones moving no money; it now folds once. The
  entry's variance claim was also vacuous — `deriveInvoice` compared a NET total
  against a GROSS amount, so every taxed invoice reported a permanent variance
  carrying no information — and `core_invoice_amendment_drift` (`001394`) is now
  the exact tax-free signal at rest. Two modelling gaps this did not close are
  recorded under the open residue. Spec §12.

- **P0-50 — Customer self-service forms demand identifiers no customer can
  obtain `[COMPLETE]`:** closed in `26ac061`. The entry was right and its first
  fix was not. Fixing the five routes it named left `/partner/portfolio/[id]` —
  also named in the entry — still rendering empty required identifiers with
  Submit posting nothing, plus `/partner/brand` and `/internal/queues/[id]` with
  the same hole, because `context` was **optional** and nothing forced a mount
  site to supply it. It is now required, so the compiler forces every mount
  current and future; that was verified by writing a mount without it and
  quoting TS2741, and by confirming no call site launders the type with a cast
  or a spread. All ten mounts were then enumerated by grep rather than from a
  list and driven in a real production build in headless Chromium: zero
  required, non-readOnly, empty record identifiers anywhere, and no fixture UUID
  survives in the client bundle. `demoValue`, the `ids` fixture map,
  `demoFallbackAllowed` and the "Development simulation accepted" branch are
  gone. Where a route genuinely cannot supply an identifier the surface refuses
  rather than posting — forcing the disabled control and calling
  `requestSubmit()` directly both produce nothing on the wire, which matters
  because `checkValidity()` is true in that state and constraint validation
  alone would not have stopped it. `WorkflowRecordContext` also declared
  fourteen identifier keys where routes supplied five; `rowVersion` is removed
  as a concurrency token rather than a record identity, and each remaining key
  is read by a live branch.

- **P0-51 — E-sign binding writes the envelope's version as the agreement's
  aggregate version `[COMPLETE]`:** closed in `26ac061`, having been dropped by
  every work-stream before it. `persistProviderBinding` wrote the envelope's row
  version as the agreement's aggregate version, feeding two counters into one
  sequence that `000001_foundation.sql:869` declares unique. The entry named one
  site; there are two occurrences and only one is a defect — the other is a
  genuine organization aggregate and is left alone. It is also worse than the
  entry said: the envelope is always inserted at 1 and this is always its first
  update, so it always reaches 2 while the draft is already at 2, meaning
  **every** production signing session hit the 23505, not only the
  counter-signed flow. That was confirmed by reverting the fix and capturing
  `duplicate key value violates unique constraint "audit_aggregate_version_unique"`
  with params showing `agreement,…,2`. The class had no test at all; it now has
  five. Note the reason this guaranteed collision was never observed in
  practice: `create_signature_envelope` cannot execute at all on a tenant route,
  which is recorded under the open residue.

- **P0-52 — The invoice payment surface is bound to one fixture invoice
  `[COMPLETE]`:** closed in `26ac061`. `PaymentHandoff` posted a literal account
  and invoice for every invoice a customer opened and rendered one amount and
  due date as markup; the session is now opened for the record on screen,
  confirmed off the wire in a production build. One caveat on the evidence: the
  demo store holds exactly one open invoice whose amount and date match the
  deleted literals, so screen text proves nothing here and only the request body
  discriminates.

- **P0-53 — Nothing prevents several full-value invoices for one order
  `[COMPLETE]`:** closed in `ca70c0c`. `mutateInvoice` took a caller-supplied
  identifier and plain-inserted at the full quote total with no uniqueness
  guard, while the workflow writer used a deterministic identifier with
  `onConflictDoNothing`, so two posts with fresh idempotency keys produced two
  full-value invoices, each independently issuable and each unlocking a fresh
  full-invoice credit allowance. The two writers now agree. What was actually
  done is narrower than the entry's prescribed fix and is recorded as what it
  is: there is no database unique index on `invoices(order_id)`; the guarantee
  is the shared deterministic identifier both writers derive, enforced through
  the primary key. Adequate, and not the index the entry asked for.

- **P0-54 — Commitment and price-book commands set the service role on the
  tenant connection `[COMPLETE]`:** closed in `ea4ab89`. One call site now uses
  `pricingDatabase`. It was deliberately **not** fixed by granting
  `clockwork_runtime` membership in `clockwork_service`, which the entry also
  warned against: `app_is_internal()` is literally
  `current_user = 'clockwork_service'`, so that grant would hand the tenant pool
  a standing exit from row-level security. Proved at the HTTP boundary against
  two real Postgres logins with genuinely separate role membership, because the
  existing price-book integration test passes
  `database: db, pricingDatabase: db` over one superuser connection and
  therefore could never have caught it. The guard that now watches for
  recurrence is weaker than it looks and is recorded under the open residue: it
  is a deny-list of one role name, and the static scan matches two literal
  spellings only. Spec §18.

- **P0-55 — Every WorkOS webhook delivery fails verification `[COMPLETE]`:**
  closed in `ea4ab89`, and **the entry's prescribed fix was wrong and is not
  applied.** `@workos-inc/node` is pinned to 10.9.0, which decodes a
  `Uint8Array` through `TextDecoder`, so passing raw bytes is correct. The real
  defect was `tolerance: 300` against an API that counts milliseconds, so every
  delivery was rejected unless it arrived within 300ms and no
  role-synchronisation event was ever ingested. Fixing that exposed two further
  holes, both found by attack rather than review: a blank `t=` was accepted
  forever, because `Number("")` is 0, which a future-bound waves through, while
  `parseInt("")` is NaN, so the SDK's past-bound never fires either; and the
  header timestamp was validated **by key** while both SDKs select it **by
  position**, never checking the field is named `t`, so given
  `x=<far future>, v1=<signature over it>, t=<now>` the two readers disagree and
  this validated the fresh field while the SDK authenticated and range-checked
  the far-future one. Both parses now select the same bytes. The class had no
  test at all; it now has 23.

- **P0-56 — Operator webhook replay clears the processed marker and enqueues a
  task no worker implements `[OPEN]`:** the damage is stopped; the capability is
  not delivered, and this entry stays open on purpose rather than being flipped
  on a refusal. The entry was exact — replay nulled `processedAt` and enqueued
  `webhook-replay:<provider>`, which no task implements, so an incident was
  closed as handled while nothing ran and the row lost its dedupe guard, letting
  a provider redelivery re-enter the projection. `ea4ab89` made the command
  **fail closed**: it does not touch the inbox row, and
  `packages/db/src/repositories/core/webhook-replay-refusal.test.ts` requires a
  typed error naming the missing task identifier and requires that no
  transaction is opened, so the dedupe marker survives. `bd42c1b` rebuilt the
  tripwire in the same file on the TypeScript AST — it now catches a task id
  written as a literal, as a constant reference, or as a factory argument, which
  the previous regex missed — and it asserts the identifier is **absent** from
  the production registry, so the day someone registers the task the suite says
  to delete the refusal.

  What remains: no task re-runs the stored verified payload, so an operator
  facing a stuck provider event still has no working replay and the runbook step
  in `docs/operations/webhook-replay.md` is not executable from the surface.
  Registering it belongs to the workflows lane and was deliberately not taken by
  the security lane. A separate composition defect on the same surface —
  `webhook-replay/actions.ts` composing `requiredTaxProvider()`, which throws at
  composition, so an unwired `EXT-TAX-01` refused every replay before this
  entry's refusal could even run — was fixed in `5c0f727`: the action now
  composes `composedTaxProvider()`, which refuses `calculate` without detonating
  the composition, verified at the emitted-JS level of a production build. That
  was never this entry, and its fix delivers no replay.

- **P0-57 — `mfaVerified` records an environment allow-list, not a second factor
  `[COMPLETE]`:** closed in `ea4ab89`. The boolean tested whether an
  organization is _configured_ to require a second factor rather than whether
  this session _completed_ one, and it was persisted to
  `experience_projection_action_requests.mfa_verified` and re-trusted by the
  asynchronous executor without recheck. The assurance claim is now read
  directly from AuthKit and the organization allow-list is only a further
  restriction.

- **P0-58 — Ten lifecycle tasks are never enqueued and execute inside the outbox
  cron `[COMPLETE]`:** closed in `bd42c1b`. A real submitter is passed, so the
  retry policy and per-task queue configuration are no longer inert and one slow
  provisioning call no longer starves every message behind it. Two things about
  the closure are worth keeping. The binding assertion is **behavioural**: the
  event-driven and scheduled partition is derived from which SDK factory each
  module actually called, so a fictional registry entry cannot satisfy it —
  which matters because three separate attempts at a binding test elsewhere in
  this pass were each evaded by a declaration standing in for an implementation.
  And carrying the invocation key across the queue hop turned out to be
  load-bearing rather than cosmetic: `dead-letter-dispatch` joins
  `workflow_runs` to `outbox_messages` on `outbox:<id>`, so without it every
  operator redrive of these ten would have returned unmapped. Spec §18.

- **P0-59 — The portal offers commands that are not implemented `[COMPLETE]`:**
  closed in `ca70c0c`, and the count was wrong in the safe direction: **six**
  advertised verbs threw `INVALID_STATE`, not five — `mutateInvoice` never
  handled `issue` either. `quotes:revise` is implemented; the rest are withdrawn
  from both the projection definition and the service catalogue, so the
  advertisement and the implementation now agree. Three attempts at a binding
  test were each evaded by _declaring_ a verb rather than implementing one — the
  same defect class as P0-47 — so the binding that shipped invokes all 45
  advertised verbs through the repository and requires something other than an
  unsupported-transition refusal, which a declaration cannot satisfy.

- **P0-60 — Updating a procurement profile erases its certificates
  `[COMPLETE]`:** closed in `ca70c0c`. `mutateProcurement` read `input.action`
  only to reject a duplicate create and then rebuilt the whole row from the
  payload, defaulting every absent key, so adding one exemption certificate
  deleted every previously validated certificate, reset `poRequired` and emptied
  `supplierDocuments`. It now branches on the action and patches present keys.
  Spec §4, §19.

- **P0-61 — No tax is calculated or stored anywhere `[COMPLETE]`:** closed in
  `ca70c0c` and then repaired in `5897196`, and the entry's lead claim was
  wrong. Tax columns already existed on three `core_` tables, written as a
  hardcoded zero. What was true is that `invoices` had no tax column,
  `TaxPort.calculate` had zero callers, and the provider composition had no tax
  slot; all three are closed. No rate, country list or exemption rule is written
  into shipped code — acceptance in a tax-bearing jurisdiction fails closed
  behind `EXT-TAX-01` rather than issuing a zero-tax invoice.

  The repair matters more than the closure. The first shape of this gate made
  the whole `DatabaseCoreFinanceService` composition conditional on
  `TAX_PROVIDER_BASE_URL` and `TAX_PROVIDER_TOKEN`, which existed nowhere in the
  repository, so `POST /v1/core/commands/*` answered 500 "Core-finance route
  dependencies are not configured" on **every** surface, customer and partner
  alike, before permissions, payload or row policies were consulted. Six pull
  requests merged green over that, and the demo would have deployed with every
  core command dead. The entry asked to gate acceptance in tax-bearing
  jurisdictions; it did not ask for the service to be decomposed. The gate now
  sits where the risk is: an unconfigured provider **refuses** rather than
  vanishing, and the refused set is exactly `orders:create` and
  `invoices:create` — the only two verbs that reach a tax determination and the
  only place `tax_minor` is written. `GET /v1/core/status` went from
  `{"service":"missing"}` to `{"service":"database"}`. `TAX_PROVIDER_*` is in
  `.env.example` and the deploy runbook, with the documented-environment
  fingerprint recomputed from 95 to 97 variables. One consumer of that
  composition was left broken and is recorded under the open residue. Spec §10,
  §19.

- **P0-62 — The partner quote builder carries a fabricated deal, a fixed partner
  identity, and an expiry default that lapses on 2026-08-31 `[COMPLETE]`:**
  closed in `26ac061`, with the write path finished in `5897196`. Identity and
  options now resolve from the session, and a two-partner crossover check shows
  zero leakage in either direction. The expiry default is derived rather than
  hardcoded and is still correct with the clock pinned to 2031.

  The builder could not actually complete a write when `26ac061` shipped, and
  that was recorded rather than hidden; `5897196` found the cause and it was
  structural. `persistQuoteDraft`'s INSERT into `quotes` used `RETURNING`, and
  Postgres requires the new row to satisfy the SELECT policies. `quotes_read`
  admits a partner only through `core_quote_is_visible`, a SECURITY DEFINER
  function that re-queries `public.quotes` by id — and inside the insert's own
  statement snapshot the row does not exist, so 42501. A direct customer quote
  succeeded because the inline arm evaluates against the new row itself. The fix
  drops `RETURNING` and re-reads in a following statement, the pattern
  `audit-outbox.ts:65` already documents for the same reason. The migration
  alternative was **declined**: it would have widened partner SELECT visibility
  as a side effect of fixing a write. This was the third instance of one class
  in this pass, after P0-54 and `create_signature_envelope` — a write path
  composing a database interaction the row policies refuse — and it survived
  because the only success-path partner-quote test ran against
  `MemoryCoreFinanceService`, which has no row-level security and no
  `RETURNING`, while every database-backed partner test is a rejection case that
  dies before the insert. There is now an integration test that drives a partner
  quote under a real signed authorization context with policies live and reads
  the row back. One residue found later and not fixed here: the **customer**
  quote builder still ships fixture selector UUIDs in the client bundle — the
  partner builder's fix did not cover it, and P0-50's bundle claim was about the
  ten workflow mounts, not this surface. Recorded under the open residue.

- **P0-63 — Internal surfaces render fixtures beneath explicit provenance claims
  `[COMPLETE]`:** closed in `5897196`, and the closure is split two ways because
  the honest answer differs per surface. Collections, provisioning and reports
  now read the channels the materializer was already producing. Renewals has
  since been wired to the internal `orders` channel — renewal work rows are
  orders, and the page says so — superseding the honest-unwired state this entry
  first shipped for it. Migrations still has **no backing channel at all** and
  still says so, rather than printing a freshness claim over a constant — which
  is the entry's own remedy ("delete the freshness and source strings and render
  an unmissable unwired state"), not a wiring. The false provenance strings —
  "Collections ledger refreshed 3 minutes ago", "Operational snapshot refreshed
  4 minutes ago", "operations · live provider state" — are gone from all eight
  pages, which was the aggravating factor the entry identified. Two loose ends
  were found while doing it: the collections `WorkflowPanel` branch, reported as
  retired by an earlier round and still standing, was sending a payload shape a
  `.strict()` schema rejects, so it could never have written either, and is now
  gone; and adding `services/[id]` activated dead code in `nextStep`'s services
  branch, which linked to `/account/offboarding` with the aggregate id while
  offboarding selects on `recordKey` from a different channel — byte-identical
  pages with and without the parameter. That fix is bound by a test constructing
  the materialized payload shape, because under the demo adapter a record's id
  _is_ its record key, so a lazy fix would have looked correct in a production
  build and still been wrong. The collections **corrections** surface named in
  P0-68 is a different thing and was delivered separately; see that entry.

- **P0-64 — The downloadable CSV escapes fewer formula prefixes than the
  workflow export, and the test that proves otherwise runs against dead code
  `[COMPLETE]`:** closed in `ca70c0c`. The API download escaped `/^[=+@-]/`
  while the workflow export also escaped whitespace-prefixed formulas, and the
  test establishing formula safety exercised `toCsv`, which nothing but that
  test references. Collapsed onto one writer with the assertion moved onto the
  HTTP response body, including the whitespace-prefixed case. Spec §17.

- **P0-65 — Unauthenticated idempotency records share one namespace and replay
  whole responses `[COMPLETE]`:** closed in `ea4ab89`. Every caller of the one
  route reachable without a session shared the scope
  `anonymous:/v1/lifecycle/registrations`, and the store replays full bodies for
  twenty-four hours, so reusing another registrant's key returned their account,
  organization and user identifiers. Anonymous callers no longer receive a
  cached body and the scope is request-bound. Transient failures are no longer
  cached for a day either, which also closes the P1 entry on that.

- **P0-66 — The telemetry ingest is unauthenticated, unmetered, and accepts
  caller-chosen trace parentage `[COMPLETE]`:** closed in `ea4ab89` after three
  successful attacks, two on the first control and one on its repair. The ingest
  now requires a signed grant and is metered, caller-supplied trace parentage is
  refused, and the error bodies are RFC 9457. The attacks are the evidence that
  the current shape is not the obvious one. The grant was first minted from the
  proxy's own span — but that span adopts `traceparent` from the request, so the
  server was signing the trace id the caller named, and
  `curl -H 'traceparent: …aaaa…' /demo` returned a valid grant for that trace
  with a forged span on it accepted. The meter keyed on a session the demo
  resolver fabricates from the caller-supplied `x-clockwork-persona` header,
  giving nine rotatable buckets. And the repair's grant-signing key fell back to
  `CLOCKWORK_DEMO_ACCESS_PASSWORD`, the password handed to every demo visitor,
  so a visitor who knew it could mint a grant naming any trace — proved end to
  end against a production build. That fallback is removed, the key floor is 32
  bytes, and `CLOCKWORK_TELEMETRY_INGEST_SECRET` is documented.

- **P0-67 — Currency and money sign are unconstrained on ten commerce tables
  `[COMPLETE]`:** closed in `a1f89e6`. The entry's currency half was exact; its
  money half was wrong in three places, and the corrected set was re-derived
  against the live schema before anything was written. Nineteen tables gain a
  vocabulary check reusing `accounts_currency_check`'s exact
  `('USD','EUR','GBP')` list rather than a second one — the ten the entry named,
  including `price_books`, plus nine `core_*` tables it missed. Every writer was
  traced first: the Stripe, marketplace, commission and allocation paths all
  normalise or parse through `CurrencySchema` before insert, so no live writer
  can produce a value the check rejects.

  The three money corrections are the reason a blanket fix would have been
  wrong. `commission_accruals` is **not** touched — its money columns already
  carry a deliberately _directional_ check (`>= 0` for payment and
  `credit_note_void` sources, `<= 0` for adjustments) and a blanket `>= 0` would
  have broken clawbacks. `quote_lines` and `rate_cards` were already half
  covered, leaving only `line_total_minor` and `floor_price_minor` open. And
  `amendment_lines.price_delta_minor` stays **signed**: it is a delta, and
  `packages/domain/src/core/amendments/index.ts:156` requires a downgrade's
  quantity delta to be negative, so a non-negativity check would reject correct
  data. Thirteen columns gain a check — an earlier count of eleven here omitted
  the constrained pair on `order_lines` — and the pgTAP proves _enforcement_
  rather than existence — every assertion attempts a violating write and
  requires it to be rejected, and dropping the constraints on a live database
  turns 26 of them red. Spec §18, §19.

- **P0-68 — Three customer and partner journeys have no working path
  `[COMPLETE]`:** two of the entry's named journeys were already delivered when
  it was written, one of its claims was stale that same day, and the journey
  that really was broken turned out to be worse than any phrasing this entry
  used. All of it now closes.

  `recordRoute` is closed. It returned `/services` for the services channel with
  no `services/[id]` route, so every row on the live-entitlements surface linked
  to itself; the route exists and `recordRoute` now returns a typed `Route`
  alias rather than `string`, with the `as Route` casts gone. Be precise about
  what that type buys, because the commit that shipped it was: `RouteImpl`'s
  first three members are unconditional, so the alias does **not** bind the
  channel set to the route tree — the original defective body recompiles clean
  under the new type. A unit test holds that direction, and the code comment now
  says so instead of promising a guarantee the compiler does not give.

  "Nine workflows mounted on no route" was wrong as one population. A design
  review established it is **two**: seven are superseded, because purpose-built
  record-bound surfaces already exist for quote, agreement, order, offboarding,
  payment, pricebook and assisted, so those panel branches are **deleted**
  rather than mounted. Each supersession was verified against its replacement
  first and none lost a live capability. Mounting them would have built seven
  duplicates alongside the real surfaces, and leaving them standing is what made
  one cause present as nine findings.

  Deal-registration create is **delivered**, and the claim that it was missing
  was stale on the day it was written: `5897196` — the same commit whose own
  body records it as undelivered — mounts `DealRegistration` on
  `/partner/registrations` behind `partner:quote:write`, with identity derived
  from the session, the end-client roster read under row-level security rather
  than a picker over fixtures, an empty roster rendered as a named state instead
  of a Submit over nothing, and `deal_registrations:create` implemented in the
  finance repository alongside `approve`, `reject`, `extend` and `convert`. The
  **collections corrections surface** is likewise delivered in that commit:
  `apps/web/src/features/internal-ops/collections-corrections/` is wired into
  `/internal/collections`, and its three corrections map onto implemented verbs
  — `credit_notes:issue`, `refunds:submit`, `disputes:create`.

  The third journey was worse than the "two-pass refresh gap" this entry used to
  call it: **no customer could complete an order acceptance at all**, and the
  live database proved it — every order in the table carried its fixture's
  acceptance instant, so the journey had never once completed anywhere. The
  binding half was already sound: the prepared order form is hashed over one
  acceptance instant and the create pass refuses a different hash. But
  `mutateOrder`'s create branch also required
  `Date.parse(command.acceptedAt) === Date.parse(input.occurredAt)`, and for any
  HTTP caller `occurredAt` is the API's own receive instant, while the surface
  must resend the prepare-pass `acceptedAt` precisely because the hash covers
  it. Two correct controls, mutually unsatisfiable.

  The repair makes `orders:create` behave the way its siblings already did.
  Amendments — the two-pass resource that moves real money through deltas — and
  `quotes:issue` both take a documentary timestamp with no clock check, relying
  on the hash binding alone; `orders:create` was the only member of the family
  with a clock equality stacked on top of the binding it duplicated. A sweep of
  every timestamp comparison in the database, API and domain packages found no
  other instance, so this generalizes to nothing. `acceptedAt` is now
  documentary and carried from prepare to create; expiry is enforced against
  `occurredAt`, which is what the refusal message always described; and the four
  operational fields that had been quietly drinking from the merged value are
  keyed on server time. One of those matters on its own: `boundAt` resolves the
  selling entity by UTC date, so a documentary instant straddling midnight would
  have let the buyer influence which legal entity sells them the order.

  Two things worth recording because they nearly went wrong. Deleting the
  equality **alone** does not fix this — it trades the clock refusal for
  `COMMERCIAL_ARTIFACT_BINDING_INVALID`, which would have been the fourth
  consecutive narrower instance of the same defect on this one bridge; the
  regression test is pinned against that reversion specifically, not only
  against the original. And an "acceptance cannot predate quote issuance" lower
  bound is **wrong** here however obvious it looks: the deployed fixtures accept
  before they issue, so adding it fails the suite wholesale.

  The test this needed did not exist in any form. Every prior integration test
  pinned `occurredAt` equal to the fixture `acceptedAt` and every surface test
  stubbed the send, which is exactly why a journey that had never worked looked
  covered. The new one drives both passes with a real clock gap between them and
  asserts the order carries the documentary instant from pass one alongside
  server-time facts. Spec §4, §8, §12, §14.

- **P0-69 — An error on any partner or internal route destroys the application
  shell `[COMPLETE]`:** closed in `26ac061`. Per-group error boundaries mean an
  error on a partner or internal route no longer replaces the whole shell, and
  `loadCommercialRecord` now distinguishes absent-or-foreign from malformed,
  which makes the "Record not found" branch that was already written reachable.
  One design point that reads like an oversight and is not: a foreign identifier
  and a nonexistent one are deliberately indistinguishable from outside. That is
  anti-enumeration.

- **P0-70 — Migration start is reachable by a customer owner or admin
  `[COMPLETE]`:** closed in `ea4ab89`. The route required only
  `destructive:request`, which `owner` and `admin` hold, with no staff check at
  the route and none in `startMigration`, so a customer owner could drive an
  authenticated outbound request into the legacy source before any row policy
  intervened. Gated at both layers. Spec §21.

- **P0-71 — The traceability ledger cites unreachable code as evidence
  `[OPEN]`:** largely delivered, open on a narrower residue than it was filed
  with, and its prescribed remedy was wrong — the fifth wrong remedy in this
  audit. The prescribed rule, "every cited symbol resolves to a definition
  reachable from production", was tested before implementation against nine
  symbols it would have called dead, and every one had a genuine in-module call
  site; measured at the time, the ledger held 2,264 citations, none in
  `path#symbol` form and 1,777 of them prose labels with no symbol in them to
  resolve. The rule was unimplementable as written and wrong where it could run.

  What shipped instead, in `5c0f727` and wired into the gates in `8c53747`:
  `scripts/validate-traceability.mjs` now enforces a citation grammar — a
  `path#symbol` citation must name a file that exists and a symbol declared in
  it, a path citation must exist on disk, prose is grandfathered and the run's
  own report says so out loud — running inside `verify:static` on every ledger
  change. `scripts/check-citation-liveness.mjs` reports cited symbols with no
  non-test reference outside their defining file. The rows the entry named were
  re-cited to the evidence that actually ships — the capacity and scorecard
  reports are the SQL views `core_capacity_planning` and
  `core_weekly_scorecard`, and those rows now cite the views and name the dead
  citations they replaced. And the tooling's own tests, which on landing were
  run by no gate because `scripts/` is not a workspace package, were wired into
  root `test:unit` in `8c53747`.

  What remains open, exactly: the liveness half reports without gating —
  `check-citation-liveness.mjs` is deliberately outside `verify:static` because
  its false-positive behaviour is documented in its own header — so no gate yet
  enforces that a cited symbol is reachable; the prose corpus is grandfathered
  and converts row by row, with progress readable as `citationGrammar.symbol`
  over `citationGrammar.total` in every run's report; and no CI has ever
  executed any of it, which is P0-48's remainder, not this entry's. This entry
  closes when the liveness check either earns a place in a gate or is retired
  with a recorded decision; `SPEC-18-VAL-01` holds the ledger-side reference
  until then.

### Corrections to markers recorded before this audit

The 2026-08-14 audit re-derived every marker and recorded ten corrections. Each
has been re-checked against the current tree, because a correction can go stale
the same way the marker it corrects did, and six of the ten now have. What
follows is the surviving set; the corrections that are now spent say so rather
than being carried forward.

- **P0-02 `[COMPLETE]` still claims "zero unmapped or internally partial
  requirements", and that is still false — now by three rows rather than twelve,
  each held partial on purpose.** The twelve `partial` rows the audit found all
  pointed at P0-42 through P0-46 and were re-derived in `5c0f727` against what
  those closures actually shipped, with `path#symbol` citations the validator
  now checks; the two rationales the audit had already caught as stale
  (`SPEC-10-02`'s and `SPEC-18-API-08`'s) were rewritten with the rest. What
  remains is deliberate: three rows are held `partial` as the ledger-side
  mapping for the backlog entries still open — `SPEC-18-INV-06` (P0-56, the
  operator replay refuses), `SPEC-08-DOC-04` (P0-68, portal order acceptance
  cannot complete), and `SPEC-18-VAL-01` (P0-71, citation liveness reports
  without gating). The row count and the specification hash do check out. This
  marker cannot be honestly re-asserted until those three close.

- **P0-04 and P0-15 `[COMPLETE]` rest on evidence captured before the tree
  changed, and the drift is now much larger than the audit measured.** The cited
  commit `9464bab` is real and dated 2026-08-01; two experience-wide redesign
  merges landed on 2026-08-02 and rewrote `packages/ui/src/styles.css`,
  `packages/ui/src/components/shell.tsx`, all four story files and fourteen
  visual baselines. Ten further work-streams have landed since. The audit
  measured the gap against `docs/baseline/tests-baseline-artifacts.json`, but
  that manifest is itself a capture — `capturedAt` is `2026-08-02T20:06:37Z` —
  and it is now stale too: it records `pgTapFiles: 22` and
  `pgTapPlannedAssertions: 488` where the tree holds **38 files** and the last
  work-stream reports **785 assertions**, and `totalFiles: 269` against a tree
  that has grown since. So the entries disagree with the manifest, the manifest
  disagrees with the tree, and neither figure should be quoted. Both markers
  need re-earning from a fresh capture, not re-argument. Regenerate with
  `pnpm generate:baseline`.

- **P0-16 `[COMPLETE]` still names the wrong generated artifact.** The entry
  cites Drizzle `0004_nosy_valkyrie` and 116 tables;
  `packages/db/drizzle/meta/_journal.json` has nine entries with head
  `0008_complete_captain_stacy`, and `meta/0008_snapshot.json` holds **118**
  tables. Verified again against the current tree, unchanged. The OpenAPI half
  was correct at the audit and has since moved — `bd42c1b` regenerated it to add
  the notification operation — so the recorded path count and hash are now stale
  as well. Both halves need regenerating rather than editing. A genuine
  improvement landed underneath this entry in `a1f89e6`:
  `scripts/check-schema-drift.mjs` now compares the Drizzle model against the
  **live applied schema** — table presence, column presence in both directions,
  and nullability — and states in its own output what it does not cover, running
  in `verify:database` and in the release integration shard, the only shard with
  an applied schema to compare against. That checks the model against the
  database; it does not check this entry's recorded hashes against the tree, and
  nothing does.

- **P0-39 `[COMPLETE]`, "accepted in 93.813 seconds": half of this correction is
  spent and half stands.** The audit said the drill was broken on `main`. It is
  not any more — `0f68e36` found the real cause (`supabase/seed.sql` set
  `invoices.amount_paid_minor` unconditionally while the drill replays that seed
  against `001230`, where the column does not exist, aborting the whole reset on
  42703), guarded it on the column, and the drill now runs and accepts;
  `a1f89e6` and `ca70c0c` both re-ran it. That half is withdrawn.

  The fixture criticism stands, re-checked against
  `scripts/qualify-populated-upgrade.mjs`: `loadLegacyFixture` still inserts one
  account, one projection, one outbox message and two action requests, and the
  drill still measures elapsed wall-clock time and nothing about locks. So the
  93.813-second figure is a timing of a nearly empty table, and the entry's
  claim to establish _populated_ upgrade safety is not supported by what the
  script does. This is left as an honest note rather than papered over: fixing
  it means a fixture with enough rows to make lock behaviour observable and an
  assertion about locks rather than seconds, which is real work and is not
  claimed here.

- **Spent corrections, recorded so they are not re-derived.** Six of the ten no
  longer describe the tree and are withdrawn rather than carried: P0-34's mobile
  drawer, which did not reproduce and is pinned under refuted findings below;
  P0-46's lead claim, now folded into that entry's closure; P0-41's, spent in
  the other direction — its lead claim had already been overtaken by `001320`
  and the production write path, the entry was held open only by `SPEC-10-02`'s
  live ledger reference, and that row was re-derived in `5c0f727`, so the entry
  is `[COMPLETE]` above; and the P1 outbox and dead-letter recovery surface and
  the P1 derivation view, both of which the audit had already marked resolved
  and whose caveats — that P0-56 made the replay control report success without
  doing anything, and that P0-49 made the derivation view report every amended
  order as unamended — are respectively now-refused-instead-of-lying and fixed.
  The P1 runbook correction is spent too, in the good direction: all six named
  runbooks now have operator surfaces — `6cf5f26` added
  `/internal/unhandled-errors` and `/internal/billing-reconciliation`, the
  residue this correction carried — while its narrower point survives and is
  restated where it belongs: the finance-lifecycle review action at
  `apps/web/src/features/internal-ops/finance-lifecycle/review-action.tsx` is
  still review-only and applies nothing.

- **The "Accepted verification evidence" block is stale in every figure the
  audit named and several it did not.** The dependency-lock hash, the canonical
  Drizzle SQL and snapshot hashes (still those of `0004_nosy_valkyrie`, four
  migrations behind the journal head), the pgTAP figures (16 files / 431
  assertions recorded, 22 / 488 in the last manifest, 32 / 687 in the tree), the
  OpenAPI hash (moved when the notification operation was generated) and the
  Playwright and Storybook figures are all wrong. Regenerate the block from
  `pnpm generate:baseline` rather than editing it by hand, and stop reading it
  as a release gate — it is a local capture. It is left unedited here so it is
  regenerated once, from the tree, in the final commit of this pass.

## Refuted findings — pinned, do not reimplement

These four were reported as defects and are not defects. Three describe the
**documented contract**, and implementing two of them caused real harm before
being reverted: one put a privileged role on a customer organization's
membership row against the live database, and one would have rolled back every
subsequent order acceptance for a partner. The fourth did not reproduce at all.

They carry no status marker on purpose. `[OPEN]` is defined at the top of this
file as "the requirement is not met in this repository, and closing it is
repository work", which for these four is an instruction to do the harmful
thing; and deleting them loses the warning, which is the only thing of value
they now carry. This section is deliberately outside the format
`scripts/validate-traceability.mjs` parses, so nothing here can be mistaken for
a work item by a tool or by a reader.

Each entry names the claim, the authority that makes it the contract, what
actually happened when it was implemented, and the test that fails if it is
reimplemented. The last of those is the real artifact: the warning is only as
durable as the assertion behind it.

- **WorkOS role synchronization — "role changes are acknowledged but never
  applied."**
  - _Claim._ `packages/db/src/repositories/webhooks.ts` never writes
    `memberships.role`, so an identity-provider demotion leaves the old role in
    force.
  - _Authority._ `docs/adr/0004` is **Accepted** and says it twice: "WorkOS role
    slugs never grant commerce roles: membership webhooks link or revoke
    identity records, while commerce approval remains authoritative", and
    "WorkOS role webhooks synchronize identifiers into commerce; they do not
    grant access without a matching commerce membership."
    `packages/domain/src/identity/index.ts:138` carries the same contract in
    code. Membership webhooks link or revoke identity records; commerce approval
    decides roles.
  - _What happened when it was implemented._ Confirmed against the live
    database, not argued: writing the slug put **`internal_operator` on a
    customer organization's membership row**.
    `packages/db/src/repositories/identity.ts` selects `memberships.role`
    straight into the session identity through `resolveWorkosIdentity`, so
    `evaluateMembershipPolicy` — which is what refuses on
    `COMMERCE_APPROVAL_REQUIRED`, `STAFF_BOUNDARY` and `MFA_POLICY_REQUIRED` —
    never runs at all. An exploitable privilege escalation, granted from outside
    the commerce boundary. Reverted in `bd42c1b`.
  - _Pinning test._ Reimplementing this fails
    `packages/db/src/repositories/webhooks.test.ts:106`, "WorkOS membership
    webhooks never write `memberships.role`" — three cases: a role-change event
    must update `workosMembershipId` and `updatedAt` and nothing else; every
    slug spelling including `Internal-Operator` and `superuser` must be ignored;
    and revocation must delete the membership rather than downgrade its role. It
    also fails `packages/db/src/repositories/webhooks.integration.test.ts:97`,
    which asserts the same three against a real database.

- **Outbox dead-lettering — "messages with no registered handler are never
  claimed, retried or dead-lettered."**
  - _Claim._ `packages/workflows/src/system/outbox-dispatcher.ts` filters claims
    to registered topics, so an event whose handler is missing accumulates
    silently rather than surfacing.
  - _Authority._ The premise is false. The outbox is the durable delivery and
    **evidence record for the whole audit log**, not a work queue: per ADR 0005
    `audit-outbox.ts` appends an `outbox_messages` row inside the same
    transaction as every `audit_events` row and defaults the topic to the event
    type. The dispatch map is the exception, and `lifecycle-task-dispatch.ts`
    says so outright — "Only domain events with an immediate task have outbox
    dispatch mappings." Measured on a reset database: **82 distinct topics and
    roughly 250 unprocessed rows** against a production handler union under 40,
    with `core.accounts.create`, `core.quotes.create`, `core.orders.create`,
    `account.registered` and `security.assisted_action.*` all legitimately
    unhandled.
  - _What happened when it was implemented._ Dead-lettering the unrouted rows on
    a one-minute cron at `maxAttempts` 8 marches every audit-only row up the
    eight-attempt ladder, writes a `workflow_runs` row per message, stamps
    `OUTBOX_DISPATCH_DEAD_LETTERED` on rows working exactly as designed, and
    mutates `attempt_count` and `available_at` on the audit stream's own
    delivery record. It **buries the dead-letter surface the runbooks depend
    on** under hundreds of rows that are not incidents — the recovery surface
    added for the P1 operator entry becomes unusable in the incident it exists
    for. Reverted in `bd42c1b`.
  - _Pinning test._ Reimplementing this fails
    `packages/workflows/src/system/outbox-dispatcher.test.ts:233`, "never claims
    outside its registered topics, leaving audit-only rows untouched". The mock
    returns a stranded audit-only row for any _unfiltered_ claim, so a
    dispatcher that surveys the table to find things to fail on trips all three
    assertions: the run must report `{ delivered: 0, idle: true }`, every claim
    must carry the registered topic list, and `fail` must never be called. The
    contract and its reasoning are written out at `:209-232` above the test.

- **`accounts:set_partner_credit` — the one-sided credit-limit write.**
  - _Claim._ The audit's P1 entry that `accounts` commands other than `create`
    are "accepted, audited as successful, and do nothing" was **correct**, and
    the four settings verbs now write. What is refuted is the obvious
    implementation of this one: setting the partner credit limit by writing the
    limit.
  - _Authority._ `core_validate_finance_chain` requires a partner account's
    approved credit limit on `core_account_commercial_profiles` and the
    `aggregate_credit_limit_minor` on `accounts` to be **equal**, and the
    constraint trigger fires on the **profile**. So a write that moves one side
    succeeds — nothing checks it at the time — and leaves the invariant broken
    behind it. `supabase/seed.sql` seeds the profile _from_ the account column
    for exactly this reason.
  - _What happened when it was implemented._ The one-sided write moved the
    account aggregate to 6000000 against a profile approved at 5000000 and
    returned success. The next statement to touch that profile is
    `core_reserve_order_acceptance` incrementing `current_exposure_minor`, which
    runs on **every accepted order** — so it raised
    `23514 partner credit limit must match the account aggregate limit`, and one
    call of this verb rolled back every subsequent order acceptance for that
    partner. Every seeded partner has a commercial profile. It was invisible in
    testing because the test used a fresh account with no profile, which is the
    one state in which the invariant cannot break. The verb that shipped writes
    **both** sides — the account row first, the profile second, in one
    transaction — and is not the thing being warned against.
  - _Pinning test._ Reimplementing the one-sided write fails
    `supabase/tests/1397_report_reach_and_partner_credit.test.sql:225` onward,
    which performs that exact write against the seeded partner, requires the
    following exposure update to throw `23514`, and separately asserts that
    `core_reserve_order_acceptance`'s own definition contains the statement that
    fires the trigger, so the reproduction cannot be dismissed as hypothetical.
    It also fails
    `packages/db/src/repositories/core/account-commands.integration.test.ts:382`,
    which sends the real command and requires both
    `accounts.aggregate_credit_limit_minor` and
    `core_account_commercial_profiles.approved_credit_limit_minor` to hold the
    new value. Note also what these tests deliberately allow: a limit **below**
    current exposure is accepted, because over-limit is a commercial state that
    should make the next order rejected, not make the profile unwritable.

- **Mobile drawer navigation — the finding recorded as a correction to P0-34.**
  - _Claim._ `packages/ui/src/components/shell.tsx` closes the drawer
    synchronously inside the navigation click handler, so the portal unmounts
    the link before the route commits and the drawer "navigates nowhere". The
    same report appeared in P0-48 as "the `ui` shard fails three tests".
  - _Authority._ Observed non-reproduction, in four independent ways. The drawer
    already calls `onNavigate` **before** `onOpenChange` in the drawer's
    `Navigation` handler in `packages/ui/src/components/shell.tsx`. Both
    existing end-to-end tests that click a drawer link and assert the resulting
    route pass. A probe across three personas at 320px navigated every
    destination. And the shard claim did not hold either: Storybook was 4 files
    / 10 tests green and Playwright 82 passed _before_ the release-gate change
    and 83 after.
  - _What happened when it was implemented._ Nothing was implemented, which is
    the point. The cost was diagnostic rather than operational: the report sent
    the release-gate work looking for a defect in the shell that was not there.
    The hazard now is the opposite one — re-fixing an ordering that is already
    correct risks inverting it, and the inverted order is the one that actually
    breaks navigation.
  - _Pinning test._ Reimplementing the reported failure mode — closing the
    drawer before handing the route to the router — fails
    `apps/web/src/features/shell/shell-dismissal.test.tsx`, "routes from every
    drawer link before the drawer closes". It enumerates every link in the
    rendered drawer rather than sampling one, and for each opens the drawer,
    clicks, and requires `router.push` to have been called with that link's own
    `href` before the dialog leaves the document. The comment above it records
    P0-34 as the origin so the next reader finds this section rather than the
    report.

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
- **No operator surface for outbox and dead-letter recovery `[RESOLVED]`.**
  `apps/web/app/(experience)/(internal)/internal/recovery/page.tsx` renders
  dead-lettered work with its failure reason, and
  `apps/web/src/features/internal-ops/recovery/actions.ts:48` gates retry and
  abandon behind a role recheck with a reason and an audit row;
  `.../internal/webhook-replay/page.tsx` covers replay. The entry's counts were
  stale when it was written and are staler now: `main` has seventeen internal
  pages, not fifteen, and `docs/operations` holds eighteen procedures, not
  thirteen. Two caveats on the surface rather than the entry: the replay control
  now **refuses** rather than reporting a success it did not achieve (P0-56), so
  the surface is honest but that one action does not work; and the reason this
  surface stays usable in an incident is that unrouted outbox rows are _not_
  dead-lettered, which is a contract and not an omission — see the refuted
  section before changing it.
- **No derivation view for a computed figure `[RESOLVED]`.**
  `packages/domain/src/core/derivation/index.ts` exports `deriveInvoice`,
  `packages/db/src/repositories/core/invoice-derivation.ts` loads the chain from
  persisted rows, and it is mounted read-only on the internal account timeline.
  The audit's caveat that P0-49 made it report every amended order as unamended
  with zero variance no longer applies: the supersession set is now written, and
  the vacuous NET-against-GROSS variance was replaced by
  `core_invoice_amendment_drift` as an exact tax-free signal at rest.
- **Recurring runbooks are prose rather than actions `[RESOLVED]`.** All six
  named runbooks now have operator surfaces:
  `docs/operations/dead-letter-recovery.md` maps `/internal/recovery` onto the
  outbox, provisioning-attempt and workflow-run engines behind
  `queue-outbox-health.md`, `stuck-provisioning.md` and `workflow-recovery.md`;
  `/internal/webhook-replay` covers `webhook-replay.md`; and `6cf5f26` added
  `/internal/unhandled-errors` — behind `system:operate`, reading the durable
  `audit_events` failure stream with persisted decisions — and
  `/internal/billing-reconciliation`, the two this entry had recorded as the
  residue. Two caveats survive: the webhook-replay surface can inspect but not
  replay (P0-56), and the finance-lifecycle pages are not closure —
  `apps/web/src/features/internal-ops/finance-lifecycle/review-action.tsx` is
  review-only and applies nothing.

## P1 — quality and operability findings from the 2026-08-14 audit

Rewritten against what the ten work-streams did. Two entries in the original
list were refuted rather than fixed — WorkOS role synchronization and outbox
dead-lettering — and are in "Refuted findings" above; they are not repeated
here, and reintroducing either fails a named test.

### Closed

- **Retry jitter `[RESOLVED]`** — injected rather than hardcoded, so determinism
  stays a test property rather than a shipped behaviour
  (`packages/workflows/src/policy.ts`,
  `packages/workflows/src/onboarding/durable.ts`).
- **Schedules bound by array position `[RESOLVED]`** — bound by name, with a
  test asserting the pairing (`packages/workflows/src/core/scheduled-tasks.ts`).
- **`HttpEsignSigningClient` timeout, abort signal and response bound
  `[RESOLVED]`** — it now has all three, matching `FetchJsonProviderTransport`.
- **`GET /v1/core/records/{resource}` over-advertised `[RESOLVED]`** — it no
  longer advertises nine resources it does not implement. The sibling half of
  that entry — `accounts` commands other than `create` accepted, audited as
  successful, and doing nothing — is also closed: `add_role`, `add_contact`,
  `set_payment_terms` and `set_partner_credit` write, each covered by an
  assertion that reads back the row the verb is supposed to have written
  (`packages/db/src/repositories/core/account-commands.integration.test.ts`).
  Read the refuted section before touching `set_partner_credit`.
- **White-label partner notification branding and end-client redaction
  `[RESOLVED]`** — wired, with integration coverage.
- **Stripe ordering watermark ties on lexicographic event identifier
  `[RESOLVED]`**, and worth reading rather than trusting: the first fix turned a
  coin flip into a _deterministic_ regression that unconditionally reverted a
  WON dispute to `needs_response`. Credit notes and refunds now dead-letter
  rather than vanish. The invoice category needed one further change — it
  decided whether a per-intent payment row should exist by comparing an
  invoice-level running total, so a second installment arriving late produced no
  payment row, left the invoice `open` and collectable, and traced only a
  `subsumed` note. Two tests encoded that loss as correct and are rewritten.
- **Idempotency caches failures for twenty-four hours `[RESOLVED]`** — closed
  with P0-65.
- **Open redirect in the demo password gate `[RESOLVED]`** —
  `safeDemoReturnPath` now rejects `/\` as well as `//`.
- **No Content-Security-Policy and no Strict-Transport-Security `[RESOLVED]`** —
  both added, with `frame-src` derived from the configured signing origins.
- **`LocalSessionResolver` defaults to the most privileged role `[RESOLVED]`** —
  it no longer defaults to `internal_operator`.
- **One shared secret signs every marketplace and every support webhook
  `[RESOLVED]`** — per-provider secrets replace the single shared key.
- **Hot foreign keys and the dead-letter lookup have no index `[RESOLVED]`** —
  nine indexes added, each with the `EXPLAIN` plan showing it is used;
  `payments` is keyed on `invoice_id` rather than `order_id`, which is what its
  query shape actually needs. `dead-letter-dispatch` now binds `aggregate_type`
  from the attempt's own scope, so the unique index's leading column is no
  longer unbound and the query no longer scans the audit log during an incident.
- **No migration is written to survive a populated table `[RESOLVED]`** —
  `001380` is written to survive one and `docs/adr/0009` records the convention.
  Historical migrations are deliberately **not** rewritten: they are already
  applied, and rewriting an applied migration is its own hazard.
- **Drizzle drift from canonical SQL `[RESOLVED]` in part** —
  `experience_esign_return_correlations.accountId` was modelled nullable where
  the canonical SQL is `not null` and is corrected, and
  `scripts/check-schema-drift.mjs` now compares the model against the live
  applied schema. The residue is named below.
- **The exception-queue vocabulary `[RESOLVED]`** — see P0-43; four declarations
  collapsed to one, with a database check constraint. The wider "vocabularies
  are duplicated without drift tests" entry is only partly closed: currency is
  now enforced (P0-67) and the exception queues are unified, but report keys,
  core resource names, document kinds, projection channels, internal roles,
  dead-letter sources and the localhost set are each still defined two or three
  times with only the external-gate unions carrying a drift test.
- **The authorization boundary is permissive by omission `[RESOLVED]` in part**
  — `requirePermission` now forces every call site to pass an account scope or
  declare itself internal-only, with the sentinel type derived from the
  permission table so it cannot drift; a route omitting the scope no longer
  compiles. One call site slipped through and is named below.
- **Two assisted-session subsystems exist `[RESOLVED]` in part** — the
  unreferenced repository is deleted. `impersonation_sessions` is still created
  and indexed and still carries a policy admitting any internal role, with
  `apps/web/src/features/internal-ops/assisted-session/repository.ts` the live
  path; the table is not retired.
- **Every production error discards its cause `[RESOLVED]` in part** — causes
  are propagated across the workflows work-stream's files, with an inventory of
  the rest. The remainder of the seventy-four bare `catch` blocks is open, and
  `docs/operations/unhandled-errors.md` still asks an operator to diagnose
  provider failures from telemetry carrying only a code.

### Still open

- **The commission clawback ceiling is an unlocked read-then-write
  `[RESOLVED]`.** `001419_commission_clawback_ceiling.sql` serializes every
  reversal at its original payment accrual and enforces the cumulative ceiling
  in the database, net of signed credit-note voids. The two-connection race test
  proves one of two concurrent over-ceiling reversals is refused and that the
  refusal reaches callers as a readable `DatabaseCoreError`.
- **Contractual renewal price protection is captured and validated but never
  enforced by any pricing path.** See the residue below: the enforcement was
  written, adopted, and then deliberately reverted.
- **The design system is a parallel catalogue.** Thirty of the fifty-three
  components exported from `packages/ui` have no use in `apps/web` while the
  product hand-rolls each of their jobs. `internal-projection-page.tsx` still
  duplicates `projection-detail-page.tsx` and is still imported by no route,
  confirmed against the current tree.
- **Mutation feedback is generic and does not refresh.**
  `apps/web/src/features/surfaces/workflow-panel.tsx` returns one of three
  sentences for the mutations it still owns after the seven supersessions, with
  no identifier, no version, no link and no revalidation; it still remounts the
  confirmation dialog by key, which defeats focus restoration, and still calls
  `sendCoreCommand` without an idempotency key — both re-verified against the
  tree — while leaving the confirm control enabled during submission. The
  development-only guard that used to cover the pre-filled legally consequential
  free text is gone with `demoValue` (P0-50), so that text needs re-checking
  rather than assuming.
- **Bulk actions and a collection export are still absent; sortable columns no
  longer are.** `8c53747` delivered server-side sorting over the whole
  collection — not a slice of the loaded page — with `aria-sort` on the customer
  and partner collection surfaces and a test that discriminates the two. Bulk
  actions and an export of the collection surfaces remain absent; the
  formula-safe CSV export that exists is the §17 report download (P0-64), not a
  collection export.
- **Test tooling ships in the application.** `apps/web/package.json` still lists
  `msw` and `@clockwork/testing` as dependencies.
- **Contract tests instantiate only the fake `[partly closed]`.** The CRM and
  notification contract tests now exercise more than the fake side;
  `EsignProviderAdapter`, `DeniedPartyScreeningAdapter`,
  `ReadOnlySupportFeedAdapter` and `MarketplacePlatformAdapter` remain
  unreferenced while each `Fake` sibling is exercised.
- **No end-to-end coverage of settlement.** Invoice issuance through payment to
  receipt, dunning escalation, refunds, credit notes, disputes, commission
  settlement and any non-USD order still have no browser coverage, as do POC
  conversion, amendment and co-termination, renewal decline, termination and
  teardown, migration runs, marketplace orders and tax exemption. The money
  work-stream added database-level and integration coverage, not browser
  coverage.
- **No `LICENSE` file `[RESOLVED]`.** The repository now carries a proprietary
  evaluation licence: all rights reserved, with an express grant to view, run
  and evaluate the software for review, audit and diligence — the use this entry
  recorded as blocked. It grants no production, distribution or derivative
  rights. Choosing a different licence is a business decision this file does not
  preempt; what is resolved is that an external reviewer is no longer infringing
  by reading.
- **Volume, freshness disclosure and accessibility: mostly delivered, two
  residues named.** Delivered and verified against the tree: page-level
  pagination and the sorting above on the collection surfaces (`8c53747`);
  customer stale-data disclosure through `ProjectionFreshnessNotice` on the
  customer and partner collection surfaces (`8c53747`); unsaved-changes
  protection on the six mutating surfaces, disarmed on the server's success
  signal so a successful submit does not warn; the internal queue search rebuilt
  so the input keeps local authority with a debounced URL commit and no longer
  drops typed characters (`5c0f727`); dashboard copy and timezone from the
  persona rather than a fixed string and America/New_York (`5c0f727`); and the
  accessibility gaps the Axe run cannot see — a focusable skip-link target,
  route announcements, the operator queue table keeping its semantics and
  keyboard scroll below 48rem, and the combobox no longer running
  `aria-activedescendant` and real focus movement simultaneously (`5c0f727`).
  Still open or partial: the 100-page cliff is closed at the loader but only
  partly disclosed — the partner surface discloses `truncated` while the
  customer collection pages drop it and render the generic stale banner, so a
  cut-off ledger reads as merely "may be out of date"; that repair is in flight
  with the experience lane. Suspense boundaries exist on the acceptance page and
  are not claimed anywhere else. The two-pass acceptance refusal is P0-68's, not
  this entry's.

### Open residue from the ten merged work-streams

Everything below was found _during_ the work and deliberately shipped open. It
is collected here because a residue recorded only in a commit body is a residue
nobody reads. None of it is speculative: each was observed by the work-stream
that left it, and each has been re-checked against the tree by the pass that
wrote this revision — entries a later work-stream closed say so instead of being
silently deleted, because the closure is part of the record.

- **The webhook-replay task is still unregistered** and the operator command
  still fails closed. See P0-56.
- **`GuardedProviderJsonTransport` is composed on exactly one path.** The ws5
  commit body records it as still uncomposed; the tree contradicts that —
  `packages/workflows/src/runtime/environment-production-adapters.ts:530` wraps
  the outbound CRM transport in it. Nothing else is wrapped. The marketplace
  finance adapters (`packages/integrations/src/core/marketplaces/types.ts:69`,
  `adapters.ts`) still have no `MarketplaceTransport` implementation and are
  wired into nothing, so the declared last-mile gate covers one provider path
  out of the set it was written for.
- **`accepted-order-provisioning.ts` emits an `aggregateType` the dead-letter
  join can never match** — it appends with `aggregateType: "provider_operation"`
  against a join that expects `order` or `poc`, so an operator redrive of these
  rows returns unmapped. Found by two separate work-streams and fixed by neither
  merged one; the join's own comment cites the wrong one of the two emitters,
  and both existing tests hand-seed `order` rows by raw SQL — fixtures built to
  satisfy the join rather than exercise the emitter. In repair by another lane
  at the time of writing; treat this as the record of the defect, not a claim
  about the final tree.
- **`create_signature_envelope` executes now, and the sweep it forced found the
  class elsewhere.** It was neither a `providerCommand` nor a
  `staffServiceCommand`, so it ran as `clockwork_runtime` and its
  `provider_operations` insert was refused with 42501 on a tenant route — which
  is _why_ P0-51's guaranteed version collision never surfaced in practice.
  `5c0f727` fixed it with a narrow role-targeted INSERT policy admitting only an
  unstarted claim for the two enumerated provider calls, proven against the
  aggregate row's account — the split migration `000200` already gave
  `lifecycle_provisioning_attempts` — rather than reclassifying a
  customer-initiated write onto the service connection. `decide_poc`'s approving
  half had the same defect and the same fix. Still open from that sweep:
  `open_exception` and `decide_exception` are dead for a tenant fall-through
  their own comment declares intentional and are left deliberately — `8c53747`
  then **removed** a migration that would have opened tenant exception intake,
  because every spec'd tenant-triggered exception is machine-opened and the
  tenant write path has never worked at any point in this repository's history;
  the remaining finding is that the route should refuse non-staff callers
  explicitly, with the two-layer treatment `start_migration` got, rather than
  dying in the row policy.
- **The provider-before-local-write window in the e-sign path remains.** Nothing
  retries, and there is no orphan sweeper for e-sign, so an envelope created at
  the provider before a failing local write leaves orphaned provider state.
- **Renewal price protection is not enforced, and the control was deliberately
  removed.** The rule and its tests are correct and are kept; the _adoption_ was
  reverted because it refused a legitimate renewal governed by a signed paper
  carrying no price protection. The blocker is a contradiction, not an
  oversight: `governingAgreementForPricing` asserts in its docstring that a
  quote and its order cannot be governed by two different papers, which
  `agreementOn` contradicts. A control that refuses a signed valid renewal is
  worse than an unenforced rule, so the rule stays unenforced until that is
  settled.
- **An amendment-added line has no `order_lines` row**, so it can never
  subsequently be reduced or removed. A modelling gap, not a bug in the
  amendment writer.
- **A standalone negative added-line delta is accepted** while the same delta
  combined with a supersession throws an **untyped** error.
- **A doc comment in `packages/domain/src/core/amendments` overstates when
  `applyAmendment` runs.**
- **`role_sync_events.error` is written durably and read by no
  operator-reachable path**, and `listUnresolvedRoleSynchronizations` has no
  caller and no resolution semantics — a reason is never cleared, so an approved
  membership still returns as unresolved. The repository read and its tests
  exist; the surface does not.
- **The `withInternalTransaction` runtime guard is a deny-list of one role
  name** and should be an allow-list, and the static scan that enforces it
  matches two literal spellings only. That is the guard standing between the
  tree and a recurrence of P0-54.
- **The one unscoped `requirePermission` call site is closed.** The lifecycle
  route that took a tenant-reachable permission with no account scope now passes
  a scope sentinel like every other call site; no two-argument
  `requirePermission` call survives anywhere in `packages/api`, re-checked by
  grep against the tree.
- **The Stripe financial verifier and the marketplace tolerance path were not
  repaired.**
- **`core_order_acceptance_reservations` has no Drizzle model at all**, so
  `check:schema-drift` cannot see it, and several pre-existing check-constraint
  names in `packages/db/src/schema/core/finance.ts` disagree with the applied
  SQL names.
- **`RELEASE_REQUIRED_RUNTIME_ENVIRONMENT` omitted the two tax variables and no
  longer does** — closed in `5c0f727`, which put `TAX_PROVIDER_BASE_URL` and
  `TAX_PROVIDER_TOKEN` in the release isolation floor. The commit is exact about
  what that closed: an assertion gap, not a leak — the token was already
  scrubbed by the sensitive-name regex and the base URL by `.env.example`
  membership. The second site of the over-broad tax gate — the internal
  webhook-replay action — was fixed in the same commit (see P0-56); the third,
  in the production-workflow proof, was reported there and fixed in `6cf5f26`:
  the outbox drain now composes `composedTaxProvider()`, so an unwired
  `EXT-TAX-01` refuses the two writing commands instead of decomposing the whole
  drain, materialization included.
- **`migrations` has no backing projection channel.** The surface says so
  honestly rather than printing a freshness claim over a constant (P0-63).
  `renewals`, which this entry used to name beside it, has since been wired to
  the internal `orders` channel — renewal work rows are orders — so its
  honest-unwired state is superseded.
- **`recordRoute`'s `Route` alias does not bind the channel set to the route
  tree.** `RouteImpl`'s first three members are unconditional, so the original
  defective body recompiles clean under the new type; a unit test holds that
  direction and the compiler does not.
- **False claims in shipped file headers remain.** `5c0f727` records four and
  `8c53747` records three more that its own work wrote — the defect the citation
  tooling exists to catch, committed while building it — including a
  justification that argues from a premise about adapter coverage that is not
  true. They are code comments, not backlog rows, and they belong to the lanes
  that own those files. The prose inaccuracies that lived in _this_ file —
  deal-registration create recorded as undelivered, the collections corrections
  surface recorded as missing, and "Poppler is installed" written as if it
  described the workflow — are corrected in this revision.
- **`commissions:accrue` cannot be executed by the role its own insert guard
  invites.** `commission_accruals_insert_role_guard` names roles no permissive
  lane admits — the only permissive lane on `commission_accruals` is
  `app_has_account(partner_account_id)`, which a finance approver does not hold
  — so the verb dies before its audit append. Recorded by `8c53747`, which fixed
  the finance audit guard beside it and deliberately did not widen an
  account-unscoped write lane to revive this; it is left with the commission
  lane in flight.
- **`core_deal_registration_disputes` exists and no code reads or writes it.**
  The deal-registration dispute path is unbuilt — `dispute` and `decide_dispute`
  are deliberately absent from the admitted verbs, and the 3-business-day
  escalation the spec gives it has no owner in code. The service catalogue says
  this in place so the absence cannot read as an oversight.
- **The customer quote builder still ships fixture selector UUIDs in the client
  bundle.** The partner builder's P0-62 fix did not cover it, and P0-50's
  no-fixture-UUID bundle proof was scoped to the ten workflow mounts, not this
  surface.
- **`main` carries no branch protection**, so no status check gates a merge even
  once Actions can run. Requiring it needs organization administration this
  account does not hold; it is a named input of `EXT-ACC-01`. See P0-48.

## P1 — external activation and approval gates

Each input below already has a repository control, deterministic simulator,
fail-closed enforcement boundary, and exact live activation test in
`docs/external-gates.md`.

- `EXT-ACC-01` — named hosted accounts/projects, scoped credentials, selected
  telemetry/paging backend and delivery proof, managed backup/PITR proof,
  staging soak, and — since P0-48 went external-only — Actions billing in good
  standing, one observed green run of the release workflow on `main`, and
  branch-protection administration to require it.
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

- **The trust surface exists now, and is honest about what it is not.**
  `6cf5f26` added `/trust`: a register of controls whose page states plainly
  that no SOC 2 report, ISO 27001 certificate, PCI attestation, HIPAA assurance
  or FedRAMP authorization is held or claimed, and whose integration list
  refuses the subprocessor-schedule reading by name. Two things about how it got
  there are the reason to trust it: the page's original guarantee — that the
  build fails if a control's evidence stops supporting it — was attacked with
  fabricated controls, three got through a strengthened guard, and the sentence
  was **lowered to what the guard can actually detect** rather than the guard
  being declared stronger than it is; and two false customer-visible security
  claims were deleted rather than defended. What is still missing is what needs
  external inputs: an attestation, a real subprocessor schedule, and a
  data-processing agreement, under `EXT-LEGAL-01` and `EXT-ACC-01`.
- **The API reference is published; credentials and a sandbox are not.**
  `6cf5f26` added `/developers`, rendering the generated contract publicly —
  both the page and `/developers/openapi.json` are in the unauthenticated path
  list, asserted by test, because an integrator evaluating the API has no
  account yet — with a plain statement of what is not yet available to an
  integrator. What remains absent is customer credential management and a
  sandbox, so the programmatic buying path is now documented but still not
  self-servable.
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
  commercial platforms ship, but the claim still cannot be demonstrated on
  demand. The reason has changed: the accessibility-adjacent browser failures
  P0-48 reported were fixtures and a non-reproducing drawer report, both now
  disposed of, and the structural gaps this entry used to point at — the
  skip-link target, route announcements, the queue table below 48rem, the
  combobox — were closed in `5c0f727`. What remains is that **no run has been
  observed**: Actions is billing-blocked, so the evidence exists only as local
  captures, and that is `EXT-ACC-01`'s remainder, not a repository one.

## P2 — post-spec expansion

- Optional shared-session/account linking with the existing Fil One product.
- Additional locales, currencies, payment rails, marketplaces, and providers
  after their legal/commercial/operational approval.
- Deeper distribution trees if a future channel program requires them.
- Bidirectional CRM editing or write-enabled support only after a new
  ownership/security ADR; the current support feed is deliberately read-only.
- Reporting dimensions beyond the ten §17 reports, and any BI export. P0-42
  completed the ten, so this is now unblocked rather than waiting.
- The exception-queue vocabulary is settled and unified by P0-43 and enforced by
  a database check constraint, so the P2 item that waited on it is done; what
  remains under P2 is only the wider single-package consolidation of the other
  duplicated vocabularies named in the P1 list.
- Per-user and per-account notification preferences beyond what P0-46 shipped.
  Deliveries now have a record and the account surface has preferences; the
  remaining scope is per-user granularity.
- Usage ingestion from a second orchestrator source, after the first source
  contract is live under `EXT-PROVISION-01`.
