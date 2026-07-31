# Fil One Commerce Platform: Build Specification

**Status:** Approved direction. Full build, complete and polished. Revised after
three-lens adversarial review (commercial/finance, buyer/legal/partner,
engineering delivery), July 31. **Author:** James Kurz, drafted with Claude
**Date:** July 31, 2026 **Source concept:** "The Frictionless Commerce Platform"
document (screenshots, July 2026)

---

## 1. What this is

A self-service commerce platform inside the existing Fil One product:
registration, legal agreements, quotes, POCs, orders, provisioning, invoicing,
payment, renewals, and offboarding for direct clients and channel partners, with
a back-office view over all of it. It replaces the email-PDF-redline chain for
business deals and gives partners a transacting path that does not require a
partner-ops team.

Fil One already has the self-serve half: a prospect can sign up, accept the
terms of service, store data, and pay by card through Stripe today. This
platform builds everything above pay-as-you-go: annual business plans,
enterprise committed capacity, MSP and embedded offers, partner quoting and
reselling, counter-signed agreements, purchase orders, term tracking, and
renewals.

The platform is also a sales asset in its own right. Being easy to buy from is
the durable differentiator the concept document describes, and for a company
selling infrastructure against AWS, Wasabi, and Backblaze, a buying experience
that looks and works like a mature cloud vendor's is proof of engineering
quality. Every enterprise meeting and partner briefing demos the portal. It
ships complete and polished; §22 defines the build sequence and what gets
deferred if something has to give.

The platform is international by design. Spain and the UK are the first non-US
markets, not special cases: currency, tax, agreement variants, and residency are
configuration dimensions (§19), so each new country is new rows in existing
tables, not a new project.

The concept document this adapts was written for a generic managed-services
company with four purchased back-end systems (CRM, CLM, provisioning, ERP). Fil
One is a product company with an engineering-grade monorepo and Stripe already
integrated. The right translation is one commerce service in our own stack, with
Stripe as the billing and payments engine and a thin e-signature integration for
counter-signed documents. We keep the concept's core ideas: one artifact chain,
self-service by default, humans as exception queues, and reporting that reads
the operating data directly.

### Sprint deliverables this system serves

| Sprint item                               | Due                | What the platform provides                                                                         |
| ----------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| §2 Offer and SKU book                     | Aug 7 / 14         | Price book is the machine-readable form of the SKU book                                            |
| §2 Margin model and order tests           | Aug 14             | Order-to-entitlement tests for self-serve, direct, and partner run against this system             |
| §3 Customer legal package                 | Aug 7 / 28         | Agreement templates, click-through records, e-sign routing                                         |
| §5 POC package                            | Aug 21             | POC module: isolated accounts, caps, expiry, success tests, conversion                             |
| §6 Partner program, terms, and deal rules | Aug 14             | Deal registration, partner pricing, attribution, merchant-of-record split, price floor enforcement |
| §6 Partner hub                            | Aug 7 / 21 / Sep 4 | The partner portal is the hub's transactional core                                                 |
| §8 Weekly scorecard and reconciliation    | Aug 21 / Oct 23    | The reporting layer; CRM, billing, usage, and attribution reconcile because they share one source  |

---

## 2. Design principles

1. **Self-service is the default path.** Human involvement is an exception
   triggered by policy (non-standard terms, pricing below guardrails, credit
   exposure, restricted parties), never a step in the happy path. Each exception
   is a queue with an owner, a named backup, and a response target.
2. **One artifact chain, no re-keying.** Registration, agreement, quote, order,
   entitlement, invoice, payment. Each object is created from the one before it
   and carries its identifiers forward. The quote is the pricing source of
   truth; the order is the commit; the provisioning event is the trigger to
   bill.
3. **The operating system is the reporting system.** A quote created at 2pm is
   in the forecast at 2pm, and every number traces to the contract behind it. No
   month-end reconstruction.
4. **We invoice one party and we notify the party we invoice.** Direct clients
   hear from us. Partner-sourced end clients never hear from us commercially;
   the partner is alerted and owns the conversation. (Product-required
   communications, breach notices, and pass-through terms are defined in §8 and
   §13.)
5. **The portal is a sales asset.** Demo-ready polish is a requirement. Every
   surface must look finished, load fast, and handle the empty, loading, and
   error states a prospect will actually see. Quality bar: a buyer should assume
   a much larger company built it.
6. **Claims discipline extends to the platform.** Quote line items, order
   confirmations, and portal copy pull product descriptions from the claims
   register's approved wording (sprint §1). The platform never generates a
   product claim of its own.
7. **Complete does not mean bespoke.** Volume through Q1 is tens of accounts.
   Stripe, Common Paper, and the e-sign provider do the heavy lifting; the build
   is the object chain, the portal, the partner logic, and the reporting.
   Nothing requires scale engineering, but the object model is the one we would
   still want at 100x.
8. **Country is configuration.** Currency, tax treatment, agreement variants,
   collection rails, and residency are data and deployment settings, never code
   forks. Entity, registration, and filing questions per country belong to the
   accountant and counsel; the schema must not need to change to hold their
   answers.
9. **The self-service portal has an assisted twin.** Some enterprise buyers
   cannot use vendor portals at all. The back office can run the entire chain on
   an account's behalf (quote, e-sign by email, PO recording, invoice delivery
   to an AP address) so those deals still produce the same artifact chain with
   the same records.

---

## 3. Two tracks, one machine

| Step                   | Client track                                                                   | Partner track                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agreements             | ToS or CSA (click-through), order form, DPA; counter-signed MSA for enterprise | NDA, partner agreement per path (referral or reseller/MSP), counter-signed; partner addendum for changes                                                |
| Merchant of record     | Fil One                                                                        | Referral: Fil One (end client contracts with us). Resale: the partner is merchant of record to its end client; we sell to the partner at transfer price |
| Quote                  | For itself, at list or contracted price                                        | For a named end client. Resale: our quote to the partner at transfer price, plus a partner-priced quote document the partner presents onward            |
| Purchase order         | Client's own PO, or in-portal order confirmation                               | Partner's PO to us, referencing the end-client quote                                                                                                    |
| Provisioning           | Client organization and entitlements                                           | End-client organization, visible to the partner                                                                                                         |
| Invoice and collection | To the client                                                                  | To the partner only; we never bill their end client                                                                                                     |
| Portal view            | Own account only                                                               | Portfolio of end clients, plus the partner's own commercials                                                                                            |
| Renewal notice         | Client alerted directly, renews in portal                                      | Partner alerted per end client, renews on their behalf                                                                                                  |

The partner's own governing agreement carries its own term. If it lapses, the
partner loses the right to quote and place new orders. In-flight end-client
services run to their end dates under the agreement's surviving terms (payment,
liability, data protection, and audit clauses survive for in-flight orders; see
§8). Both clocks appear in the partner portal, agreement clock first.

### Offers carried on each track

From the SKU book (sprint §2, due Aug 7/14). The SKU book is the source for
prices, minimums, trial limits, and egress treatment; this spec defines how each
offer flows, not what it costs.

