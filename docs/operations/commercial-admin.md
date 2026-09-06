# Commercial administration

Finance can reopen an unproposed price-book draft at `/internal/price-books`,
add multiple SKU/region rates, edit
list/floor/overage/minimum/tax/accounting/claim fields, configure transfer
prices by tier, and remove draft rates. Removing the last rate leaves an empty
draft that cannot be proposed. Draft removal never deletes published history.

The discount authority editor persists the default ceiling and scoped
volume/term/route/tier rules. Ceilings use basis points (100 = 1%). The greatest
matching grant wins, with the default as the minimum grant; floors independently
apply. Unconfigured discount authority is zero. The term simulator uses saved
rate cards and policy, including direct/referral list pricing and
resale/distributor transfer prices. It displays tax-exclusive totals and
guardrail exceptions without activating anything. PAYG usage and minimum-charge
simulation belongs to the separate offer policy.

A first finance approver proposes the validated draft. All price content freezes
until a distinct finance approver activates it, approves a future schedule, or
returns it for changes with a reason. An approved schedule remains frozen until
execution, explicit cancellation, or expiry. Returned drafts require a new
proposal. See [scheduled pricing](scheduled-pricing.md) for execution and
recovery. Activation preserves published immutability and existing two-person
controls. Optimistic versions and database row locks prevent stale or concurrent
content changes from invalidating an approval. The database also rejects adding
rates to an already published book.

Rate changes record the changed rate and previous rate in audit evidence.
Discount changes preserve previous/new matrix data. Review the displayed claims,
tax/accounting mappings, transfer prices, floors and matrix before deciding.
These changes add no approved commercial policy: finance still must supply
signed economics and satisfy external gates.

## Referral policy snapshots

Migration `001426` captures private, immutable commission rate, holdback and
partner account version at creation of each quote naming a partner. A
non-referral partner captures null/ineligible economics so later account changes
cannot turn it into an unsnapshotted referral. A different partner requires a
new quote revision. Every payment for an accepted order reads the snapshot
through `orders.quote_id`; refunds and clawbacks continue to mirror their
original accruals. The table is private to the service reader and is not exposed
on customer quote rows.

**Legacy limitation:** quotes predating migration `001426` lack an authentic
historical snapshot. Their payments deliberately retain the prior
current-account policy resolution. The migration does not invent contracted
economics, rewrite accrued earnings, or silently stop existing contracted
payments. Before changing a legacy partner's rate, finance should identify
affected orders, reconcile signed agreements and payment-accrual evidence, and
approve a separately audited remediation. Use:

```sql
select o.id as order_id, o.quote_id, o.partner_account_id, o.status
from public.orders o
left join public.core_referral_commission_policy_snapshots policy
  on policy.quote_id = o.quote_id
where o.sourcing = 'referral' and policy.quote_id is null
order by o.partner_account_id, o.id;
```

## Work still required before full commercial release

The selected price book can be downloaded as JSON with retained rates,
discounts, source, and read timestamp. Finance can clone a version or import
validated economics into a new draft, review retained quote/order/contract
impact counts, and approve scheduled activation. These operations preserve the
proposal and distinct-approver controls; imported data cannot supply approval.
Normalized effective-dated transfer programs, full commission
tenure/eligibility/settlement policy, and source-document/evidence lifecycle
remain outstanding. The transfer map remains the current runtime's versioned
rate-card policy; normalized program administration remains outstanding. The
term simulator is not a PAYG billing proof. External legal, tax, cost,
identity/provisioning, provider and production-pilot evidence gates remain
release conditions.

## PAYG invoice and correction sources

PAYG invoices use `billing_source = 'payg'` and a unique retained period-effect
key. Term invoices retain `billing_source = 'order'` and their accepted order.
The database requires exactly one source. PAYG never creates a placeholder order
to satisfy the term billing model.

Each PAYG invoice retains its rating, policy, billing identity, supplier and
customer presentation, tax question and determination in
`core_payg_invoice_sources`. The database checks the charge against the original
period rating or the positive correction delta, verifies canonical hashes,
checks tax lines against the pinned rule books, and requires the snapshot in the
same transaction as the invoice. Later policy, tax or address changes do not
rewrite the issued source. Customer reads are scoped to their own invoice.

Negative corrections allocate credits against the original period's retained
invoices. Finance must authorize materialization. Every allocation retains its
net and tax split; cumulative rounding preserves the original invoice's exact
tax total across multiple corrections. An effect must be completely allocated in
one transaction. The provider must have issued the original invoices before they
can be credited. Credits and refunds share one invoice ceiling and use retained
Stripe adjustment operations, including stable provider idempotency. The
database serializes their source checks so concurrent credits and refunds cannot
spend the same remaining invoice amount.

A retained allocation continues to reserve its net and tax while its provider
operation needs recovery. Resolve or redrive that operation; do not create a
replacement allocation or delete evidence to bypass it. PAYG refunds and
disputes bind actual recorded payments, with no invented term order. None of
these local contracts transfers billing authority from Fil One or supplies
verified usage, live tax rules, provider credentials, or external pilot
evidence.

