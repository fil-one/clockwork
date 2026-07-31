alter table public.accounts
  add column commission_holdback_bps integer;

update public.accounts
set commission_holdback_bps = 0
where commission_rate_bps is not null;

alter table public.accounts
  add constraint accounts_commission_policy_check
  check (
    (commission_rate_bps is null) = (commission_holdback_bps is null)
    and (
      commission_rate_bps is null
      or (
        commission_rate_bps between 0 and 10000
        and commission_holdback_bps between 0 and 10000
      )
    )
  );

alter table public.commission_accruals
  add column source_type text,
  add column source_id uuid,
  add column holdback_bps integer;

-- Clockwork is a new application, but retain structurally valid identifiers if
-- an operator rehearses this migration over an earlier demo snapshot.
update public.commission_accruals
set source_type = 'payment',
    source_id = id,
    holdback_bps = 0
where source_type is null;

alter table public.commission_accruals
  alter column source_type set not null,
  alter column source_id set not null,
  alter column holdback_bps set not null,
  add constraint commission_accruals_adjustment_source_fk
    foreign key (adjustment_source_id) references public.commission_accruals(id),
  add constraint commission_accruals_source_type_check
    check (source_type in ('payment','credit_note','refund','dispute')),
  add constraint commission_accruals_policy_check
    check (rate_bps between 0 and 10000 and holdback_bps between 0 and 10000),
  add constraint commission_accruals_sign_check
    check (
      (
        source_type = 'payment'
        and adjustment_source_id is null
        and net_collected_revenue_minor >= 0
        and amount_minor >= 0
        and holdback_minor >= 0
      )
      or (
        source_type <> 'payment'
        and adjustment_source_id is not null
        and net_collected_revenue_minor <= 0
        and amount_minor <= 0
        and holdback_minor <= 0
      )
    );

create unique index commission_accruals_source_unique
  on public.commission_accruals(source_type, source_id);

alter table public.core_commission_statements
  drop constraint if exists core_commission_statements_holdback_minor_check;

drop trigger if exists commission_accruals_immutable
  on public.commission_accruals;

create or replace function public.protect_commission_accrual()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'commission accrual is append-only';
  end if;
  if old.id is distinct from new.id
    or old.partner_account_id is distinct from new.partner_account_id
    or old.invoice_id is distinct from new.invoice_id
    or old.source_type is distinct from new.source_type
    or old.source_id is distinct from new.source_id
    or old.adjustment_source_id is distinct from new.adjustment_source_id
    or old.rate_bps is distinct from new.rate_bps
    or old.holdback_bps is distinct from new.holdback_bps
    or old.currency is distinct from new.currency
    or old.net_collected_revenue_minor is distinct from new.net_collected_revenue_minor
    or old.amount_minor is distinct from new.amount_minor
    or old.holdback_minor is distinct from new.holdback_minor
    or old.period is distinct from new.period
    or old.created_at is distinct from new.created_at
    or old.version is distinct from new.version
  then
    raise exception using errcode = '55000', message = 'commission financial truth is immutable';
  end if;
  if not (
    (old.status = new.status)
    or (old.status = 'accrued' and new.status = 'stated')
    or (old.status = 'stated' and new.status = 'paid')
  ) then
    raise exception using errcode = '23514', message = 'invalid commission accrual status transition';
  end if;
  return new;
end;
$$;

create trigger commission_accruals_immutable
before update or delete on public.commission_accruals
for each row execute function public.protect_commission_accrual();

create or replace function public.validate_commission_source_truth()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_invoice_id uuid;
  source_order_id uuid;
  source_payment_id uuid;
  source_currency text;
  source_amount_minor bigint;
  source_occurred_at timestamptz;
  referral_partner_id uuid;
  persisted_rate_bps integer;
  persisted_holdback_bps integer;
  original public.commission_accruals%rowtype;
  expected_net_minor bigint;
  expected_commission_minor bigint;
  expected_holdback_minor bigint;
  expected_period text;