| Offer                         | Track                        | Agreement                                                   | Billing shape                                                                                       |
| ----------------------------- | ---------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Pay-as-you-go                 | Client (exists today)        | Click-through ToS                                           | Stripe metered subscription, monthly in arrears                                                     |
| Annual business               | Client                       | Click-through CSA + order form                              | Annual or monthly commit, overage metered                                                           |
| Enterprise committed capacity | Client                       | Counter-signed MSA/CSA + order form, DPA, security addendum | Committed capacity for a term, overage metered, invoice terms possible                              |
| POC                           | Client or partner end client | POC terms + permitted-data rules                            | Zero-price entitlement with caps and expiry; converts to a paid order                               |
| Reseller / MSP                | Partner                      | Counter-signed partner agreement (resale)                   | Partner buys at transfer price; consolidated partner invoice; partner sets its own resale price     |
| Referral / agent              | Partner                      | Counter-signed referral agreement                           | End client contracts with us directly; partner earns commission on attributed net collected revenue |
| Embedded / white-label        | Partner                      | Counter-signed, custom                                      | Deferred; build when a producing partner creates the need                                           |

---

## 4. The lifecycle, end to end

Steps marked AUTO require no action from anyone at Fil One. Steps marked SELF
are the customer or partner acting alone. HUMAN appears only via exception
queues. Every step below can also be driven from the back office on an account's
behalf (principle 9) with identical records.

1. **Register.** (SELF) Company details, tax and billing identity (VAT/tax IDs
   validated at entry), users and roles. Domain-verified business email;
   declares client or partner track. Creates the account in the commerce DB and
   mirrors it to the CRM.
2. **Complete the procurement profile where the deal needs it.** (SELF or
   assisted) AP contact and invoice-delivery address, PO requirements, tax or
   resale exemption certificates, and our supplier documents to them (W-9/W-8,
   certificate of insurance, bank verification). Supplier-portal onboarding into
   buyer systems (Coupa, Ariba) is a tracked recurring task with an owner, not
   an exception.
3. **Execute agreements.** (SELF) Click-through ToS/CSA/DPA execute instantly
   with a full acceptance record including an authority attestation.
   Counter-signed documents route through the e-signature system (redirect flow
   at launch, embedded signing later); standard templates need no legal review,
   edits route to counsel as an exception. Deals on the customer's paper are
   recorded as first-class agreements (§8).
4. **Generate a quote.** (SELF) Configure offer, term, committed volume, and
   region against the published price book, in the customer-facing quote
   builder. Partners quote for a named end client; on the resale path the
   partner also gets a partner-priced quote document for its own customer.
   Discounts inside guardrails price instantly; below-guardrail pricing routes
   to the pricing exception queue. Every issued quote renders as a branded PDF.
5. **Run a POC where the deal needs one.** (SELF setup, HUMAN qualification) An
   approved POC provisions an isolated environment with caps, named keys,
   expiry, and success tests attached. Conversion pre-populates the paid quote
   and keeps the tenant and its data (§11).
6. **Submit the order.** (SELF) Accept the quote in-portal or upload a PO bound
   to a specific quote version. The buyer's PO number becomes a first-class
   field carried onto every invoice. This is the commit event; it closes the CRM
   opportunity and generates the order form document, pinned to the governing
   agreement version.
7. **Provision.** (AUTO) The accepted order creates or updates the organization
   and entitlements through the commerce-to-orchestrator bridge (§18), for the
   client or the partner's end client, with credentials and notification to the
   right parties. End-client first login requires pass-through end-user terms
   acceptance (§8).
8. **Invoice.** (AUTO) Provisioning confirmation generates the Stripe invoice
   against the order, to the client or to the partner, carrying the PO number
   and delivered to the AP address. Never to a partner's end client.
9. **Collect and apply cash.** (AUTO for auto-charge; tracked for terms) Card,
   ACH, or bank transfer (wire, SEPA, BACS) in the portal or against the
   invoice. Net-terms collections have a named owner and a dunning calendar;
   status, aging, and receipts appear in the account as they settle, via Stripe
   webhooks.
10. **Meter and true up.** (AUTO) Usage events flow to the commitment ledger and
    Stripe meters; overage bills per the commit type and contracted overage rate
    (§10).
11. **Amend, renew, decline, or end.** (SELF) Mid-term changes are Amendments
    (§12), never overlapping orders. Term alerts fire ahead of notice windows;
    renewal is a pre-populated quote through the same path; a customer can
    decline renewal in-portal, and notice received outside the portal is
    recorded against the order with a served-on date. Cancellation and
    termination run the offboarding flow (§13).
12. **Keep the record.** (AUTO) Every agreement, quote, order, amendment,
    invoice, payment, notice, and certificate stays in one account view,
    searchable and exportable, for client, partner, and back office alike.

---

## 5. Domain model

One customer master and one price master feed everything. The commerce DB is the
system of record for all objects below; CRM, Stripe, and the provisioning layer
hold mirrors or projections, never the master.

### Core objects

**Account.** A legal entity we deal with. One legal entity is exactly one
Account; its **relationship roles are a set, not an enum**: `direct_client`,
`partner`, `end_client` can coexist on one Account (a company can buy direct and
also be sourced by a partner; a partner can consume for itself). Sourcing and
visibility are order-level, not account-level: each order knows whether it is
direct or partner-sourced and through whom, so a co-mingled entity sees its
direct orders in its portal, its partner-sourced orders show through the
partner, and renewal notices follow each order's invoicing party. Fields: legal
name, registered address, validated tax/VAT IDs, billing and **AP contacts**,
invoice-delivery address, domain, country, currency, restricted-party screening
status, Stripe customer ID, CRM record ID. **ProcurementProfile** sub-object: PO
requirements, exemption certificates (jurisdiction, ID, expiry, document),
buyer-side supplier-portal status, our supplier documents furnished (W-9/W-8,
COI) with dates. Partner accounts add: agreement type, discount tier or
commission rate, aggregate credit limit, `parent_partner_id` (nullable; holds
distributor-to-reseller structure even though two-tier logic ships later).

**Organization / User / Role.** The product-side identity objects. The product
today has single-admin organizations with an unused two-value role enum;
membership, invites, and role checks are built first, as a foundation
deliverable (§22). Roles at minimum: `owner`, `admin`, `billing`, `member`;
partner-side adds `partner_admin`, `partner_seller`. Every commerce action is
attributed to a user; shared logins are prohibited platform-wide. SSO is a
committed fast-follow, labeled per the sprint availability sheet.

**AgreementTemplate.** A versioned legal document: type (ToS, CSA, DPA, MSA,
order form terms, POC terms, end-user pass-through terms, partner agreement,
addendum), version, jurisdiction variant, effective date, storage hash of the
canonical text, execution mode (`click_through` | `counter_signed`), approval
status from counsel.

**Agreement.** An executed instance: account, **paper (`ours` | `theirs`)**,
template + version when on our paper, uploaded executed PDF and negotiation
status when on theirs, execution mode, evidence (§8), effective date, term
length, renewal type (auto-renew | expires), notice window, status (`active`,
`in_notice`, `expired`, `terminated`), superseded-by pointer, and a **KeyTerms
record**: structured fields for negotiated obligations the machine must act on
(SLA credit schedule, liability cap, breach-notice clock, price protection at
renewal, audit rights, retention-liability rule). Renewal, billing, and the
SLA-credit path read KeyTerms; counsel populates it as part of executing any
non-standard deal.

