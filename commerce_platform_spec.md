# Clockwork Commerce Platform: Production Build Specification

**Status:** Approved production target; current implementation and release
evidence remain governed by the checked-in traceability ledger, backlog, and
release report. Revised after three-lens adversarial review
(commercial/finance, buyer/legal/partner, engineering delivery) and aligned to
the five-Codex production plan on July 31, 2026. **Author:** James Kurz, drafted
with Claude. **Date:** July 31, 2026. **Source concept:** "The Frictionless
Commerce Platform" document (screenshots, July 2026).

---

## 1. What this is

A standalone self-service commerce application for Fil One: registration,
legal agreements, quotes, POCs, orders, provisioning, invoicing, payment,
renewals, and offboarding for direct clients and channel partners, with a
back-office view over all of it. Clockwork is a greenfield repository rooted at
`/Users/jameskurz/Downloads/Fil One/Clockwork`; it does not share code, runtime,
sessions, or deployment machinery with the existing Fil One or Object Lock
repositories. It replaces the email-PDF-redline chain for business deals and
gives partners a transacting path that does not require a partner-ops team.

Fil One already has a self-serve product path: a prospect can sign up, accept
terms, store data, and pay by card through Stripe. That installed base is
context and an integration boundary, not a source-code dependency. Clockwork
builds the complete business-commerce layer: pay-as-you-go migration support,
annual business plans, enterprise committed capacity, MSP and embedded offers,
partner quoting and reselling, counter-signed agreements, purchase orders,
term tracking, marketplaces, renewals, and offboarding.

The platform is also a sales asset in its own right. Being easy to buy from is
the durable differentiator the concept document describes, and for a company
selling infrastructure against AWS, Wasabi, and Backblaze, a buying experience
that looks and works like a mature cloud vendor's is proof of engineering
quality. Every enterprise meeting and partner briefing demos the portal. The
target is a complete and polished release; §22 records the historical five-lane
build and the active three-lane release-candidate topology. Features may be
activation-gated for a genuine external dependency, but internal implementation
is not deferred.

The platform is international by design. Spain and the UK are the first non-US
markets, not special cases: currency, tax, agreement variants, and residency are
configuration dimensions (§19), so each new country is new rows in existing
tables, not a new project.

The concept document this adapts was written for a generic managed-services
company with four purchased back-end systems (CRM, CLM, provisioning, ERP). Fil
One is a product company, but Clockwork deliberately has its own architecture
and commerce system of record. Stripe remains the billing and payments engine;
identity, e-signature, provisioning, CRM, accounting, screening, support, and
marketplaces cross typed provider boundaries. We keep the concept's core ideas:
one artifact chain, self-service by default, humans as exception queues, and
reporting that reads the operating data directly.

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
   Supabase, WorkOS, Trigger.dev, Stripe, Common Paper, the selected e-sign
   provider, and S3 do the heavy lifting; the build is the object chain, the
   portal, the partner logic, and the reporting. Nothing requires speculative
   scale engineering, but the object model is the one we would still want at
   100x.
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
| Embedded / white-label        | Partner                      | Counter-signed, custom                                      | Built now: partner branding, custom-domain verification, end-client invitations, communication ownership, and partner-priced commerce; production activation may await brand, domain, and legal inputs |

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
   Counter-signed documents route through the e-signature system (embedded
   signing with a redirect fallback); standard templates need no legal review,
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
commission rate, aggregate credit limit, and `parent_partner_id` (nullable;
holds the distributor-to-reseller structure used by the shipped two-tier
quoting, billing, commission, and settlement flow).

**Organization / User / Membership / Role.** WorkOS AuthKit owns authentication,
sessions, identity lifecycle, organizations, invitations, MFA, and SSO.
Clockwork mirrors the identifiers it needs, while commerce membership and
authorization remain independently authoritative in Postgres and the domain
layer. Roles are `owner`, `admin`, `billing`, `member`, `partner_admin`,
`partner_seller`, `internal_operator`, `finance_approver`, `legal_approver`, and
`destructive_action_approver`. Every commerce action is attributed to a user;
shared logins are prohibited. Internal staff require an internal membership and
allow-listed identity, cannot be granted through a customer organization, and
assisted actions preserve both actual and effective actors. MFA is enforced for
privileged roles, and SSO ships from launch behind each organization's WorkOS
policy configuration.

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

**AuditEvent (`audit_events`).** Append-only log of every state change:
aggregate, event schema version, actual actor, effective actor and
assistance/impersonation context, timestamp, safe before/after projections, and
request ID. Sensitive document, tax, and payment contents are never copied into
metadata. The AuditEvent is the account-timeline and SOC 2 evidence stream; a
transactional outbox is the delivery feed for CRM, notifications, and other
projections.

