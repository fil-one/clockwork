# Core-finance lane handoff

Current disposition: historical provenance. This lane and its integration
expectations were considered represented and repository-qualified when this
handoff was written; the current backlog controls present gaps and status.

Branch: `commerce/core-finance`

Foundation base: `d9fdacce7eb3d66e3ba0aaa698814e3d42660668`

## Implemented behavior

- Commercial account profiles model one legal entity with dedupe
  fingerprints/signals, a set of relationship roles, multi-role contacts,
  validated tax identifiers, procurement certificates and supplier documents,
  PO/AP/vendor-setup readiness, payment terms, collections ownership, partner
  hierarchy, and aggregate credit exposure. Credit breaches block only new
  service.
- Versioned USD/EUR/GBP price books and region/SKU rate cards carry exact
  minor-unit prices, floor prices, partner transfer tiers, Stripe tax codes, QBO
  mappings, commit semantics, contracted overage rates, effective dates,
  activation controls, and append-only activation audit.
- Direct, referral, resale, distributor, marketplace, and white-label quote
  shapes use exact pricing, margin-floor exceptions, immutable issuance
  snapshots/revision chains, partner-controlled resale totals, and separate
  partner-facing artifact references.
- Order acceptance binds authority attestation, PO requirements, the exact
  governing agreement and quote versions, merchant-of-record/invoicing rules,
  immutable order-line snapshots, co-termination, and a deterministic
  provisioning idempotency key/port request.
- Amendments cover upgrade, downgrade, extension, co-termination, deterministic
  daily/monthly proration, immutable line supersession/replacement, and net
  forecast adjustments.
- `CommitmentLedger` is the only overage authority. It replays source events
  deterministically across half-open contractual boundaries, IANA time zones,
  period allowance/term drawdown, partial periods, amendments, renewals, late
  usage, corrections, duplicates, and source reconciliation. Overage uses the
  order's contracted rate and may emit negative deltas after correction.
- Billing logic covers direct/referral and consolidated resale invoices grouped
  by end client, prepay/auto-charge/net-terms policies, AP/PO delivery data,
  partner exposure, retention-aware dunning, approved credits, refunds,
  disputes, receipts, and non-regressing Stripe truth projection.
- Partner logic covers deal exclusions, protection windows/extensions,
  sourced/influenced credit, recorded disputes/tiebreaks, two-tier
  distributor/reseller validation, merchant-of-record isolation, and
  partner-only commercial notification/invoicing rules.
- Referral commissions accrue only on net collected revenue; refunds, credits,
  and chargebacks create negative accruals. Holdbacks, clawbacks, quarterly
  statements, settlement CSV, and accounting-bill exports are supported.
- AWS, Azure, and Google marketplace adapters normalize orders, entitlements,
  metering, fees, invoices, settlements, refunds, and reconciliation behind
  explicit credential gates.
- QBO-neutral exports cover AR at terms-invoice issuance, auto-charge payout
  summaries, deferred-revenue schedules, commission bills, tax liabilities, cost
  summaries, balanced journals, and platform/Stripe/QBO tie-out.
- Reports cover revenue forecast, capacity planning, renewal/churn exposure,
  partner performance, funnel/cycle time, margin/POC cost, three-way tie-out,
  and weekly scorecard. ARR/MRR follows merchant-of-record revenue basis;
  margins remain labeled `modeled` until entitlement-grain costs are complete.
  CSV output is formula-safe.

## Migration and persistence

Canonical migration: `supabase/migrations/000100_core_finance.sql`.

It adds 34 normalized `core_*` tables for account commercial records,
relationship roles, contacts, tax IDs/certificates, price activation/transfer
tiers, quote commercial profiles/snapshots/exceptions, order commercial and line
snapshots, amendment terms/supersession, commitment
periods/corrections/reconciliation, billing policies/allocations/collections,
partner hierarchy/attribution/exclusions/disputes, commission
statements/settlements, marketplace events/financial entries/reconciliation,
accounting exports/entries, and three-way tie-outs.

The migration adds checks, unique/idempotency constraints, optimistic
row-version triggers, immutable append-only triggers, indexes, grants, and RLS
policies. Privileged tax, credit, billing, ledger, marketplace, accounting, and
reporting writes are service/internal only. Tenant reads follow foundation
account and order visibility functions. `CoreFinanceRepository` performs
transaction-scoped writes and appends audit/outbox evidence atomically.

SQL report views, all with `security_invoker = true`:

- `core_revenue_forecast`
- `core_capacity_planning`
- `core_renewal_churn_exposure`
- `core_partner_performance`
- `core_funnel_cycle_time`
- `core_margin_poc_cost`
- `core_three_way_tie_out`
- `core_weekly_scorecard`

## Events

The database repository accepts the foundation `CoreMutationAudit` envelope and
emits caller-specified versioned event names atomically with its state write.
The API command service uses the stable pattern `core.<resource>.<action>`; its
current resources are accounts, procurement profiles, price books, quotes,
orders, amendments, commitments, invoices, credits/refunds/disputes, deal
registrations, commissions, accounting exports, marketplace reconciliation, and
reports. Provider consumers deduplicate by provider event ID plus payload hash
and reject an ID reused with different bytes.

Important persisted event payload evidence includes price-book activation,
issued-quote snapshot hash, accepted-order line hashes/agreement
version/provisioning key, ledger correction and source reference, collection
action/outcome, marketplace claim, accounting export, and tie-out variance.

## API routes

- `GET /v1/core/status`
- `POST /v1/core/commands/{resource}` — authorized, idempotent,
  optimistic-versioned mutations with audit/outbox IDs