**PriceBook / RateCard.** Versioned, effective-dated machine-readable SKU book,
**per currency**: SKUs, unit prices by region, minimums, trial limits, egress
treatment, **commit type (`period_allowance` | `term_drawdown`) and a distinct
contracted overage rate per SKU**, floor prices from the margin model, partner
transfer-price tiers by agreement type, QBO income-account mapping and **Stripe
tax code per SKU**. Only one version per currency is active for new quotes;
existing orders keep the version they were priced on.

**Quote.** Account (and end-client account when partner-issued), price book
version, line items (SKU, quantity/commit, term, unit price, overage rate,
discount), totals, margin-floor check result, expiry date, status (`draft`,
`issued`, `accepted`, `expired`, `superseded`, `rejected`), created-by, revision
chain, rendered PDF reference. On the resale path, additionally a
**partner-priced quote document**: partner name and logo, partner-entered resale
price, our transfer price and discount suppressed. Immutable once issued;
changes create a new version.

**POC.** Qualification record (workload, permitted-data class, success tests,
commercial range), isolated organization, caps (capacity, duration, egress),
named keys, expiry date, support owner, milestone dates (kickoff, midpoint,
final report), cost and engineering-time tracking, status (`proposed`,
`approved`, `active`, `expired`, `converted`, `closed`), conversion pointer to
the resulting quote.

**Order.** The commit. Accepted quote version, **pinned governing agreement
version**, sourcing (`direct` | `partner:<id>`), PO number and PO document,
signer identity with authority attestation, status (`submitted`, `accepted`,
`provisioning`, `active`, `amended`, `completed`, `cancelled`, `terminated`).
Carries the service term clock: start, end (may be co-terminated to a parent
agreement anniversary), notice date. Generates the order form document on
acceptance.

**Amendment.** First-class mid-term change: parent order, effective date, delta
lines (upgrade, downgrade, term extension, co-termination), proration method,
superseded lines. An amendment supersedes lines on the parent order rather than
creating a second order, so one service has one term clock and the forecast
reads net of superseded lines.

**CommitmentLedger.** Per committed order: the commit balance and its
consumption over time, per the commit type. The ledger, not Stripe meter
thresholds, decides when overage exists; the platform pushes priced overage
lines to Stripe. This module carries the heaviest contract-test load in the
codebase.

**Entitlement.** What the order grants: SKU, committed volume, region,
organization, activation timestamp, **maximum Object Lock retention date across
the tenant** (drives what dunning and offboarding may lawfully do), linkage to
the orchestrator's provisioned resources.

**Invoice / Payment / CreditNote / Refund / DisputeCase.** Local records keyed
to Stripe IDs, holding order linkage and denormalized amounts. Credit notes
carry reason codes and approval. Refunds move cash and are distinct from credit
notes. DisputeCase tracks chargebacks with evidence deadlines. All three emit
negative commission accruals where a referral partner was paid on the underlying
revenue.

**InboundNotice.** A legal notice received outside the portal (non-renewal,
termination, breach claim): account, order, type, served-on date, evidence
document, recorded-by. Auto-renew logic checks InboundNotice before firing.

**Termination / DeletionCertificate.** Offboarding record per order or account:
effective date, final billing state, entitlement teardown confirmation from the
orchestrator, deletion schedule per the documented deletion behavior, and the
issued deletion certificate. Where Object Lock retention prevents deletion, the
certificate states scope, the locked exclusions, and their retention expiry
dates. Retained after account closure for the contract retention period.

**Registration (deal registration).** Partner, named end client, workload,
expected volume, status (`registered`, `approved`, `expired`, `converted`,
`rejected`, `disputed`), protection window, decision timestamps. House-account
and prior-deal detection runs against the unified Account (one entity, one
Account) so co-mingled entities resolve correctly.

**Novation / ConversionRecord.** The path for an end client becoming a direct
client (on partner default, partner exit, or agreed handoff): new direct
agreement executed, billing identity created, pricing re-established without
disclosing partner economics, service continuity preserved. Referenced by the
partner agreement's step-in clause (§8).

**CommissionAccrual.** Referral-path only: attributed invoice, rate from the
partner agreement, computed on **net collected revenue**, negative accruals from
credit notes, refunds, and chargebacks, holdback per the partner agreement,
period, statement ID, status (`accrued`, `stated`, `paid`). Payment execution is
manual at launch; the statement nets clawbacks.

**Event.** Append-only log of every state change: object, actor, timestamp,
before/after, request ID. This is the audit trail, the CRM sync feed, and the
SOC 2 evidence stream in one.

### The chain

Registration creates the Account. Agreements attach to the Account. A Quote
references Account + PriceBook version. A POC converts into a Quote. An Order
references a Quote version and pins its governing Agreement version. Amendments
supersede Order lines. Entitlements reference the Order. Invoices reference the
Order and carry its PO number. Payments, CreditNotes, Refunds, and Disputes
reference Invoices and flow through to CommissionAccruals. Renewals create new
Quotes pre-populated from the expiring Order; InboundNotices gate auto-renewal.
Terminations close the chain with a certificate. No object is ever created
without its upstream reference.

---

## 6. Portal surfaces

Seven surfaces, each rendering the same objects the back office sees. Built as
routes in the existing `@filone/website` SPA (React 19, TanStack Router,
Tailwind v4), gated by role.

| Surface               | Contents                                                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**         | Open quotes, orders awaiting action, POCs running with days remaining, services live, invoices due. One glance shows where every deal stands.                                                                        |
| **Agreements**        | Every executed contract with version, signatory, effective and renewal dates, including deals on the customer's paper. Execute new ones here. Term bar per agreement.                                                |
| **Quote builder**     | Configure, price, and issue a quote in a few fields, customer- and partner-facing at launch. Duplicate, revise, or expire prior versions. Download as PDF; resale partners also download the partner-priced version. |
| **Orders & services** | POs submitted, provisioning status, live entitlements and usage, contract term status per service, amendments. Partners see it per end client. A co-mingled entity sees its direct orders only.                      |
| **POCs**              | Active and past POCs: caps, usage against caps, success tests, expiry countdown, milestone dates, one-click conversion to a paid quote.                                                                              |
| **Billing**           | Invoices (with PO numbers), credit notes, payment methods including bank transfer details, receipts, aging. Pay in place; download for the finance team.                                                             |
| **Account & users**   | Legal entity, validated tax IDs, AP and remit-to details, procurement profile and exemption certificates, roles and approval limits, notification routing, offboarding requests and deletion certificates.           |

Partner accounts additionally get the **portfolio view**: every end client with
term status and upcoming renewals sorted by expiry, plus the partner's own
agreement clock shown first.

**Read-only support visibility** ships when the support-system feed is
available. Visibility only; intake stays in the existing support channel.

---

## 7. Design and experience quality

The portal must read as a finished product from a mature vendor. Concrete
requirements, not aspirations:

- **One design system with the marketing site and sales kit.** Extend the
  existing website design language (Inter, Tailwind v4, CVA variants, Phosphor
  icons) into a documented component library in the repo's Storybook: buttons,
  forms, tables, term bars, status badges, stat tiles, timelines, document
  cards, queue rows. Design direction is reviewed with Chris Rocco alongside the
  sales kit so the portal, deck, and website share one visual language.
- **Signature elements done well.** The term bar (elapsed time, notice window,
  end date) is the product's visual identity, rendered per service and rolled up
  per account. Dashboards use restrained, consistent charts (existing recharts
  dependency) for usage and spend.