### Operational records

The production model also includes the records needed to make the domain safe
and operable rather than hiding those concerns inside provider metadata:

- `idempotency_keys`, `webhook_receipts`, `outbox_messages`, and `provider_links`;
- `approval_requests`, `approval_steps`, and `notification_deliveries`;
- `usage_samples`, `cost_entries`, and `reconciliation_runs`;
- `document_artifacts`, `workflow_runs`, and `feature_flags`; and
- `migration_candidates` and `migration_reviews`.

Webhook receipts deduplicate on provider plus provider-event ID and retain
enough verified-envelope metadata for safe replay and out-of-order processing.
Approval steps record separation-of-duty decisions. Workflow records expose
durable task identity, attempt, state, and operator recovery without making the
workflow vendor the commerce system of record.

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

Seven customer surfaces, each rendering the same objects the back office sees.
They are Next.js App Router route groups in the standalone `apps/web`
application, use React Server Components where appropriate, and are gated both
at the route boundary and in every server-side query.

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

Partner routes also include deal registration and disputes, referral/resale/
distributor quote paths, consolidated billing, commissions and statements,
renewals, sandboxes, white-label and custom-domain controls, and AWS/Azure/GCP
marketplace status. End-client and transfer-price visibility remains scoped by
merchant-of-record and order sourcing.

The **internal back office** includes global search, a complete account
timeline, assisted execution for every customer or partner action, every
exception and approval queue, price-book and agreement administration,
customer-paper handling, provisioning recovery, collections and disputes, the
renewal command center, reports, reconciliation, migration review, and external
gate status. Assisted operation produces the same objects as self-service and
always identifies the internal actor.

**Read-only support visibility** is implemented behind the support provider
port. A deterministic feed operates before provider selection; production data
activates after credentials and contract tests pass. Visibility only; intake
stays in the selected support channel.

---

## 7. Design and experience quality

The portal must read as a finished product from a mature vendor. Concrete
requirements, not aspirations:

- **A distinctive Clockwork design system.** Build a restrained, mature visual
  language from design tokens and a text wordmark in `packages/ui`, documented
  in Storybook. Official logo, type, color, and footer assets remain swappable
  without redesign. The component set includes buttons, forms, dialogs, tables,
  skeletons, empty states, status badges, term bars, stat tiles, timelines,
  document cards, queue rows, toasts, and error boundaries.
- **Signature elements done well.** The term bar (elapsed time, notice window,
  end date) is the product's visual identity, rendered per service and rolled up
  per account. Dashboards use restrained, consistent, accessible visualizations
  with semantic table equivalents for usage, spend, and capacity. The rendering
  library is an implementation choice, not part of the product contract.
- **Every state designed.** Loading, empty, partial, optimistic, success,
  validation, permission, stale-version, offline, and recoverable/unrecoverable
  failure states have intentional copy and behavior on every surface. No raw
  spinners, dead ends, or placeholder copy ship.
- **Fast.** Route-level code splitting, deliberate React Server Component and
  client boundaries, streaming and skeletons, optimistic mutations with
  rollback, correct cache invalidation, and explicit performance budgets.
  Performance is part of the wow.
- **Accessible and responsive.** Keyboard-first forms, focus restoration, skip
  links, semantic landmarks, visible focus, screen-reader announcements,
  reduced motion, WCAG AA contrast, and layouts that hold from 320px to a
  conference-room display. Storybook and route-level axe checks have zero
  serious findings.
- **Documents match the portal.** React PDF renders direct, partner-transfer,
  resale/white-label quotes, order forms, amendments, POC summaries and final
  reports, invoice companions and receipts, commission statements, renewal and
  decline confirmations, deletion certificates, reconciliation reports, and
  exports. Documents use deterministic pagination, repeating headers/footers,
  IDs, version/hash, accessible metadata, and golden tests. Money paths never
  depend on browser printing.
- **Localization is structural.** English is the launch catalog, and feature
  components contain no hard-coded user-facing copy. Locale-aware USD/EUR/GBP,
  dates, addresses, VAT/tax labels, and pluralization make a later Spanish
  catalog additive rather than a rewrite.
- **Demo environment.** A seeded, resettable demo tenant with clearly fictional
  accounts, quotes, POCs, invoices, and renewals at interesting states, used in
  every sales and partner meeting. Demo mode has a visible badge. Reset is one
  command, deterministic, and hard-coded to refuse production targets; demo
  data never mixes with production.

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
e-signature system through embedded signing with a redirect fallback and a
verified completion webhook. The platform stores the signed PDF, envelope ID,
and certificate of completion. Provider selection and credentials may gate live
activation; neither embedded behavior nor its sandbox and replay tests are
deferred.

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
- **Two-tier distributor commerce.** `parent_partner_id` holds the
  distributor-to-reseller structure. The production build includes the full
  distributor/reseller quote, sourcing, invoice allocation, commission,
  settlement export, visibility, and reconciliation path. A named distributor
  account or enrollment gates activation, not implementation.
