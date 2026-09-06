# PAYG invoice sources

A monthly PAYG charge and a term-order charge share the invoice, payment,
collections, and provider-delivery ledgers. `invoices.billing_source` selects
exactly one source: an accepted order, or a retained PAYG billing effect. A PAYG
invoice never creates a placeholder order or quote.

A PAYG invoice retains its rating revision, approved policy, effect, supplier,
customer, Stripe customer binding, and determined tax in
`core_payg_invoice_sources`. Positive corrections invoice only the additional
amount; the complete rerated month remains evidence. SQL checks the canonical
snapshot hash and financial bindings, and the provider dispatch rechecks the
retained source before issuing. Stripe metadata identifies the PAYG enrollment,
month, revision, and effect. The provider amount is the retained gross amount;
automatic tax does not recalculate tax already determined by Clockwork.

The issued-invoice projection and signed payment inbox both validate this
source. Provider receipt replay converges on one invoice/payment. Invoice source
identity and amounts cannot change after insertion. Customer invoice derivation
reads the retained source through the account's row access policy; it displays
the charge or correction delta, service period, policy version, usage totals,
and jurisdiction-level tax evidence.

Negative corrections allocate credit across the retained issued invoices. Each
allocation retains its net and tax amounts and original invoice source hash. For
the paid portion, an approved credit note credits the customer’s Stripe balance
for a future invoice. A cash refund remains a separate finance action. The
gateway previews the payment split and finds a prior matching provider note
before retrying, so a crash after acceptance cannot create a second credit.

Provider credit and refund commands reserve their shared original invoice
ceiling; unrelated PAYG invoices do not share a null-order ceiling. Refunds
remain bound to an actual payment, and provider commands require a persisted
provider invoice or payment identifier.

Collections use the confirmed PAYG service end when available. A PAYG invoice
does not invent a term entitlement or a retention deadline: unresolved retention
liability requires operator review. PAYG payment receipts do not create referral
commissions without an approved PAYG attribution policy.

These paths require approved commercial policy, verified source measurements,
Clockwork billing authority and cutover evidence, and the normal production
capability and external-provider gates. Retaining a rating plan is separate from
issuing an invoice; the operator queue exposes the unresolved work.