- **Every state designed.** Loading skeletons, designed empty states with a next
  action, inline validation, and human-readable error states on every surface.
  No raw spinners, no dead ends, no placeholder copy anywhere in the shipped
  product.
- **Fast.** Route-level code splitting, optimistic UI on portal actions,
  sub-second interactions on cached data. Performance is part of the wow.
- **Accessible and responsive.** Keyboard-navigable flows, visible focus states,
  WCAG AA contrast, and layouts that hold from a 13-inch laptop in a conference
  room to a phone. Storybook a11y checks stay green.
- **Documents match the portal.** Quote PDFs, order forms, partner-priced
  quotes, commission statements, and deletion certificates share one branded
  document template. A buyer who forwards the PDF to procurement is forwarding
  the brand.
- **Demo environment.** A seeded, resettable demo tenant with clearly fictional
  accounts, quotes, POCs, invoices, and renewals at interesting states, used in
  every sales and partner meeting. Reset is one command; demo data never mixes
  with production.

---

## 8. Agreements layer

### Document catalog and execution mode

| Document                                    | Base                                                      | Mode                                                | Notes                                                                                       |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Terms of Service (PAYG)                     | Common Paper ToS (customized)                             | Click-through                                       | Already effectively in place; migrate to versioned records                                  |
| Cloud Service Agreement (annual business)   | Common Paper CSA + Fil One cover page                     | Click-through below the threshold (see below)       | Standard terms, standard SLA                                                                |
| MSA / CSA (enterprise committed)            | Same CSA base, negotiated cover page; or customer's paper | Counter-signed                                      | Redlines route to counsel; KeyTerms populated on execution                                  |
| Order form                                  | House template                                            | In-portal acceptance or counter-signed with the MSA | Binds a specific quote version, pins the agreement version                                  |
| POC terms                                   | House template with permitted-data rules                  | Click-through                                       | Caps, expiry, data classes, no production-claim rights                                      |
| End-user pass-through terms                 | House, short form                                         | Click-through at end-client first login             | AUP privity, data-protection terms, and our breach-notice route for resale-path end clients |
| DPA + subprocessor schedule                 | Common Paper DPA                                          | Click-through, attached automatically               | Per-jurisdiction transfer terms (EU SCCs, UK IDTA) per counsel                              |
| Security addendum, SLA, support policy, AUP | House, from the security packet                           | Attached to CSA/MSA                                 | Single source with the claims register                                                      |
| NDA                                         | Mutual house template                                     | E-sign, either party initiates                      | Due Aug 7 in the e-sign system                                                              |
| Partner agreements (referral, reseller/MSP) | House, per program guide                                  | Counter-signed                                      | See required contents below                                                                 |

Common Paper's CSA, ToS, and DPA are free standard agreements maintained like
open source and structured exactly for this click-through plus cover-page
pattern; counsel review customizes rather than drafts from scratch. The platform
ships with these defaults and swaps in counsel-final text as data, so the Aug 28
legal-package date does not block the build.

### Partner agreement required contents

Counsel drafts; the platform enforces. Each partner agreement must carry:
agreement type and merchant-of-record position, transfer-price tier or
commission rate, permitted offers and territory, term and notice, **subprocessor
DPA with a clocked incident-notification obligation** (we are a
processor/subprocessor for end-client data with no direct contract with the end
client), **surviving terms governing in-flight orders after lapse or
termination** (payment, liability, data protection, audit), **a step-in right
permitting Fil One to convert end clients to direct on partner default**
(executed via the Novation record), commission clawback and holdback terms,
dispute process for deal registration, and direct-contact and conversion rules.

### Click-through threshold and authority

Click-through applies below a counsel-set threshold evaluated on **cumulative
contracted account value** (initial order plus expansions and renewals), not
per-quote. When an account crosses the threshold, the next commercial event
requires counter-signed re-execution. Click-through records capture a **title
and authority attestation** ("I am authorized to bind <entity>") alongside user
identity and role, account, template version and SHA-256 hash of the exact text
presented, timestamp, IP address, and UI context. Courts enforce clickwrap when
the record proves who accepted which version when, and the authority attestation
closes the "an engineer clicked it" gap. Counter-signed documents execute in the
e-signature system via redirect flow with a completion webhook (embedded signing
is a post-launch enhancement); the platform stores the signed PDF, envelope ID,
and certificate of completion.

### Versioning

Template changes are new versions with counsel approval recorded; an account's
active agreement never mutates, and **every order pins the agreement version
that governs it**, including through auto-renewal (an auto-renewed order stays
on its pinned version; version upgrades are an explicit, recorded re-execution).
Renewals on unchanged standard terms re-execute in-portal with no legal review.
Changed terms, a new discount tier, or a change of agreement type route to the
legal exception queue.

---

## 9. Pricing engine and guardrails

- The price book is data, versioned per currency in the commerce DB, with an
  admin editor. The published rate card on the website renders from the same
  data, closing the sprint audit finding that pricing answers differ across
  pages.
- The margin model (sprint §2, Aug 14) produces a **floor price per SKU and
  region**. Quotes at or above floor and within the standard discount matrix
  price and issue with zero review. Floors are configuration; enforcement ships
  before the model lands and activates when the numbers are entered.
- **The floor applies to prices we set: direct prices and partner transfer
  prices.** On the resale path the partner is merchant of record to its end
  client and sets its own resale price; we do not enforce, suggest, or record a
  required end-client price (resale price maintenance is a hardcore restriction
  in the EU and UK). Pricing-parity expectations, if any, are contract terms
  counsel drafts, not code.
- Commit pricing carries the commit type and the contracted overage rate as
  explicit quote lines (§10). Amendments price with the proration method
  recorded on the amendment.
- Below-guardrail pricing is not blocked; it routes to the pricing exception
  queue with the margin impact computed and displayed. Approval or rejection is
  recorded on the quote.

---

## 10. Billing and payments (Stripe as the engine)

Stripe Billing carries: customers, subscriptions and subscription schedules,
invoices, dunning and smart retries on auto-charge, card, ACH, and
**bank-transfer payment rails (wire, SEPA, BACS)**, receipts, and Stripe Tax
with **per-SKU tax codes** for calculation across US states that tax cloud
storage and for EU/UK VAT with reverse-charge on validated VAT IDs. A dedicated
metering platform (Metronome, Orb) is unnecessary at our volume.

Platform responsibilities on top of Stripe:

- **The commitment ledger owns commit semantics.** Each committed order declares
  `period_allowance` (commit resets per period, overage per period) or
  `term_drawdown` (commit is a term-scoped balance drawn down by usage, overage
  only after exhaustion), per the SKU book. The ledger computes overage at the
  **contracted overage rate on the quote** and pushes priced overage lines to
  Stripe. Stripe meter thresholds are never the arbiter of overage. This module
  gets the deepest contract-test suite in the platform.
- **Usage pipeline.** The backend measures storage and egress; the commerce
  layer attributes usage to entitlements, feeds the commitment ledger, and
  reconciles metered totals against orchestrator usage monthly.
- **Partner invoicing and credit.** One Stripe customer per partner; end-client
  charges roll up to consolidated partner invoices with per-end-client line
  grouping. **Partners transact on prepay or auto-charge until they have payment
  history; an aggregate partner credit limit caps total exposure across all end
  clients, and a breached limit blocks new end-client provisioning** (never
  running services). Partner default triggers the step-in evaluation (§8), not
  automated suspension of end clients.
