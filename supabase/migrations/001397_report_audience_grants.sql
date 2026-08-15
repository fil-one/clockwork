-- The three §17 views 001396 added were reachable by nobody and refused to
-- nobody, which is not the same as being internal.
--
-- Every §17 view that shipped before them is in exactly one of two states:
--
--   * granted `select` to `clockwork_runtime` (000905: revenue forecast,
--     renewal and churn, partner performance, funnel and cycle time, margin and
--     POC cost) -- "Customer-facing reports must execute as clockwork_runtime so
--     the security-invoker views apply underlying table RLS"; or
--   * granted only to `clockwork_service` AND named in the `internalOnly` list
--     that `CoreFinanceRepository.report()` checks (capacity planning, the
--     three-way tie-out, the weekly scorecard).
--
-- `core_arr_mrr`, `core_billing_collections` and `core_commission_settlement`
-- were in NEITHER. A non-internal caller holding `report:read` -- an `owner` on
-- a partner account is one -- passed the account-scope check, was not refused,
-- and reached a view its role has no `select` on. PostgreSQL answered
-- `42501 permission denied for view core_commission_settlement`: a raw driver
-- error where the API contract promises a typed refusal or a page.
--
-- This migration is the SQL half of the decision. The other half is
-- `coreReportSources[report].audience` in
-- packages/db/src/repositories/core/database-finance.ts, which is now the only
-- declaration of who a report is for -- the `internalOnly` set is derived from
-- it rather than written twice. `core-reports.integration.test.ts` reads
-- `has_table_privilege('clockwork_runtime', ...)` back for every report in the
-- catalogue and fails when the grant here and the audience there disagree, so
-- the two are bound by measurement and not by both being edited at once.
--
-- This grants `select` and nothing else. No column, constraint, policy or lock
-- changes: the set of writes this migration can refuse is empty.
set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Tenant-reachable: ARR/MRR and billing and collections
-- ---------------------------------------------------------------------------
-- `core_arr_mrr` reads exactly one relation, `core_revenue_forecast`, which
-- 000905 already granted to `clockwork_runtime`. It adds no table of its own,
-- so this grant hands a tenant the run rate of numbers they can already page
-- through month by month, under the same row-level security -- both views are
-- `security_invoker`, so the RLS applied is the caller's.
--
-- `core_billing_collections` reads invoices, orders, payments, credit notes,
-- refunds, dispute cases, the collection case, the billing policy and the
-- account commercial profile. Every one of those has a SELECT policy for the
-- account party (`app_has_account(...)` directly or through the invoice), so
-- the row an account reads about its own invoice is column-for-column the row
-- an internal operator reads -- asserted against the demo seed in
-- supabase/tests/1397_report_reach_and_partner_credit.test.sql rather than
-- assumed here. The inner join to `orders` cannot silently drop an invoice
-- either: `core_validate_finance_chain` requires
-- `orders.invoicing_account_id = invoices.account_id`, and `orders_scope`
-- admits `app_has_account(invoicing_account_id)`.
--
-- What this grant makes newly reachable IN PRACTICE, stated rather than left to
-- be discovered: `core_collection_cases` is not on the record-read surface, so
-- the dunning owner's user id, the next dunning action and the running-service
-- decision arrive at a tenant here for the first time. Its SELECT policy
-- already admits the account party (`app_is_internal() or
-- app_has_account(account_id)`), which is the platform's standing answer to who
-- may read an account's own collection case, and §17 names the dunning owner as
-- content of this report. Nothing here widens a policy; if that answer is to
-- change, the policy is where it changes, and this view follows it.
grant select on public.core_arr_mrr, public.core_billing_collections
  to clockwork_runtime;

-- ---------------------------------------------------------------------------
-- Internal: commission and settlement
-- ---------------------------------------------------------------------------
-- Stated as a revoke rather than left implicit, so the intent survives a future
-- blanket grant and so `has_table_privilege` reads false for a reason someone
-- wrote down.
--
-- This is the one of the three whose content would survive the grant while
-- being wrong. Two independent reasons:
--
--   1. It joins `invoices` and `orders` inline. A commission accrual exists
--      only on a referral order -- `core_validate_finance_chain`: "commission
--      must belong to an attributed referral invoice" -- and on a referral the
--      merchant of record is Fil One, so the invoice belongs to the END CLIENT.
--      The partner cannot read that invoice under `invoices_scope`, the join
--      drops, and the partner's own settlement report returns ZERO ROWS while
--      `commission_accruals` one relation away returns the accrual. The pgTAP
--      test measures exactly that, as an owner on the seeded Redwood partner.
--   2. `marketplace_fee_minor` sums `core_marketplace_financial_entries`, whose
--      only policy is `app_is_internal()`. A tenant reads 0 for a column §17
--      requires, whatever the fee actually was.
--
-- An empty page for the exact party the report is about, and a zero for a fee
-- that is not zero, are both worse than a typed refusal. §17 opens "Internal
-- only; clients and partners see their own data in the portal", and a partner's
-- settlement position is already reachable row by row through
-- `core_commission_statements`, whose policy is
-- `app_has_account(partner_account_id)`. Making this tenant-reachable is a view
-- change -- the joins have to survive the end client's RLS and the marketplace
-- fee has to come from a relation a partner may read -- not a grant.
revoke all on public.core_commission_settlement
  from public, anon, authenticated, clockwork_runtime;
grant select on public.core_commission_settlement to clockwork_service;

comment on view public.core_arr_mrr is
  'Spec §17 ARR and MRR: contracted recurring value per committed order at the run rate in force now, on the merchant-of-record basis (gross for direct/referral, transfer price for partner-of-record resale and distributor). A projection of core_revenue_forecast - it computes no money of its own, so ARR here and revenue forecast there cannot disagree. Tenant-reachable: granted to clockwork_runtime, rows scoped by the row-level security of core_revenue_forecast, which it is the only reader of.';

comment on view public.core_billing_collections is
  'Spec §17 billing and collections: one row per invoice with issuance, aging, payment, credit, refund, dispute, dunning owner, billed-account credit exposure and cash timing. An invoice nothing has happened to still reports a row, reading zero. Tenant-reachable: granted to clockwork_runtime, and every relation it reads has a SELECT policy for the account party, so an account reads its own invoices complete.';

comment on view public.core_commission_settlement is
  'Spec §17 commission and settlement: one row per commission accrual with the collected-revenue basis, holdback, clawback, statement, distributor allocation, marketplace fee and settlement-export status, each tied to the invoice and payment it came from. Adjustments keep their sign rather than being netted, so a clawback stays visible. INTERNAL ONLY - ungranted to clockwork_runtime and refused by report(): under a tenant the referral invoice join drops every row and the marketplace fee reads zero, so a tenant grant would return an empty, understated report rather than a refusal.';

reset lock_timeout;