- **End-client visibility (default):** the partner sees its end clients'
  entitlements, usage summaries, term status, provisioning and offboarding
  state. The partner does not see our margin. The end client sees nothing
  commercial from us on the resale track; it does accept pass-through end-user
  terms at first login (§8).
- **Partner-priced quote artifact.** Resale partners download a presentable
  quote in their own name at their resale price, transfer price suppressed. This
  remains useful inside the broader shipped white-label capability because it
  preserves a portable procurement artifact without forcing a branded portal.
  Without it every reseller re-keys the quote off-platform and the attribution
  chain starts outside the system.
- **Commissions (referral path):** accrue on net collected revenue, net of
  clawbacks, with holdback per the agreement; quarterly statements generate as
  documents in the partner portal. Payment executes from QBO.
- **Sandboxes:** partner sandbox organizations are zero-price SKU entitlements
  with caps and expiry, flowing through the same provisioning path.
- **White-label:** eligible partners can verify a custom domain, select approved
  branding tokens, send branded end-client invitations, own commercial
  communications, and fall back safely to the neutral Clockwork presentation.
  Branding never changes legal entity, merchant-of-record, or audit identity.
- **Cloud marketplaces:** AWS, Azure, and Google marketplace adapters normalize
  orders, entitlements, metering, fees, invoices, settlements, and refunds into
  provider-neutral records. Marketplace enrollment and credentials are
  activation gates; complete adapters, fixtures, replay behavior, and financial
  reconciliation ship in the release candidate.

---

## 15. CRM and the customer master

The commerce DB is the customer master. The CRM is a projection for pipeline
work: registration creates the CRM account, quote issuance creates or updates
the opportunity with amount and stage, order acceptance closes it, and invoice
and payment events update financial state. Sync is one-way outbound through the
transactional outbox, with CRM-side edits limited to sales-process fields.
Nothing commercial is keyed into the CRM by hand. A provider-neutral port,
production-grade fake, replay controls, and export fallback ship regardless of
provider selection; the chosen production adapter activates only after its
contract suite passes.

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
| Provisioning recovery      | Permanent provider failure, dead letter, or stuck confirmation          | Internal operator | Named deputy          | Same business day   |
| Migration review           | Ambiguous account, product, Stripe, or acceptance match                 | Internal operator | Named deputy          | Before migration run |
| Offboarding/destructive    | Teardown request, retained-object branch, or deletion approval          | Named approver    | Named deputy          | Before effective date |

Every queue has an owner, distinct backup, response target, escalation rule,
and preserved approve/reject evidence. Separation-sensitive actions prohibit
self-approval, and teardown requires two distinct destructive approvers. Each
queue is a filtered view over the same objects rather than an off-platform
spreadsheet. Screening includes an embargoed-country gate at registration and a
denied-party check before any counter-signature or partner activation; counsel
confirms the production standard before external use.

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
| **ARR and MRR**                | Contracted recurring value under merchant-of-record rules: gross for direct/referral, transfer-price revenue for resale/marketplace as applicable, currency separated and methodology versioned.                                          |
| **Billing and collections**    | Invoice issuance, aging, payment, credit, refund, dispute, dunning owner, partner credit exposure, and cash timing by account and order.                                                                                             |
| **Commission and settlement**  | Collected-revenue accruals, holdbacks, clawbacks, statements, distributor allocations, marketplace fees, and settlement status tied to source invoices and payments.                                                                 |
| **Reconciliation**             | Monthly Clockwork/Stripe/QBO tie-out plus marketplace and source-usage reconciliation, with every variance assigned, explained, and replayable from source records.                                                                   |

The weekly scorecard reads these directly and exposes bookings, cycle time,
renewal exposure, capacity, margin, partner performance, and POC economics.
Every report has a cursor-paginated API, role- and account-scoped view, CSV
export, source-record traceability, and deterministic SQL integration tests. No
BI tool is required at launch.

---

## 18. Architecture

### Standalone repository and runtime

Clockwork is a new application in its own pnpm 10/Turborepo monorepo, using
Node.js 24 and strict TypeScript. It neither imports nor modifies the Fil One or
Object Lock repositories. The repository shape is fixed:

```text
Clockwork/
├── apps/web/                  # Next.js portal, admin, API and webhook entrypoints
├── packages/api/              # Hono route groups and authorization boundary
├── packages/contracts/        # Zod schemas, OpenAPI, events and provider contracts
├── packages/domain/           # Pure state machines and commerce rules
├── packages/db/               # Drizzle schema, repositories, transactions and outbox
├── packages/integrations/     # Stripe, WorkOS, e-sign, CRM, QBO and other adapters
├── packages/workflows/        # Trigger.dev workflows and schedules
├── packages/documents/        # Quotes, order forms, statements and certificates
├── packages/ui/               # Design system and Storybook
├── packages/testing/          # Fakes, fixtures, builders and demo reset
├── supabase/                  # Config, canonical migrations, seed and pgTAP tests
├── docs/                      # ADRs, runbooks, gate register and lane handoffs
└── commerce_platform_spec.md
```

`apps/web` uses the Next.js App Router, React Server Components, Server
Functions, Suspense, Tailwind CSS v4, and Vercel Fluid Compute. Hono is mounted
inside Next.js for `/api/v1`; Zod definitions generate OpenAPI 3.1 and a typed
frontend client.
WorkOS AuthKit supplies identity services. Trigger.dev Cloud supplies durable
jobs, schedules, waits, bounded retries, idempotency, preview environments, and
operator visibility. React PDF produces deterministic documents.

### Commerce system of record and deployment environments

Supabase managed Postgres is the only Clockwork commerce system of record.
Staging and production are separate projects; each pull request gets a Supabase
preview branch paired with its Vercel and Trigger.dev previews. Production has
PITR enabled, and backup restoration is rehearsed into an isolated project.

Drizzle supplies the typed schema and repository mapping. Reviewed SQL under
`supabase/migrations` is the canonical, append-only migration history; no schema
change is authored in the Supabase Dashboard. CI recreates the database from
zero, applies every migration, seeds it, and runs pgTAP. Vercel functions use
Supavisor transaction mode with SSL required and prepared statements disabled.
Only CI and controlled deployment tooling may use the direct migration
connection.

Database access is server-side only. Browser bundles receive no Supabase
service or database credentials. Runtime access uses restricted application
roles with `NOBYPASSRLS`; row-level security is defense in depth, not a
replacement for authorization in the API and domain layers.

### Public API contract

The generated Hono/OpenAPI contract uses `/v1` as its prefix. The standalone
Next.js application mounts that contract beneath `/api`, so browser-visible
production URLs use `/api/v1`. In the list below, paths are shown as their
browser-visible mounted URLs; after the first explicit prefix, unprefixed paths
are relative to `/api/v1`:

- `/api/v1/auth`, `/organizations`, `/memberships`, `/accounts`, and
  `/procurement-profiles`;
- `/agreements`, `/agreement-templates`, `/acceptances`, and `/notices`;
- `/price-books`, `/quotes`, `/orders`, `/amendments`, and `/entitlements`;
- `/usage`, `/commitments`, `/invoices`, `/payments`, `/credits`, `/refunds`,
  and `/disputes`;
- `/partners`, `/registrations`, `/commissions`, `/distributors`, and
  `/marketplaces`;
- `/pocs`, `/renewals`, `/terminations`, and `/certificates`;
- `/exceptions`, `/approvals`, and `/notifications`;
- `/reports`, `/exports`, and `/reconciliations`; and
- `/admin/*` for back-office assisted operations.

Provider callbacks use `/v1/webhooks/*` in the Hono/OpenAPI contract and enter
the deployed application through `/api/v1/webhooks/workos`,
`/api/v1/webhooks/stripe`, `/api/v1/webhooks/esign`,
`/api/v1/webhooks/marketplaces/*`, and `/api/v1/webhooks/support/*`. Every list
endpoint uses a stable cursor and explicit account scope. Mutations return the
aggregate version and any relevant workflow handle. Errors use RFC 9457
`application/problem+json` with a request ID, a stable machine code, and a safe
user message.

### Provider boundaries

Typed ports and behaviorally realistic deterministic fakes exist for
e-signature, product provisioning, document/evidence storage, CRM, QBO and
accounting, denied-party screening, support, email and notifications, business
domain and tax-ID verification, AWS/Azure/GCP marketplace ingestion and
settlement, existing-product account/subscription import, rate limiting, and
feature flags. Each fake models success, transient and permanent failure,
duplicate callbacks, delay, and out-of-order delivery.

Real adapters are mandatory where the provider is fixed: Supabase, WorkOS,
Trigger.dev, Stripe, S3, and Vercel. Provider-neutral behavior, contract tests,
and fakes ship for unselected systems; provider choice and credentials are an
activation gate, never an excuse for incomplete domain code.