- **Invoice terms and collections.** Default is auto-charge. Net terms are
  granted per account through the credit exception queue against a **written
  credit policy (limits, escalation, and what happens at each aging step)**. A
  net-terms order requires PO number, AP contact, and vendor-setup status
  complete before invoicing. Stripe smart retries apply only to auto-charge;
  **terms invoices get a dunning calendar and a named collections owner** (§16).
- **Nonpayment policy, encoded and retention-aware.** Aging past the first
  threshold pauses new orders and POC conversions. Aging past the second
  triggers a human decision on suspension, write-access suspension before any
  deletion, and deletion only per the documented schedule with notice, **and
  never for objects under active Object Lock retention: the entitlement's
  maximum retention date gates the state machine.** The retention-liability rule
  (customer liability for storage through retention expiry, or a cap on
  retention beyond the paid term) is a KeyTerms field the CSA carries and the
  Aug 14 margin model prices.
- **Credit notes, refunds, disputes.** Credit notes reduce AR with reason codes
  and approval; refunds move cash; chargebacks are DisputeCases with evidence
  deadlines. All three emit negative commission accruals.
- **Webhooks are the source of payment truth.** Payment status, aging, and
  receipt data flow from Stripe events into the commerce DB and the portal. No
  polling, no manual entry.

### Accounting spine (QuickBooks Online)

QBO is the general ledger and the source of financial statements. The commerce
DB is the operational record; Stripe is the billing engine and AR subledger.
Invoices originate in Stripe only; nothing creates or edits invoices in QBO, and
no revenue is keyed into QBO by hand.

- **Posting model matches the billing model.** Auto-charge (card/ACH) volume
  posts summary-per-payout through the connector (Synder, Acodei, or Stripe's
  QBO app; selected at kickoff with the accountant). **Anything on net terms
  posts to QBO as AR at invoice issuance**, so the GL carries real receivables
  and an accrual balance sheet; payout summaries alone are a cash-basis pattern
  that would break the tie-out the moment terms exist.
- **Deferred revenue.** Prepaid commit SKUs map to a deferred-revenue liability
  account at issuance. The platform emits a monthly revenue-recognition schedule
  per order; the accountant books one summary entry moving deferred to earned.
  Stripe Revenue Recognition is the upgrade path; no rev-rec logic is built
  beyond the schedule export.
- **Revenue by merchant-of-record position.** Direct and referral revenue posts
  gross; resale-path revenue posts at transfer price. The §17 reports observe
  the same split so ARR is stated consistently.
- **Sales tax has one brain.** Stripe Tax calculates and collects; QBO's own
  computation stays off; collected tax books to a liability account. Exemption
  certificates on the ProcurementProfile suppress tax where valid; registration
  and filing obligations are tracked with the accountant per country (§19).
- **Commissions are payables.** Quarterly partner statements (net of clawbacks)
  post to QBO as bills; payment executes from QBO.
- **Cost side.** The orchestrator cost report is ingested monthly **at
  organization/entitlement grain into the commerce DB** (it powers realized
  margin, §17) and summarized into QBO.
- **Monthly three-way tie-out.** Platform revenue report, Stripe, and QBO must
  agree, with variances listed. This is the sprint §8 reconciliation deliverable
  in practice.

---

## 11. POCs

The POC module operationalizes the sprint §5 POC package (due Aug 21):

- **Qualification gate.** A POC is created from a qualification record: named
  workload, buyer, permitted-data class, success tests, commercial range, and
  expiry. Unqualified trials stay on the self-serve trial path.
- **Isolated by construction.** Each POC provisions an isolated organization
  with named keys, capacity and egress caps, explicit restrictions, and logging.
- **Clock and milestones.** Expiry countdown, kickoff, midpoint review, and
  final report dates drive alerts to the support owner and the account. A
  proposal (pre-populated quote) is generated before expiry.
- **Cost tracking.** Infrastructure cost and engineering hours are recorded per
  POC, feeding the margin model's POC-cost line and the weekly scorecard.
- **Conversion keeps the data.** Conversion re-parents the POC organization and
  tenant into the paid order: entitlements upgrade in place, caps lift, and the
  data already stored (a migrated 40 TB test set is the deal) stays where it is.
  No re-upload, no hand migration. Verified results flow to the proof library
  within five business days per the sprint rule.

---

## 12. Amendments and renewals

PAYG has no term; this machinery applies to annual business, enterprise
committed, POC expiries, and partner agreements.

- **Amendments, not overlapping orders.** Upgrades, downgrades, term extensions,
  and co-termination are Amendment objects on the parent order: effective date,
  delta lines, proration method, superseded lines. One service, one term clock;
  the forecast reads net of superseded lines. **Co-termination is supported
  natively**: an MSP adding its seventh end client mid-term can align that order
  to its anniversary with a prorated first period, so it manages one renewal
  date.
- **Term clock per order and per partner agreement:** start, end, elapsed,
  notice window, auto-renew or expiry, pinned governing agreement. Rendered as a
  term bar per service and rolled up per account.
- **Alerts** fire at set intervals before the notice window and end date, with
  one-click paths to **renew, change term, request a change, or decline
  renewal**. A decline is recorded with the same evidentiary weight as an
  acceptance. Notice received outside the portal is recorded as an InboundNotice
  with served-on date and evidence, and auto-renew checks it before firing.
- **Two notification paths.** Direct clients are alerted directly, with the same
  alert to the internal owner so a silent client is visible before the notice
  window closes. Partner-sourced renewals alert the partner per end client; our
  internal job is to confirm the partner has acted. On co-mingled accounts the
  notification path follows each order's invoicing party.
- **Renewal command center (internal).** Term data as a queue: expiring in 30 /
  60 to 90 / 180 days, split direct, partner-sourced, and partner-agreement.
  Risk signals per row (open support issues, declining usage, overdue invoices,
  no portal activity). Status per row with owner and last touch.

---

## 13. Termination and offboarding

Ending well is a trust feature for a storage vendor:

- **Cancellation and non-renewal** run a defined offboarding: confirmation of
  the effective date, final invoice or credit note, a data-retrieval window with
  egress terms stated up front, entitlement teardown confirmed by the
  orchestrator, then deletion per the documented schedule.
- **Retention-aware by design.** Objects under active Object Lock retention
  cannot be deleted, by us or anyone. The offboarding state machine branches on
  the entitlement's maximum retention date; the commercial treatment of locked
  storage after termination follows the agreement's retention-liability
  KeyTerms.
- **Deletion certificate.** On completion, the platform issues a branded
  deletion certificate listing scope, method, and dates, and, where retention
  applies, the locked exclusions and their expiry dates. Certificates and
  offboarding records are retained for the contract retention period.
- **Teardown is deliberately gated.** The product currently maintains an
  invariant that no billing or closure path can request tenant teardown, a
  safety property chosen on purpose. Commerce-initiated teardown is designed up
  front (events, confirmations, certificate flow) but **automated teardown
  activates only after an explicit decision to relax that invariant, with a
  two-person approval step on every destructive action** (§22).
- **Partner track.** End-client termination is partner-initiated; the partner
  sees offboarding status per end client. A lapsed partner agreement never
  interrupts a provisioned end-client service; surviving terms govern in-flight
  orders, and the end-client conversion path (Novation) exists for partner
  default and exit.

