-- P0-49. 001390 was right that the database should enforce the invoice amount
-- against the amendments the invoice bills, and wrong about what it compared
-- against. It replaced the stable predicate
--
--   q.total_minor = new.amount_minor
--
-- with one that sums `core_amendment_financial_terms` live (001392 carries it
-- forward against the net), and `invoices_projection_truth` (000920:96) is
--
--   before insert or update on public.invoices
--
-- so that predicate is re-evaluated on EVERY UPDATE of the row, not only when
-- it is written. The summed set keeps growing. The moment an amendment is
-- accepted after an invoice exists — which `mutateAmendment` has no reason to
-- refuse and does not — the row's persisted amount stops satisfying the
-- predicate and every subsequent UPDATE is rejected.
--
-- What that broke is the money path, not a reporting path. The blocked writers
-- are invoice issuance (workflows/core.ts:1136) and the verified Stripe
-- settlement projection (system/providers.ts:854 and :921). A customer pays, the
-- payment can never be recorded, `amount_remaining_minor` stays at the full
-- amount for the life of the row, and a paid invoice goes to dunning and then
-- to collections. A control that blocks a legitimate write is as serious as one
-- that permits a wrong number, and this one blocked the most legitimate write
-- the system has.
--
-- The fix is to make the predicate INVARIANT over the row's lifetime, as the
-- pre-001390 one was, without giving up what 001390 added. The invoice now
-- carries `amendment_delta_minor`: the net amendment delta that was applied when
-- the row was written. The identity becomes
--
--   q.total_minor + new.amendment_delta_minor = new.amount_minor - new.tax_minor
--
-- which is a function of the row plus immutable quote truth and of nothing that
-- can move afterwards, and `amendment_delta_minor` joins the immutable set so
-- the stored figure cannot be edited to launder a different amount.
--
-- 001390's strength is kept where it means something. On INSERT — the one moment
-- the live aggregate IS the truth about what this invoice bills — the trigger
-- additionally requires the stored delta to equal the sum of
-- `forecast_delta_minor` over the order's amendments, so a writer that computes a
-- delta the database does not agree with still cannot persist a bill. After that
-- the figure is history and is compared as history.
--
-- The alternative was to leave the live aggregate and narrow the trigger to
-- `before insert or update of amount_minor`. That is weaker in two ways. It
-- stops enforcing the derivation on every UPDATE that does not name
-- `amount_minor` — which is most of them, and includes the settlement writes —
-- so the column that matters loses its check exactly when the row is moving; and
-- an UPDATE that does name it is still judged against a set that has moved since
-- the row was written, so the same trap reappears for any writer that touches
-- the amount. Storing the figure removes the moving target instead of dodging it.
--
-- What this migration deliberately does NOT decide: what SHOULD happen
-- commercially when an amendment is accepted after an invoice exists. The
-- invoice keeps the amount it was issued at — a persisted bill is not re-priced
-- in place — and settling the difference needs either a credit note (for a
-- post-invoice downgrade) or a supplementary invoice (for an upgrade).
-- `credit_notes` exists; no writer issues one for this case, and `invoices`
-- cannot express a second bill for one order. Inventing that mechanism here
-- would be guessing at a commercial policy nobody has stated, so it is named and
-- left open rather than half-built.
--
-- CORRECTION (001394). This paragraph originally claimed the difference reached
-- finance as `deriveInvoice`'s signed `varianceMinor` with an
-- `INVOICE_TOTAL_VARIANCE` note. It did not. That comparison put a net derived
-- total against a gross invoiced one, so it was already saturated before any
-- amendment landed — measured at -202830 on the taxed fixture, against an
-- amendment worth -9148 — and the test asserting it passed with the amendment
-- removed. The gross-versus-net half is fixed in the domain; a second basis
-- mismatch in the same comparison is not, so that note is still not this signal.
-- The exact signal is `core_invoice_amendment_drift` (001394), which reads the
-- immutable `amendment_delta_minor` this migration adds against the live
-- accepted sum. Naming an open remedy is honest; claiming a detection that does
-- not exist is not, and it is what let the remedy stay open unnoticed.
--
-- Written for a populated table (ADR-0009): the column takes a constant default
-- so no heap is rewritten, the backfill is a bounded UPDATE of a small table, no
-- index is built, and each statement commits on its own so a run that times out
-- resumes rather than restarts.
set lock_timeout = '5s';