begin
  if new.source_type = 'payment' then
    select p.invoice_id, p.order_id, p.id, p.currency, p.amount_minor, p.received_at
      into source_invoice_id, source_order_id, source_payment_id,
           source_currency, source_amount_minor, source_occurred_at
    from public.payments p
    where p.id = new.source_id and p.status = 'succeeded' and p.received_at is not null;
  elsif new.source_type = 'credit_note' then
    select c.invoice_id, c.order_id, c.currency, c.amount_minor, c.created_at
      into source_invoice_id, source_order_id, source_currency,
           source_amount_minor, source_occurred_at
    from public.credit_notes c
    where c.id = new.source_id and c.status = 'issued';
  elsif new.source_type = 'refund' then
    select p.invoice_id, r.order_id, p.id, r.currency, r.amount_minor, r.created_at
      into source_invoice_id, source_order_id, source_payment_id,
           source_currency, source_amount_minor, source_occurred_at
    from public.refunds r
    join public.payments p on p.id = r.payment_id
    where r.id = new.source_id and r.status = 'succeeded'
      and p.order_id = r.order_id and p.currency = r.currency
      and r.amount_minor <= p.amount_minor;
  else
    select p.invoice_id, d.order_id, p.id, d.currency, d.amount_minor, d.updated_at
      into source_invoice_id, source_order_id, source_payment_id,
           source_currency, source_amount_minor, source_occurred_at
    from public.dispute_cases d
    join public.payments p on p.id = d.payment_id
    where d.id = new.source_id and d.status = 'lost'
      and p.order_id = d.order_id and p.currency = d.currency
      and d.amount_minor <= p.amount_minor;
  end if;

  if source_invoice_id is null or source_amount_minor is null or source_amount_minor <= 0 then
    raise exception using errcode = '23514', message = 'commission source is not an eligible persisted financial event';
  end if;

  select o.partner_account_id, a.commission_rate_bps, a.commission_holdback_bps
    into referral_partner_id, persisted_rate_bps, persisted_holdback_bps
  from public.invoices i
  join public.orders o on o.id = i.order_id
  join public.accounts a on a.id = o.partner_account_id
  where i.id = source_invoice_id
    and o.id = source_order_id
    and o.sourcing = 'referral'
    and a.partner_agreement_type = 'referral'
    and i.currency = source_currency
    and source_amount_minor <= i.amount_minor;

  if referral_partner_id is null
    or new.invoice_id <> source_invoice_id
    or new.partner_account_id <> referral_partner_id
    or new.currency <> source_currency
  then
    raise exception using errcode = '23514', message = 'commission source must match its persisted referral invoice and partner';
  end if;

  if new.source_type = 'payment' then
    if new.adjustment_source_id is not null
      or persisted_rate_bps is null
      or persisted_holdback_bps is null
      or new.rate_bps <> persisted_rate_bps
      or new.holdback_bps <> persisted_holdback_bps
    then
      raise exception using errcode = '23514', message = 'commission policy must match persisted referral partner policy';
    end if;
    expected_net_minor := source_amount_minor;
  else
    select * into original
    from public.commission_accruals a
    where a.id = new.adjustment_source_id
      and a.source_type = 'payment'
      and a.invoice_id = source_invoice_id
      and a.partner_account_id = referral_partner_id;
    if original.id is null
      or (source_payment_id is not null and original.source_id <> source_payment_id)
      or new.rate_bps <> original.rate_bps
      or new.holdback_bps <> original.holdback_bps
    then
      raise exception using errcode = '23514', message = 'commission clawback must use its persisted payment accrual policy';
    end if;
    expected_net_minor := -source_amount_minor;
  end if;

  expected_commission_minor := round(
    (expected_net_minor * new.rate_bps)::numeric / 10000
  )::bigint;
  expected_holdback_minor := round(
    (expected_commission_minor * new.holdback_bps)::numeric / 10000
  )::bigint;
  expected_period := extract(year from source_occurred_at at time zone 'UTC')::integer::text
    || '-Q' || extract(quarter from source_occurred_at at time zone 'UTC')::integer::text;

  if new.net_collected_revenue_minor <> expected_net_minor
    or new.amount_minor <> expected_commission_minor
    or new.holdback_minor <> expected_holdback_minor
    or new.period <> expected_period
    or new.status <> 'accrued'
  then
    raise exception using errcode = '23514', message = 'commission values must derive from source money, policy, and UTC quarter';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_commission_source_truth() from public;

