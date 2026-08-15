-- P0-49, residual A. 001393 said that when an amendment is accepted after an
-- invoice exists "`deriveInvoice` reports the difference as a signed
-- `varianceMinor` with an `INVOICE_TOTAL_VARIANCE` note, so finance can see it".
-- That was not true, and the integration test asserting it passed identically
-- with the post-invoice amendment removed.
--
-- `deriveInvoice` sums the order lines, the amendment supersessions and the
-- metered overage — all of them net figures — and compared the sum against
-- `invoices.amount_minor`, which 001392 made GROSS. Measured on the taxed
-- fixture, the variance was -202830 BEFORE any post-invoice amendment existed
-- and the amendment moved it by -9148. A signal that is already saturated
-- carries no information, and "not equal to zero" is not a detection.
--
-- The net-against-net comparison is fixed in the domain
-- (packages/domain/src/core/derivation). It is necessary and it is not
-- sufficient: the derived total is still not on the same basis as the invoiced
-- one, because `order_lines.unit_price_minor` is a PER-MONTH rate while the
-- invoice bills the whole term (`core_revenue_forecast` at 000900:261 already
-- multiplies by `billing_months` for exactly this reason). Every invoice in this
-- database therefore still reports a variance of eleven months of line revenue.
-- That is a real defect and it is NOT fixed here: it is a question about which
-- persisted field is the line's billed amount, it changes the derivation
-- contract and its callers, and guessing at it inside a fix for something else
-- is how the last two rounds of this bug were made. INVOICE_TOTAL_VARIANCE is
-- consequently not the post-invoice-amendment signal and nothing should be
-- built on it as though it were.
--
-- What IS an exact signal is already at rest, and it needs no heuristic:
--
--   * `invoices.amendment_delta_minor` (001393) is the net amendment delta this
--     invoice billed, frozen at the moment it was written and immutable after.
--   * The sum of `core_amendment_financial_terms.forecast_delta_minor` over the
--     order's amendments is the net amendment delta accepted for that order NOW.
--     On INSERT the trigger requires the two to be equal.
--
-- Their difference is, to the minor unit, the amendment value accepted after the
-- invoice was written. No tax in it, no per-month-versus-per-term basis in it,
-- and zero exactly when nothing has been amended since the bill went out. That
-- is the detection signal, and this view is it.
--
-- It is a REPORT, not a control. Amending after an invoice is legitimate — the
-- customer signs what the customer signs — and 001393 is right that the invoice
-- keeps the amount it was issued at. What the difference obliges is a REMEDY,
-- and the remedy is a credit note when it is negative and a supplementary
-- invoice when it is positive. Neither is built: `credit_notes` exists and no
-- writer issues one for this case, and `invoices` cannot express a second bill
-- for one order (the writer refuses it as a double bill). That is a commercial
-- policy nobody has stated, so it stays named and unbuilt — but it is no longer
-- undetectable, which is the part that was not acceptable.
--
-- A view adds no column, no constraint and no lock: nothing here can block a
-- write, which is the correct blast radius for a thing whose only job is to be
-- read.
set lock_timeout = '5s';

create or replace view public.core_invoice_amendment_drift
with (security_invoker = true) as
select
  i.id                                                as invoice_id,
  i.order_id,
  i.account_id,
  i.currency,
  i.status,
  i.amount_minor,
  i.tax_minor,
  i.amount_minor - i.tax_minor                        as net_amount_minor,
  i.amendment_delta_minor                             as billed_amendment_delta_minor,
  coalesce(sum(terms.forecast_delta_minor), 0)::bigint
                                                      as accepted_amendment_delta_minor,
  (coalesce(sum(terms.forecast_delta_minor), 0) - i.amendment_delta_minor)::bigint
                                                      as unbilled_amendment_delta_minor
from public.invoices i
-- LEFT so an unamended order still reports a row reading zero. An amendment
-- carrying no financial terms contributes nothing, which is the same treatment
-- the 001393 insert check gives it: `amendment_lines` alone states a
-- full-period contractual delta, not an amount owed.
left join public.amendments amendment
  on amendment.order_id = i.order_id
left join public.core_amendment_financial_terms terms
  on terms.amendment_id = amendment.id
group by i.id;

comment on view public.core_invoice_amendment_drift is
  'Per invoice: the net amendment delta it billed (frozen at issue) against the net amendment delta accepted for its order now. unbilled_amendment_delta_minor is the signed difference and is exactly the amendment value accepted after the bill went out - negative wants a credit note, positive wants a supplementary invoice, zero means nothing moved. A report, not a control: it blocks no write. Do not use deriveInvoice INVOICE_TOTAL_VARIANCE for this - see this migration for why.';

reset lock_timeout;
