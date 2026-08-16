# Billing reconciliation

Run the monthly three-way tie-out after the accounting period closes and after
all known Stripe deliveries for the window have been processed. The result is
platform revenue versus Stripe versus QuickBooks Online (QBO), with every
variance listed. A close requires zero **unexplained** variance; timing and
mapping variances may remain only with an owner and evidence.

## Owners and source records

- Finance owns the close and QBO sign-off; commerce operations owns workflow
  recovery; accounting approves mappings and revenue-recognition treatment.
- The commerce database is the operating source, Stripe is billing/payment truth
  and the AR subledger, and QBO is the general ledger. Invoices originate in
  Stripe only. Do not repair a variance by hand-editing commerce or creating an
  invoice in QBO.
- Use `/internal/reports`, the `three_way_tie_out` report, and the immutable
  reconciliation export. The relevant durable tasks are
  `core.reconciliation.usage.v1` and `core.reconciliation.three-way.v1`.
- `/internal/billing-reconciliation` is the operator surface for the close. It
  lists the stored tie-out periods and the open variances, and it is where a
  variance is classified. Reaching it requires `report:read`; recording a
  disposition requires `billing:approve` or `system:operate`, re-read at
  execution time, with recent authentication and a reason of at least 8
  characters.

## What the operator surface reads

The two tables on that surface are different in kind and the surface says so:

- **Tie-out periods** come from `core_three_way_tie_out`, a real view over a
  real table that **no application path writes**.
  `core.reconciliation.three-way.v1` computes its variances in memory, opens an
  exception case and records the run; it inserts no tie-out row. Rows there were
  loaded by a fixture or by hand and are shown as stored values, never as the
  output of a close. A period is reported as untied from its own variance
  columns, not from its `status` label.
- **Variances** are the open exception cases in the `reconciliation` queue,
  which is what both reconciliation tasks actually produce.

Classifying a variance writes the classification, the expected clearing period
and the evidence reference to the case's audit trail, and a summary to the
case's `decision_reason`. It **does not close the case**: closing one is a
signed decision requiring an immutable evidence document and stays on the
lifecycle command path. An `unexplained` classification is accepted and keeps
counting as blocking, because a close requires zero unexplained variance and the
blocker has to be recordable to be tracked.

## Prepare the period

1. Record the exact half-open UTC window, close version, currencies, Stripe
   account, QBO company, price-book versions, report run ID, and input export
   hashes. Keep USD, EUR, and GBP separate; never net currencies.
2. Confirm webhook inboxes and billing workflows have no in-scope pending or
   permanent failures. Replay verified deliveries through
   [webhook-replay.md](./webhook-replay.md) before rerunning the tie-out.
3. Confirm entitlement-grain usage and orchestrator costs have arrived. A margin
   report remains labeled `modeled`, not `realized`, until those costs are
   complete.
4. Confirm `EXT-TAX-01`, `EXT-PROVIDER-01`, and the applicable account and
   marketplace gates show the activation evidence used for this period.

## Reconcile

1. **Commercial population:** tie immutable accepted orders and amendment
   supersessions to invoiced lines. Direct and referral revenue is gross; resale
   revenue is the partner transfer price. Consolidated partner invoices must
   group end-client allocations without billing an end client.
2. **Commitment and usage:** run source reconciliation, then compare the
   commitment ledger with deduplicated usage. Respect contractual time zones,
   partial periods, `period_allowance` versus `term_drawdown`, contracted
   overage rates, late events, and corrections. Negative usage may correct a
   prior overage; it may not create unvalidated negative consumption.
3. **Stripe:** tie issued invoices, tax, discounts, credits, refunds, disputes,
   payments, fees, and payouts. Keep invoice issuance and collection timing
   separate. Confirm all bank-transfer receipts were applied to the intended
   customer and currency.
4. **QBO:** terms invoices post AR at issuance; auto-charge volume posts by
   payout summary; prepaid commitments map to deferred revenue; Stripe Tax maps
   to tax liabilities; commission statements map to bills; entitlement-grain
   costs map to the approved cost accounts. QBO tax calculation remains off.
5. **Commissions:** referral accruals use net collected revenue. Credits,
   refunds, and chargebacks must create negative accruals and be netted on the
   next statement according to holdback and clawback terms.
6. **Marketplaces:** reconcile each provider order and entitlement separately
   from fees, invoice, refund, disbursement, and settlement. Tie normalized
   marketplace entries to the relevant order before including them in the
   platform/QBO comparison.

## Variance handling

Classify every variance as delivery timing, period cut-off, currency, tax,
account mapping, missing/duplicate event, usage correction, amendment/proration,
provider fee, or unexplained. Record amount, currency, source IDs, owner,
expected clearing period, evidence, and correction mechanism. Corrections are
new domain records or accounting entries with audit evidence; issued artifacts
and prior close exports remain immutable.

For a provider or workflow defect, open the owned exception and follow
[workflow-recovery.md](./workflow-recovery.md). For a tax, revenue-recognition,
or mapping decision, stop the affected country/payment path until `EXT-TAX-01`
is approved.

## Close evidence

- All currencies and merchant-of-record paths reconcile independently.
- The run is reproducible from hashed source exports and traces each report row
  to order, invoice, payment, and amendment records.
- Unexplained variance is zero. Approved timing variances have an owner and
  next-period verification date.
- Finance and accounting approvers sign the immutable reconciliation report; its
  document ID/hash and QBO close reference are attached to the audit event.
