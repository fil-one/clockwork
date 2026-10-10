-- Saved indicative pricing scenarios. A seller prices several lines for one
-- prospect from the price books in force that day and keeps the result to
-- reopen, edit or download as an indicative summary. Lines hold list prices
-- only: floors, transfer prices, claims and accounting codes are never copied
-- here. Totals are not stored; readers recompute them from the lines.
--
-- Staff reach the table through server code that checks `sales:read` for
-- their own rows; `commerce_admin` reaches every row (ADR 0011). The company
-- is free text with no CRM reference.
set lock_timeout = '5s';

create table if not exists public.commerce_pricing_scenarios (
  id uuid primary key,
  owner_id uuid not null,
  owner_name text not null check (length(btrim(owner_name)) between 1 and 200),
  name text not null check (length(btrim(name)) between 1 and 120),
  company text not null check (length(btrim(company)) between 1 and 200),
  notes text not null default '' check (length(notes) <= 2000),
  currency text not null check (currency in ('USD','EUR','GBP')),
  -- The day the lines were priced; `price_books` names the versions in force.
  as_of date not null,
  price_books jsonb not null check (jsonb_typeof(price_books) = 'array'
    and jsonb_array_length(price_books) between 1 and 20),
  lines jsonb not null check (jsonb_typeof(lines) = 'array'
    and jsonb_array_length(lines) between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1)
);

comment on table public.commerce_pricing_scenarios is
  'Saved indicative pricing scenarios: list prices only, totals recomputed on read. Not a quote or an offer.';

create index if not exists commerce_pricing_scenarios_owner_updated
  on public.commerce_pricing_scenarios (owner_id, updated_at desc, id desc);

create index if not exists commerce_pricing_scenarios_updated
  on public.commerce_pricing_scenarios (updated_at desc, id desc);

-- Who owns a scenario and when it was first saved never change; an edit
-- overwrites the rest and moves the version on by one.
create or replace function public.protect_commerce_pricing_scenario() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.id <> old.id or new.owner_id <> old.owner_id or new.owner_name <> old.owner_name
     or new.created_at <> old.created_at then
    raise exception 'Pricing scenario owner and creation are immutable';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'Pricing scenario version must advance by one';
  end if;
  return new;
end $$;

drop trigger if exists protect_commerce_pricing_scenario on public.commerce_pricing_scenarios;

create trigger protect_commerce_pricing_scenario before update on public.commerce_pricing_scenarios
  for each row execute function public.protect_commerce_pricing_scenario();

alter table public.commerce_pricing_scenarios enable row level security;

alter table public.commerce_pricing_scenarios force row level security;

revoke all on public.commerce_pricing_scenarios
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

revoke all on function public.protect_commerce_pricing_scenario() from public;

-- Customer identities have no grants. Deletes are hard and audited.
grant select, insert, update, delete on public.commerce_pricing_scenarios to clockwork_service;

drop policy if exists pricing_scenarios_service on public.commerce_pricing_scenarios;

create policy pricing_scenarios_service on public.commerce_pricing_scenarios
  for all to clockwork_service using (true) with check (true);

reset lock_timeout;