---

## 14. Partner layer specifics

- **Merchant-of-record split, enforced in the model.** Referral: end client
  contracts with us, we set price, commission is our expense. Resale: partner is
  merchant of record to its end client, we sell at transfer price, the resale
  price is the partner's alone (§9). The Aug 14 partner program guide records
  the position per agreement type; the platform encodes both.
- **Deal registration** enforces the program guide's rules in code: registration
  data, decision clock, protection window, house-account and prior-deal
  exclusions resolved against unified Accounts, sourced versus influenced
  credit, automatic expiry, explicit extensions, and a **dispute path with an
  owner and a recorded tiebreak** (§16).
- **Attribution is structural.** Revenue is partner-attributed because the order
  chain says so. This is what makes attribution and commission reconciliation
  trivial.
- **Two-tier ready.** `parent_partner_id` holds distributor-to-reseller
  structure (Ingram Micro route) from day one; two-tier quoting and settlement
  logic ships when the Ingram route is confirmed.
- **End-client visibility (default):** the partner sees its end clients'
  entitlements, usage summaries, term status, provisioning and offboarding
  state. The partner does not see our margin. The end client sees nothing
  commercial from us on the resale track; it does accept pass-through end-user
  terms at first login (§8).
- **Partner-priced quote artifact.** Resale partners download a presentable
  quote in their own name at their resale price, transfer price suppressed. This
  is deliberately narrower than white-label (which stays deferred) and exists
  because without it every reseller re-keys the quote off-platform and the
  attribution chain starts outside the system.
- **Commissions (referral path):** accrue on net collected revenue, net of
  clawbacks, with holdback per the agreement; quarterly statements generate as
  documents in the partner portal. Payment executes from QBO.
- **Sandboxes:** partner sandbox organizations are zero-price SKU entitlements
  with caps and expiry, flowing through the same provisioning path.

---

## 15. CRM and the customer master

The commerce DB is the customer master. The CRM (selected in sprint §1, live
Aug 5) is a projection for pipeline work: registration creates the CRM account,
quote issuance creates or updates the opportunity with amount and stage, order
acceptance closes it, invoice and payment update financial state. Sync is
one-way outbound via the event log, with CRM-side edits limited to sales-process
fields. Nothing commercial is keyed into the CRM by hand. If the CRM cannot
ingest cleanly, a nightly export is acceptable at launch; the event feed is the
contract.

---

## 16. Exception queues (where humans belong)

| Queue                      | Trigger                                                                 | Owner (launch)    | Backup                | Target              |
| -------------------------- | ----------------------------------------------------------------------- | ----------------- | --------------------- | ------------------- |
| Pricing                    | Quote below floor or outside discount matrix                            | Founder           | Named deputy          | Same business day   |
| Legal                      | Redlines, customer paper, changed renewal terms, new agreement type     | Counsel           | Founder (triage only) | 3 business days     |
| Credit & collections       | Net-terms request; aging step per credit policy; terms-invoice dunning  | Founder           | Named deputy          | Same business day   |
| Restricted parties         | Screening hit; embargoed-country signal                                 | Founder + counsel | —                     | Block until cleared |
| Disputes                   | Invoice dispute, refund request, chargeback (evidence deadline tracked) | Founder           | Named deputy          | 2 business days     |
| Deal registration disputes | Competing claims, house-account challenge                               | Founder           | —                     | 3 business days     |
| POC qualification          | POC request needing approval                                            | Founder           | Named deputy          | Same business day   |

Every queue names a backup approver before launch, because the founder travels;
published targets must be honest against that reality. Each queue is a filtered
view over the same objects with an approve/reject action recorded on the object.
Screening at launch: embargoed-country block list at registration, plus a
denied-party check before any counter-signature or partner activation. Counsel
confirms the screening standard.

---

## 17. The reporting layer

Internal only; clients and partners see their own data in the portal. All
reports are queries over the commerce DB, current as of the last event. These
are management reports; financial statements come from QBO, and the monthly
tie-out (§10) is what entitles the two to agree. Revenue is stated by
merchant-of-record position (gross direct/referral, transfer-price resale) so
ARR is consistent everywhere.

| Report                         | Contents                                                                                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Revenue forecast**           | Contracted revenue by month, net of superseded amendment lines, with terms, renewal dates, and expiry known. Committed backlog separated from pipeline, partner-sourced from direct.                                                                               |
| **Capacity planning**          | Committed and provisioned capacity by region trended against actual stored bytes. Feeds the Spain node economics.                                                                                                                                                  |
| **Renewal and churn exposure** | Revenue at risk by window, segment, and partner, with risk signals and recorded notices attached.                                                                                                                                                                  |
| **Partner performance**        | Bookings, registration-to-close rate, end-client counts, renewal rate, and margin by partner and agreement type.                                                                                                                                                   |
| **Funnel and cycle time**      | Where deals stall: registration to agreement, quote to order, order to provisioned, invoice to cash, POC to conversion.                                                                                                                                            |
| **Margin and POC cost**        | **Realized** margin per order: contracted revenue against ingested orchestrator cost at entitlement grain (§10), price-floor exceptions listed, POC cost and engineering time per deal. Until cost ingestion is live, the report is labeled modeled, not realized. |

The weekly scorecard (sprint §8) reads these directly. Export to CSV everywhere;
no BI tool required at launch.

---

## 18. Architecture

### Placement

New workspace packages in the existing monorepo, deployed by the existing SST v3
pipeline:

```
packages/
├── commerce/            # domain logic: objects, state machines, pricing, commitment ledger, Stripe mapping (pure TS)
├── commerce-api/        # Lambda handlers (Middy), authz, webhooks (Stripe, e-sign)
├── commerce-docs/       # branded document generation: quote PDF, order form, partner-priced quote, statements, certificates
├── backend/             # existing; gains org membership/roles (Lane 0) and the provisioning bridge consumer
└── website/             # existing SPA; gains portal routes and the internal back office under /admin
```

Shared zod schemas for every object live in `@filone/shared`, used by API,
website, and tests, matching the current repo pattern.

### Datastore: Postgres for the commerce domain

The commerce domain goes in Postgres, while the existing product tables stay in
DynamoDB. Rationale: this system's product is correctness and reporting; joins,
sums that tie, foreign keys, and the §17 report set are native SQL. DynamoDB
single-table was considered and rejected because reconciliation and cross-object
queries are the point of the system.

Adoption is an explicit foundation spike with three decisions made before any
schema lands: **connection strategy** (Aurora Serverless v2 in a VPC versus the
RDS Data API; the existing Lambda fleet is not in a VPC today, and VPC adoption
drags in subnets, endpoints, and cold-start changes), **per-PR preview
strategy** (the repo deploys an ephemeral SST stage per pull request; the cheap
answer is one shared instance with schema-per-stage and a migration run in CI),
and **migrations tooling plus backup/PITR posture**. The Event log is a Postgres
append-only table with an outbox to SQS for CRM sync and notifications.

### The provisioning bridge (new, not assumed)