create trigger commission_accruals_source_truth
before insert on public.commission_accruals
for each row execute function public.validate_commission_source_truth();

-- Replaced by the source-specific security-definer validator above. The
-- foundation trigger cannot see an end-client invoice in partner RLS scope.
drop trigger if exists commission_accruals_chain
  on public.commission_accruals;

create or replace function public.core_validate_financial_rollup()
returns trigger
language plpgsql
set search_path = public
as $$
declare export_record core_accounting_exports%rowtype;
declare statement_record core_commission_statements%rowtype;
declare invoice_record invoices%rowtype;
declare summed_debits bigint;
declare summed_credits bigint;
declare summed_total bigint;
declare summed_gross bigint;
declare summed_clawback bigint;
declare summed_holdback bigint;
declare summed_payable bigint;
begin
  if tg_table_name = 'core_accounting_exports' then
    export_record := new;
  elsif tg_table_name = 'core_accounting_export_entries' then
    select * into export_record from core_accounting_exports where id = new.export_id;
  elsif tg_table_name = 'core_invoice_end_client_allocations' then
    select * into invoice_record from invoices where id = new.invoice_id;
    select coalesce(sum(a.total_minor), 0) into summed_total
      from core_invoice_end_client_allocations a where a.invoice_id = new.invoice_id;
    if summed_total <> invoice_record.amount_minor then
      raise exception using errcode = '23514', message = 'invoice end-client allocations must tie to the invoice total';
    end if;
    return new;
  elsif tg_table_name = 'core_commission_statements' then
    statement_record := new;
  elsif tg_table_name = 'core_commission_statement_lines' then
    select * into statement_record from core_commission_statements where id = new.statement_id;
  end if;

  if export_record.id is not null and export_record.status in ('generated','delivered') then
    select coalesce(sum(e.debit_minor), 0), coalesce(sum(e.credit_minor), 0)
      into summed_debits, summed_credits from core_accounting_export_entries e where e.export_id = export_record.id;
    if summed_debits <> export_record.total_debit_minor or summed_credits <> export_record.total_credit_minor then
      raise exception using errcode = '23514', message = 'accounting export entries must tie to header totals';
    end if;
  end if;

  if statement_record.id is not null and statement_record.status in ('issued','approved','exported','paid') then
    select
      coalesce(sum(greatest(l.commission_minor, 0)), 0),
      coalesce(sum(greatest(-l.commission_minor, 0)), 0),
      coalesce(sum(l.holdback_minor), 0),
      coalesce(sum(l.commission_minor - l.holdback_minor), 0)
      into summed_gross, summed_clawback, summed_holdback, summed_payable
    from core_commission_statement_lines l where l.statement_id = statement_record.id;
    if summed_gross <> statement_record.gross_accrued_minor
      or summed_clawback <> statement_record.clawback_minor
      or summed_holdback <> statement_record.holdback_minor
      or summed_payable <> statement_record.payable_minor
    then
      raise exception using errcode = '23514', message = 'commission statement lines must tie to header totals';
    end if;
  end if;
  return new;
end;
$$;

-- The finance/system path can create an accrual from a persisted source, but
-- only the internal statement generator may advance accrual status.
revoke update, delete on public.commission_accruals from clockwork_runtime;