### Cross-cutting invariants

- IDs are UUIDv7. Instants are UTC `timestamptz`; contractual dates use `date`.
  Currency codes are ISO 4217.
- Money is a signed integer number of minor units, rates are basis points, and
  usage quantities are `numeric(38,18)`. Binary floating point never enters a
  monetary, quantity, proration, tax, or commission calculation.
- Every mutable aggregate has an optimistic concurrency version returned by the
  API and required as a typed `expectedVersion` on mutations; resource-style
  HTTP endpoints may additionally expose it through `ETag`/`If-Match`. Issued
  artifacts use immutable versions and supersession pointers instead of
  in-place edits.
- Every money-changing API call requires `Idempotency-Key`. Downstream effects
  derive stable keys from aggregate, version, and operation. Reuse with a
  different payload fails closed.
- Every write passes through an authorized domain command and one database
  transaction that changes current state and appends an immutable audit event
  plus transactional outbox record. No route or workflow accesses tables
  directly.
- Webhook signatures are verified against the raw request body before
  acknowledgment. Receipt tables deduplicate by provider/event ID and allow
  controlled replay and out-of-order delivery.
- Issued quote snapshots, accepted order terms and lines, executed agreement
  text/evidence, legal notices, and certificates cannot mutate. Workflow and
  lifecycle state can advance through versioned transitions; corrections create
  a new version, amendment, or reversal. Executed agreements and acceptance
  evidence, issued quotes, order forms, amendments, notices, completion
  certificates, and deletion certificates are content-addressed in a versioned
  S3 bucket with Object Lock in Compliance mode unless counsel approves a
  narrower class. Other issued documents retain content hashes and immutable
  application versions without widening the legal-retention boundary.
- Authorization evaluates the current WorkOS membership, commerce role and
  permission, account scope, order sourcing, partner portfolio, internal-staff
  status, and assistance context. Both domain authorization and RLS fail closed.
- CSRF/origin protection applies to mutations. Request IDs cross HTTP,
  database, workflows, providers, and telemetry. Impersonation is time-limited,
  reasoned, visible, and audited with both actors.
- Teardown, forced deletion, and production migration execution require two
  distinct authorized approvers; retention-locked data cannot be deleted.

### Workflows, telemetry, and validation

Trigger.dev owns long-running and provider-facing work, including onboarding,
agreements, provisioning, billing, collections, commissions, reconciliation,
reporting, POCs, renewals, offboarding, exceptions, and migrations. A stable
idempotency key protects every external effect. Transient failures retry with
bounded backoff; permanent failures enter an owned exception queue; operator
replay is safe and recorded in `workflow_runs`.

Telemetry is OpenTelemetry-compatible structured data plus Sentry. Logs and
error events never contain agreement bodies, tax identifiers, payment details,
uploaded document contents, or other secret material.

The required validation stack is Vitest, Testing Library, MSW, Storybook,
Playwright, axe, pgTAP, fast-check, Stripe fixtures and test clocks, WorkOS
session fixtures, Trigger.dev task tests, provider contract suites, and
deterministic personas/clocks. GitHub Actions CI includes formatting, lint,
strict typecheck, package-boundary checks, secret scanning, dependency audit,
database reset from zero, tests, generated-artifact verification, and production
builds.

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
| Residency                         | Supabase/Vercel deployment configuration per region, disclosed in the subprocessor schedule; commerce DB placement is a counsel-informed deployment decision | Clockwork US region selected at provisioning; EU project if Spain requires |
| Entity, registration, e-invoicing | Accountant and counsel workstream per country; schema holds their answers (entity on invoice header, per-country registration IDs)             | Spain packet (Aug 21); Living Rock's countries when confirmed     |

Currency and rails are decided on the **partner timeline (Aug 14)**, not the
Spain timeline: the sprint has UK partner meetings by Aug 14 and a possible
Ingram UK order route by Sep 18, and the first UK reseller must be quoted and
invoiced in GBP with a bank-transfer path.

---

## 20. Security, compliance, and open decisions

- MFA is enforced for privileged roles, shared enterprise logins are
  prohibited, and permissions are least-privilege. WorkOS identity status never
  grants commerce access without a current scoped Clockwork membership.
- Business POCs always use isolated organizations and entitlements. Paid
  conversion upgrades the same tenant in place without weakening isolation.
- Executed agreements and acceptance evidence, issued quotes, order forms,
  amendments, notices, completion certificates, and deletion certificates are
  retained for the applicable contract period in versioned, object-locked S3
  storage. Other commercial artifacts remain immutable through application
  versions and content hashes but do not expand the Object Lock scope.
