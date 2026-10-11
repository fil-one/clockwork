-- Partner records: what the revenue team agreed, or is negotiating, with a
-- channel, referral, affiliate or technology partner, and the deals each
-- partner has registered with us. Staff keep them before any organization
-- exists in Commerce; a record may link to an organization later.
--
-- This is a working record for sellers. Billing, commission accrual and the
-- partner portal's deal-registration engine (001426, deal_registrations) do
-- not read it, and nothing here writes to them.
--
-- Staff reach both tables through server code on the service role: holders of
-- `sales:read` read them and holders of `contract:write` change them. Every
-- change writes a `partner.*` audit event in the same transaction. Customer
-- identities have no grants. Rows are never deleted: a partner that went
-- nowhere is `ended` and a mistaken registration is `withdrawn`.
set lock_timeout = '5s';

create table if not exists public.commerce_partners (
  id uuid primary key,
  name text not null check (length(btrim(name)) between 1 and 200),
  normalized_name text generated always as (public.commerce_mnda_normalize_company(name)) stored,
  website text not null default '' check (length(website) <= 500),
  region text not null default '' check (length(region) <= 500),
  models text[] not null default '{}'
    check (models <@ array['referral','resale','affiliate','distributor','msp','teaming','technology','other']::text[]),
  status text not null default 'prospect'
    check (status in ('prospect','talking','negotiating','terms_agreed','signed','active','paused','ended')),
  owner_id uuid,
  owner_name text check (owner_name is null or length(btrim(owner_name)) between 1 and 200),
  organization_id uuid references public.organizations(id),
  contacts jsonb not null default '[]'
    check (jsonb_typeof(contacts) = 'array' and jsonb_array_length(contacts) <= 20),
  next_step text not null default '' check (length(next_step) <= 500),
  next_step_due date,
  notes text not null default '' check (length(notes) <= 8000),
  -- The common terms. Each is optional and bounded only for sanity: no
  -- commission or margin ceiling applies.
  commission_pct numeric(7,4) check (commission_pct between 0 and 100),
  commission_schedule text not null default '' check (length(commission_schedule) <= 500),
  commission_steps jsonb not null default '[]'
    check (jsonb_typeof(commission_steps) = 'array' and jsonb_array_length(commission_steps) <= 24),
  margin_pct numeric(7,4) check (margin_pct between 0 and 100),
  territory text not null default '' check (length(territory) <= 500),
  exclusivity text check (exclusivity in ('none','limited','exclusive')),
  exclusivity_note text not null default '' check (length(exclusivity_note) <= 500),
  currency text check (currency in ('USD','EUR','GBP')),
  nfr_allowance text not null default '' check (length(nfr_allowance) <= 500),
  trial_period text not null default '' check (length(trial_period) <= 200),
  trial_targets text not null default '' check (length(trial_targets) <= 2000),
  -- Anything the slots above do not fit: label, value and notes per row.
  term_rows jsonb not null default '[]'
    check (jsonb_typeof(term_rows) = 'array' and jsonb_array_length(term_rows) <= 40),
  created_by_id uuid not null,
  created_by_name text not null check (length(btrim(created_by_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint commerce_partners_owner_check check ((owner_id is null) = (owner_name is null))
);

comment on table public.commerce_partners is
  'Staff partner records and the terms agreed with each partner. Not read by billing, commissions or the partner portal. Service role only; every change is audited as partner.*.';

create index if not exists commerce_partners_updated
  on public.commerce_partners (updated_at desc, id desc);

create index if not exists commerce_partners_owner_due
  on public.commerce_partners (owner_id, next_step_due) where next_step_due is not null;

create index if not exists commerce_partners_normalized_name
  on public.commerce_partners (normalized_name);

create table if not exists public.commerce_partner_deals (
  id uuid primary key,
  partner_id uuid not null references public.commerce_partners(id),
  end_client text not null check (length(btrim(end_client)) between 1 and 200),
  normalized_end_client text generated always as (public.commerce_mnda_normalize_company(end_client)) stored,
  organization_id uuid references public.organizations(id),
  registered_on date not null,
  protected_until date not null,
  estimated_size numeric(15,3) check (estimated_size > 0),
  size_unit text check (size_unit in ('TB','PB','TiB','PiB')),
  model text not null default 'referral' check (model in ('referral','resale','other')),
  status text not null default 'registered'
    check (status in ('registered','accepted','won','lost','expired','withdrawn','disputed')),
  notes text not null default '' check (length(notes) <= 4000),
  created_by_id uuid not null,
  created_by_name text not null check (length(btrim(created_by_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint commerce_partner_deals_protection_check check (protected_until >= registered_on),
  constraint commerce_partner_deals_size_check check (estimated_size is null or size_unit is not null)
);

comment on table public.commerce_partner_deals is
  'Deals a partner registered with the revenue team, logged by staff. Overlaps between partners are warned about, never blocked. Service role only; audited as partner.deal_*.';

create index if not exists commerce_partner_deals_partner
  on public.commerce_partner_deals (partner_id, registered_on desc, id desc);

create index if not exists commerce_partner_deals_end_client
  on public.commerce_partner_deals (normalized_end_client)
  where status in ('registered','accepted','disputed');

create index if not exists commerce_partner_deals_lapsing
  on public.commerce_partner_deals (protected_until)
  where status in ('registered','accepted');

-- Who recorded a row and when never change; every other column may, and each
-- change moves the version on by one. A registration stays with its partner.
create or replace function public.protect_commerce_partner_row() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.id <> old.id or new.created_by_id <> old.created_by_id
     or new.created_by_name <> old.created_by_name or new.created_at <> old.created_at then
    raise exception using errcode = 'P0001', message = 'PARTNER_ROW_CREATION_IMMUTABLE';
  end if;
  -- PL/pgSQL resolves every field an expression names, so the deal-only
  -- check reads the row as JSON rather than naming a column partners lack.
  if tg_table_name = 'commerce_partner_deals'
     and to_jsonb(new)->>'partner_id' <> to_jsonb(old)->>'partner_id' then
    raise exception using errcode = 'P0001', message = 'PARTNER_DEAL_PARTNER_IMMUTABLE';
  end if;
  if new.version <> old.version + 1 then
    raise exception using errcode = 'P0001', message = 'PARTNER_VERSION_MUST_ADVANCE';
  end if;
  return new;
end $$;

drop trigger if exists protect_commerce_partner on public.commerce_partners;

create trigger protect_commerce_partner before update on public.commerce_partners
  for each row execute function public.protect_commerce_partner_row();

drop trigger if exists protect_commerce_partner_deal on public.commerce_partner_deals;

create trigger protect_commerce_partner_deal before update on public.commerce_partner_deals
  for each row execute function public.protect_commerce_partner_row();

alter table public.commerce_partners enable row level security;

alter table public.commerce_partners force row level security;

alter table public.commerce_partner_deals enable row level security;

alter table public.commerce_partner_deals force row level security;

revoke all on public.commerce_partners
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

revoke all on public.commerce_partner_deals
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

revoke all on function public.protect_commerce_partner_row() from public;

grant select, insert, update on public.commerce_partners to clockwork_service;

grant select, insert, update on public.commerce_partner_deals to clockwork_service;

drop policy if exists partners_service on public.commerce_partners;

create policy partners_service on public.commerce_partners
  for all to clockwork_service using (true) with check (true);

drop policy if exists partner_deals_service on public.commerce_partner_deals;

create policy partner_deals_service on public.commerce_partner_deals
  for all to clockwork_service using (true) with check (true);

reset lock_timeout;
