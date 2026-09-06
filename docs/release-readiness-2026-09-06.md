# Clockwork readiness work — 6 September 2026

Baseline: `55b4082d380e086b29da7e76f4e060d19cbb49a6`.

This implementation advances the commercial-readiness register with working
administration, durable PAYG billing, safer production controls, and fixes found
through browser dogfooding. It does not approve the register's proposed
commercial/legal terms or transfer billing authority from Fil One. Production
capability defaults remain off.

## Delivered behavior

- Finance can reopen draft price books, add/edit/remove multiple rates,
  configure floors, overage, transfer tiers and discount matrices, simulate
  quotes, and compare economics before two-person activation. Pending proposals
  freeze their content. Activation clearly identifies the current currency-wide
  book it replaces, including when the new book has a different name. The
  selected book exports retained rates, discounts and source metadata as JSON.
- PAYG policy versions retain source evidence, effective dates, decimal units,
  hourly aggregation, monthly minimum and partial-month choices, correction
  windows, zero-priced API/egress, tax and accounting mappings. Approval
  requires a distinct finance approver.
- Channel policies (`001431`) configure the sales handoff threshold, default and
  maximum initial requested registration protection, extension length and
  extension count. Distinct creator/editor/proposer review and UTC effective
  dates control approval. New registrations retain an immutable server-selected
  policy or explicit legacy marker; extensions require progress evidence and
  obey individual and cumulative limits. Existing registrations are not repriced
  or assigned an invented historical policy.
- Durable trial authorization (`001432`) retains lifetime organization/domain
  claims against persisted verification evidence and an approved policy
  snapshot. The finance UI can record a verified claim and confirmed term/PAYG
  conversion. Append-only counter receipts, atomic pending-operation
  reservations, settlement proofs and freshness deadlines prevent concurrent
  requests from independently spending the same quota. Conversion rechecks the
  current account/organization/tenant binding and locks the paid order or PAYG
  enrollment while validating it, preventing a remapped tenant or concurrent
  cancellation from supplying stale conversion authority. These are implemented
  application/database boundaries; no live provider pre-operation hook or
  signature verifier is claimed.
- Catalog mapping administration (`001433`) lets directly authenticated
  operators or finance users edit provider SKU, region, meter and evidence
  references for unproposed draft rates. Changes lock the parent book, advance
  its version and audit the mapping. Proposed and published mappings are frozen.
  A supplied mapping remains an attestation; this editor does not establish live
  provider qualification or supply the final provisioning/ingestion adapter.
- Verified-source enrollment, usage receipts, completeness manifests, period
  ratings, corrections and confirmed cancellation persist with replay
  protection. The daily close scheduler revisits retained periods; finance
  materializes pending effects into invoices or credits. Missing usage cannot
  silently become a zero bill.
- PAYG invoices retain their original policy, rating, legal identities and tax
  determination. Invoices, customer PDFs, payment evidence, credits, refunds and
  disputes work without invented term orders. Credits and refunds share an
  invoice ceiling; cumulative tax allocation preserves the original tax amount.
- Billing and collection reports (`001434`) include PAYG invoices that have no
  term order, including invoices with no payment or collection activity. The
  view retains one row per invoice, derives PAYG invoicing identity from the
  immutable source, and exposes cash, credits, refunds, disputes and source
  references under the existing account-scoped read rules.
- New referral quotes retain commission-policy snapshots. Later partner-rate
  edits cannot reprice their payments. Authentic historical economics cannot be
  reconstructed for legacy quotes; the operations guide supplies an explicit
  remediation query.
- Production capabilities have two-person enablement, immediate reasoned
  disablement, recovery mode, evidence and audit history. Provider startup
  honors capabilities. Production bootstrap is a dry run by default, binds the
  target host, refuses existing commerce and creates disabled capabilities and
  draft configuration.
- Internal approval and agreement pages use persisted records. Demonstration
  fixtures do not appear as production evidence. Explicit demo deployments have
  resettable fictional PAYG/trial and channel policy editors, including
  distinct-author proposals and real-engine usage simulations. Demo approval
  cannot create verified enrollment or execute billing.
- Customer order receipts survive server refresh and subsequent quotes.
  Confirmation dialogs prevent duplicate submissions, restore focus, and refresh
  successful changes. Dashboard obligations reflect paid invoices and accepted
  quotes. Partner dashboards use the selected organization. Account selection
  retains IDs and rejects ambiguous name-only matches.
- Queue search supports native GET submission before hydration, retains text
  entered while the page starts, and preserves newer typing when a submitted
  query finishes navigating. External query-history changes update the field;
  Enter submits once and result navigation retains keyboard focus behavior.
- Buy inputs and commercial headings have clear visual affordances. Desktop and
  narrow mobile layouts, keyboard flows, document pagination, and PDF footers
  were reviewed. PDF baselines record their exact Node/zlib toolchain.
- Vulnerable transitive `fast-uri`, `toml`, `fastify`, and `qs` versions were
  patched. The existing three documented advisories without fixed releases
  remain visible; no new audit exception was added.

Detailed behavior and limitations:
[commercial administration](operations/commercial-admin.md),
[capabilities](operations/capability-controls.md),
[PAYG invoice sources](operations/payg-invoice-sources.md), and
[production bootstrap](operations/production-bootstrap.md).

## Dogfooding and adversarial review

