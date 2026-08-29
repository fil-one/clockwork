# Clockwork commercial readiness decision register

Status: **Proposed for product, finance, legal, and operations approval**  
Research date: **2026-08-29**  
Repository baseline: `fil-one/clockwork` `main` at `55b4082d380e086b29da7e76f4e060d19cbb49a6`

## Purpose

This register converts Clockwork's open commercial inputs into explicit launch recommendations and identifies the product work required to make those policies operable after deployment.

Clockwork has a strong pricing, quote, order, audit, RLS, outbox, and approval foundation. It is **not yet safe to use as Fil One's production commerce system**. The immediate blocker is not a missing percentage; it is a mismatch between the live Fil One offer and Clockwork's current term-quote/billing model, combined with incomplete operator controls and an unwired Fil One boundary.

The recommended launch sequence is:

1. Direct PAYG pilot.
2. Direct committed Business contracts.
3. Referral and resale/MSP.
4. Co-branded resale.
5. Full white-label/OEM, distribution, and cloud marketplaces.

Partner, marketplace, and full white-label capabilities should default off until their dedicated acceptance gates pass.

## Current public source of truth

The live offer, not the fictional seed catalog or an earlier four-tier proposal, should be the commercial baseline:

- PAYG storage is **$4.99 per decimal TB-month**, calculated from average daily usage, with a **$4.99 monthly minimum**, no term, and no egress, API, or exit fees. See [Fil One pricing](https://www.fil.one/pricing) and [billing documentation](https://docs.fil.one/billing/pricing).
- The trial is **30 days**, **1 TB storage**, **2 TB cumulative egress**, unlimited API operations, and no card. See [trial documentation](https://docs.fil.one/billing/trial).
- Business contracts offer custom capacity and pricing on **1-, 3-, or 5-year terms**, consolidated invoicing, capacity assurance, and contractual SLAs. See [enterprise offering](https://www.fil.one/enterprise).
- The standard availability SLA is **99.9%**, with published service-credit bands. See [Fil One SLA](https://www.fil.one/sla).
- The currently named storage regions are France and Michigan.

The old `$6.99 Standard`, `$9.99 Pro`, and `$1.50 Cold` concepts should not be loaded into production. A `$1.50/TB-month` archive product would need a genuinely different lifecycle, minimum duration, asynchronous restore behavior, retrieval economics, and COGS model; it conflicts with today's always-hot, no-retrieval-penalty positioning.

## Greenlight decisions

Each recommendation should become effective-dated configuration. An accepted quote/order must retain an immutable resolved snapshot so a later configuration change cannot alter contracted economics.

| ID | Category | Recommended launch decision |
|---|---|---|
| `COM-001` | Canonical catalog | Launch two commercial offers: `OBJECT_PAYG` and `OBJECT_COMMIT`. Treat the trial as an entitlement/promotion, not a paid SKU. Keep migration, support, and future archive as separate SKUs. |
| `COM-002` | PAYG | USD `$4.99` per decimal TB-month; `1 TB = 1,000 GB`; average-daily aggregation; `$4.99` monthly minimum; monthly billing; no commitment; egress/API/exit explicitly zero-rated. |
| `COM-003` | Self-serve | No 10-TB or 12-month minimum. Route estimated usage above a configurable **100 TB** threshold to sales while preserving PAYG economics. The threshold is a workflow control, not a pricing term. |
| `COM-004` | Trial | One trial per verified organization/domain; 30 days; 1 TB storage; 2 TB cumulative egress; no card; near-real-time limit enforcement; suspend writes at expiry and require conversion before continued service. Define notice and deletion windows before launch. |
| `COM-005` | Business commit | Permit only 12-, 36-, and 60-month terms. Use take-or-pay committed capacity, no unused-capacity rollover, PAYG-list overage until a co-termed amendment, locked contract currency, 60-day non-renewal notice, and optional written 25/50/75/100% quarterly migration ramp. |
| `COM-006` | Direct discounts | 1 year: up to 3% at 100-499 TB, 6% at 500 TB-1.99 PB, 9% at 2 PB+. Add up to 3 points for 3 years and 5 points for 5 years. Standard cap 12%; strategic cap 15% only at 5 PB+ with finance/executive approval. No automatic stacking. |
| `COM-007` | Price floor | Target at least **40% contribution margin** after fully loaded infrastructure, repair, network, API/egress, support, payment, bad-debt, and marketplace/channel costs. Finance approval below 40%; absolute launch floor 30%. The system floor is `worst_case_unit_COGS / (1 - required_margin)`, not an invented dollar amount. |
| `COM-008` | Support | Standard support included. Priority Support: greater of `$250/month` or 7% of service spend. Enterprise 24x7: greater of `$1,000/month` or 10%, with an approved response matrix and named owner; optionally include above `$100,000` ACV. |
| `COM-009` | Currency | Launch production billing in USD. Add independently approved, effective-dated EUR and GBP price books after tax, legal, banking, and FX policy gates pass. Never rate a signed term contract using live FX. |
| `COM-010` | Referral | Fil One is seller/MoR and supports the customer. Pay 10% of Net Collected Product Revenue for months 1-12; 5% for months 13-24 only while the partner remains active and materially supports the account; zero thereafter. Do not combine with wholesale margin. |
| `COM-011` | Reseller/MSP | Partner is seller/MoR to the end customer and sets the resale price; Fil One invoices wholesale. Registered 10%; Authorized 15% at 100 TB; Premier 20% at 1 PB; Strategic up to 25% for qualifying multi-year business. Every tier remains subject to the contribution-margin floor. MSP owns L1/L2; Fil One owns L3. |
| `COM-012` | Distributor | Invite only. Require an explicit active distributor-to-reseller edge and settlement owner. Permit a 3-5-point override inside a **30% maximum total channel pool**, never in addition to that cap or below the price floor. |
| `COM-013` | Deal registration | One primary economic owner. Channel-ops decision within 2 business days; 90-day protection; one 90-day extension with documented progress; 180-day conflict lookback for an active opportunity or paid relationship; managed house-account exceptions; automatic expiry and immutable dispute rationale. |
| `COM-014` | Commission settlement | Cleared cash only. Quarterly close, Net 30 after close, 60-day first-payment risk hold, `$500` payout minimum with carry-forward. Executed agreement, tax form, verified payout/vendor profile, and no sanctions/compliance hold are prerequisites. Offset refunds, credits, chargebacks, fraud, and duplicate attribution; no automatic bank debit without contractual authority. |
| `COM-015` | Incentives | MDF up to 1% of eligible prior-quarter wholesale revenue, pre-approved and receipt-backed. Incremental rebates 1-2% above approved thresholds in a separate ledger. SPIF and split-credit off at GA. |
| `COM-016` | Co-branded resale | First white-label release is co-branded resale: verified domain, branded quotes/documents/notifications, explicit legal seller, support owner, and Fil One subprocessor disclosure. Suggested economics: 20% wholesale, `$5,000` setup, and `$1,000/month` minimum spend creditable to usage on a 12-month term; waive setup for a qualifying 1 PB commitment. |
| `COM-017` | Full white-label/OEM | Keep off at initial GA. Require tenant-aware routing, brand-version snapshots, SSO, customer subaccounts, usage export, quotas, support escalation, legal/invoice/remittance ownership, account ejection/transfer, credential rotation, deletion recovery, and 20-25% wholesale economics that clear the floor. Never pool unrelated end customers in one technical account. |
| `COM-018` | Operator model | Treat a partner-branded operator/SP arrangement as a separate product, not a transfer-price tier. It needs versioned hardware title, capex/collateral recovery, minimum capacity/term, operating fee, revenue and block-reward split, reward valuation, loss priority, step-in, and termination policy. Do not enable until that economics object and agreement exist. |
| `COM-019` | Marketplace | AWS first only when customer demand justifies integration; Azure/GCP follow demand. Model marketplace fee, CPPO/reseller margin, tax, collection, renewal status, and vendor net separately. Use a marketplace-specific price book/discount budget; do not show a surprise surcharge. |
| `COM-020` | Payments and MoR | Self-serve may use card/ACH; enterprise defaults to ACH/invoice. Direct/referral MoR is Fil One. Reseller/MSP/distributor MoR is the named partner selected from the active chain. Avoid Stripe Connect split payments at GA; invoice the reseller wholesale. |
| `COM-021` | Tax and payout compliance | Prices are tax-exclusive unless local law requires otherwise. Require W-9/W-8BEN-E or local equivalent, resale certificates where applicable, verified bank/vendor mapping, sanctions status, withholding holds, and exportable reporting. Do not hard-code a US-only rule globally. |
| `COM-022` | SLA | Keep the current 99.9% standard SLA for PAYG. Contract enhanced SLAs only for named topology, region, capacity, RPO/RTO, and deployment dates. Remove the `$1` minimum-credit anomaly or accumulate sub-dollar credits. Publish monitoring source and partial-region/bucket handling. |

### Net Collected Product Revenue

For referral commissions, define:

`Net Collected Product Revenue = cleared cash for eligible recurring storage and approved support - taxes - discounts - credits - refunds - chargebacks - bad debt - pass-through hardware/shipping/migration/professional-services charges - marketplace fees`

Ordinary direct payment-processing fees remain a Fil One cost, not a hidden deduction from a referral partner. Reseller economics are retail revenue minus the wholesale invoice, not a commission calculation.

### Non-stacking rule

A transaction has one primary economic motion. Referral commission, reseller margin, distributor override, marketplace fee, promotional discount, and rebate must be independent components with explicit precedence and a total-economic cap. Double compensation is prohibited unless finance approves a versioned exception.

## What Clockwork currently makes configurable

The assumption that all commercial policy can be changed inside the deployed tool is only partly correct.

| Area | Current state | Required state |
|---|---|---|
| External gates | DB-backed, audited, and substantially operable | Preserve; add source document, checked date, approver, and activation-test freshness where absent. |
| Price-book header and activation | Draft metadata and strong two-person activation exist | Preserve separation of duties and immutable activated versions. |
| Rate cards | Admin can add only the first rate while creating a draft | Reopen drafts; add/edit/retire multiple rates; clone/import/export; schedule; preview; full economic diff. |
| PAYG rating | Current domain requires positive term and rates `unit price x quantity x months` | Add no-term recurring usage rating, average-daily meter, minimum monthly charge, corrections, and late-usage reconciliation. |
| Trial | One scalar limit | Add duration, separate storage/egress limits, eligibility, conversion, enforcement, expiry, and deletion lifecycle. |
| Discounts | Domain support exists; no admin editor | Effective-dated volume/term matrix, caps, floors, exceptions, simulation, and approval. |
| Transfer pricing | Admin hard-codes `{}`; runtime and normalized table compete | Choose normalized effective-dated transfer tiers as source of truth and snapshot the resolution. |
| Partner programs | Commission/agreement fields are mostly account-creation inputs | Versioned program, enrollment, commission, tier, hierarchy, territory, support, credit, payout, and suspension admin. |
| Commission policy | Payment accrual reads the partner's current account rate | Pin a commission-policy version to registration/quote/order and use it for every payment. |
| Deal registration | 90 days is a UI constant; new prospect intake is circular | Policy-driven registration, prospect intake/dedupe, authoritative ledger, disputes, SLA, and extension workflow. |
| White-label | Verified-domain notification plumbing exists; key pages are unbacked | Authoritative versioned brand profile applied to portal, quote, order, invoice, document, and notification. |
| Capabilities/kill switches | Read path exists; no audited application writer | Two-person enable, immediate reasoned disable, recovery state, and provider-test visibility. Production defaults off. |
| Agreements/approvals | Some commands are real, but operator list pages can show fixtures | DB-backed queues, evidence, diff, decisions, and no fictional production state. |
| Provider credentials | Environment/secret based | Keep secrets out of business admin. Show only connection status, secret reference/version, rotation age, and activation tests. |

## Required configuration hierarchy

Resolve commercial policy in this order:

`Product/SKU -> Offer version -> Meter definition -> Price book -> Channel program -> Account/agreement override -> Quote/order snapshot`

Minimum versioned entities:

- Product catalog, SKU, offer version, region/capability mapping, sellability, and entitlements.
- Meter definition: source, dimension, unit, aggregation, service period, timezone, rounding, corrections, minimum charge, included/zero-rated usage, and abuse limit.
- Price book/rate cards: currency, region, effective window, list/floor/overage, term ladder, minimum, support, tax code, accounting mapping, and approved claims.
- Partner program/version, enrollment, channel chain, registration policy, commission policy, rebate/MDF policy, payout profile, and support owner.
- Brand profile/version: mode, domain/DNS/TLS, logo/colors, email sender, legal identity, invoice/remittance, support/status, SSO, locale, catalog, and attribution.
- Marketplace fee schedule and private-offer/renewal state.
- Contract override with approval, reason, source agreement, effective dates, and economic impact.

Activated versions must be immutable. Every configuration item needs `source_uri`, `source_checked_at`, `source_document_id`, owner, approver, status, effective dates, and audit history. Changes are prospective. Issued quotes, orders, invoices, and earnings keep exact snapshots.

## P0 implementation program

### 1. Make the live PAYG product billable

The current self-serve implementation hard-codes 10 TB, 12 months, and a 100-TB escalation threshold. More importantly, the pricing and billing flow does not support the live offer.

Required work:

- Remove the fixed 10-TB and 12-month commercial assumptions from customer and resale quote builders.
- Implement byte-hour or at least hourly source metering and an average-daily monthly rating policy.
- Create recurring monthly invoice periods, `$4.99` minimum-charge logic, service-period line items, corrections, late-event reconciliation, cancel/final-invoice behavior, and zero-rated egress/API meters.
- Model the 30-day trial with separate storage and egress counters and near-real-time enforcement.
- Stress-test economics at 1x, 3x, and 10x monthly egress, high request rates, small objects, versions, and incomplete multipart uploads before promising unlimited use at scale.

The visible self-serve form must not be “fixed” in isolation; it would still bill incorrectly until rating and recurring invoicing exist.

### 2. Wire the Fil One boundary

Implement the required design in `docs/adjacent-service-integration.md`:

- Auth0/WorkOS identity mapping and immutable Fil One organization mapping.
- Provisionable SKU/region/capability mapping.
- Signed, idempotent provisioning callbacks and raw usage ingestion.
- Stripe ownership/cutover rules, CRM ownership, machine authentication, reconciliation, redrive, and rollback.

Clockwork should reject any quote whose SKU, region, meter, or provisioning mapping is unknown.

### 3. Complete Commercial Admin v1

- Catalog/meter/offer administration.
- Multi-rate price-book drafting and full discount/floor editor.
- Golden-quote simulation covering PAYG minimum, enterprise term ladders, overage, channel transfer price, and renewal.
- Draft -> validate -> propose -> distinct finance approval -> scheduled activation -> immutable history/retirement.
- Full before/after economic diff, affected accounts/contracts, source evidence, and rollback plan.

### 4. Make production controls authoritative

- Add audited Capabilities Admin; default every production sales motion off.
- Replace fixture agreement/approval pages with persisted projections.
- Add safe production bootstrap for staff/approvers, provider references, disabled capabilities, initial catalog, and mapping records. Never use the demo seed in production.
- Make worker providers capability-aware so a direct pilot does not require every future provider to boot.
- Align `.env.example` and runbooks with executable environment requirements.

### 5. Qualify a direct-production pilot

Before enabling direct sales, prove in staging and then a tightly scoped production pilot:

`account -> approved terms -> PAYG enrollment/quote -> provisioning -> usage -> monthly rating -> invoice -> payment -> accounting/reconciliation -> correction/credit -> webhook replay -> cancellation/final invoice`

Required evidence includes protected green CI, migration verification, named staging/production environments, observability and alerts, backup/restore drill, provider activation tests, rollback drill, RLS/security checks, and signed external gates.

### 6. Build the channel control plane before channel activation

Add versioned partner programs and enrollments, normalized transfer tiers, commission snapshots, prospect registration/dedupe, disputes, hierarchy settlement, payout eligibility, commission statement lifecycle, brand versions, support ownership, account ejection/transfer, and authoritative partner projections.

Referral, resale, distributor, marketplace, and white-label switches remain off until their golden transactions settle and reconcile end to end.

## Approvals and inputs still required

The policy framework above can be approved now. The following inputs must be supplied before a production price book or legal offer is activated:

1. Finance-approved fully loaded unit COGS by region and workload, including 1x/3x/10x egress and request/object-size sensitivity.
2. Signed USD list/floor/discount and channel economics with owner, version, hash, and effective date (`EXT-COMMERCIAL-01`).
3. Tax registrations, calculation provider, exemption/resale-certificate workflow, and invoice wording (`EXT-TAX-01`).
4. Storage MSA/order form, DPA, support policy, security and residency schedules, deletion/export/switching terms, marketplace/partner paper, and reconciled privacy wording (`EXT-LEGAL-01`).
5. Authoritative region topology, durability/availability boundaries, capacity, RPO/RTO, support response matrix, monitoring source, and SLA-credit policy.
6. Trial abuse, small-object/API, multipart, versioning, cancellation, retention, crypto-erasure, export, and final-deletion policies.
7. Fil One identity, organization, SKU, region, provisioning, usage, Stripe, CRM, and accounting mappings with activation tests and rollback owners.
8. Named deployment environments, provider credentials in the secret manager, observability backend, backup/restore evidence, protected CI, and final launch approvers.

## External benchmark rationale

- [Backblaze B2](https://www.backblaze.com/cloud-storage/pricing) is `$6.95/TB-month` with free egress to 3x average storage and paid excess.
- [Wasabi](https://wasabi.com/pricing) is `$7.99/TB-month`, generally subject to a 1-TB invoice floor, minimum storage duration, and egress policy; its public MSP bands reach roughly the low-to-high 20% range for committed partners.
- [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/) is `$0.015/GB-month` Standard with no egress charge but request fees; Infrequent Access adds retrieval and duration economics.
- [Storj](https://www.storj.io/pricing) is `$7/TB-month` Standard plus egress.
- AWS, Microsoft, and Google commercial marketplaces generally charge roughly 1.5-3% at scale/public terms, with channel/private-offer variants. See [AWS listing fees](https://docs.aws.amazon.com/marketplace/latest/userguide/listing-fees.html), [Microsoft private offers](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/private-offers-for-channel), and [Google revenue share](https://cloud.google.com/terms/marketplace-revenue-share-schedule).
- [Stripe US pricing](https://stripe.com/pricing) makes card-funded enterprise invoices materially more expensive than ACH; marketplace/MoR and Connect liability must be modeled separately.

Fil One's `$4.99` list price is already materially below the relevant independent-cloud-storage benchmark while offering a more generous egress promise. The launch advantage is simplicity. The commercial system should defend that promise with accurate metering, margin gates, versioned policy, and explicit channel economics—not introduce more headline tiers.

## Decision protocol

For review, mark each `COM-*` row `approved`, `approved with change`, or `deferred`. Record the final value, owner, approval evidence, and effective date. Approval of this register does not activate an offer; activation requires all relevant external gates, executable golden-transaction tests, and two-person publication in Clockwork.
