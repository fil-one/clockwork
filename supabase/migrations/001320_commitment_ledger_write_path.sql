-- The commitment ledger decides invoiceable overage (spec section 5). Usage
-- arrives as an append-only event stream, a correction appends a reversing fact
-- instead of rewriting the fact it corrects, and an allowance amendment records
-- its own delta. A replay of these three streams reproduces the balance without
-- reading any materialized column.

alter table usage_events
  add column ledger_kind text not null default 'usage',
  add column corrects_usage_event_id uuid references usage_events(id);

alter table usage_events
  add constraint usage_events_ledger_kind_check
  check (ledger_kind in ('usage', 'correction'));

alter table usage_events
  add constraint usage_events_correction_target_check
  check ((ledger_kind = 'correction') = (corrects_usage_event_id is not null));

-- Only a correction may carry a negative quantity; raw usage cannot subtract.
alter table usage_events
  add constraint usage_events_usage_sign_check
  check (ledger_kind = 'correction' or quantity >= 0);

create index usage_events_correction_idx
  on usage_events (corrects_usage_event_id)
  where corrects_usage_event_id is not null;

create table core_commitment_allowance_adjustments (
  id uuid primary key default public.uuid_v7(),
  ledger_id uuid not null references commitment_ledgers(id),
  period_id uuid references core_commitment_periods(id),
  effective_at timestamptz not null,
  quantity_delta numeric(38, 18) not null,
  reason text not null check (reason in ('amendment', 'renewal', 'correction')),
  source_reference text not null check (length(source_reference) between 1 and 255),
  recorded_by uuid not null references commerce_users(id),
  recorded_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint core_commitment_allowance_adjustment_source_unique
    unique (ledger_id, source_reference)
);

create index core_commitment_allowance_adjustment_replay_idx
  on core_commitment_allowance_adjustments (ledger_id, effective_at, id);

create or replace function core_validate_allowance_adjustment() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.period_id is not null and not exists (
    select 1 from core_commitment_periods p
    where p.id = new.period_id and p.ledger_id = new.ledger_id
  ) then
    raise exception using errcode = '23514',
      message = 'allowance adjustment period must belong to its ledger';
  end if;
  return new;
end $$;

create constraint trigger core_commitment_allowance_adjustments_chain
  after insert or update on core_commitment_allowance_adjustments
  deferrable initially immediate
  for each row execute function core_validate_allowance_adjustment();

create trigger core_commitment_allowance_adjustments_immutable
  before update or delete on core_commitment_allowance_adjustments
  for each row execute function deny_immutable_mutation();

alter table core_commitment_allowance_adjustments enable row level security;
alter table core_commitment_allowance_adjustments force row level security;

create policy core_commitment_allowance_adjustment_read
  on core_commitment_allowance_adjustments for select
  using (exists (
    select 1 from commitment_ledgers l
    where l.id = ledger_id and core_can_access_order(l.order_id)
  ));

create policy core_commitment_allowance_adjustment_write
  on core_commitment_allowance_adjustments for all
  using (app_is_internal()) with check (app_is_internal());

grant select on core_commitment_allowance_adjustments to clockwork_runtime;