- EU/UK personal data handled per the DPA and jurisdictional transfer terms; the
  resale path's data-protection chain runs through the partner subprocessor DPA
  plus end-user pass-through terms (§8).
- The platform emits the evidence SOC 2 will want: append-only change history,
  access reviews, payment reconciliation, provider receipts, and two-person
  approvals on destructive actions.
- Legal, tax, and regulatory positions embedded in templates, tax handling,
  screening standards, and the merchant-of-record split require counsel and
  accountant sign-off before first external use.
- Uploads are content-type and size constrained, malware-scanned through a
  provider port, stored outside the web root, and served only by short-lived,
  authorized URLs. Webhooks use signature verification and replay protection;
  outbound fetches use allow-lists to prevent SSRF.
- Structured telemetry excludes agreement bodies, tax identifiers, payment
  data, document contents, credentials, and provider secrets.

### Decisions taken and decisions open

| Decision                                                            | Position                                                                                                                                                              | External input still needed                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Click-through vs counter-signed                                     | ToS, standard CSA, DPA, and POC terms click-through below a cumulative-account-value threshold; MSA, partner agreements, customer paper, and redlines are counter-signed | Counsel-approved text, threshold, variants, and KeyTerms defaults |
| Merchant of record                                                  | Fil One is MoR for direct/referral; partner is MoR for resale, priced at transfer price, with resale price uncontrolled                                                | Partner program guide and counsel approval                       |
| Commit semantics                                                    | `period_allowance` or `term_drawdown` per SKU with a distinct contracted overage rate                                                                                 | Signed-off SKU and rate-card data                                |
| Pricing guardrails                                                  | Discount matrix plus per-SKU floor on prices Fil One sets; below floor routes to an approval queue                                                                     | Margin model, floors, claims wording                             |
| Credit                                                              | Auto-charge default; written policy for net terms; partner aggregate limits; retention-aware nonpayment ladder                                                        | Finance-approved credit and collections policy                   |
| Retention liability                                                 | CSA carries a retention-liability KeyTerms rule                                                                                                                       | Counsel and margin-model decision                                |
| Customer master                                                     | Supabase Postgres commerce DB; CRM is a projection                                                                                                                     | CRM selection and scoped credentials                             |
| Currency and rails                                                  | USD/EUR/GBP price books and configured card, ACH, wire, SEPA, and BACS rails                                                                                           | Accountant sign-off, registrations, live payment rails           |
| E-signature                                                         | Provider-neutral embedded signing plus redirect fallback ships with a complete fake and contract tests                                                                | Provider selection, account, and credentials                     |
| Teardown invariant                                                  | Automation is complete behind a feature flag and two-person approval; production activation requires explicit authorization                                           | Written product/security/legal decision                          |
| Stripe-to-QBO                                                       | AR at issuance for terms is mandatory; auto-charge may post by payout summary                                                                                          | Connector selection, accounts, and accountant approval           |
| Existing-base migration                                             | Complete dry-run, review, execution, and recovery tooling ships behind a feature flag                                                                                   | Production source access, authorization, and migration window    |
| White-label, marketplaces, distributor, embedded signing, SSO, support | Fully implemented and tested; production features activate independently after their accounts, domains, policies, branding, or enrollments pass activation tests     | Feature-specific external inputs only                            |

Only genuine external dependencies may remain gated: managed provider accounts
and scoped credentials; counsel-approved text, thresholds, retention and
screening rules; final price/margin/claims and credit data; provider selection;
the product provisioning API; tax/accounting decisions; production domains and
email records; brand assets; named approvers; production migration access and
window; and explicit teardown authorization. Every gate has an ID, owner/input,
affected feature, simulator coverage, activation test, and launch severity in
`docs/external-gates.md`.

---

## 21. Migration of existing accounts

Existing self-serve customers exist as Stripe customers and product accounts.
Migration creates commerce Accounts keyed to Stripe customer IDs, backfills ToS
acceptance where recoverable, and attaches existing subscriptions as PAYG
Orders. Because no versioned acceptance record exists today, most existing
customers require re-acceptance.

The production build includes dry-run discovery, account/subscription/product
matching, explicit re-acceptance decisions, an ambiguous-candidate review queue,
fixtures and rehearsal, resumable batches, deterministic idempotency, progress
and audit records, rollback boundaries, and feature-flagged execution. The
tooling never guesses through an ambiguous one-entity/one-Account match.

Only the real production run is deferred. It requires source-system access,
customer communication and legal approval, a named migration window and
approvers, a snapshot rehearsal, and an approved rollback point. Until then,
new Clockwork business and the existing population remain separable by
construction.

---

## 22. Build and release plan

