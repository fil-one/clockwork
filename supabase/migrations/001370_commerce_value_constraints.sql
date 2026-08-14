-- Money on the commerce tables was typed but not constrained. `accounts` has
-- pinned its currency to the shipped vocabulary since 000001_foundation.sql:53
-- and two core_* tables did the same at 001000; the twenty-one other tables that
-- declare a currency column never did, so the three-code list that appears in
-- seven files was enforced on three of the twenty-four tables that carry it.
-- The sign of an amount was in the same state: `quotes.total_minor` and the two
-- price columns on `quote_lines` and `rate_cards` were guarded, and everything
-- around them relied on a trigger, on a chain equality to a guarded column, or
-- on nothing at all. A trigger is bypassed by `session_replication_role`, by a
-- future writer that drops it, and by any path that predates it; a CHECK is not.
--
-- This migration adds the declarative rules only. It deliberately leaves three
-- things alone, each recorded below where the reasoning belongs.

-- Currency vocabulary. Same three literals and same predicate shape as
-- accounts_currency_check, so there is one list rather than two.
alter table public.commission_accruals
  add constraint commission_accruals_currency_check
  check (currency in ('USD','EUR','GBP'));

alter table public.cost_records
  add constraint cost_records_currency_check
  check (currency in ('USD','EUR','GBP'));

alter table public.credit_notes
  add constraint credit_notes_currency_check
  check (currency in ('USD','EUR','GBP'));

alter table public.dispute_cases
  add constraint dispute_cases_currency_check
  check (currency in ('USD','EUR','GBP'));

alter table public.invoices
  add constraint invoices_currency_check
  check (currency in ('USD','EUR','GBP'));

alter table public.payments
  add constraint payments_currency_check
  check (currency in ('USD','EUR','GBP'));

alter table public.pocs
  add constraint pocs_currency_check
  check (currency in ('USD','EUR','GBP'));

-- The price book is the root of the currency chain: a rate card, the quote that
-- prices from it, the order, and the invoice all inherit this value.
alter table public.price_books
  add constraint price_books_currency_check
  check (currency in ('USD','EUR','GBP'));

alter table public.quotes
  add constraint quotes_currency_check
  check (currency in ('USD','EUR','GBP'));

alter table public.refunds
  add constraint refunds_currency_check
  check (currency in ('USD','EUR','GBP'));

-- Two further currency columns carry a different name and are nullable, which is
-- why they were missed by a scan for `currency text not null`. They denominate
-- the two money columns constrained further down and are worthless without the
-- same vocabulary.
alter table public.key_terms
  add constraint key_terms_liability_cap_currency_check
  check (liability_cap_currency is null or liability_cap_currency in ('USD','EUR','GBP'));

alter table public.memberships
  add constraint memberships_approval_limit_currency_check
  check (approval_limit_currency is null or approval_limit_currency in ('USD','EUR','GBP'));

-- The core_* mirror of the same hole. Nine real tables declare a currency and
-- had no vocabulary behind it; the two that already did
-- (core_invoice_document_snapshots at 001000 and
-- core_order_acceptance_reservations at 001000) are left alone, and the six
-- views that project a currency are not constrainable and inherit the rule from
-- the tables they read. Every writer was traced before the rule was added: the
-- marketplace path parses its payload through MarketplaceEventPayloadSchema,
-- whose `currency` is `CurrencySchema.nullable()`
-- (packages/contracts/src/primitives.ts:114 is the same three literals), and the
-- provider normaliser upper-cases before it parses
-- (packages/integrations/src/core/marketplaces/normalization.ts:206). The
-- commission statement writer parses with the same schema
-- (packages/db/src/repositories/core/commissions.ts:169). The end-client
-- allocation copies `invoices.currency` and the Stripe adjustment operation
-- copies `credit_notes.currency` or `refunds.currency`
-- (001000_commercial_database_integrity.sql:2193), all three of which are
-- constrained above. The remaining four have no writer outside seed and pgTAP.
alter table public.core_accounting_exports
  add constraint core_accounting_exports_currency_check
  check (currency in ('USD','EUR','GBP'));

alter table public.core_amendment_financial_terms
  add constraint core_amendment_financial_terms_currency_check
  check (currency in ('USD','EUR','GBP'));

alter table public.core_commission_statements
  add constraint core_commission_statements_currency_check
  check (currency in ('USD','EUR','GBP'));

alter table public.core_invoice_end_client_allocations
  add constraint core_invoice_end_client_allocations_currency_check
  check (currency in ('USD','EUR','GBP'));

-- The only nullable one of the nine: core_marketplace_events_check already
-- requires currency and the four money columns to be null or present together,
-- so a null here is the legal "non-financial event" shape and the vocabulary
-- applies to the populated case only.
alter table public.core_marketplace_events
  add constraint core_marketplace_events_currency_check
  check (currency is null or currency in ('USD','EUR','GBP'));

alter table public.core_marketplace_financial_entries
  add constraint core_marketplace_financial_entries_currency_check
  check (currency in ('USD','EUR','GBP'));