At `/internal/payg-offers`, finance approvers can create a policy draft,
simulate monthly charges, propose it, and have a different approver approve the
version. The source URL, retained source evidence, effective date, correction
window, partial-month minimum, tax code, accounting income account, and trial
limits are explicit inputs. Approval does not activate sales.

The same page records verified existing provider enrollments and confirmed
service cancellations, lists their immutable identifiers, and exposes a billing
effect queue. A Clockwork billing enrollment requires cutover evidence; a Fil
One billing enrollment remains outside Clockwork invoicing. Supplier and Stripe
customer mappings are resolved from persisted account configuration at
enrollment. Cancellation records confirmed provider service end and does not
itself delete or disable storage. Both admin writes retain the authenticated
actor in audit.

`core.schedule.payg-close.v1` runs daily at 03:00 UTC in staging and production.
Its runtime is configured during worker bootstrap and checks the current billing
capability before closing periods. It revisits periods covered by retained
enrollments, closes ended calendar/final service periods, and reports accounts
blocked by missing source completeness or correction evidence. Retries retain
one revision per evidence hash and one billing effect per delta. Finance uses
**Refresh billing queue** and **Create financial document** to materialize each
retained effect into the shared audit/outbox/provider delivery path. Provider
capability and external activation gates still apply to delivery.

The source integration boundary is
`DatabasePaygBillingRepository.ingestVerifiedReceipt`: its caller must
authenticate the provider payload and retain signature evidence before invoking
it. Receipt/source IDs and bytes are deduplicated transactionally; local receipt
time controls correction windows. The repository does not expose an
unauthenticated browser ingestion endpoint. A live Fil One adapter still
requires its agreed signed payload, identity mapping, complete-count watermark,
and operational reconciliation contract.

Trial administration on the same page retains lifetime claims for a persisted
organization and verified domain. Eligibility requires a cleared account,
server-verified registration audit evidence or an existing verified DNS domain
record, an approved effective policy, and a mapped provider tenant. Neither a
free-form domain assertion nor deleting a claim can reset eligibility.

`DatabaseTrialRepository.ingestVerifiedCounters` retains authenticated source
receipt evidence, exact normalized payload hashes, monotonic measurement time,
and cumulative egress. `reserve` locks the trial before evaluating each write,
egress, or API operation against both the current counter and outstanding
reservations. Stale counters fail closed. The authorization includes a
`validUntil` deadline; the provider must honor that deadline and the reservation
ID as its operation idempotency key. Reservations remain held until a verified
completion or rejection settles them; a timeout never manufactures fresh quota.
Confirmed actual egress cannot exceed or disappear beneath the source counter.
SQL constraints enforce the same bounds and atomic settlement completeness.

Policy expiry blocks writes, the configured grace period permits reads subject
to egress limits, and the end of grace denies trial access. An explicitly
blocked account or changed tenant mapping also denies authorization. Confirmed
paid conversion binds either an active committed entitlement or a retained PAYG
enrollment on the same account and tenant. It preserves data and does not invent
a term order for PAYG. Later authorization returns `converted` so the adapter
must use the paid access policy.

The durable trial store, per-operation authorization boundary, admin operations,
and provider-fake lifecycle are qualified locally. No live Fil One transport
currently invokes counter ingestion or reservation. Its adapter must verify the
actual source signature, apply capability and service holds, reserve before
executing an operation, honor the authorization deadline, and retain verified
settlement evidence. Existing provisioning ports do not yet supply a live
read-only/block-all access mutation. Trial activation therefore remains disabled
until that external provider contract and adapter behavior are qualified.

## Channel policy and fictional review workspaces

Finance can draft, edit, propose, return, and approve effective-dated channel
policies at `/internal/channel-policy`. Sales handoff capacity, default and
maximum initial requested protection, extension length, and maximum extensions
are configurable. Creator, last editor, and proposer cannot review their own
version. Approval is immutable; UTC effective dates select the policy for new
requests. Each new registration retains the server-selected policy (or an
explicit legacy-default marker), initial requested window, and extension count.
Extensions require progress evidence and obey both per-extension and cumulative
limits. Existing registrations are not rewritten when policy changes.

Explicitly configured demo deployments offer fictional PAYG/trial and channel
policy workspaces. The seeded proposals have a different author, allowing the
finance persona to review them without weakening two-person controls. Saved
records and idempotency receipts use the same resettable demo state store as
other demo commands. PAYG simulation uses the real usage rating engine with
synthetic hourly measurements. Live enrollment and billing execution are
unavailable in this workspace; approval cannot verify an external source or
activate live sales. The separate customer request workspace at `/buy/payg` and
finance queue at `/internal/payg-requests` retain fictional trial, conversion
and cancellation handoffs, explicitly labeled **Simulate verified handoff**.
They do not invoke production repositories or providers. Demo reset removes
those requests and simulated service results and restores the fictional
policies. See [customer acquisition](customer-acquisition.md) for the production
assent and verified-source requirements.