Native Chrome computer use exercised customer quote acceptance and its PDF,
simulated invoice payment and receipt, partner registration, and finance
price-book authoring, multiple rates, discounts, simulation and proposal.
Finance also exercised PAYG minimum/usage simulations and policy approval, plus
channel approval and persistence of the current controls. Channel layout defects
found in this pass were corrected with direct server-side CSS imports,
responsive summary cards, readable policy details and status labels. All
operations used fictional local data. Automated browser journeys cover customer,
partner, billing, legal, finance and operator roles, access denials, assisted
sessions, refresh persistence, mobile overflow, text spacing, reduced motion and
accessibility.

Independent agents reviewed commercial administration, database/source
integrity, provider delivery, capability checks and UX decisions. Findings
corrected during review include duplicate account-name selection, misleading
cross-name price-book comparisons, paid invoice metadata, PAYG source consumers
that assumed every invoice had an order, credit/refund concurrency, and Stripe's
explicit allocation requirement for credits against paid invoices. Additional
regressions cover PAYG invoices disappearing from order-joined collection
reports and trial conversion accepting an obsolete tenant mapping. Conversion
source locks and account-scoped report checks were reviewed independently.
Search review reproduced an early-typing hydration loss and corrected it with
DOM-owned form input and query synchronization. Thirteen focused accessibility
tests cover hydration, submission, navigation and focus; final browser
qualification is recorded separately below.

The integration rerun bypassed task caching and passed all 10 integration tasks,
including 51 database test files with 307 tests. This exercises real local
PostgreSQL persistence and provider fixtures; it does not attest live provider
delivery. Final qualification and branch outcomes remain in the validation
section below.

## Research informing decisions

Research was targeted at concrete implementation questions, using primary
provider documentation and upstream security advisories. It is not a complete
competitive survey, a legal/tax opinion, COGS validation, confirmation of a
private integration contract, or approval of the register's proposed terms.
Public documentation was checked at a point in time; deployment must bind its
own approved policy versions and live provider evidence. In particular,
published Fil One behavior and the register's recommended behavior are not
assumed equal.

- [Fil One trial and billing](https://docs.fil.one/billing/trial), checked 6
  September 2026: separate storage and cumulative egress caps, read-only grace
  and disabled access are distinct states. Published enforcement is twice daily;
  the register requests stronger enforcement. Live integration must explicitly
  reconcile that difference. No automatic deletion policy is invented.
- [Stripe credit-note creation](https://docs.stripe.com/api/credit_notes/create),
  checked 6 September 2026: a paid portion requires explicit refund, customer
  balance or outside-Stripe allocation. A credit note credits the customer
  balance in the implemented policy; this is a Clockwork decision among Stripe's
  supported allocation choices. A cash refund remains its own finance action.
  Replay must recover an existing operation before attempting another
  preview/create.
- Security patches follow
  [fast-uri's advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-5jgf-p345-68v8),
  [toml's advisory](https://github.com/BinaryMuse/toml-node/security/advisories/GHSA-82x6-q7mm-w9cf),
  [Fastify's release](https://github.com/fastify/fastify/releases/tag/v5.12.1),
  and [qs's changelog](https://github.com/ljharb/qs/blob/main/CHANGELOG.md).

## Remaining internal implementation

These are product/integration work, not merely missing credentials:

- Connect the actual Fil One signature verifier and ingestion/provisioning
  contracts to the retained source boundaries. Trial operations must call the
  reservation boundary before provider execution, honor its reservation ID and
  expiry, and supply authoritative completion/counter receipts. Existing
  repository tests use provider fixtures; the methods alone do not enforce a
  remote storage service. Draft catalog references need a qualified runtime
  mapping consumer.
- Deliver the customer-facing no-term PAYG/trial acquisition and lifecycle flow,
  including approved notices, conversion and any approved retention/deletion
  behavior. Current committed quote builders still represent committed products.
  An approved PAYG policy does not silently convert a term contract into usage
  billing. A configurable sales threshold does not itself remove committed
  product minimums.
- Complete broader channel program, brand, marketplace and operator products
  before their capabilities are enabled. Versioned transfer maps and new quote
  commission snapshots do not implement full referral tenure/eligibility,
  settlement programs, distributor economics, OEM/operator agreements or
  marketplace adapters. Deal-registration protection controls do not implement
  every recommended prospect/conflict/house-account decision policy.
- Price-book import/clone, scheduled activation execution and impact analysis
  across existing contracts remain beyond the delivered editor and JSON export.
  Legacy unsnapshotted commissions retain explicitly documented legacy behavior;
  their historical economics need evidenced remediation, not a fabricated
  backfill.

## Actual external release dependencies

Live rollout needs approved commercial terms and finance-owned cost inputs;
approved legal, tax, invoice and retention policies; externally issued
credentials and verified identity/provider mappings; Fil One's agreed
signed-ingestion, provisioning and per-operation authorization contracts; an
explicit billing cutover owner; and named staging/production pilot evidence.
Public pricing or an internal configuration approval cannot satisfy these
dependencies.

The published twice-daily trial enforcement and the register's requested
stronger enforcement must be reconciled with the Fil One owner before rollout.
Local provider fixtures prove Clockwork-side behavior, not external delivery.
Broader channel, white-label, marketplace and operator capabilities remain
disabled until both their internal implementation and their own external
acceptance gates pass.

## Validation and branch consolidation

Final qualification and branch outcomes are recorded below after checks
complete.
