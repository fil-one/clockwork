-- Four foreign keys that every commerce read walks had nothing behind them, and
-- the cursor pager filtered on an account while ordering by id, which no
-- existing index can serve in one pass. Both shapes degrade with row count
-- rather than with the size of the answer, so they are invisible on a seeded
-- database and expensive on a real one. Measured on 100k children and 60k
-- account-spread parents, quote_lines went from 1819 buffers to 7, order_lines
-- 1640 to 4, payments 1961 to 4, entitlements 1924 to 4, and the first quote
-- page 991 to 371 with the row-count-scaled filter gone entirely; the pager
-- numbers were taken as clockwork_runtime with force row security on, so the
-- policy quals ride along as filters and do not displace the index.
--
-- Written for a populated table: `create index concurrently` is unavailable
-- here because the migration runner pipelines every statement after the first
-- and PostgreSQL 17 rejects a concurrent build inside a pipeline, so each build
-- instead runs under a bounded lock wait, commits on its own, and is written
-- `if not exists` so a timed-out run resumes where it stopped. ADR-0009 records
-- the convention and the measurement behind it.
set lock_timeout = '5s';

-- Child tables first: the shortest builds and the least contended relations, so
-- a run that dies on a lock has already banked the cheap wins.
create index if not exists quote_lines_quote_idx
  on quote_lines (quote_id);
create index if not exists order_lines_order_idx
  on order_lines (order_id);

-- payments has two parents and only invoice_id is read by a predicate. The
-- order_id references all resolve through payments_pkey
-- (`where p.id = new.payment_id and p.order_id = new.order_id`), so an index
-- there would never be planned. entitlements likewise already covers
-- order_line_id through entitlements_order_line_unique and organization_id as
-- the leading column of entitlements_org_status_idx; order_id is the one the
-- report views correlate on per order and the only one still uncovered.
create index if not exists payments_invoice_idx
  on payments (invoice_id);
create index if not exists entitlements_order_idx
  on entitlements (order_id);

-- Cursor pages filter on the owning account and order by id. The existing
-- *_account_timeline_idx and invoices_account_aging_idx lead on the same
-- account column but sort by time or status, so the pager fell back to a
-- primary-key walk that discards every other account's rows one at a time.
-- Those indexes still serve their own timeline and aging queries and stay. The
-- accounts page is the one branch that gets nothing: it filters on accounts.id
-- and orders by it, which the primary key already answers.
create index if not exists quotes_account_page_idx
  on quotes (account_id, id);
create index if not exists orders_account_page_idx
  on orders (account_id, id);
create index if not exists invoices_account_page_idx
  on invoices (account_id, id);
create index if not exists deal_registrations_partner_page_idx
  on deal_registrations (partner_account_id, id);
create index if not exists commission_accruals_partner_page_idx
  on commission_accruals (partner_account_id, id);

reset lock_timeout;