- `GET /v1/core/records/{resource}` — account-scoped stable cursor pagination,
  maximum 100
- `GET /v1/core/reports/{report}` — JSON or formula-safe CSV for all
  report/scorecard types
- `POST /v1/core/replays/{provider}/{eventId}` — internal operator plus
  recent-authentication replay claim
- `POST /v1/webhooks/stripe` — raw-body signature verification before
  claim/acknowledgement, duplicate/in-progress handling, replay-safe projection

Unsafe requests use the foundation Origin/CSRF and idempotency middleware.
Errors are RFC 9457 responses with stable codes. Customer and partner requests
require explicit account scope; negative tests prove cross-account and
cross-partner writes are denied.

## Workflow IDs

- `core.billing.issue-invoice.v1`
- `core.billing.sync-overage.v1`
- `core.collections.dunning.v1`
- `core.collections.partner-credit.v1`
- `core.commissions.settle.v1`
- `core.reconciliation.usage.v1`
- `core.reconciliation.three-way.v1`
- `core.reporting.export.v1`

Workflow invocation/downstream keys derive only from task, aggregate, version,
and operation. Duplicate successes return the stored result; different payloads
conflict; transient failures surface bounded retry instructions; permanent
failures write the owned exception queue and require an explicit replay.

## Test evidence

- Domain: property and scenario coverage for exact decimal/currency rounding,
  price floors, multi-currency isolation, quote/order snapshots, PO/authority
  binding, proration, line supersession, period and term commitments, time-zone
  boundaries, partial periods, late usage/corrections, source reconciliation,
  credits, partner exposure/MoR, commissions/clawbacks, reports, tie-out, and
  CSV safety.
- API: idempotent replay, optimistic conflict, audit/outbox pairing, tenant
  cursor scope, unauthorized cross-account/cross-partner denial, recent-auth
  replay, and raw Stripe signature-before-claim behavior.
- Stripe:
  customer/subscription/schedule/invoice/tax/payment-method/bank-transfer/receipt/overage/credit/refund/dispute
  contract tests; deterministic monthly, annual, payment-failure, renewal, and
  amendment test-clock scenarios; duplicate, reordered, conflict, and operator
  replay webhook cases.
- Marketplaces: AWS/Azure/Google normalization/reconciliation fixtures and
  credential-denial tests.
- Workflows: unit coverage for all eight tasks plus a composed partner
  money-path integration test.
- SQL: migration from zero and 33 lane pgTAP assertions covering constraints,
  RLS, append-only records, report source traceability, MoR isolation, and
  tie-out arithmetic; 94 repository pgTAP assertions pass in total.

Combined verification on Node 24.18.1 / pnpm 10.34.5:

- Format, ESLint, secret scan, and dependency boundaries passed; boundaries
  covered 193 modules and 341 dependencies.
- All 10 workspace packages typechecked and built.
- Unit suites passed 76 tests; integration suites passed 29 tests.
- Database reset applied migrations `000001` and `000100` from zero; pgTAP
  passed 94 tests.
- Storybook passed 1 browser test and built; Playwright smoke passed 1 test.
- Dependency audit passed the configured high-severity threshold; it reports two
  unchanged moderate advisories and this lane changed no dependencies or
  lockfile entries.

## External gates

No new external gate was introduced and `docs/external-gates.md` was not
changed. Activation remains subject to existing gates:

- `EXT-COMMERCIAL-01`: signed SKU/rate/floor/partner-tier data before real
  quotes.
- `EXT-ACC-01` and `EXT-PROVIDER-01`: production Stripe, marketplace,
  Trigger.dev, and selected Stripe-to-QBO credentials/provider choice.
- `EXT-TAX-01`: registrations, exemption/reverse-charge policy, entity headers,
  QBO account map, rev-rec, and written credit policy.
- `EXT-PROVISION-01`: authenticated provisioning and source-usage contract.
- `EXT-APPROVERS-01`: named primary/backup queue owners and response targets.

Fakes and deterministic ports cover every gated path in CI.

## Agent 5 integration expectations

1. Add the backward-compatible `@clockwork/domain/core` package export (or
   re-export `src/core`) in the shared package manifest/barrel. The lane did not
   edit foundation-owned package composition.
2. Add `core?: CoreRouteDependencies` to shared `ApiAppOptions` and pass it to
   `registerCoreRoutes`, or call `configureCoreRouteDependencies` once in
   bootstrap. Supply a database-backed `CoreFinanceService`; the memory service
   deliberately refuses to be the production default.
3. Configure `CoreFinanceWorkflowEngine` in the Trigger worker bootstrap with
   durable run/exception/record ports. `StripeFinanceGateway` structurally
   supplies the billing and ledger-overage ports; `QboNeutralAccountingAdapter`
   supplies the accounting port.
4. Connect accepted-order outbox events to the foundation `ProvisioningPort`; do
   not move provisioning semantics into Stripe.
5. Configure `StripeFinancialWebhookVerifier`, durable webhook
   inbox/deduplicator, and projection callback on the core route. Preserve
   untouched request bytes.
6. Register marketplace credential gates/transports per environment. Missing
   credentials must remain a denied activation, not a fallback.
7. Regenerate OpenAPI artifacts after all lane routes merge; generated files
   remain integration-owned and were not edited in this lane.
8. Compose the core schema/repository already exposed through the foundation
   lane barrels, add integrated fictional demo fixtures, and run the full
   cross-lane money path from account through provisioning, billing, accounting
   export, and report tie-out.