Clockwork's initial implementation pass was delivered by five Codex instances with
one serial foundation, three parallel implementation lanes, and one serial
integration/release lane. The table below is historical provenance, not active
branch ownership after consolidation. Its refs and worktrees remain preserved
for the release auditor, and the exact source and merge hashes are recorded in
the checked-in Git baseline manifest.

| Agent | Branch | Fixed worktree | Ownership |
| ----- | ------ | -------------- | --------- |
| 1 — foundation | `commerce/foundation` | `/Users/jameskurz/Downloads/Fil One/Clockwork` | Monorepo, shared contracts, complete schema, migrations, auth plumbing, fakes, test harness, foundational UI, CI, ADRs, and worktrees |
| 2 — core finance | `commerce/core-finance` | `/Users/jameskurz/Downloads/Fil One/Clockwork-core-finance` | Accounts, pricing, quotes, orders, amendments, commitments, billing, partners, commissions, marketplace finance, accounting, reconciliation, and reports |
| 3 — lifecycle platform | `commerce/lifecycle-platform` | `/Users/jameskurz/Downloads/Fil One/Clockwork-lifecycle` | Identity, agreements, evidence, POCs, provisioning, renewals, offboarding, exceptions, compliance, notifications, support, and migration tooling |
| 4 — experience and documents | `commerce/experience-docs` | `/Users/jameskurz/Downloads/Fil One/Clockwork-experience` | Customer, partner, and admin routes; design system; accessibility; localization; deterministic documents; demo and visual/persona tests |
| 5 — integration | `commerce/integration` | `/Users/jameskurz/Downloads/Fil One/Clockwork-merge` | No-fast-forward lane merges, generated artifacts, all cross-lane joins, adversarial repair, release evidence, and operations runbooks |

That historical run completed with explicit merge commits. Ongoing release-
candidate work starts from one verified `main` commit and uses these three
exclusive lanes; `docs/implementation-lanes.md` is the operational ownership
record:

| Lane | Branch / fixed worktree | Exclusive implementation ownership | Migration range |
| ---- | ----------------------- | ---------------------------------- | --------------- |
| Commercial integrity | `rc/commercial-integrity` / `/Users/jameskurz/Downloads/Fil One/Clockwork-rc-commercial` | Core commercial domain, API, database repositories/schema, finance/provider adapters, and core acceptance tests | `001000`–`001099` |
| Runtime operations | `rc/runtime-operations` / `/Users/jameskurz/Downloads/Fil One/Clockwork-rc-runtime` | Lifecycle/system runtime, workflows, schedules, outbox/provider execution, operational repositories, and recovery tests | `001100`–`001199` |
| Experience release | `rc/experience-release` / `/Users/jameskurz/Downloads/Fil One/Clockwork-rc-experience` | Web routes and projections, design system, documents/delivery, browser/visual/accessibility tests, and release-facing experience | `001200`–`001299` |

Root manifests and lockfile, shared contracts/barrels, generated OpenAPI/client
artifacts, canonical specification, traceability and baseline manifests, and CI
composition are integration-owned shared files. A lane records a handoff rather
than editing a shared file. Lanes do not merge or cherry-pick one another and do
not receive live production credentials.

The architecture is collision-resistant: route groups, domain directories,
workflow/integration registries, schema extensions, migrations, and tests have
lane ownership. Shared generated OpenAPI clients, Drizzle metadata, and the
lockfile are regenerated from sources during integration, never edited by hand.
Historical and current lane migration number ranges do not overlap, and applied
migrations never change.

### Completeness rule

The release scope includes embedded signing, SSO, white-label, AWS/Azure/GCP
marketplaces, two-tier distributor settlement, support visibility,
existing-base migration tooling, automated teardown, and the complete report
suite. Presence of a schema, fake, route shell, candidate task, or renderer does
not make a capability complete; the traceability ledger and backlog remain the
status authority. A feature can remain disabled only for a registered external
account, credential, legal/commercial decision, production data set, or explicit
authorization, and every disabled feature requires a simulator and activation
test.

No `TODO`, `FIXME`, fake success, skipped/disabled test, placeholder copy,
unsafe cast, unhandled promise, direct table access outside `packages/db`, raw
SQL outside approved repositories/migrations, or unregistered environment
variable may survive the release gate unless it references a genuine registered
external gate.

### Release verification

The release candidate is qualified from a clean standalone checkout of the exact
resulting `main` SHA and must pass:

- frozen dependency installation; formatting, lint, strict typecheck, package
  boundaries, dependency audit, secret scan, and production build;
- Supabase reset from zero; migration dry run; pgTAP; unit, property,
  repository, provider-contract, integration, and reconciliation suites;