alter table public.invoices
  add column if not exists amendment_delta_minor bigint not null default 0;

comment on column public.invoices.amendment_delta_minor is
  'Net forecast delta of the order amendments this invoice billed, as at the moment it was written. Signed: a downgrade lowers the bill as an upgrade raises it. Immutable, and the figure the projection trigger checks amount_minor against so the check cannot drift as later amendments land.';

-- Backfill is not a guess. For every row already at rest the delta that was in
-- fact applied is exactly the slack between the billed net and the quote total,
-- because that identity is what the trigger required of the row when it was
-- written. Every pre-001390 row lands on 0. Any row already bricked by a
-- post-invoice amendment is restored to satisfying its own constraint, which is
-- the repair as much as the migration is.
update public.invoices i
   set amendment_delta_minor = i.amount_minor - i.tax_minor - q.total_minor
  from public.orders o
  join public.quotes q on q.id = o.quote_id
 where o.id = i.order_id
   and i.amendment_delta_minor is distinct from
       (i.amount_minor - i.tax_minor - q.total_minor);

create or replace function public.validate_invoice_payment_projection_truth()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'invoices' then
    if not exists (
      select 1
      from public.orders o
      join public.quotes q on q.id = o.quote_id
      where o.id = new.order_id
        and o.immutable_at is not null
        and q.status = 'accepted'
        and o.invoicing_account_id = new.account_id
        and q.currency = new.currency
        and q.total_minor + new.amendment_delta_minor
              = new.amount_minor - new.tax_minor
        and o.po_number is not distinct from new.po_number
    ) then
      raise exception using
        errcode = '23514',
        message = 'invoice must derive account, currency, amount, and PO from its accepted order and quote';
    end if;
    -- Only at insert is the live sum the truth about what this invoice bills.
    -- An amendment carrying no financial terms contributes nothing to it and is
    -- refused at the writer rather than here: the seeded demo predates 001390
    -- and carries one.
    if tg_op = 'INSERT' and new.amendment_delta_minor is distinct from coalesce((
      select sum(terms.forecast_delta_minor)
      from public.amendments amendment
      join public.core_amendment_financial_terms terms
        on terms.amendment_id = amendment.id
      where amendment.order_id = new.order_id
    ), 0) then
      raise exception using
        errcode = '23514',
        message = 'invoice amendment delta must equal the net forecast delta of its order amendments';
    end if;
    if tg_op = 'UPDATE' and (
      old.order_id is distinct from new.order_id
      or old.account_id is distinct from new.account_id
      or old.currency is distinct from new.currency
      or old.amount_minor is distinct from new.amount_minor
      or old.amendment_delta_minor is distinct from new.amendment_delta_minor
      or old.tax_minor is distinct from new.tax_minor
      or old.tax_treatment is distinct from new.tax_treatment
      or old.po_number is distinct from new.po_number
    ) then
      raise exception using
        errcode = '23514',
        message = 'persisted invoice commercial truth is immutable';
    end if;
    if tg_op = 'UPDATE' and new.amount_paid_minor < old.amount_paid_minor then
      raise exception using
        errcode = '23514',
        message = 'settled invoice amount cannot decrease';
    end if;
  elsif tg_table_name = 'payments' then
    if new.amount_minor <= 0 then
      raise exception using
        errcode = '23514',
        message = 'Stripe payment amount must be positive';
    end if;
    if not exists (
      select 1
      from public.invoices i
      where i.id = new.invoice_id
        and i.order_id = new.order_id
        and i.currency = new.currency
    ) then
      raise exception using
        errcode = '23514',
        message = 'Stripe payment must match its local invoice, order, and currency';
    end if;
  end if;
  return new;
end;
$$;

reset lock_timeout;