The product today provisions synchronously on the request path
(`ensureTenantReady`), has no queue, no entitlement concept, and no consumer for
commerce events; teardown is deliberately impossible from billing paths. The
bridge is therefore a named foundation deliverable, not wiring: an SQS queue and
consumer, an entitlement-to-tenant mapping, idempotent re-drive on a state
machine written for one-shot use, teardown design behind the gated invariant
decision (§13), and confirmation events back to commerce. The org
membership/roles work precedes it, because provisioning "an organization with
roles" requires organizations with roles to exist.

### Invariants

- **Idempotency everywhere money moves.** Every Stripe call carries an
  idempotency key derived from the commerce object; every webhook handler is
  replay-safe. E-sign webhooks get the same signature-verification and replay
  treatment.
- **Issued quotes, accepted orders, executed agreements, notices, and
  certificates are immutable.** Changes are new versions or amendments with
  pointers. Signed PDFs, click-through text hashes, and certificates are
  content-addressed in S3 with object lock.
- **All writes go through the domain layer.** No handler touches tables
  directly; state machines validate every transition. This is what makes the
  codebase safe for agent-written contributions.
- **Authorization is role plus account scope on every query.** Partner users are
  scoped to their portfolio; end-client data never leaks across partners;
  co-mingled accounts resolve visibility at order level. No shared logins; MFA
  for admin and partner roles.
- **Destructive actions are two-person.** Teardown, forced deletion, and
  migration runs require a second approver, recorded in the Event log.
- **Audit trail is a first-class feature:** the Event table drives the account
  history view and doubles as SOC 2 change evidence.

### Integrations

| System                        | Direction | Mechanism                                                                                                                      |
| ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Stripe                        | Both      | API for customers/subscriptions/invoices/credit notes/refunds; per-SKU tax codes; webhooks for payment truth                   |
| E-signature provider          | Both      | API envelopes, redirect signing with completion webhook (embedded signing post-launch)                                         |
| Aurora orchestrator / backend | Both      | Provisioning bridge: entitlement events on new SQS queue + consumer; confirmations back; teardown gated                        |
| CRM                           | Outbound  | Event-driven sync or nightly export                                                                                            |
| QuickBooks Online             | Outbound  | Connector for sales/fees/payouts with AR-at-issuance for terms; platform exports for rev-rec, commission bills, cost summaries |
| Screening                     | Outbound  | Denied-party check API at registration and pre-signature                                                                       |
| Support system                | Inbound   | Read-only ticket feed (when available)                                                                                         |

---

## 19. International by design

Spain and the UK are the first rows, not the design. Country-varying concerns
and where each lives:

| Concern                           | Where it lives                                                                                                                                 | First rows                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Currency                          | Price book per currency; partner agreement declares its transaction currency; Stripe presentment                                               | USD, EUR, GBP                                                     |
| Collection rails                  | Stripe payment-method configuration per currency                                                                                               | Card, ACH; wire, SEPA, BACS enabled before the first non-US order |
| VAT / sales tax                   | Validated tax IDs on Account; per-SKU tax codes; Stripe Tax with reverse charge on valid VAT IDs; exemption certificates on ProcurementProfile | US states taxing cloud storage; ES, UK                            |
| Agreement variants                | AgreementTemplate jurisdiction variants (governing law, SCCs/IDTA transfer terms)                                                              | US, EU, UK                                                        |
| Residency                         | Deployment configuration per region, disclosed in the subprocessor schedule; commerce DB placement is a counsel-informed deployment decision   | us-east-2 today; EU if Spain requires                             |
| Entity, registration, e-invoicing | Accountant and counsel workstream per country; schema holds their answers (entity on invoice header, per-country registration IDs)             | Spain packet (Aug 21); Living Rock's countries when confirmed     |

Currency and rails are decided on the **partner timeline (Aug 14)**, not the
Spain timeline: the sprint has UK partner meetings by Aug 14 and a possible
Ingram UK order route by Sep 18, and the first UK reseller must be quoted and
invoiced in GBP with a bank-transfer path.

---

## 20. Security, compliance, and open decisions

- MFA enforced; shared enterprise logins prohibited; roles least-privilege.
  Business POCs use isolated accounts per the sprint release gates until
  organizations fully ship.
- Executed documents, acceptance evidence, notices, and deletion certificates
  retained for the contract retention period in object-locked storage.
- EU/UK personal data handled per the DPA and jurisdictional transfer terms; the
  resale path's data-protection chain runs through the partner subprocessor DPA
  plus end-user pass-through terms (§8).
- The platform emits the evidence SOC 2 will want: change log, access reviews,
  payment reconciliation, two-person approvals on destructive actions.
- Legal, tax, and regulatory positions embedded in templates, tax handling,
  screening standards, and the merchant-of-record split require counsel and
  accountant sign-off before first external use (planning boundary, sprint
  checklist).

### Decisions taken and decisions open

| Decision                                                            | Position                                                                                                                                                              | Needs                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Click-through vs counter-signed                                     | ToS, standard CSA, DPA, POC terms click-through below a cumulative-account-value threshold; MSA, partner agreements, customer paper, anything redlined counter-signed | Counsel sets threshold; ships configurable                        |
| Merchant of record                                                  | Split by agreement type: we are MoR direct and referral; partner is MoR on resale, priced at transfer price, resale price uncontrolled                                | Partner program guide (Aug 14), counsel                           |
| Commit semantics                                                    | `period_allowance` or `term_drawdown` declared per SKU with a distinct contracted overage rate                                                                        | SKU book (Aug 7/14)                                               |
| Pricing guardrails                                                  | Discount matrix plus per-SKU floor on our prices only; below floor routes to founder queue                                                                            | Margin model (Aug 14); ships configurable                         |
| Credit                                                              | Auto-charge default; written credit policy for net terms; partner aggregate limits with prepay-until-history; retention-aware nonpayment ladder                       | SKU book payment-failure answer; credit policy drafted at kickoff |
| Retention liability                                                 | CSA carries a retention-liability KeyTerms rule (customer liable through retention expiry, or retention capped at paid term)                                          | Counsel + margin model (Aug 14)                                   |
| Customer master                                                     | Commerce DB; CRM is a projection                                                                                                                                      | CRM selection (Aug 5)                                             |
| Currency and rails                                                  | Multi-currency price books (USD/EUR/GBP) and bank-transfer rails on the partner timeline                                                                              | Aug 14, with accountant                                           |
| E-signature provider                                                | Selected first, before build starts (it is a code dependency, unlike the legal text); redirect signing at launch, embedded later                                      | Selection at kickoff                                              |
| Teardown invariant                                                  | Commerce-initiated tenant teardown designed now, activated only by explicit decision with two-person approval                                                         | Product decision, recorded                                        |
| Stripe-to-QBO connector                                             | Selected at kickoff with the accountant; AR-at-issuance for terms is a hard requirement of the choice                                                                 | Kickoff                                                           |
| Migration of existing base                                          | After launch, behind a feature flag, on a quiet day (§21)                                                                                                             | —                                                                 |
| White-label, marketplaces, distributor logic, embedded signing, SSO | Deferred until demand; schema-ready where cheap (`parent_partner_id`)                                                                                                 | Demand                                                            |

---

## 21. Migration of existing accounts