alter table public.core_marketplace_reconciliations
  add constraint core_marketplace_reconciliations_currency_check
  check (currency in ('USD','EUR','GBP'));

-- Named for the column rather than the table: this one is `source_currency`,
-- the denomination of the adjustment the operation was built from.
alter table public.core_stripe_adjustment_operations
  add constraint core_stripe_adjustment_operations_source_currency_check
  check (source_currency in ('USD','EUR','GBP'));

alter table public.core_three_way_tie_outs
  add constraint core_three_way_tie_outs_currency_check
  check (currency in ('USD','EUR','GBP'));

-- Money sign. `>= 0` throughout, matching accounts_credit_nonnegative_check,
-- quotes_total_nonnegative_check, invoices_amount_paid_check and
-- quote_lines_values_check. The invoice, payment and adjustment triggers demand
-- a strictly positive amount, but that is a write-path policy: a declarative
-- `> 0` here would be stricter than any constraint this schema has ever shipped
-- and would reject a legitimate zero-amount row later.
alter table public.invoices
  add constraint invoices_amount_nonnegative_check
  check (amount_minor >= 0);

alter table public.payments
  add constraint payments_amount_nonnegative_check
  check (amount_minor >= 0);

alter table public.credit_notes
  add constraint credit_notes_amount_nonnegative_check
  check (amount_minor >= 0);

alter table public.refunds
  add constraint refunds_amount_nonnegative_check
  check (amount_minor >= 0);

-- dispute_cases is the live hole among the three adjustments: refunds and
-- credit_notes have protect_financial_adjustment on UPDATE, dispute_cases has
-- only a BEFORE INSERT amount guard, so `update dispute_cases set amount_minor
-- = -1` succeeded before this constraint existed.
alter table public.dispute_cases
  add constraint dispute_cases_amount_nonnegative_check
  check (amount_minor >= 0);

-- An order line copies its prices from the quote line it was accepted from, and
-- validate_commerce_chain requires them to stay equal, so these two columns were
-- protected transitively by quote_lines_values_check and never declaratively.
-- Named and shaped after rate_card_price_check, which states the same rule.
alter table public.order_lines
  add constraint order_lines_price_nonnegative_check
  check (unit_price_minor >= 0 and overage_rate_minor >= 0);

-- The remaining halves of two constraints that only ever covered part of their
-- table. 000001 is applied history, so these are separate named constraints
-- rather than a rewrite of quote_lines_values_check and rate_card_price_check.
alter table public.quote_lines
  add constraint quote_lines_line_total_nonnegative_check
  check (line_total_minor >= 0);

-- floor_price_minor is nullable; a bare `>= 0` would pass NULL anyway, but the
-- explicit form matches 000100_core_finance.sql:96 and states the intent.
alter table public.rate_cards
  add constraint rate_cards_floor_price_nonnegative_check
  check (floor_price_minor is null or floor_price_minor >= 0);

-- The core mirror of this concept already constrains partner resale
-- (000100_core_finance.sql:96); the foundation quote constrained total_minor
-- beside it and left this column open.
alter table public.quotes
  add constraint quotes_partner_resale_total_nonnegative_check
  check (partner_resale_total_minor is null or partner_resale_total_minor >= 0);

-- A POC cost is read as a positive cost and negated downstream
-- (000100_core_finance.sql:830 selects `p.cost_minor, -p.cost_minor`), so the
-- stored value is never itself negative.
alter table public.pocs
  add constraint pocs_cost_nonnegative_check
  check (cost_minor >= 0);

alter table public.key_terms
  add constraint key_terms_liability_cap_nonnegative_check
  check (liability_cap_minor is null or liability_cap_minor >= 0);

alter table public.memberships
  add constraint memberships_approval_limit_nonnegative_check
  check (approval_limit_minor is null or approval_limit_minor >= 0);

-- Three deliberate omissions, so the next reader does not read them as misses.
--
-- amendment_lines.price_delta_minor and amendment_lines.quantity_delta are
-- deltas, not amounts. A downgrade amendment is required to carry a negative
-- one: packages/domain/src/core/amendments/index.ts:156 rejects a downgrade
-- whose quantity delta is positive. The directional rule that would be correct
-- keys on amendments.kind, which a CHECK cannot reach, so the only options were
-- unconstrained or wrong. 1370's pgTAP pins a negative delta as legal.
--
-- commission_accruals money is already constrained, and directionally:
-- commission_accruals_sign_check (000930:44, rewritten at 001000:3048) requires
-- >= 0 for payment and credit_note_void rows and <= 0 for the adjustment rows a
-- clawback is made of. A blanket >= 0 would break clawbacks. Only its currency
-- is added above.
--
-- cost_records.amount_minor is left open on purpose. It is summed as realized
-- cost and subtracted from booked revenue (000100_core_finance.sql:821-824), so
-- a negative row reads as a provider rebate rather than corrupt data. Its sign
-- is a semantic question this migration is not the place to settle.