- Stripe webhook replay and test-clock scenarios for monthly/annual billing,
  failures, renewals, amendments, credits, refunds, and disputes;
- WorkOS, e-sign, provisioning, notification, support, migration, and all three
  marketplace duplicate/delay/reorder/replay suites;
- Storybook, axe, visual snapshots, React PDF golden tests, and all Playwright
  personas and critical paths; and
- deterministic demo reset plus a proof that the reset is physically incapable
  of targeting production.

Adversarial review covers tenant and partner isolation, co-mingled visibility,
IDOR, privilege escalation, assisted-mode identity, CSRF, webhook forgery and
replay, SSRF, injection, unsafe uploads, secret/PII leakage, destructive-action
separation, duplicate submission, stale and concurrent writes, provider and
database partial failure, workflow replay, crash recovery, rounding, currency
separation, tax changes, DST and calendar boundaries, proration, usage
corrections, both commitment models, and commission clawbacks. RLS and domain
authorization must both fail closed.

### Acceptance matrix

- A standard direct purchase completes registration → WorkOS organization →
  exact-text agreement evidence → quote/PDF → order/PO → provisioning →
  entitlement → Stripe invoice → payment → portal/reporting without Fil One
  intervention.
- Assisted purchase creates the identical artifact chain and identifies the
  internal actor. Referral and resale invoice the legally correct party and
  never leak partner economics.
- Distributor/two-tier, white-label, and AWS/Azure/GCP marketplace paths trace
  orders through entitlement, invoice, fee, settlement, and reconciliation.
- Issued commercial and legal artifacts cannot mutate. Webhooks and durable
  tasks remain correct under duplication, delay, replay, reordering, rollback,
  and crash recovery.
- Both commitment models pass property and contract tests across amendments,
  late/corrected usage, period and term boundaries, partial periods, and
  contracted overage rates.
- A POC converts without tenant or data migration. Retention-locked objects
  cannot be deleted, and every destructive action requires two distinct
  approvers.
- Amendment/co-termination, renewal/decline/InboundNotice, re-execution,
  dunning, credit exposure, disputes, reversals, termination, deletion
  certificates, and Novation preserve the artifact chain.
- Every report traces to source records. The monthly Clockwork/Stripe/QBO and
  marketplace reconciliations expose and assign every variance.
- Cross-account, cross-partner, order-sourcing, and co-mingled visibility tests
  fail closed. Every surface is responsive at 320px+, keyboard usable, WCAG AA,
  and free of serious axe findings.
- Restore rehearsal, migration rehearsal, webhook replay, workflow recovery,
  billing reconciliation, stuck provisioning, offboarding, and disaster
  recovery have tested runbooks. No unfinished internal work is mislabeled as
  an external dependency.

The integration/release owner produces the release-candidate report, final gate
register, launch checklist, and operations runbooks. The launch checklist includes staging soak,
rollback, isolated backup-restore drill, alert verification, feature-flag
activation, and named approvals. Merging and producing a release candidate do
not authorize a production deployment or contact with external parties.

---

## 23. References

- Sprint checklist: `docs/sprint-checklist.md`, reviewed July 2026 snapshot.
- Concept document: "The Frictionless Commerce Platform" screenshots, July 2026.
- Five-Codex implementation plan, July 31, 2026. This historical plan superseded
  the former architecture during the initial pass; active release-candidate
  ownership is now recorded in `docs/implementation-lanes.md`.
- Adversarial review findings (three lenses, July 31, 2026): folded throughout;
  see §22 rules, §5 Account/Amendment/CommitmentLedger, §8 partner agreement
  contents, §10 posting model, §19.
- Next.js App Router: https://nextjs.org/docs/app
- Supabase Postgres connections and transaction pooling:
  https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase branching: https://supabase.com/docs/guides/deployment/branching
- Supabase backups and PITR: https://supabase.com/features/database-backups
- WorkOS organizations:
  https://workos.com/docs/authkit/users-organizations
- WorkOS roles and permissions:
  https://workos.com/docs/authkit/roles-and-permissions
- Trigger.dev idempotency: https://trigger.dev/docs/idempotency
- Trigger.dev preview branches:
  https://trigger.dev/docs/deployment/preview-branches
- Stripe usage-based billing and meters:
  https://docs.stripe.com/billing/usage-based
- Clickwrap enforceability components and record-keeping:
  https://ironcladapp.com/journal/contract-management/6-components-of-clickwrap-enforceability
- Common Paper standard agreements (CSA, ToS, DPA):
  https://commonpaper.com/standards/cloud-service-agreement/ ,
  https://commonpaper.com/standards/terms-of-service/ ,
  https://commonpaper.com/standards/data-processing-agreement/