Existing self-serve customers exist as Stripe customers and product accounts.
Migration creates commerce Accounts keyed to Stripe customer IDs, backfills ToS
acceptance where recoverable, and attaches existing subscriptions as PAYG
Orders. Because no versioned acceptance record exists today, most existing
customers would face a re-acceptance interstitial; forcing that on the live
paying base during launch week is needless risk to the self-serve funnel the
sprint depends on. **Migration therefore runs after launch, behind a feature
flag, rehearsed against a snapshot first, on a quiet day.** Until then, commerce
Accounts exist only for new business, and the two populations are cleanly
separable by construction. Rule: one legal entity, one Account; ambiguous
matches land in a review queue rather than creating duplicates.

---

## 22. Build plan

Built in-house in the existing monorepo with agentic tooling (Claude Code with
Fable as the primary lane, Codex/GPT-5.6 as a second implementation and review
lane). Working method: this spec decomposes into module briefs with acceptance
tests written first; agents implement in parallel worktrees; CI gates are the
existing `pnpm lint`, typecheck, unit tests, plus the money-path suite below.
Agents never hold live Stripe or AWS production credentials. Getting it done
right matters more than any date; the plan below is a dependency order, not a
calendar.

Three rules from the delivery review:

- **Staggered lanes, not six at once.** No more than three lanes run
  concurrently, sequenced so joins land early. The commerce platform is almost
  entirely joins (quote to order to entitlement to tenant; order to Stripe
  schedule; webhook to invoice state; partner scope to end-client query), and
  joins are where agent-built systems fail review.
- **Integration tests are the merge gate.** Every money-path PR must include an
  integration-level acceptance test (composed handler or Playwright), never only
  unit tests. The money-path harness (Stripe test clocks, resettable commerce
  DB, webhook replay fixtures, e-sign sandbox) is a foundation deliverable with
  its own owner, and the harness defines the demo-critical path.
- **Merging is not deploying.** Money-path deploys go behind a manual approval
  environment with a staging soak; `main` auto-deploy continues for everything
  else.

### Deferral order, decided now

Everything in this spec ships. If something must give temporarily, it gives in
this order, decided in writing early rather than discovered late, and picked
back up immediately after launch:

1. Commission statements, the report suite beyond forecast/funnel/margin,
   renewal command center polish
2. Partner portal surfaces (partner transacting continues through the back
   office with identical records)
3. Customer-facing quote builder (quotes issued from back office, received and
   accepted in portal)

**Never deferred:** the demo-critical path (register, click-through CSA with
hashed acceptance record, quote with PDF, in-portal order acceptance,
provisioned org, Stripe invoice, payment), the acceptance-evidence records, the
commitment ledger's correctness, and the seeded demo tenant.

### Build sequence

**Foundations (everything depends on these).** Org membership, invites, and role
checks in the product; the provisioning bridge (SQS queue, consumer,
entitlement-to-tenant mapping, idempotent re-drive); the Postgres decisions
(connection strategy, preview-stage strategy, migrations tooling); e-sign
provider selection; QBO connector and written credit policy with the accountant;
the money-path test harness; design-system components in Storybook. The product
has single-admin orgs and no bridge today, so this is real work, named and
tested, not wiring.

**Phase 1: the spine.** Commerce schema and domain package for every object in
§5; back-office surfaces (accounts, agreements, multi-currency price book
editor, quote issue, order accept); Stripe mapping including the commitment
ledger. Exit: a deal runs account through invoice in the back office on staging,
with an integration test proving it.

**Phase 2: the direct track.** Registration with domain verification and tax-ID
validation, click-through execution with evidence and authority attestation,
procurement profile, customer-facing dashboard/agreements/billing surfaces,
in-portal order acceptance with PO fields, Stripe payment including
bank-transfer rails, provisioning through the bridge, quote PDF rendering. Exit:
the sprint §2 order-to-entitlement tests pass for self-serve (existing flow),
direct (portal), and the partner shape (driven through the back office until
Phase 3).

**Phase 3: the partner track and POCs.** Partner agreements with the §8 required
contents, deal registration with dispute path, partner quoting with the
partner-priced quote artifact, consolidated partner invoicing with aggregate
credit limits, portfolio view, sandbox SKUs, the POC module with data-preserving
conversion, the customer- and partner-facing quote builder, amendments and
co-termination, term clocks and renewal alerts including decline and
InboundNotice. Exit: a partner registers a deal, quotes, orders; the end client
is provisioned and accepts pass-through terms; only the partner is invoiced.

**Phase 4: close the loop and polish.** Renewal command center; forecast,
funnel, and margin reports plus scorecard export; commission statements with
clawback netting; termination flow and retention-aware deletion certificates
(teardown design complete; activation per the gated decision); credit notes,
refunds, dispute cases; screening integration; seeded demo environment; a polish
pass across every surface (empty states, skeletons, motion, responsive, a11y,
copy review against the claims register); money-path suite green on the full
demo-critical path; security review of authz scoping and both webhook surfaces.
**Operations readiness before launch: named backup approvers on every queue, a
one-page runbook for stuck provisioning and webhook replay, and alerting on
bridge failures.**

**Launch and after.** Launch for new business with the demo tenant ready for
sales and partner meetings. Then: migration of the existing base (§21),
hardening, embedded signing, SSO, support-ticket feed, remaining reports, and
whatever a live deal pulls in.

### External dependencies the plan absorbs

The SKU book, margin model, CRM selection, partner program guide, and
counsel-final legal text all land mid-build; each is data or a swappable
adapter, so late inputs change rows, not code. Two exceptions are code
dependencies and belong in Foundations: the e-sign provider and the QBO
connector posting model. The one hard sequencing rule: no external account
transacts on agreement text counsel has not approved; the demo tenant and
staging carry the Common Paper defaults until then.

### Success criteria (at launch)

- A new business client goes from registration to provisioned and invoiced with
  zero Fil One touches on standard terms, in minutes, with a PO number on the
  invoice.
- A partner completes registration, quoting (both documents), ordering, and
  consolidated invoicing in the portal; its end client accepts pass-through
  terms at first login.
- A POC provisions isolated, tracks against caps and milestones, and converts to
  a paid quote keeping its data.
- The commitment ledger prices a term-drawdown and a period-allowance contract
  correctly under contract tests, including contracted overage rates.
- Every surface passes the polish bar; the demo tenant opens a sales meeting
  credibly.
- Money-path suite green; forecast, funnel, and margin reports tie to Stripe and
  QBO under the three-way tie-out.
- Operations readiness complete: backups named, runbook written, alerts live.

---

## 23. References

- Sprint checklist: `sprint_checklist.md` (this folder), July 2026.
- Concept document: "The Frictionless Commerce Platform" screenshots, July 2026.
- Repo: `Object Lock/fil-one` worktree (SST v3, pnpm monorepo, Stripe
  integration, Aurora clients); `object-lock-review.md` for the
  joins-versus-units review finding this plan's merge gates respond to.
- Adversarial review findings (three lenses, July 31, 2026): folded throughout;
  see §22 rules, §5 Account/Amendment/CommitmentLedger, §8 partner agreement
  contents, §10 posting model, §19.
- Stripe usage-based billing and meters:
  https://docs.stripe.com/billing/usage-based
- Clickwrap enforceability components and record-keeping:
  https://ironcladapp.com/journal/contract-management/6-components-of-clickwrap-enforceability
- Common Paper standard agreements (CSA, ToS, DPA):
  https://commonpaper.com/standards/cloud-service-agreement/ ,
  https://commonpaper.com/standards/terms-of-service/ ,
  https://commonpaper.com/standards/data-processing-agreement/
