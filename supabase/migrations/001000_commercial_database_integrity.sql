-- Commercial-integrity forward repair. This migration deliberately derives
-- money, party, and relationship facts from canonical rows and keeps runtime
-- callers behind fail-closed RLS and command boundaries.

-- Repository fixtures are useful evidence, but they are not signed production
-- inputs and can never activate the commercial or tax gates.
alter table public.system_external_gates
  add column input_provenance text not null default 'unverified'
  check (input_provenance in ('unverified','repository_fixture','live_signed'));

update public.system_external_gates
set input_provenance = 'repository_fixture'
where gate_key in ('EXT-COMMERCIAL-01','EXT-TAX-01');

alter table public.system_external_gates
  add constraint system_external_gates_signed_activation_check check (
    configured_status <> 'active'
    or gate_key not in ('EXT-COMMERCIAL-01','EXT-TAX-01')
    or input_provenance = 'live_signed'
  );

create or replace function public.system_gate_is_active(candidate text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.system_external_gates gate_record
    where gate_record.gate_key = candidate
      and gate_record.configured_status = 'active'
      and (
        gate_record.gate_key not in ('EXT-COMMERCIAL-01','EXT-TAX-01')
        or gate_record.input_provenance = 'live_signed'
      )
  )
$$;
revoke all on function public.system_gate_is_active(text) from public;
grant execute on function public.system_gate_is_active(text)
  to clockwork_runtime, clockwork_service;

-- Software capabilities are independent of external-readiness evidence.
-- Recovery can remain authorized without enabling new business or live effects.
create table public.system_capabilities (
  capability_key text primary key check (capability_key in (
    'new_business','legal','billing','partner','marketplace','teardown'
  )),
  enabled boolean not null default false,
  recovery_enabled boolean not null default false,
  change_reason text not null check (length(trim(change_reason)) > 0),
  changed_by text not null check (length(trim(changed_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0)
);
insert into public.system_capabilities (
  capability_key, enabled, recovery_enabled, change_reason, changed_by
) values
  ('new_business', true, false, 'repository command path enabled', 'migration:001000'),
  ('legal', true, true, 'repository legal and recovery paths enabled', 'migration:001000'),
  ('billing', true, true, 'repository billing and recovery paths enabled', 'migration:001000'),
  ('partner', true, true, 'repository partner and recovery paths enabled', 'migration:001000'),
  ('marketplace', false, true, 'new enrollment disabled; recovery retained', 'migration:001000'),
  ('teardown', false, true, 'automated teardown disabled; recovery retained', 'migration:001000');

create trigger system_capabilities_version
before update on public.system_capabilities
for each row execute function public.touch_versioned_row();
alter table public.system_capabilities enable row level security;
alter table public.system_capabilities force row level security;
create policy system_capabilities_service
on public.system_capabilities for all to clockwork_service
using (true) with check (true);
revoke all on public.system_capabilities
  from public, anon, authenticated, clockwork_runtime;
grant select, insert, update on public.system_capabilities to clockwork_service;

create or replace function public.system_capability_is_enabled(
  candidate text,
  recovery boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(bool_or(
    case when recovery then capability.recovery_enabled else capability.enabled end
  ), false)
  from public.system_capabilities capability
  where capability.capability_key = candidate
$$;
revoke all on function public.system_capability_is_enabled(text,boolean) from public;
grant execute on function public.system_capability_is_enabled(text,boolean)
  to clockwork_runtime, clockwork_service;

-- Raw runtime writes cannot bypass disabled software capabilities.
create policy quotes_capability_gate_insert
on public.quotes as restrictive for insert to clockwork_runtime
with check (public.system_capability_is_enabled('new_business'));

create policy orders_capability_gate_insert
on public.orders as restrictive for insert to clockwork_runtime
with check (
  public.system_capability_is_enabled('new_business')
  and public.system_capability_is_enabled('legal')
  and public.system_capability_is_enabled('billing')
  and (
    sourcing not in ('referral','resale','distributor')
    or public.system_capability_is_enabled('partner')
  )
  and (
    sourcing <> 'marketplace'
    or public.system_capability_is_enabled('marketplace')
  )
);

create policy pocs_capability_gate_insert
on public.pocs as restrictive for insert to clockwork_runtime
with check (
  public.system_capability_is_enabled('new_business')
  and public.system_capability_is_enabled('legal')
  and (
    partner_account_id is null
    or public.system_capability_is_enabled('partner')
  )
);

-- A resale/distributor quote is partner-confidential even though its service
-- account is the end client. Missing channel classification also fails closed
-- whenever partner-confidential columns are present.
create or replace function public.core_quote_is_visible(
  candidate uuid,
  internal_access boolean,
  allowed_account_ids jsonb
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.quotes quote_record
    left join public.core_quote_commercial_profiles commercial
      on commercial.quote_id = quote_record.id
    where quote_record.id = candidate
      and (
        internal_access
        or quote_record.partner_account_id::text in (
          select jsonb_array_elements_text(coalesce(allowed_account_ids, '[]'::jsonb))
        )
        or (
          quote_record.account_id::text in (
            select jsonb_array_elements_text(coalesce(allowed_account_ids, '[]'::jsonb))
          )
          and (
            commercial.channel_shape in ('direct','referral','marketplace')
            or (
              commercial.quote_id is null
              and quote_record.partner_account_id is null
              and quote_record.partner_resale_total_minor is null
              and quote_record.partner_document_id is null
            )
          )
        )
      )
  )
$$;
revoke all on function public.core_quote_is_visible(uuid,boolean,jsonb) from public;
grant execute on function public.core_quote_is_visible(uuid,boolean,jsonb)
  to clockwork_runtime, clockwork_service;

create or replace function public.core_can_access_quote(candidate uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.core_quote_is_visible(
    candidate,
    app_is_internal(),
    coalesce(app_context_claims()->'accountIds', '[]'::jsonb)
  )
$$;

drop policy if exists quotes_scope on public.quotes;
create policy quotes_read on public.quotes for select
using (
  public.core_can_access_quote(id)
  or (
    app_has_account(account_id)
    and partner_account_id is null
    and partner_resale_total_minor is null
    and partner_document_id is null
  )
);
create policy quotes_insert on public.quotes for insert
with check (
  app_is_internal()
  or app_has_account(account_id)
  or app_has_account(partner_account_id)
);
create policy quotes_update on public.quotes for update
using (public.core_can_access_quote(id))
with check (
  app_is_internal()
  or app_has_account(account_id)
  or app_has_account(partner_account_id)
);
create policy quotes_delete on public.quotes for delete
using (public.core_can_access_quote(id));

drop policy if exists quote_lines_scope on public.quote_lines;
create policy quote_lines_read on public.quote_lines for select
using (public.core_can_access_quote(quote_id));
create policy quote_lines_insert on public.quote_lines for insert
with check (public.core_can_access_quote(quote_id));
create policy quote_lines_update on public.quote_lines for update
using (public.core_can_access_quote(quote_id))
with check (public.core_can_access_quote(quote_id));
create policy quote_lines_delete on public.quote_lines for delete
using (public.core_can_access_quote(quote_id));

-- Portfolio and POC access comes only from a current approved/converted deal
-- relationship. A historical quote is not authority to browse a tenant.
create or replace function public.core_partner_has_current_relationship(
  candidate_partner uuid,
  candidate_end_client uuid
)
returns boolean
language sql
stable
set search_path = public
as $$
  select app_is_internal() or exists (
    select 1
    from public.deal_registrations registration
    where registration.partner_account_id = candidate_partner
      and registration.end_client_account_id = candidate_end_client
      and registration.status in ('approved','converted')
      and registration.protection_starts_at <= clock_timestamp()
      and registration.protection_ends_at > clock_timestamp()
  )
$$;

create or replace function public.core_partner_can_access_account(candidate uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select app_is_internal() or exists (
    select 1
    from public.deal_registrations registration
    where registration.end_client_account_id = candidate
      and registration.status in ('approved','converted')
      and registration.protection_starts_at <= clock_timestamp()
      and registration.protection_ends_at > clock_timestamp()
      and app_has_account(registration.partner_account_id)
  )
$$;

create policy deal_registrations_end_client_read
on public.deal_registrations for select to clockwork_runtime
using (
  app_has_account(end_client_account_id)
  and status in ('approved','converted')
  and protection_starts_at <= clock_timestamp()
  and protection_ends_at > clock_timestamp()
);

drop policy if exists pocs_scope on public.pocs;
create policy pocs_read on public.pocs for select
using (
  app_is_internal()
  or app_has_account(account_id)
  or (
    partner_account_id is not null
    and app_has_account(partner_account_id)
    and public.core_partner_has_current_relationship(partner_account_id, account_id)
  )
);
create policy pocs_insert on public.pocs for insert
with check (
  app_is_internal()
  or (
    exists (
      select 1 from public.organizations organization_record
      where organization_record.id = pocs.organization_id
        and organization_record.account_id = pocs.account_id
    )
    and (
      (partner_account_id is null and app_has_account(pocs.account_id))
      or (
        partner_account_id is not null
        and public.core_partner_has_current_relationship(partner_account_id, account_id)
        and (
          app_has_account(pocs.account_id)
          or app_has_account(partner_account_id)
        )
      )
    )
  )
);
create policy pocs_update on public.pocs for update
using (
  app_is_internal()
  or app_has_account(account_id)
  or (
    partner_account_id is not null
    and app_has_account(partner_account_id)
    and public.core_partner_has_current_relationship(partner_account_id, account_id)
  )
)
with check (
  app_is_internal()
  or (
    exists (
      select 1 from public.organizations organization_record
      where organization_record.id = pocs.organization_id
        and organization_record.account_id = pocs.account_id
    )
    and (
      (partner_account_id is null and app_has_account(pocs.account_id))
      or (
        partner_account_id is not null
        and public.core_partner_has_current_relationship(partner_account_id, account_id)
        and (
          app_has_account(pocs.account_id)
          or app_has_account(partner_account_id)
        )
      )
    )
  )
);
create policy pocs_delete on public.pocs for delete
using (app_is_internal() or app_has_account(account_id));

drop policy if exists lifecycle_poc_evidence_read
  on public.lifecycle_poc_evidence;
drop policy if exists lifecycle_poc_evidence_insert
  on public.lifecycle_poc_evidence;
create policy lifecycle_poc_evidence_read
on public.lifecycle_poc_evidence for select
using (exists (
  select 1
  from public.pocs poc_record
  where poc_record.id = poc_id
    and (
      app_is_internal()
      or app_has_account(poc_record.account_id)
      or (
        poc_record.partner_account_id is not null
        and app_has_account(poc_record.partner_account_id)
        and public.core_partner_has_current_relationship(
          poc_record.partner_account_id,
          poc_record.account_id
        )
      )
    )
));
create policy lifecycle_poc_evidence_insert
on public.lifecycle_poc_evidence for insert
with check (exists (
  select 1
  from public.pocs poc_record
  where poc_record.id = poc_id
    and (
      app_is_internal()
      or app_has_account(poc_record.account_id)
      or (
        poc_record.partner_account_id is not null
        and app_has_account(poc_record.partner_account_id)
        and public.core_partner_has_current_relationship(
          poc_record.partner_account_id,
          poc_record.account_id
        )
      )
    )
));

-- Accepted orders pin both legal parties independently. The legacy
-- governing_agreement_version remains for compatibility; these columns are
-- the authoritative buyer/partner evidence used by acceptance.
alter table public.core_order_commercial_profiles
  add column buyer_agreement_id uuid references public.agreements(id),
  add column buyer_agreement_version integer,
  add column partner_agreement_id uuid references public.agreements(id),
  add column partner_agreement_version integer;

create or replace function public.core_pin_order_agreements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.orders%rowtype;
  agreement_record public.agreements%rowtype;
begin
  select * into order_record
  from public.orders
  where id = new.order_id;
  if not found then
    raise exception using errcode = '23503', message = 'order commercial profile requires its order';
  end if;

  if new.buyer_agreement_id is null then
    select * into agreement_record
    from public.agreements agreement_candidate
    where agreement_candidate.account_id = order_record.account_id
      and agreement_candidate.status = 'active'
      and agreement_candidate.effective_on <= order_record.service_starts_on
      and agreement_candidate.superseded_by_id is null
    order by
      agreement_candidate.effective_on desc,
      agreement_candidate.version desc,
      agreement_candidate.created_at desc,
      agreement_candidate.id desc
    limit 1;
    if found then
      new.buyer_agreement_id := agreement_record.id;
      new.buyer_agreement_version := agreement_record.version;
    end if;
  end if;

  if order_record.partner_account_id is not null
    and new.partner_agreement_id is null
  then
    select * into agreement_record
    from public.agreements agreement_candidate
    where agreement_candidate.account_id = order_record.partner_account_id
      and agreement_candidate.status = 'active'
      and agreement_candidate.effective_on <= order_record.service_starts_on
      and agreement_candidate.superseded_by_id is null
    order by
      agreement_candidate.effective_on desc,
      agreement_candidate.version desc,
      agreement_candidate.created_at desc,
      agreement_candidate.id desc
    limit 1;
    if found then
      new.partner_agreement_id := agreement_record.id;
      new.partner_agreement_version := agreement_record.version;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists core_order_commercial_profiles_immutable
  on public.core_order_commercial_profiles;

update public.core_order_commercial_profiles profile
set
  buyer_agreement_id = buyer_agreement.id,
  buyer_agreement_version = buyer_agreement.version,
  partner_agreement_id = partner_agreement.id,
  partner_agreement_version = partner_agreement.version
from public.orders order_record
join lateral (
  select agreement_candidate.id, agreement_candidate.version
  from public.agreements agreement_candidate
  where agreement_candidate.account_id = order_record.account_id
    and agreement_candidate.status = 'active'
    and agreement_candidate.effective_on <= order_record.service_starts_on
    and agreement_candidate.superseded_by_id is null
  order by
    agreement_candidate.effective_on desc,
    agreement_candidate.version desc,
    agreement_candidate.created_at desc,
    agreement_candidate.id desc
  limit 1
) buyer_agreement on true
left join lateral (
  select agreement_candidate.id, agreement_candidate.version
  from public.agreements agreement_candidate
  where agreement_candidate.account_id = order_record.partner_account_id
    and agreement_candidate.status = 'active'
    and agreement_candidate.effective_on <= order_record.service_starts_on
    and agreement_candidate.superseded_by_id is null
  order by
    agreement_candidate.effective_on desc,
    agreement_candidate.version desc,
    agreement_candidate.created_at desc,
    agreement_candidate.id desc
  limit 1
) partner_agreement on true
where profile.order_id = order_record.id;

create trigger core_order_commercial_profiles_pin_agreements
before insert on public.core_order_commercial_profiles
for each row execute function public.core_pin_order_agreements();

alter table public.core_order_commercial_profiles
  alter column buyer_agreement_id set not null,
  alter column buyer_agreement_version set not null,
  add constraint core_order_buyer_agreement_version_check
    check (buyer_agreement_version > 0),
  add constraint core_order_partner_agreement_pair_check check (
    (partner_agreement_id is null) = (partner_agreement_version is null)
  ),
  add constraint core_order_partner_agreement_version_check check (
    partner_agreement_version is null or partner_agreement_version > 0
  ),
  add constraint core_order_partner_agreement_shape_check check (
    (billing_shape in ('direct','marketplace') and partner_agreement_id is null)
    or (billing_shape in ('referral','resale','distributor')
      and partner_agreement_id is not null)
  );

create trigger core_order_commercial_profiles_immutable
before update or delete on public.core_order_commercial_profiles
for each row execute function public.deny_immutable_mutation();

create or replace function public.core_validate_commercial_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  quote_record public.quotes%rowtype;
  order_record public.orders%rowtype;
  quote_profile public.core_quote_commercial_profiles%rowtype;
  buyer_agreement_record public.agreements%rowtype;
  partner_agreement_record public.agreements%rowtype;
begin
  if tg_table_name = 'core_quote_commercial_profiles' then
    select * into quote_record
    from public.quotes where id = new.quote_id;
    if not found then
      raise exception using errcode = '23503', message = 'quote commercial profile requires its quote';
    end if;
    if new.channel_shape = 'distributor' and (
      quote_record.account_id <> quote_record.end_client_account_id
      or quote_record.partner_account_id is null
      or new.distributor_account_id is distinct from quote_record.partner_account_id
      or new.billing_account_id <> quote_record.partner_account_id
      or new.merchant_of_record <> 'partner'
      or new.pricing_authority <> 'partner'
    ) then
      raise exception using errcode = '23514', message = 'distributor quote buyer and merchant-of-record identities are inconsistent';
    elsif new.channel_shape = 'marketplace' and (
      quote_record.partner_account_id is not null
      or quote_record.end_client_account_id is not null
      or new.distributor_account_id is not null
      or new.billing_account_id <> quote_record.account_id
      or new.merchant_of_record <> 'marketplace'
      or new.pricing_authority <> 'marketplace'
    ) then
      raise exception using errcode = '23514', message = 'marketplace quote buyer and merchant-of-record identities are inconsistent';
    elsif new.channel_shape <> 'distributor'
      and new.distributor_account_id is not null
    then
      raise exception using errcode = '23514', message = 'only distributor quotes may name a distributor account';
    end if;
  elsif tg_table_name = 'core_order_commercial_profiles' then
    -- SHARE excludes concurrent agreement inserts/updates until this profile
    -- commits. The canonical re-selection below therefore cannot be invalidated
    -- by a parallel active row after validation.
    lock table public.agreements in share mode;
    select * into order_record
    from public.orders where id = new.order_id;
    select * into quote_profile
    from public.core_quote_commercial_profiles
    where quote_id = order_record.quote_id;
    if not found
      or quote_profile.channel_shape <> new.billing_shape
      or quote_profile.merchant_of_record <> new.merchant_of_record
      or quote_profile.billing_account_id <> order_record.invoicing_account_id
    then
      raise exception using errcode = '23514', message = 'order buyer and merchant-of-record identities must match its quote';
    end if;
    if new.billing_shape = 'distributor'
      and new.distributor_account_id is distinct from order_record.partner_account_id
    then
      raise exception using errcode = '23514', message = 'distributor order must pin its invoicing distributor';
    elsif new.billing_shape <> 'distributor'
      and new.distributor_account_id is not null
    then
      raise exception using errcode = '23514', message = 'only distributor orders may name a distributor account';
    end if;
    -- SHARE conflicts with the NO KEY UPDATE lock used by status/version/
    -- supersession changes, so the selected legal state cannot become stale
    -- between validation and commit.
    select * into buyer_agreement_record
    from public.agreements buyer_agreement
    where buyer_agreement.id = new.buyer_agreement_id
    for share;
    if not found
      or buyer_agreement_record.account_id <> order_record.account_id
      or buyer_agreement_record.version <> new.buyer_agreement_version
      or buyer_agreement_record.status <> 'active'
      or buyer_agreement_record.effective_on > order_record.service_starts_on
      or buyer_agreement_record.superseded_by_id is not null
      or new.buyer_agreement_id is distinct from (
        select agreement_candidate.id
        from public.agreements agreement_candidate
        where agreement_candidate.account_id = order_record.account_id
          and agreement_candidate.status = 'active'
          and agreement_candidate.effective_on <= order_record.service_starts_on
          and agreement_candidate.superseded_by_id is null
        order by agreement_candidate.effective_on desc,
          agreement_candidate.version desc,
          agreement_candidate.created_at desc,
          agreement_candidate.id desc
        limit 1
      )
    then
      raise exception using errcode = '23514', message = 'order must pin the authoritative buyer agreement';
    end if;
    if new.partner_agreement_id is not null then
      select * into partner_agreement_record
      from public.agreements partner_agreement
      where partner_agreement.id = new.partner_agreement_id
      for share;
    end if;
    if order_record.partner_account_id is not null and (
      new.partner_agreement_id is null
      or partner_agreement_record.id is null
      or partner_agreement_record.account_id <> order_record.partner_account_id
      or partner_agreement_record.version <> new.partner_agreement_version
      or partner_agreement_record.status <> 'active'
      or partner_agreement_record.effective_on > order_record.service_starts_on
      or partner_agreement_record.superseded_by_id is not null
      or new.partner_agreement_id is distinct from (
        select agreement_candidate.id
        from public.agreements agreement_candidate
        where agreement_candidate.account_id = order_record.partner_account_id
          and agreement_candidate.status = 'active'
          and agreement_candidate.effective_on <= order_record.service_starts_on
          and agreement_candidate.superseded_by_id is null
        order by agreement_candidate.effective_on desc,
          agreement_candidate.version desc,
          agreement_candidate.created_at desc,
          agreement_candidate.id desc
        limit 1
      )
    ) then
      raise exception using errcode = '23514', message = 'order must pin the authoritative partner agreement';
    end if;
  elsif tg_table_name = 'core_marketplace_events' and new.order_id is not null then
    if not exists (
      select 1
      from public.orders marketplace_order
      join public.core_order_commercial_profiles commercial
        on commercial.order_id = marketplace_order.id
      where marketplace_order.id = new.order_id
        and marketplace_order.sourcing = 'marketplace'
        and marketplace_order.account_id = new.account_id
        and marketplace_order.invoicing_account_id = new.account_id
        and marketplace_order.partner_account_id is null
        and commercial.billing_shape = 'marketplace'
        and commercial.merchant_of_record = 'marketplace'
    ) then
      raise exception using errcode = '23514', message = 'marketplace event must name the persisted buyer and marketplace merchant of record';
    end if;
  end if;
  return new;
end
$$;

create constraint trigger core_quote_commercial_identity
after insert or update on public.core_quote_commercial_profiles
deferrable initially immediate for each row
execute function public.core_validate_commercial_identity();
create constraint trigger core_order_commercial_identity
after insert or update on public.core_order_commercial_profiles
deferrable initially immediate for each row
execute function public.core_validate_commercial_identity();
create constraint trigger core_marketplace_event_identity
after insert or update on public.core_marketplace_events
deferrable initially immediate for each row
execute function public.core_validate_commercial_identity();

-- One durable reservation owns the acceptance decision for an order. No
-- caller supplies amount, currency, buyer, billing party, or partner.
create table public.core_order_acceptance_reservations (
  order_id uuid primary key references public.orders(id),
  buyer_account_id uuid not null references public.accounts(id),
  billing_account_id uuid not null references public.accounts(id),
  partner_account_id uuid references public.accounts(id),
  currency text not null check (currency in ('USD','EUR','GBP')),
  amount_minor bigint not null check (amount_minor > 0),
  decision text not null check (decision in ('approved','rejected','released')),
  reason text not null check (length(trim(reason)) > 0),
  owner_user_id uuid references public.commerce_users(id),
  review_case_id uuid unique references public.exception_cases(id),
  released_by_user_id uuid references public.commerce_users(id),
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0),
  constraint core_order_acceptance_review_check check (
    (decision = 'rejected' and owner_user_id is not null and review_case_id is not null)
    or decision <> 'rejected'
  ),
  constraint core_order_acceptance_release_check check (
    (decision = 'released'
      and released_by_user_id is not null
      and released_at is not null
      and length(trim(release_reason)) > 0)
    or (decision <> 'released'
      and released_by_user_id is null
      and released_at is null
      and release_reason is null)
  )
);
create index core_order_acceptance_decision_idx
  on public.core_order_acceptance_reservations(decision, created_at);
create unique index exception_cases_order_acceptance_open_unique
  on public.exception_cases(object_type, object_id)
  where queue = 'order_acceptance_review'
    and status in ('open','under_review');

create trigger core_order_acceptance_reservations_version
before update on public.core_order_acceptance_reservations
for each row execute function public.touch_versioned_row();

create or replace function public.core_protect_order_acceptance_reservation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'order acceptance reservations are durable';
  end if;
  if old.order_id is distinct from new.order_id
    or old.buyer_account_id is distinct from new.buyer_account_id
    or old.billing_account_id is distinct from new.billing_account_id
    or old.partner_account_id is distinct from new.partner_account_id
    or old.currency is distinct from new.currency
    or old.amount_minor is distinct from new.amount_minor
    or old.created_at is distinct from new.created_at
  then
    raise exception using errcode = '55000', message = 'order acceptance source facts are immutable';
  end if;
  if (
    old.owner_user_id is distinct from new.owner_user_id
    or old.review_case_id is distinct from new.review_case_id
  ) and not (old.decision = 'released' and new.decision = 'rejected') then
    raise exception using errcode = '55000', message = 'order acceptance review ownership is immutable';
  end if;
  if old.decision <> new.decision and not (
    (old.decision in ('approved','rejected') and new.decision = 'released')
    or (old.decision = 'released' and new.decision in ('approved','rejected'))
  ) then
    raise exception using errcode = '23514', message = 'invalid order acceptance reservation transition';
  end if;
  return new;
end
$$;
create trigger core_order_acceptance_reservations_protect
before update or delete on public.core_order_acceptance_reservations
for each row execute function public.core_protect_order_acceptance_reservation();

create or replace function public.core_validate_order_acceptance_reservation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.orders order_record
    join public.quotes quote_record on quote_record.id = order_record.quote_id
    where order_record.id = new.order_id
      and order_record.account_id = new.buyer_account_id
      and order_record.invoicing_account_id = new.billing_account_id
      and order_record.partner_account_id is not distinct from new.partner_account_id
      and quote_record.currency = new.currency
      and quote_record.total_minor = new.amount_minor
  ) then
    raise exception using errcode = '23514', message = 'order acceptance reservation must match persisted order amount, currency, and parties';
  end if;
  if new.review_case_id is not null and not exists (
    select 1
    from public.exception_cases review_case
    where review_case.id = new.review_case_id
      and review_case.queue = 'order_acceptance_review'
      and review_case.object_type = 'order'
      and review_case.object_id = new.order_id
      and review_case.owner_user_id = new.owner_user_id
  ) then
    raise exception using errcode = '23514', message = 'rejected order acceptance must own its review';
  end if;
  return new;
end
$$;
create constraint trigger core_order_acceptance_reservation_chain
after insert or update on public.core_order_acceptance_reservations
deferrable initially immediate for each row
execute function public.core_validate_order_acceptance_reservation();

alter table public.core_order_acceptance_reservations enable row level security;
alter table public.core_order_acceptance_reservations force row level security;
create policy core_order_acceptance_service
on public.core_order_acceptance_reservations for all to clockwork_service
using (true) with check (true);
revoke all on public.core_order_acceptance_reservations
  from public, anon, authenticated, clockwork_runtime;
grant select, insert, update on public.core_order_acceptance_reservations
  to clockwork_service;

create or replace function public.core_reserve_order_acceptance(
  candidate_order_id uuid,
  candidate_expected_order_version integer,
  candidate_review_owner_user_id uuid,
  candidate_request_id text
)
returns public.core_order_acceptance_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.orders%rowtype;
  quote_record public.quotes%rowtype;
  order_profile public.core_order_commercial_profiles%rowtype;
  quote_profile public.core_quote_commercial_profiles%rowtype;
  billing_profile public.core_account_commercial_profiles%rowtype;
  partner_profile public.core_account_commercial_profiles%rowtype;
  billing_policy public.core_billing_policies%rowtype;
  partner_policy public.core_billing_policies%rowtype;
  existing_reservation public.core_order_acceptance_reservations%rowtype;
  review_id uuid;
  rejection_reason text;
  inserted_reservation public.core_order_acceptance_reservations%rowtype;
begin
  if current_setting('role', true) = 'clockwork_runtime' and not (
    public.app_context_is_valid()
    and public.app_has_any_role(array[
      'owner','admin','partner_admin','internal_operator'
    ]::text[])
  ) then
    raise exception using errcode = '42501', message = 'order acceptance requires a signed authorized actor';
  end if;
  if candidate_expected_order_version <= 0
    or nullif(trim(candidate_request_id), '') is null
  then
    raise exception using errcode = '22023', message = 'order version and request identity are required';
  end if;
  if not exists (
    select 1 from public.commerce_users user_record
    where user_record.id = candidate_review_owner_user_id
      and user_record.is_internal_staff
  ) then
    raise exception using errcode = '23514', message = 'order rejection review requires an internal owner';
  end if;

  select * into order_record
  from public.orders
  where id = candidate_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'order not found';
  end if;
  if current_setting('role', true) = 'clockwork_runtime' and not (
    public.app_is_internal()
    or (
      order_record.sourcing in ('resale','distributor')
      and order_record.partner_account_id = order_record.invoicing_account_id
      and public.app_has_account(order_record.invoicing_account_id)
    )
    or (
      order_record.sourcing not in ('resale','distributor')
      and public.app_has_account(order_record.account_id)
    )
  ) then
    raise exception using errcode = '42501', message = 'order acceptance actor is outside the persisted party chain';
  end if;
  if order_record.row_version <> candidate_expected_order_version then
    raise exception using errcode = '40001', message = 'stale order acceptance version';
  end if;
  if order_record.status not in ('submitted','accepted') then
    raise exception using errcode = '23514', message = 'only submitted or accepted orders may reserve acceptance';
  end if;
  select * into quote_record
  from public.quotes where id = order_record.quote_id for update;
  select * into order_profile
  from public.core_order_commercial_profiles
  where order_id = order_record.id;
  select * into quote_profile
  from public.core_quote_commercial_profiles
  where quote_id = quote_record.id;

  select * into existing_reservation
  from public.core_order_acceptance_reservations
  where order_id = order_record.id
  for update;
  if found and existing_reservation.decision <> 'released' then
    return existing_reservation;
  end if;

  perform 1
  from public.core_account_commercial_profiles commercial_profile
  where commercial_profile.account_id = any(array_remove(array[
    order_record.invoicing_account_id,
    order_record.partner_account_id
  ]::uuid[], null))
  order by commercial_profile.account_id
  for update;
  perform 1
  from public.core_billing_policies policy_record
  where policy_record.account_id = any(array_remove(array[
    order_record.invoicing_account_id,
    order_record.partner_account_id
  ]::uuid[], null))
  order by policy_record.account_id
  for update;

  select * into billing_profile
  from public.core_account_commercial_profiles
  where account_id = order_record.invoicing_account_id;
  select * into billing_policy
  from public.core_billing_policies
  where account_id = order_record.invoicing_account_id;
  if order_record.partner_account_id is not null then
    select * into partner_profile
    from public.core_account_commercial_profiles
    where account_id = order_record.partner_account_id;
    select * into partner_policy
    from public.core_billing_policies
    where account_id = order_record.partner_account_id;
  end if;

  if not public.system_capability_is_enabled('new_business')
    or not public.system_capability_is_enabled('legal')
    or not public.system_capability_is_enabled('billing')
    or (order_record.sourcing in ('referral','resale','distributor')
      and not public.system_capability_is_enabled('partner'))
    or (order_record.sourcing = 'marketplace'
      and not public.system_capability_is_enabled('marketplace'))
  then
    rejection_reason := 'software_capability_blocked';
  elsif quote_record.status <> 'accepted'
    or quote_record.total_minor <= 0
    or quote_profile.quote_id is null
    or order_profile.order_id is null
    or order_profile.billing_shape <> order_record.sourcing
    or quote_profile.channel_shape <> order_record.sourcing
  then
    rejection_reason := 'authoritative_commercial_state_missing';
  elsif order_profile.buyer_agreement_id is null
    or (
      order_record.partner_account_id is not null
      and order_profile.partner_agreement_id is null
    )
  then
    rejection_reason := 'authoritative_agreement_missing';
  elsif billing_profile.account_id is null
    or billing_policy.account_id is null
    or (
      order_record.partner_account_id is not null
      and (partner_profile.account_id is null or partner_policy.account_id is null)
    )
  then
    rejection_reason := 'authoritative_payment_policy_missing';
  elsif billing_profile.new_service_blocked
    or (order_record.partner_account_id is not null
      and partner_profile.new_service_blocked)
  then
    rejection_reason := 'new_service_blocked';
  elsif quote_record.currency <> (
    select billing_account.currency from public.accounts billing_account
    where billing_account.id = order_record.invoicing_account_id
  )
  then
    rejection_reason := 'source_currency_mismatch';
  elsif billing_profile.billing_model = 'net_terms' and (
    billing_profile.credit_status <> 'approved'
    or billing_profile.current_exposure_minor + quote_record.total_minor
      > billing_profile.approved_credit_limit_minor
  ) then
    rejection_reason := 'billing_credit_unavailable';
  elsif order_record.partner_account_id is not null
    and order_record.partner_account_id <> order_record.invoicing_account_id
    and partner_profile.billing_model = 'net_terms' and (
      partner_profile.credit_status <> 'approved'
      or partner_profile.current_exposure_minor + quote_record.total_minor
        > partner_profile.approved_credit_limit_minor
    )
  then
    rejection_reason := 'partner_credit_unavailable';
  end if;

  if rejection_reason is not null then
    insert into public.exception_cases (
      account_id, queue, object_type, object_id, owner_user_id,
      target_at, status, decision_reason
    ) values (
      order_record.invoicing_account_id, 'order_acceptance_review',
      'order', order_record.id, candidate_review_owner_user_id,
      clock_timestamp(), 'open', rejection_reason
    )
    on conflict (object_type, object_id)
      where queue = 'order_acceptance_review'
        and status in ('open','under_review')
    do update set
      owner_user_id = excluded.owner_user_id,
      decision_reason = excluded.decision_reason,
      updated_at = clock_timestamp()
    returning id into review_id;

    if existing_reservation.order_id is null then
      insert into public.core_order_acceptance_reservations (
        order_id, buyer_account_id, billing_account_id, partner_account_id,
        currency, amount_minor, decision, reason, owner_user_id,
        review_case_id
      ) values (
        order_record.id, order_record.account_id,
        order_record.invoicing_account_id, order_record.partner_account_id,
        quote_record.currency, quote_record.total_minor, 'rejected',
        rejection_reason, candidate_review_owner_user_id, review_id
      ) returning * into inserted_reservation;
    else
      update public.core_order_acceptance_reservations
      set decision = 'rejected', reason = rejection_reason,
        owner_user_id = candidate_review_owner_user_id,
        review_case_id = review_id,
        released_by_user_id = null, released_at = null,
        release_reason = null, updated_at = clock_timestamp()
      where order_id = order_record.id
      returning * into inserted_reservation;
    end if;
    return inserted_reservation;
  end if;

  update public.core_account_commercial_profiles
  set current_exposure_minor = current_exposure_minor + quote_record.total_minor
  where account_id = order_record.invoicing_account_id;
  if order_record.partner_account_id is not null
    and order_record.partner_account_id <> order_record.invoicing_account_id
  then
    update public.core_account_commercial_profiles
    set current_exposure_minor = current_exposure_minor + quote_record.total_minor
    where account_id = order_record.partner_account_id;
  end if;

  if existing_reservation.order_id is null then
    insert into public.core_order_acceptance_reservations (
      order_id, buyer_account_id, billing_account_id, partner_account_id,
      currency, amount_minor, decision, reason
    ) values (
      order_record.id, order_record.account_id,
      order_record.invoicing_account_id, order_record.partner_account_id,
      quote_record.currency, quote_record.total_minor,
      'approved', 'authoritative_checks_passed'
    ) returning * into inserted_reservation;
  else
    update public.core_order_acceptance_reservations
    set decision = 'approved', reason = 'authoritative_checks_passed',
      released_by_user_id = null, released_at = null,
      release_reason = null, updated_at = clock_timestamp()
    where order_id = order_record.id
    returning * into inserted_reservation;
  end if;
  return inserted_reservation;
end
$$;
revoke all on function public.core_reserve_order_acceptance(uuid,integer,uuid,text)
  from public;
grant execute on function public.core_reserve_order_acceptance(uuid,integer,uuid,text)
  to clockwork_runtime, clockwork_service;

create or replace function public.core_release_order_acceptance_hold(
  candidate_order_id uuid,
  candidate_expected_reservation_version integer,
  candidate_released_by_user_id uuid,
  candidate_reason text
)
returns public.core_order_acceptance_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation_record public.core_order_acceptance_reservations%rowtype;
  released_record public.core_order_acceptance_reservations%rowtype;
begin
  if current_setting('role', true) <> 'clockwork_service' then
    raise exception using errcode = '42501', message = 'order acceptance release is service-only';
  end if;
  if nullif(trim(candidate_reason), '') is null then
    raise exception using errcode = '22023', message = 'release reason is required';
  end if;
  if not exists (
    select 1 from public.commerce_users user_record
    where user_record.id = candidate_released_by_user_id
      and user_record.is_internal_staff
  ) then
    raise exception using errcode = '23514', message = 'order acceptance release requires an internal actor';
  end if;
  select * into reservation_record
  from public.core_order_acceptance_reservations
  where order_id = candidate_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'order acceptance reservation not found';
  end if;
  if reservation_record.row_version <> candidate_expected_reservation_version then
    raise exception using errcode = '40001', message = 'stale order acceptance release version';
  end if;
  if reservation_record.decision = 'released' then
    raise exception using errcode = '23514', message = 'order acceptance reservation is already released';
  end if;
  if reservation_record.owner_user_id is not null
    and reservation_record.owner_user_id = candidate_released_by_user_id
  then
    raise exception using errcode = '23514', message = 'order acceptance review owner cannot self-release';
  end if;
  if reservation_record.decision = 'rejected' and not exists (
    select 1 from public.exception_cases review_case
    where review_case.id = reservation_record.review_case_id
      and review_case.status in ('resolved','approved','closed')
  ) then
    raise exception using errcode = '23514', message = 'order acceptance review must be resolved before release';
  end if;
  if reservation_record.decision = 'approved' then
    update public.core_account_commercial_profiles
    set current_exposure_minor =
      current_exposure_minor - reservation_record.amount_minor
    where account_id = reservation_record.billing_account_id
      and current_exposure_minor >= reservation_record.amount_minor;
    if not found then
      raise exception using errcode = '23514', message = 'billing exposure does not cover the reserved amount';
    end if;
    if reservation_record.partner_account_id is not null
      and reservation_record.partner_account_id <> reservation_record.billing_account_id
    then
      update public.core_account_commercial_profiles
      set current_exposure_minor =
        current_exposure_minor - reservation_record.amount_minor
      where account_id = reservation_record.partner_account_id
        and current_exposure_minor >= reservation_record.amount_minor;
      if not found then
        raise exception using errcode = '23514', message = 'partner exposure does not cover the reserved amount';
      end if;
    end if;
  end if;
  update public.core_order_acceptance_reservations
  set decision = 'released', reason = 'authoritative_release',
    released_by_user_id = candidate_released_by_user_id,
    released_at = clock_timestamp(), release_reason = candidate_reason,
    updated_at = clock_timestamp()
  where order_id = candidate_order_id
  returning * into released_record;
  return released_record;
end
$$;
revoke all on function public.core_release_order_acceptance_hold(uuid,integer,uuid,text)
  from public, clockwork_runtime;
grant execute on function public.core_release_order_acceptance_hold(uuid,integer,uuid,text)
  to clockwork_service;

-- A rejected, missing, or released reservation cannot enqueue provisioning.
create or replace function public.core_guard_provisioning_outbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload_order_id uuid;
begin
  if new.topic = 'order.provisioning_requested' then
    begin
      payload_order_id := coalesce(
        new.payload #>> '{data,orderId}',
        case
          when new.payload ->> 'eventType' = 'order.provisioning_requested'
            and new.payload ->> 'aggregateType' = 'order'
          then new.payload ->> 'aggregateId'
        end,
        new.payload ->> 'orderId'
      )::uuid;
    exception when others then
      payload_order_id := null;
    end;
    if payload_order_id is null or not exists (
      select 1
      from public.core_order_acceptance_reservations reservation
      where reservation.order_id = payload_order_id
        and reservation.decision = 'approved'
    ) then
      raise exception using errcode = '23514', message = 'provisioning requires an approved order acceptance reservation';
    end if;
  end if;
  return new;
end
$$;
create trigger outbox_order_acceptance_guard
before insert on public.outbox_messages
for each row execute function public.core_guard_provisioning_outbox();

-- Collection mutations belong to the acting finance user. Broad finance audit
-- access is replaced with actor/adjustment-scoped visibility.
create or replace function public.app_current_user_id()
returns uuid
language plpgsql
stable
set search_path = public
as $$
begin
  return nullif(public.app_context_claims()->>'userId', '')::uuid;
exception when others then
  return null;
end
$$;
grant execute on function public.app_current_user_id()
  to clockwork_runtime, clockwork_service;

drop policy if exists core_collection_cases_finance_read
  on public.core_collection_cases;
drop policy if exists core_collection_cases_finance_insert
  on public.core_collection_cases;
drop policy if exists core_collection_cases_finance_update
  on public.core_collection_cases;
drop policy if exists core_collection_actions_finance_read
  on public.core_collection_actions;
drop policy if exists core_collection_actions_finance_insert
  on public.core_collection_actions;

create policy core_collection_cases_finance_read
on public.core_collection_cases for select to clockwork_runtime
using (
  app_has_role('finance_approver')
  and owner_user_id = public.app_current_user_id()
);
create policy core_collection_cases_finance_insert
on public.core_collection_cases for insert to clockwork_runtime
with check (
  app_has_role('finance_approver')
  and owner_user_id = public.app_current_user_id()
  and exists (
    select 1 from public.invoices source_invoice
    where source_invoice.id = invoice_id
      and source_invoice.account_id = account_id
  )
);
create policy core_collection_cases_finance_update
on public.core_collection_cases for update to clockwork_runtime
using (
  app_has_role('finance_approver')
  and owner_user_id = public.app_current_user_id()
)
with check (
  app_has_role('finance_approver')
  and owner_user_id = public.app_current_user_id()
  and exists (
    select 1 from public.invoices source_invoice
    where source_invoice.id = invoice_id
      and source_invoice.account_id = account_id
  )
);
create policy core_collection_actions_finance_read
on public.core_collection_actions for select to clockwork_runtime
using (
  app_has_role('finance_approver')
  and actor_user_id = public.app_current_user_id()
  and exists (
    select 1 from public.core_collection_cases collection_case
    where collection_case.id = collection_case_id
      and collection_case.owner_user_id = public.app_current_user_id()
  )
);
create policy core_collection_actions_finance_insert
on public.core_collection_actions for insert to clockwork_runtime
with check (
  app_has_role('finance_approver')
  and actor_user_id = public.app_current_user_id()
  and exists (
    select 1 from public.core_collection_cases collection_case
    where collection_case.id = collection_case_id
      and collection_case.owner_user_id = public.app_current_user_id()
  )
);
grant insert, update on public.core_collection_cases to clockwork_runtime;
grant insert on public.core_collection_actions to clockwork_runtime;
revoke delete on public.core_collection_cases, public.core_collection_actions
  from clockwork_runtime;

create or replace function public.core_protect_collection_case_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.invoice_id is distinct from new.invoice_id
    or old.account_id is distinct from new.account_id
    or old.owner_user_id is distinct from new.owner_user_id
    or old.created_at is distinct from new.created_at
  then
    raise exception using errcode = '55000', message = 'collection case source and ownership are immutable';
  end if;
  return new;
end
$$;
create trigger core_collection_cases_identity
before update on public.core_collection_cases
for each row execute function public.core_protect_collection_case_identity();

drop policy if exists audit_events_finance_read on public.audit_events;
drop policy if exists audit_events_finance_insert on public.audit_events;
drop policy if exists outbox_messages_finance_insert on public.outbox_messages;

create policy audit_events_finance_read
on public.audit_events for select to clockwork_runtime
using (
  app_has_role('finance_approver')
  and (
    actor ->> 'id' = public.app_current_user_id()::text
    or (aggregate_type = 'credit_note' and exists (
      select 1 from public.credit_notes adjustment where adjustment.id = aggregate_id
    ))
    or (aggregate_type = 'refund' and exists (
      select 1 from public.refunds adjustment where adjustment.id = aggregate_id
    ))
    or (aggregate_type in ('dispute','dispute_case') and exists (
      select 1 from public.dispute_cases adjustment where adjustment.id = aggregate_id
    ))
    or (aggregate_type = 'collection_case' and exists (
      select 1 from public.core_collection_cases collection_case
      where collection_case.id = aggregate_id
        and collection_case.owner_user_id = public.app_current_user_id()
    ))
  )
);
create policy audit_events_finance_visibility_guard
on public.audit_events as restrictive for select to clockwork_runtime
using (
  not app_has_role('finance_approver')
  or actor ->> 'id' = public.app_current_user_id()::text
  or (aggregate_type = 'credit_note' and exists (
    select 1 from public.credit_notes adjustment where adjustment.id = aggregate_id
  ))
  or (aggregate_type = 'refund' and exists (
    select 1 from public.refunds adjustment where adjustment.id = aggregate_id
  ))
  or (aggregate_type in ('dispute','dispute_case') and exists (
    select 1 from public.dispute_cases adjustment where adjustment.id = aggregate_id
  ))
  or (aggregate_type = 'collection_case' and exists (
    select 1 from public.core_collection_cases collection_case
    where collection_case.id = aggregate_id
      and collection_case.owner_user_id = public.app_current_user_id()
  ))
);
create policy audit_events_finance_insert
on public.audit_events for insert to clockwork_runtime
with check (
  app_has_role('finance_approver')
  and actor ->> 'id' = public.app_current_user_id()::text
  and aggregate_type in (
    'invoice','credit_note','refund','dispute','dispute_case',
    'collection_case','collection_action'
  )
);
create policy audit_events_finance_insert_guard
on public.audit_events as restrictive for insert to clockwork_runtime
with check (
  not app_has_role('finance_approver')
  or (
    actor ->> 'id' = public.app_current_user_id()::text
    and aggregate_type in (
      'invoice','credit_note','refund','dispute','dispute_case',
      'collection_case','collection_action'
    )
  )
);
create policy outbox_messages_finance_insert
on public.outbox_messages for insert to clockwork_runtime
with check (
  app_has_role('finance_approver')
  and exists (
    select 1 from public.audit_events finance_event
    where finance_event.id = event_id
      and finance_event.actor ->> 'id' = public.app_current_user_id()::text
  )
);
create policy outbox_messages_finance_insert_guard
on public.outbox_messages as restrictive for insert to clockwork_runtime
with check (
  not app_has_role('finance_approver')
  or exists (
    select 1 from public.audit_events finance_event
    where finance_event.id = event_id
      and finance_event.actor ->> 'id' = public.app_current_user_id()::text
  )
);

-- Verified QBO identity is a persisted partner mapping, never a caller-supplied
-- vendor identifier. Provider credentials and raw realm identifiers do not
-- belong in this table.
create table public.core_partner_qbo_vendor_mappings (
  partner_account_id uuid primary key references public.accounts(id),
  provider text not null default 'qbo' check (provider = 'qbo'),
  realm_reference_hash text not null check (realm_reference_hash ~ '^[a-f0-9]{64}$'),
  vendor_id text not null check (length(trim(vendor_id)) > 0),
  verification_status text not null
    check (verification_status in ('verified','revoked')),
  verified_at timestamptz not null,
  verified_by uuid not null references public.commerce_users(id),
  source_reference text not null check (length(trim(source_reference)) > 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0),
  unique(provider, vendor_id),
  constraint core_partner_qbo_vendor_partner_check check (
    verification_status = 'verified' and revoked_at is null
    or verification_status = 'revoked' and revoked_at is not null
  )
);

create or replace function public.core_validate_partner_qbo_vendor_mapping()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.accounts partner
    where partner.id = new.partner_account_id
      and 'partner' = any(partner.relationship_roles)
  ) then
    raise exception using errcode = '23514', message = 'QBO vendor mapping requires the persisted partner identity';
  end if;
  if tg_op = 'UPDATE' then
    if old.partner_account_id is distinct from new.partner_account_id
      or old.provider is distinct from new.provider
      or old.realm_reference_hash is distinct from new.realm_reference_hash
      or old.vendor_id is distinct from new.vendor_id
      or old.verified_at is distinct from new.verified_at
      or old.verified_by is distinct from new.verified_by
      or old.source_reference is distinct from new.source_reference
      or old.created_at is distinct from new.created_at
    then
      raise exception using errcode = '55000', message = 'verified QBO vendor identity is immutable';
    end if;
    if old.verification_status = 'revoked'
      or new.verification_status not in (old.verification_status, 'revoked')
    then
      raise exception using errcode = '23514', message = 'invalid QBO vendor verification transition';
    end if;
  end if;
  return new;
end
$$;
create trigger core_partner_qbo_vendor_mapping_guard
before insert or update on public.core_partner_qbo_vendor_mappings
for each row execute function public.core_validate_partner_qbo_vendor_mapping();
create trigger core_partner_qbo_vendor_mapping_version
before update on public.core_partner_qbo_vendor_mappings
for each row execute function public.touch_versioned_row();
alter table public.core_partner_qbo_vendor_mappings enable row level security;
alter table public.core_partner_qbo_vendor_mappings force row level security;
create policy core_partner_qbo_vendor_mapping_service
on public.core_partner_qbo_vendor_mappings for all to clockwork_service
using (true) with check (true);
revoke all on public.core_partner_qbo_vendor_mappings
  from public, anon, authenticated, clockwork_runtime;
grant select, insert, update on public.core_partner_qbo_vendor_mappings
  to clockwork_service;

-- One statement binds one replay-safe provider posting. An alternate export
-- key cannot create a second payable for the same settled statement.
create unique index core_commission_settlement_statement_unique
  on public.core_commission_settlement_exports(statement_id);

-- Settlement uses pending -> succeeded/failed provider semantics. Preserve the
-- legacy generated/delivered values for existing rows while admitting the
-- repository's replay-safe provider success state under an explicit name.
alter table public.core_commission_settlement_exports
  drop constraint core_commission_settlement_exports_status_check,
  add constraint core_commission_settlement_exports_status_check
    check (status in (
      'pending','generated','delivered','succeeded','failed'
    ));

create or replace function public.core_validate_commission_settlement_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'core_commission_statements' then
    if tg_op = 'UPDATE' and (
      old.id is distinct from new.id
      or old.partner_account_id is distinct from new.partner_account_id
      or old.period_starts_on is distinct from new.period_starts_on
      or old.period_ends_on is distinct from new.period_ends_on
      or old.currency is distinct from new.currency
      or old.gross_accrued_minor is distinct from new.gross_accrued_minor
      or old.clawback_minor is distinct from new.clawback_minor
      or old.holdback_minor is distinct from new.holdback_minor
      or old.payable_minor is distinct from new.payable_minor
      or old.created_at is distinct from new.created_at
    ) then
      raise exception using errcode = '55000', message = 'commission statement settlement facts are immutable';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status and not (
      old.status = 'draft' and new.status in ('issued','void')
      or old.status = 'issued' and new.status in ('approved','void')
      or old.status = 'approved' and new.status in ('exported','void')
      or old.status = 'exported' and new.status = 'paid'
    ) then
      raise exception using errcode = '23514', message = 'invalid commission statement transition';
    end if;
  else
    if tg_op = 'INSERT' and new.status <> 'pending' then
      raise exception using errcode = '23514', message = 'commission settlement export must begin pending';
    end if;
    if tg_op = 'UPDATE' and (
      old.id is distinct from new.id
      or old.statement_id is distinct from new.statement_id
      or old.export_key is distinct from new.export_key
      or old.format is distinct from new.format
      or old.created_at is distinct from new.created_at
      or old.provider_reference is distinct from new.provider_reference and not (
        old.provider_reference is null
        and nullif(trim(new.provider_reference), '') is not null
        and old.status in ('pending','generated')
        and new.status = 'succeeded'
      )
    ) then
      raise exception using errcode = '55000', message = 'commission settlement provider binding is immutable';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status and not (
      old.status = 'pending' and new.status in (
        'generated','succeeded','failed'
      )
      or old.status = 'generated' and new.status in (
        'delivered','succeeded','failed'
      )
      or old.status = 'failed' and new.status = 'pending'
    ) then
      raise exception using errcode = '23514', message = 'invalid commission settlement export transition';
    end if;
    if new.status in ('pending','failed') and new.provider_reference is not null
      or new.status = 'succeeded' and nullif(trim(new.provider_reference), '') is null
    then
      raise exception using errcode = '23514', message = 'commission settlement provider reference does not match status';
    end if;
    if new.status in ('pending','succeeded','failed') and not exists (
      select 1
      from public.core_commission_statements statement_record
      where statement_record.id = new.statement_id
        and statement_record.status in ('exported','paid')
    ) then
      raise exception using errcode = '23514', message = 'commission settlement export requires an exported statement';
    end if;
  end if;
  return new;
end
$$;
create trigger core_commission_statement_transition_guard
before update on public.core_commission_statements
for each row execute function public.core_validate_commission_settlement_state();
create trigger core_commission_settlement_export_transition_guard
before insert or update on public.core_commission_settlement_exports
for each row execute function public.core_validate_commission_settlement_state();

create or replace function public.core_assert_commission_settlement_convergence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate_statement_id uuid;
begin
  candidate_statement_id := coalesce(
    nullif(to_jsonb(new) ->> 'statement_id', '')::uuid,
    nullif(to_jsonb(new) ->> 'id', '')::uuid
  );
  if exists (
    select 1
    from public.core_commission_statements statement_record
    where statement_record.id = candidate_statement_id
      and (
        statement_record.status = 'exported' and not exists (
          select 1
          from public.core_commission_settlement_exports settlement
          where settlement.statement_id = statement_record.id
            and settlement.status in ('pending','succeeded','failed')
        )
        or statement_record.status = 'paid' and not exists (
          select 1
          from public.core_commission_settlement_exports settlement
          where settlement.statement_id = statement_record.id
            and settlement.status = 'succeeded'
        )
      )
  ) then
    raise exception using errcode = '23514', message = 'commission statement and provider settlement must converge before commit';
  end if;
  return null;
end
$$;
revoke all on function public.core_assert_commission_settlement_convergence()
  from public;
create constraint trigger core_commission_statement_settlement_convergence
after insert or update on public.core_commission_statements
deferrable initially deferred
for each row execute function public.core_assert_commission_settlement_convergence();
create constraint trigger core_commission_export_settlement_convergence
after insert or update on public.core_commission_settlement_exports
deferrable initially deferred
for each row execute function public.core_assert_commission_settlement_convergence();

create unique index core_commission_settlement_provider_reference_unique
  on public.core_commission_settlement_exports(format, provider_reference)
  where provider_reference is not null and status = 'succeeded';

-- Provider adjustment identifiers do not exist until Stripe accepts the
-- replay-safe operation. A finance command creates only an approved local
-- adjustment; provider acceptance and signed event projection bind/advance it.
alter table public.credit_notes
  alter column stripe_credit_note_id drop not null,
  add column stripe_last_occurred_at timestamptz,
  add column stripe_last_event_id text,
  drop constraint credit_notes_status_check,
  add constraint credit_notes_status_check
    check (status in ('approved','pending','issued','failed','void')),
  add constraint credit_notes_provider_binding_check check (
    status = 'approved' and stripe_credit_note_id is null
    or status = 'failed'
    or status in ('pending','issued','void') and stripe_credit_note_id is not null
  ),
  add constraint credit_notes_stripe_watermark_check check (
    (stripe_last_occurred_at is null) = (stripe_last_event_id is null)
  );
alter table public.refunds
  alter column stripe_refund_id drop not null,
  add column stripe_last_occurred_at timestamptz,
  add column stripe_last_event_id text,
  drop constraint refunds_status_check,
  add constraint refunds_status_check
    check (status in ('approved','pending','succeeded','failed')),
  add constraint refunds_provider_binding_check check (
    status = 'approved' and stripe_refund_id is null
    or status = 'failed'
    or status in ('pending','succeeded') and stripe_refund_id is not null
  ),
  add constraint refunds_stripe_watermark_check check (
    (stripe_last_occurred_at is null) = (stripe_last_event_id is null)
  );

-- Approved, pending, and successful adjustments all reserve their persisted
-- source ceiling. Rejection/failure and voiding release it. Locking the source
-- row makes same-source concurrent commands observe one another.
create or replace function public.validate_financial_adjustment_amount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_amount bigint;
  source_order_id uuid;
  source_currency text;
  prior_amount bigint;
begin
  if new.amount_minor <= 0 then
    raise exception using errcode = '23514', message = 'financial adjustment amount must be positive';
  end if;
  if tg_table_name = 'credit_notes' then
    select amount_minor, order_id, currency
    into source_amount, source_order_id, source_currency
    from public.invoices where id = new.invoice_id for update;
    if source_amount is null
      or new.order_id <> source_order_id
      or new.currency <> source_currency
    then
      raise exception using errcode = '23514', message = 'credit note must match its persisted invoice order and currency';
    end if;
    select coalesce(sum(amount_minor), 0) into prior_amount
    from public.credit_notes
    where invoice_id = new.invoice_id
      and status in ('approved','pending','issued');
  elsif tg_table_name = 'refunds' then
    select amount_minor, order_id, currency
    into source_amount, source_order_id, source_currency
    from public.payments where id = new.payment_id for update;
    if source_amount is null
      or new.order_id <> source_order_id
      or new.currency <> source_currency
    then
      raise exception using errcode = '23514', message = 'refund must match its persisted payment order and currency';
    end if;
    select coalesce(sum(amount_minor), 0) into prior_amount
    from public.refunds
    where payment_id = new.payment_id
      and status in ('approved','pending','succeeded');
  else
    select amount_minor, order_id, currency
    into source_amount, source_order_id, source_currency
    from public.payments where id = new.payment_id for update;
    if source_amount is null
      or new.order_id <> source_order_id
      or new.currency <> source_currency
    then
      raise exception using errcode = '23514', message = 'dispute must match its persisted payment order and currency';
    end if;
    select coalesce(sum(amount_minor), 0) into prior_amount
    from public.dispute_cases
    where payment_id = new.payment_id and status <> 'won';
  end if;
  if new.amount_minor > source_amount
    or prior_amount + new.amount_minor > source_amount
  then
    raise exception using errcode = '23514', message = 'financial adjustment exceeds its persisted source amount';
  end if;
  return new;
end
$$;
revoke all on function public.validate_financial_adjustment_amount()
  from public;

-- The finance role can approve an adjustment but cannot project provider
-- truth. Only the service projection may bind the once-null provider ID and
-- advance the state machine after provider acceptance or a signed event.
drop policy if exists credit_notes_finance_update on public.credit_notes;

create or replace function public.protect_financial_adjustment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = format('%s cannot be deleted', tg_table_name);
  end if;
  if tg_table_name = 'credit_notes' then
    if old.invoice_id is distinct from new.invoice_id
      or old.order_id is distinct from new.order_id
      or old.currency is distinct from new.currency
      or old.amount_minor is distinct from new.amount_minor
      or old.reason_code is distinct from new.reason_code
      or old.approved_by is distinct from new.approved_by
      or old.created_at is distinct from new.created_at
    then
      raise exception using errcode = '55000', message = 'credit note financial facts are immutable';
    end if;
    if new.version <> old.version + 1
      or current_setting('role', true) <> 'clockwork_service'
    then
      raise exception using errcode = '40001', message = 'credit note projection version is stale or unauthorized';
    end if;
    if new.status is not distinct from old.status
      and new.stripe_credit_note_id is not distinct from old.stripe_credit_note_id
      and new.stripe_last_occurred_at is not distinct from old.stripe_last_occurred_at
      and new.stripe_last_event_id is not distinct from old.stripe_last_event_id
    then
      raise exception using errcode = '23514', message = 'credit note projection must advance provider state or watermark';
    end if;
    if old.stripe_credit_note_id is not null
      and old.stripe_credit_note_id is distinct from new.stripe_credit_note_id
    then
      raise exception using errcode = '55000', message = 'credit note provider identity is immutable once bound';
    end if;
    if new.status is distinct from old.status
      and not (
        old.status = 'approved' and new.status in ('pending','failed')
        or old.status = 'pending' and new.status in ('issued','failed')
        or old.status = 'issued' and new.status = 'void'
      )
    then
      raise exception using errcode = '23514', message = 'invalid credit note status transition';
    end if;
    if old.stripe_last_occurred_at is not null and (
      new.stripe_last_occurred_at is null
      or new.stripe_last_occurred_at < old.stripe_last_occurred_at
      or new.stripe_last_occurred_at = old.stripe_last_occurred_at
        and new.stripe_last_event_id is distinct from old.stripe_last_event_id
    ) then
      raise exception using errcode = '23514', message = 'credit note Stripe watermark cannot regress';
    end if;
    if new.status = 'approved' and new.stripe_credit_note_id is not null
      or new.status in ('pending','issued','void') and new.stripe_credit_note_id is null
    then
      raise exception using errcode = '23514', message = 'credit note provider binding does not match status';
    end if;
  elsif tg_table_name = 'refunds' then
    if old.payment_id is distinct from new.payment_id
      or old.order_id is distinct from new.order_id
      or old.currency is distinct from new.currency
      or old.amount_minor is distinct from new.amount_minor
      or old.reason_code is distinct from new.reason_code
      or old.created_at is distinct from new.created_at
    then
      raise exception using errcode = '55000', message = 'refund financial facts are immutable';
    end if;
    if new.version <> old.version + 1
      or current_setting('role', true) <> 'clockwork_service'
    then
      raise exception using errcode = '40001', message = 'refund projection version is stale or unauthorized';
    end if;
    if new.status is not distinct from old.status
      and new.stripe_refund_id is not distinct from old.stripe_refund_id
      and new.stripe_last_occurred_at is not distinct from old.stripe_last_occurred_at
      and new.stripe_last_event_id is not distinct from old.stripe_last_event_id
    then
      raise exception using errcode = '23514', message = 'refund projection must advance provider state or watermark';
    end if;
    if old.stripe_refund_id is not null
      and old.stripe_refund_id is distinct from new.stripe_refund_id
    then
      raise exception using errcode = '55000', message = 'refund provider identity is immutable once bound';
    end if;
    if new.status is distinct from old.status
      and not (
        old.status = 'approved' and new.status in ('pending','failed')
        or old.status = 'pending' and new.status in ('succeeded','failed')
      )
    then
      raise exception using errcode = '23514', message = 'invalid refund status transition';
    end if;
    if old.stripe_last_occurred_at is not null and (
      new.stripe_last_occurred_at is null
      or new.stripe_last_occurred_at < old.stripe_last_occurred_at
      or new.stripe_last_occurred_at = old.stripe_last_occurred_at
        and new.stripe_last_event_id is distinct from old.stripe_last_event_id
    ) then
      raise exception using errcode = '23514', message = 'refund Stripe watermark cannot regress';
    end if;
    if new.status = 'approved' and new.stripe_refund_id is not null
      or new.status in ('pending','succeeded') and new.stripe_refund_id is null
    then
      raise exception using errcode = '23514', message = 'refund provider binding does not match status';
    end if;
  end if;
  return new;
end
$$;

-- This is the sole durable Stripe command source. Runtime callers cannot read,
-- write, or update it directly; the creation function below derives every
-- provider/source/money fact, while the service worker owns leased transitions.
create table public.core_stripe_adjustment_operations (
  adjustment_id uuid primary key,
  kind text not null check (kind in ('credit_note','refund')),
  order_id uuid not null references public.orders(id),
  source_id uuid not null,
  source_currency text not null,
  provider_invoice_id text,
  provider_payment_intent_id text,
  amount_minor bigint not null,
  individual_cap_minor bigint not null,
  aggregate_cap_minor bigint not null,
  provider_reason text not null check (length(trim(provider_reason)) > 0),
  internal_reason_code text not null check (length(trim(internal_reason_code)) > 0),
  provider_idempotency_key text not null unique
    check (length(trim(provider_idempotency_key)) >= 16),
  state text not null default 'approved'
    check (state in ('approved','submitting','retrying','provider_accepted','rejected')),
  lease_token uuid,
  lease_until timestamptz,
  provider_object_id text unique,
  provider_status text,
  last_error_code text,
  command_version integer not null default 1 check (command_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0),
  constraint core_stripe_adjustment_amount_check check (
    amount_minor > 0
    and amount_minor <= individual_cap_minor
    and individual_cap_minor <= aggregate_cap_minor
  ),
  constraint core_stripe_adjustment_provider_shape_check check (
    kind = 'credit_note'
      and provider_invoice_id is not null
      and provider_payment_intent_id is null
    or kind = 'refund'
      and provider_invoice_id is null
      and provider_payment_intent_id is not null
  ),
  constraint core_stripe_adjustment_execution_shape_check check (
    state = 'submitting' and lease_token is not null and lease_until is not null
      and provider_object_id is null and provider_status is null
    or state = 'provider_accepted' and lease_token is null
      and lease_until is null
      and length(trim(provider_object_id)) > 0
      and length(trim(provider_status)) > 0
    or state in ('approved','retrying','rejected') and lease_token is null
      and lease_until is null
      and provider_object_id is null and provider_status is null
  )
);
create index core_stripe_adjustment_source_idx
  on public.core_stripe_adjustment_operations(
    kind,source_id,source_currency,state
  );

create or replace function public.core_validate_stripe_adjustment_operation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  canonical_order_id uuid;
  canonical_source_id uuid;
  canonical_currency text;
  canonical_provider_source_id text;
  canonical_amount bigint;
  canonical_individual_cap bigint;
  canonical_aggregate_cap bigint;
  canonical_reason text;
  canonical_command_version integer;
  canonical_adjustment_status text;
  already_reserved bigint;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Stripe adjustment operations cannot be deleted';
  end if;

  if tg_op = 'UPDATE' then
    if old.adjustment_id is distinct from new.adjustment_id
      or old.kind is distinct from new.kind
      or old.order_id is distinct from new.order_id
      or old.source_id is distinct from new.source_id
      or old.source_currency is distinct from new.source_currency
      or old.provider_invoice_id is distinct from new.provider_invoice_id
      or old.provider_payment_intent_id is distinct from new.provider_payment_intent_id
      or old.amount_minor is distinct from new.amount_minor
      or old.individual_cap_minor is distinct from new.individual_cap_minor
      or old.aggregate_cap_minor is distinct from new.aggregate_cap_minor
      or old.provider_reason is distinct from new.provider_reason
      or old.internal_reason_code is distinct from new.internal_reason_code
      or old.provider_idempotency_key is distinct from new.provider_idempotency_key
      or old.command_version is distinct from new.command_version
      or old.created_at is distinct from new.created_at
    then
      raise exception using errcode = '55000', message = 'Stripe adjustment command facts are immutable';
    end if;
    if new.state is distinct from old.state
      and not (
        old.state = 'approved' and new.state = 'submitting'
        or old.state = 'submitting' and new.state in ('retrying','provider_accepted','rejected')
        or old.state = 'retrying' and new.state in ('submitting','rejected')
      )
    then
      raise exception using errcode = '23514', message = 'invalid Stripe adjustment operation transition';
    end if;
    if new.state is not distinct from old.state and (
      old.lease_token is distinct from new.lease_token
      or old.lease_until is distinct from new.lease_until
      or old.provider_object_id is distinct from new.provider_object_id
      or old.provider_status is distinct from new.provider_status
      or old.last_error_code is distinct from new.last_error_code
    ) then
      raise exception using errcode = '55000', message = 'Stripe adjustment execution facts require a valid state transition';
    end if;
    if old.provider_object_id is not null and (
      old.provider_object_id is distinct from new.provider_object_id
      or old.provider_status is distinct from new.provider_status
    ) then
      raise exception using errcode = '55000', message = 'accepted Stripe provider identity is immutable';
    end if;
  end if;

  -- The order lock is the cross-source aggregate mutex. Credit notes and
  -- refunds for different source rows on the same order/currency cannot race
  -- one another past the aggregate ceiling.
  perform 1 from public.orders source_order
  where source_order.id = new.order_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'Stripe adjustment order does not exist';
  end if;

  if new.kind = 'credit_note' then
    select adjustment.order_id, adjustment.invoice_id, adjustment.currency,
      source_invoice.stripe_invoice_id, adjustment.amount_minor,
      source_invoice.amount_minor, source_invoice.amount_minor,
      adjustment.reason_code, adjustment.version, adjustment.status
    into canonical_order_id, canonical_source_id, canonical_currency,
      canonical_provider_source_id, canonical_amount,
      canonical_individual_cap, canonical_aggregate_cap,
      canonical_reason, canonical_command_version, canonical_adjustment_status
    from public.credit_notes adjustment
    join public.invoices source_invoice on source_invoice.id = adjustment.invoice_id
    where adjustment.id = new.adjustment_id
    for update of adjustment, source_invoice;
    if new.provider_invoice_id is distinct from canonical_provider_source_id
      or new.provider_payment_intent_id is not null
      or new.provider_reason not in (
        'duplicate','fraudulent','order_change','product_unsatisfactory'
      )
    then
      raise exception using errcode = '23514', message = 'credit note provider binding is not authoritative';
    end if;
  else
    select adjustment.order_id, adjustment.payment_id, adjustment.currency,
      source_payment.stripe_payment_intent_id, adjustment.amount_minor,
      source_payment.amount_minor, source_invoice.amount_minor,
      adjustment.reason_code, adjustment.version, adjustment.status
    into canonical_order_id, canonical_source_id, canonical_currency,
      canonical_provider_source_id, canonical_amount,
      canonical_individual_cap, canonical_aggregate_cap,
      canonical_reason, canonical_command_version, canonical_adjustment_status
    from public.refunds adjustment
    join public.payments source_payment on source_payment.id = adjustment.payment_id
    join public.invoices source_invoice on source_invoice.id = source_payment.invoice_id
    where adjustment.id = new.adjustment_id
    for update of adjustment, source_payment, source_invoice;
    if new.provider_payment_intent_id is distinct from canonical_provider_source_id
      or new.provider_invoice_id is not null
      or new.provider_reason not in (
        'duplicate','fraudulent','requested_by_customer'
      )
    then
      raise exception using errcode = '23514', message = 'refund provider binding is not authoritative';
    end if;
  end if;

  if canonical_order_id is null
    or canonical_provider_source_id is null
    or new.order_id is distinct from canonical_order_id
    or new.source_id is distinct from canonical_source_id
    or new.source_currency is distinct from canonical_currency
    or new.amount_minor is distinct from canonical_amount
    or new.individual_cap_minor is distinct from canonical_individual_cap
    or new.aggregate_cap_minor is distinct from canonical_aggregate_cap
    or new.internal_reason_code is distinct from canonical_reason
    or new.command_version is distinct from canonical_command_version
  then
    raise exception using errcode = '23514', message = 'Stripe adjustment operation must match persisted source, order, currency, amount, caps, and reason';
  end if;
  if tg_op = 'INSERT' and canonical_adjustment_status <> 'approved' then
    raise exception using errcode = '23514', message = 'Stripe adjustment operation requires an approved local adjustment';
  end if;

  if new.state in ('approved','submitting','retrying','provider_accepted') then
    select coalesce(sum(operation.amount_minor), 0)
    into already_reserved
    from public.core_stripe_adjustment_operations operation
    where operation.order_id = new.order_id
      and operation.source_currency = new.source_currency
      and operation.adjustment_id <> new.adjustment_id
      and operation.state in ('approved','submitting','retrying','provider_accepted');
    if already_reserved + new.amount_minor > new.aggregate_cap_minor then
      raise exception using errcode = '23514', message = 'Stripe adjustment aggregate ceiling exceeded';
    end if;
  end if;
  return new;
end
$$;
create trigger core_stripe_adjustment_operation_guard
before insert or update or delete on public.core_stripe_adjustment_operations
for each row execute function public.core_validate_stripe_adjustment_operation();
create trigger core_stripe_adjustment_operation_version
before update on public.core_stripe_adjustment_operations
for each row execute function public.touch_versioned_row();

alter table public.core_stripe_adjustment_operations enable row level security;
alter table public.core_stripe_adjustment_operations force row level security;
create policy core_stripe_adjustment_operations_service
on public.core_stripe_adjustment_operations for all to clockwork_service
using (true) with check (true);
revoke all on public.core_stripe_adjustment_operations
  from public, anon, authenticated, clockwork_runtime;
grant select, insert, update on public.core_stripe_adjustment_operations
  to clockwork_service;

-- Runtime supplies only the local adjustment identity/kind and allowed reason
-- choice. All Stripe identifiers, source bindings, amount, currency, caps,
-- idempotency, and command version are derived under locks from canonical rows.
create or replace function public.core_create_stripe_adjustment_operation(
  candidate_adjustment_id uuid,
  candidate_kind text,
  candidate_provider_reason text,
  candidate_internal_reason_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := current_setting('role', true);
  existing_operation public.core_stripe_adjustment_operations%rowtype;
  created_operation public.core_stripe_adjustment_operations%rowtype;
  adjustment_order_id uuid;
  adjustment_source_id uuid;
  adjustment_currency text;
  adjustment_amount bigint;
  adjustment_reason text;
  adjustment_version integer;
  adjustment_status text;
  provider_source_id text;
  individual_cap bigint;
  aggregate_cap bigint;
  adjustment_approver uuid;
begin
  if caller_role = 'clockwork_runtime' and not (
    public.app_context_is_valid()
    and public.app_has_role('finance_approver')
  ) then
    raise exception using errcode = '42501', message = 'finance approval is required to create a Stripe adjustment operation';
  end if;
  if candidate_kind not in ('credit_note','refund') then
    raise exception using errcode = '23514', message = 'Stripe adjustment kind is invalid';
  end if;

  select * into existing_operation
  from public.core_stripe_adjustment_operations operation
  where operation.adjustment_id = candidate_adjustment_id
  for update;
  if found then
    if existing_operation.kind is distinct from candidate_kind
      or existing_operation.provider_reason is distinct from candidate_provider_reason
      or existing_operation.internal_reason_code is distinct from candidate_internal_reason_code
    then
      raise exception using errcode = '23505', message = 'Stripe adjustment replay conflicts with the durable operation';
    end if;
    return existing_operation.adjustment_id;
  end if;

  -- Resolve only the immutable order identity first, then take the aggregate
  -- mutex before any source lock. Direct service validation uses the same lock
  -- order, preventing a source/order deadlock under mixed concurrent callers.
  if candidate_kind = 'credit_note' then
    select adjustment.order_id into adjustment_order_id
    from public.credit_notes adjustment
    where adjustment.id = candidate_adjustment_id;
  else
    select adjustment.order_id into adjustment_order_id
    from public.refunds adjustment
    where adjustment.id = candidate_adjustment_id;
  end if;
  if adjustment_order_id is null then
    raise exception using errcode = '23514', message = 'Stripe adjustment source is missing its persisted provider binding';
  end if;
  perform 1 from public.orders source_order
  where source_order.id = adjustment_order_id
  for update;

  if candidate_kind = 'credit_note' then
    select adjustment.order_id, adjustment.invoice_id, adjustment.currency,
      adjustment.amount_minor, adjustment.reason_code, adjustment.version,
      adjustment.status, adjustment.approved_by,
      source_invoice.stripe_invoice_id, source_invoice.amount_minor,
      source_invoice.amount_minor
    into adjustment_order_id, adjustment_source_id, adjustment_currency,
      adjustment_amount, adjustment_reason, adjustment_version,
      adjustment_status, adjustment_approver,
      provider_source_id, individual_cap, aggregate_cap
    from public.credit_notes adjustment
    join public.invoices source_invoice on source_invoice.id = adjustment.invoice_id
    where adjustment.id = candidate_adjustment_id
    for update of adjustment, source_invoice;
    if caller_role = 'clockwork_runtime'
      and adjustment_approver is distinct from public.app_current_user_id()
    then
      raise exception using errcode = '42501', message = 'finance user must own the approved credit note';
    end if;
  else
    select adjustment.order_id, adjustment.payment_id, adjustment.currency,
      adjustment.amount_minor, adjustment.reason_code, adjustment.version,
      adjustment.status, source_payment.stripe_payment_intent_id,
      source_payment.amount_minor, source_invoice.amount_minor
    into adjustment_order_id, adjustment_source_id, adjustment_currency,
      adjustment_amount, adjustment_reason, adjustment_version,
      adjustment_status, provider_source_id, individual_cap, aggregate_cap
    from public.refunds adjustment
    join public.payments source_payment on source_payment.id = adjustment.payment_id
    join public.invoices source_invoice on source_invoice.id = source_payment.invoice_id
    where adjustment.id = candidate_adjustment_id
    for update of adjustment, source_payment, source_invoice;
  end if;

  if adjustment_order_id is null or provider_source_id is null then
    raise exception using errcode = '23514', message = 'Stripe adjustment source is missing its persisted provider binding';
  end if;
  if adjustment_status <> 'approved' then
    raise exception using errcode = '23514', message = 'Stripe adjustment operation requires an approved local adjustment';
  end if;
  if candidate_internal_reason_code is distinct from adjustment_reason then
    raise exception using errcode = '23514', message = 'Stripe adjustment internal reason must match the approved adjustment';
  end if;

  insert into public.core_stripe_adjustment_operations(
    adjustment_id,kind,order_id,source_id,source_currency,
    provider_invoice_id,provider_payment_intent_id,amount_minor,
    individual_cap_minor,aggregate_cap_minor,provider_reason,
    internal_reason_code,provider_idempotency_key,command_version
  ) values (
    candidate_adjustment_id,candidate_kind,adjustment_order_id,
    adjustment_source_id,adjustment_currency,
    case when candidate_kind = 'credit_note' then provider_source_id end,
    case when candidate_kind = 'refund' then provider_source_id end,
    adjustment_amount,individual_cap,aggregate_cap,candidate_provider_reason,
    adjustment_reason,'stripe-adjustment:' || candidate_adjustment_id::text,
    adjustment_version
  )
  returning * into created_operation;
  return created_operation.adjustment_id;
end
$$;
revoke all on function public.core_create_stripe_adjustment_operation(
  uuid,text,text,text
) from public;
grant execute on function public.core_create_stripe_adjustment_operation(
  uuid,text,text,text
) to clockwork_runtime, clockwork_service;

-- Approved local adjustments may not commit without their polymorphic durable
-- operation. The deferred check permits the command and operation to be
-- inserted in either order inside one atomic transaction.
create or replace function public.core_require_stripe_adjustment_operation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
begin
  if tg_table_name = 'credit_notes' then
    select adjustment.status into current_status
    from public.credit_notes adjustment where adjustment.id = new.id;
  else
    select adjustment.status into current_status
    from public.refunds adjustment where adjustment.id = new.id;
  end if;
  if current_status = 'approved' and not exists (
    select 1
    from public.core_stripe_adjustment_operations operation
    where operation.adjustment_id = new.id
      and operation.kind = case
        when tg_table_name = 'credit_notes' then 'credit_note'
        else 'refund'
      end
  ) then
    raise exception using errcode = '23503', message = 'approved Stripe adjustment requires its durable operation';
  end if;
  return null;
end
$$;
revoke all on function public.core_require_stripe_adjustment_operation()
  from public;
create constraint trigger credit_notes_require_stripe_operation
after insert or update of status on public.credit_notes
deferrable initially deferred
for each row execute function public.core_require_stripe_adjustment_operation();
create constraint trigger refunds_require_stripe_operation
after insert or update of status on public.refunds
deferrable initially deferred
for each row execute function public.core_require_stripe_adjustment_operation();

-- A resale/distributor partner is the persisted merchant of record. Give that
-- exact partner the minimum renewal/offboarding rows needed to perform a
-- recoverable non-renewal, without opening end-client documents or arbitrary
-- tenant lifecycle state.
create or replace function public.core_partner_is_order_mor(
  candidate_order_id uuid,
  candidate_end_client_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders order_record
    where order_record.id = candidate_order_id
      and order_record.account_id = candidate_end_client_account_id
      and order_record.sourcing in ('resale','distributor')
      and order_record.partner_account_id is not null
      and order_record.invoicing_account_id = order_record.partner_account_id
      and public.app_has_account(order_record.partner_account_id)
  )
$$;
revoke all on function public.core_partner_is_order_mor(uuid,uuid)
  from public;
grant execute on function public.core_partner_is_order_mor(uuid,uuid)
  to clockwork_runtime, clockwork_service;

create or replace function public.core_partner_can_insert_provisioning_attempt(
  candidate_order_id uuid,
  candidate_account_id uuid,
  candidate_organization_id uuid,
  candidate_command_id text,
  candidate_operation text,
  candidate_state text,
  candidate_attempt jsonb,
  candidate_poc_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    candidate_operation = 'provision'
    and candidate_state = 'pending'
    and candidate_poc_id is null
    and candidate_attempt #>> '{command,commandId}' = candidate_command_id
    and candidate_attempt #>> '{command,orderId}' = candidate_order_id::text
    and candidate_attempt #>> '{command,organizationId}' =
      candidate_organization_id::text
    and candidate_attempt #>> '{command,operation}' = 'provision'
    and exists (
      select 1
      from public.orders order_record
      join public.core_order_commercial_profiles commercial
        on commercial.order_id = order_record.id
      join public.organizations organization_record
        on organization_record.id = candidate_organization_id
        and organization_record.account_id = order_record.account_id
      join public.core_order_acceptance_reservations reservation
        on reservation.order_id = order_record.id
        and reservation.decision = 'approved'
      where order_record.id = candidate_order_id
        and order_record.account_id = candidate_account_id
        and order_record.status = 'accepted'
        and candidate_attempt #>> '{command,orderVersion}' =
          order_record.row_version::text
        and commercial.provisioning_idempotency_key =
          candidate_attempt #>> '{command,idempotencyKey}'
        and public.core_partner_is_order_mor(
          order_record.id, order_record.account_id
        )
    )
$$;
revoke all on function public.core_partner_can_insert_provisioning_attempt(
  uuid,uuid,uuid,text,text,text,jsonb,uuid
) from public;
grant execute on function public.core_partner_can_insert_provisioning_attempt(
  uuid,uuid,uuid,text,text,text,jsonb,uuid
) to clockwork_runtime, clockwork_service;

create policy lifecycle_provisioning_partner_mor_read
on public.lifecycle_provisioning_attempts for select to clockwork_runtime
using (public.core_partner_is_order_mor(order_id, account_id));
create policy lifecycle_provisioning_partner_mor_insert
on public.lifecycle_provisioning_attempts for insert to clockwork_runtime
with check (
  public.core_partner_can_insert_provisioning_attempt(
    order_id,
    account_id,
    organization_id,
    command_id,
    operation,
    state,
    attempt,
    poc_id
  )
);

create or replace function public.core_partner_is_termination_mor(
  candidate_termination_id uuid,
  candidate_end_client_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.terminations termination_record
    join public.orders order_record on order_record.id = termination_record.order_id
    where termination_record.id = candidate_termination_id
      and termination_record.account_id = candidate_end_client_account_id
      and order_record.account_id = termination_record.account_id
      and order_record.sourcing in ('resale','distributor')
      and order_record.partner_account_id is not null
      and order_record.invoicing_account_id = order_record.partner_account_id
      and public.app_has_account(order_record.partner_account_id)
  )
$$;
revoke all on function public.core_partner_is_termination_mor(uuid,uuid)
  from public;
grant execute on function public.core_partner_is_termination_mor(uuid,uuid)
  to clockwork_runtime, clockwork_service;

create or replace function public.core_partner_can_access_offboarding_organization(
  candidate_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.entitlements entitlement
    join public.orders order_record on order_record.id = entitlement.order_id
    where entitlement.organization_id = candidate_organization_id
      and order_record.sourcing in ('resale','distributor')
      and order_record.partner_account_id is not null
      and order_record.invoicing_account_id = order_record.partner_account_id
      and public.app_has_account(order_record.partner_account_id)
  )
$$;
revoke all on function public.core_partner_can_access_offboarding_organization(uuid)
  from public;
grant execute on function public.core_partner_can_access_offboarding_organization(uuid)
  to clockwork_runtime, clockwork_service;

create or replace function public.core_renewal_action_is_partner_confidential(
  candidate_order_id uuid,
  candidate_actor_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders order_record
    where order_record.id = candidate_order_id
      and order_record.sourcing in ('resale','distributor')
      and order_record.partner_account_id is not null
      and order_record.invoicing_account_id = order_record.partner_account_id
      and candidate_actor_user_id is not null
  )
$$;
revoke all on function public.core_renewal_action_is_partner_confidential(uuid,uuid)
  from public;
grant execute on function public.core_renewal_action_is_partner_confidential(uuid,uuid)
  to clockwork_runtime, clockwork_service;

drop policy if exists lifecycle_renewal_read
  on public.lifecycle_renewal_actions;
drop policy if exists lifecycle_renewal_insert
  on public.lifecycle_renewal_actions;
create policy lifecycle_renewal_read
on public.lifecycle_renewal_actions for select to clockwork_runtime
using (
  app_is_internal()
  or app_has_account(account_id)
    and not public.core_renewal_action_is_partner_confidential(
      order_id, actor_user_id
    )
  or public.core_partner_is_order_mor(order_id, account_id)
    and public.core_renewal_action_is_partner_confidential(
      order_id, actor_user_id
    )
);
create policy lifecycle_renewal_service_read
on public.lifecycle_renewal_actions for select to clockwork_service
using (true);
create policy lifecycle_renewal_insert
on public.lifecycle_renewal_actions for insert to clockwork_runtime
with check (
  app_is_current_user(actor_user_id)
  and (
    app_has_account(account_id)
    or public.core_partner_is_order_mor(order_id, account_id)
  )
);

drop policy if exists lifecycle_offboarding_scope
  on public.lifecycle_offboarding_plans;
create policy lifecycle_offboarding_service
on public.lifecycle_offboarding_plans for all to clockwork_service
using (true) with check (true);
create policy lifecycle_offboarding_tenant_read
on public.lifecycle_offboarding_plans for select to clockwork_runtime
using (
  app_is_internal()
  or app_has_account(account_id)
    and not public.core_renewal_action_is_partner_confidential(
      (select termination_record.order_id
       from public.terminations termination_record
       where termination_record.id = termination_id),
      requested_by
    )
);
create policy lifecycle_offboarding_tenant_insert
on public.lifecycle_offboarding_plans for insert to clockwork_runtime
with check (
  app_is_internal()
  or app_has_account(account_id) and app_is_current_user(requested_by)
);
create policy lifecycle_offboarding_tenant_update
on public.lifecycle_offboarding_plans for update to clockwork_runtime
using (
  app_is_internal()
  or app_has_account(account_id)
    and app_has_role('destructive_action_approver')
)
with check (
  app_is_internal()
  or app_has_account(account_id)
    and app_has_role('destructive_action_approver')
);
create policy lifecycle_offboarding_partner_read
on public.lifecycle_offboarding_plans for select to clockwork_runtime
using (
  public.core_partner_is_termination_mor(termination_id, account_id)
  and public.core_renewal_action_is_partner_confidential(
    (select termination_record.order_id
     from public.terminations termination_record
     where termination_record.id = termination_id),
    requested_by
  )
);
create policy lifecycle_offboarding_partner_insert
on public.lifecycle_offboarding_plans for insert to clockwork_runtime
with check (
  app_is_current_user(requested_by)
  and reason in ('non_renewal','partner_request','partner_default')
  and public.core_partner_is_termination_mor(termination_id, account_id)
);

create policy organizations_partner_offboarding_read
on public.organizations for select to clockwork_runtime
using (public.core_partner_can_access_offboarding_organization(id));

create policy terminations_partner_mor_read
on public.terminations for select to clockwork_runtime
using (public.core_partner_is_order_mor(order_id, account_id));
create policy terminations_partner_mor_insert
on public.terminations for insert to clockwork_runtime
with check (public.core_partner_is_order_mor(order_id, account_id));
create policy terminations_safe_initial_state
on public.terminations as restrictive for insert to clockwork_runtime
with check (
  order_id is not null
  and teardown_status in ('pending_final_billing','retrieval_window')
  and teardown_confirmed_at is null
  and (
    final_billing_status = 'settled' and teardown_status = 'retrieval_window'
    or final_billing_status in ('pending','credit_due')
      and teardown_status = 'pending_final_billing'
  )
);

create or replace function public.core_validate_offboarding_plan_transition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  approval_count integer;
  distinct_approvers integer;
  old_approval_count integer;
  last_approval jsonb;
  last_approver uuid;
begin
  if tg_op = 'UPDATE' then
    if old.termination_id is distinct from new.termination_id
      or old.account_id is distinct from new.account_id
      or old.organization_id is distinct from new.organization_id
      or old.requested_by is distinct from new.requested_by
      or old.reason is distinct from new.reason
      or old.created_at is distinct from new.created_at
      or new.row_version <> old.row_version + 1
    then
      raise exception using errcode = '55000', message = 'offboarding source identity and version are immutable';
    end if;
  end if;
  if new.plan ->> 'terminationId' is distinct from new.termination_id::text
    or new.plan ->> 'accountId' is distinct from new.account_id::text
    or new.plan ->> 'organizationId' is distinct from new.organization_id::text
    or new.plan ->> 'requestedBy' is distinct from new.requested_by::text
    or new.plan ->> 'reason' is distinct from new.reason
  then
    raise exception using errcode = '23514', message = 'offboarding plan must match persisted source identities';
  end if;
  if jsonb_typeof(new.plan -> 'approvals') <> 'array' then
    raise exception using errcode = '23514', message = 'offboarding approvals must be an array';
  end if;
  select count(*), count(distinct approval ->> 'approverId')
    into approval_count, distinct_approvers
  from jsonb_array_elements(new.plan -> 'approvals') approval;
  if approval_count <> distinct_approvers or exists (
    select 1 from jsonb_array_elements(new.plan -> 'approvals') approval
    where approval ->> 'approverId' = new.requested_by::text
  ) then
    raise exception using errcode = '23514', message = 'offboarding requires distinct non-requester approvals';
  end if;
  if tg_op = 'INSERT' and not (
    approval_count = 0
      and new.plan ->> 'status' in (
        'pending_final_billing','retrieval_window','retention_blocked'
      )
      and new.plan ->> 'teardownOperationId' is null
      and new.plan ->> 'teardownConfirmedAt' is null
    or new.plan ->> 'status' = 'teardown_requested'
      and new.plan ->> 'finalBillingStatus' = 'settled'
      and approval_count >= 2
      and (select count(*) from jsonb_array_elements(new.plan -> 'approvals') approval
           where approval ->> 'decision' = 'approved') >= 2
      and new.plan ->> 'teardownOperationId' is null
      and new.plan ->> 'teardownConfirmedAt' is null
      and not exists (
        select 1
        from jsonb_array_elements(new.plan -> 'approvals') approval
        where not exists (
          select 1 from public.approvals durable_approval
          where durable_approval.id = (approval ->> 'approvalId')::uuid
            and durable_approval.account_id = new.account_id
            and durable_approval.action = 'termination_teardown'
            and durable_approval.object_type = 'termination'
            and durable_approval.object_id = new.termination_id
            and durable_approval.requested_by = new.requested_by
            and durable_approval.approved_by =
              (approval ->> 'approverId')::uuid
            and durable_approval.status = approval ->> 'decision'
            and durable_approval.decided_at is not null
        )
      )
  ) then
    raise exception using errcode = '23514', message = 'offboarding request must begin in a recoverable pre-approval state';
  end if;
  if tg_op = 'UPDATE' then
    old_approval_count := jsonb_array_length(old.plan -> 'approvals');
    if new.plan ->> 'status' is distinct from old.plan ->> 'status' and not (
      old.plan ->> 'status' = 'pending_final_billing'
        and new.plan ->> 'status' in ('retrieval_window','pending_approval')
      or old.plan ->> 'status' = 'retrieval_window'
        and new.plan ->> 'status' in ('retention_blocked','pending_approval')
      or old.plan ->> 'status' = 'retention_blocked'
        and new.plan ->> 'status' in ('retrieval_window','pending_approval')
      or old.plan ->> 'status' = 'pending_approval'
        and new.plan ->> 'status' in ('ready_for_teardown','teardown_requested')
      or old.plan ->> 'status' = 'ready_for_teardown'
        and new.plan ->> 'status' = 'teardown_requested'
      or old.plan ->> 'status' = 'teardown_requested'
        and new.plan ->> 'status' = 'teardown_confirmed'
      or old.plan ->> 'status' = 'teardown_confirmed'
        and new.plan ->> 'status' = 'complete'
    ) then
      raise exception using errcode = '23514', message = 'invalid offboarding status transition';
    end if;
    if approval_count not in (old_approval_count, old_approval_count + 1) then
      raise exception using errcode = '23514', message = 'offboarding update may append at most one durable approval';
    end if;
    if approval_count = old_approval_count + 1 then
      last_approval := new.plan -> 'approvals' -> (approval_count - 1);
      last_approver := nullif(last_approval ->> 'approverId', '')::uuid;
      if not exists (
        select 1
        from public.approvals durable_approval
        where durable_approval.id = (last_approval ->> 'approvalId')::uuid
          and durable_approval.account_id = new.account_id
          and durable_approval.action = 'termination_teardown'
          and durable_approval.object_type = 'termination'
          and durable_approval.object_id = new.termination_id
          and durable_approval.requested_by = new.requested_by
          and durable_approval.approved_by = last_approver
          and durable_approval.status = last_approval ->> 'decision'
          and durable_approval.decided_at is not null
      ) then
        raise exception using errcode = '23514', message = 'offboarding approval must match its durable approval row';
      end if;
    end if;
    if current_setting('role', true) = 'clockwork_runtime' then
      if (new.plan - 'status' - 'approvals')
        is distinct from (old.plan - 'status' - 'approvals')
        or approval_count <> old_approval_count + 1
      then
        raise exception using errcode = '23514', message = 'runtime offboarding update may append exactly one approval only';
      end if;
      if last_approver is distinct from public.app_current_user_id() then
        raise exception using errcode = '42501', message = 'offboarding approval must belong to the acting approver';
      end if;
    end if;
  end if;
  if new.plan ->> 'status' = 'teardown_requested' and (
    new.plan ->> 'teardownOperationId' is not null
    or new.plan ->> 'teardownConfirmedAt' is not null
    or not exists (
      select 1
      from public.lifecycle_provisioning_attempts attempt_record
      join public.provider_operations provider_operation
        on provider_operation.provider = 'provisioning'
        and provider_operation.operation = 'teardown'
        and provider_operation.idempotency_key =
          attempt_record.attempt #>> '{command,idempotencyKey}'
        and provider_operation.aggregate_type = 'termination'
        and provider_operation.aggregate_id = new.termination_id
      where attempt_record.order_id = (new.plan ->> 'orderId')::uuid
        and attempt_record.organization_id = new.organization_id
        and attempt_record.operation = 'teardown'
        and (
          public.system_capability_is_enabled('teardown')
          and attempt_record.state in ('pending','in_flight')
          and provider_operation.status in ('pending','running')
          or public.system_capability_is_enabled('teardown', true)
          and attempt_record.state = 'retry_scheduled'
          and provider_operation.status = 'retrying'
        )
    )
  ) then
    raise exception using errcode = '23514', message = 'teardown request requires its enabled durable provider command';
  end if;
  if new.plan ->> 'status' = 'teardown_confirmed' and not exists (
    select 1
    from public.lifecycle_provisioning_attempts attempt_record
    join public.provider_operations provider_operation
      on provider_operation.provider = 'provisioning'
      and provider_operation.operation = 'teardown'
      and provider_operation.idempotency_key =
        attempt_record.attempt #>> '{command,idempotencyKey}'
      and provider_operation.aggregate_type = 'termination'
      and provider_operation.aggregate_id = new.termination_id
      and provider_operation.status = 'succeeded'
      and provider_operation.provider_reference =
        new.plan ->> 'teardownOperationId'
    where attempt_record.order_id = (new.plan ->> 'orderId')::uuid
      and attempt_record.organization_id = new.organization_id
      and attempt_record.operation = 'teardown'
      and attempt_record.state = 'confirmed'
      and attempt_record.provider_operation_id =
        new.plan ->> 'teardownOperationId'
      and attempt_record.last_provider_occurred_at =
        (new.plan ->> 'teardownConfirmedAt')::timestamptz
  ) then
    raise exception using errcode = '23514', message = 'teardown confirmation requires matching provider success';
  end if;
  if new.plan ->> 'status' = 'complete' and not exists (
    select 1 from public.deletion_certificates certificate
    where certificate.termination_id = new.termination_id
      and certificate.completed_at >=
        (new.plan ->> 'teardownConfirmedAt')::timestamptz
  ) then
    raise exception using errcode = '23514', message = 'offboarding completion requires its deletion certificate';
  end if;
  if new.plan ->> 'status' in (
    'ready_for_teardown','teardown_requested','teardown_confirmed','complete'
  ) and (
    approval_count < 2
    or (select count(*) from jsonb_array_elements(new.plan -> 'approvals') approval
        where approval ->> 'decision' = 'approved') < 2
    or new.plan ->> 'finalBillingStatus' <> 'settled'
  ) then
    raise exception using errcode = '23514', message = 'teardown requires two approvals and settled final billing';
  end if;
  return new;
end
$$;
create trigger lifecycle_offboarding_plan_transition_guard
before insert or update on public.lifecycle_offboarding_plans
for each row execute function public.core_validate_offboarding_plan_transition();

-- The repository advances the durable plan first and its summary row second.
-- Check convergence at commit so either both changes persist or neither does.
create or replace function public.core_assert_offboarding_termination_convergence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate_termination_id uuid;
begin
  candidate_termination_id := coalesce(
    nullif(to_jsonb(new) ->> 'termination_id', '')::uuid,
    nullif(to_jsonb(new) ->> 'id', '')::uuid
  );
  if not exists (
    select 1
    from public.lifecycle_offboarding_plans offboarding
    join public.terminations termination_record
      on termination_record.id = offboarding.termination_id
      and termination_record.account_id = offboarding.account_id
      and termination_record.order_id = (offboarding.plan ->> 'orderId')::uuid
      and termination_record.teardown_status = offboarding.plan ->> 'status'
      and termination_record.final_billing_status =
        offboarding.plan ->> 'finalBillingStatus'
    where offboarding.termination_id = candidate_termination_id
  ) then
    raise exception using errcode = '23514', message = 'offboarding plan and termination must converge before commit';
  end if;
  return null;
end
$$;
revoke all on function public.core_assert_offboarding_termination_convergence()
  from public;
create constraint trigger lifecycle_offboarding_termination_convergence_guard
after insert or update on public.lifecycle_offboarding_plans
deferrable initially deferred
for each row execute function public.core_assert_offboarding_termination_convergence();
create constraint trigger terminations_offboarding_convergence_guard
after insert or update on public.terminations
deferrable initially deferred
for each row execute function public.core_assert_offboarding_termination_convergence();

create or replace function public.core_validate_runtime_termination_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('role', true) = 'clockwork_runtime' then
    if tg_op = 'UPDATE' and (
      old.id is distinct from new.id
      or old.account_id is distinct from new.account_id
      or old.order_id is distinct from new.order_id
      or old.effective_at is distinct from new.effective_at
      or old.created_at is distinct from new.created_at
      or new.row_version <> old.row_version + 1
    ) then
      raise exception using errcode = '55000', message = 'termination source identity and version are immutable';
    end if;
    if tg_op = 'UPDATE' and not exists (
      select 1 from public.lifecycle_offboarding_plans offboarding
      where offboarding.termination_id = new.id
        and offboarding.account_id = new.account_id
        and offboarding.plan ->> 'status' = new.teardown_status
        and offboarding.plan ->> 'finalBillingStatus' = new.final_billing_status
    ) then
      raise exception using errcode = '23514', message = 'termination transition must match its durable offboarding plan';
    end if;
  end if;
  return new;
end
$$;
create trigger terminations_runtime_transition_guard
before update on public.terminations
for each row execute function public.core_validate_runtime_termination_transition();

-- Audit/outbox append for partner commands is bound to the persisted aggregate,
-- current version, exact event family, and signed actor. The visibility helper
-- additionally prevents the end client from reading a partner-authored event.
create or replace function public.core_partner_can_append_commercial_audit(
  candidate_aggregate_type text,
  candidate_aggregate_id uuid,
  candidate_account_id uuid,
  candidate_aggregate_version integer,
  candidate_event_type text,
  candidate_actor jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if candidate_actor ->> 'kind' <> 'user'
    or candidate_actor ->> 'id' is distinct from public.app_current_user_id()::text
  then
    return false;
  end if;
  if candidate_aggregate_type = 'quote'
    and candidate_event_type like 'core.quotes.%'
  then
    return exists (
      select 1
      from public.quotes quote_record
      join public.core_quote_commercial_profiles quote_profile
        on quote_profile.quote_id = quote_record.id
      where quote_record.id = candidate_aggregate_id
        and quote_record.account_id = candidate_account_id
        and quote_record.row_version = candidate_aggregate_version
        and quote_record.partner_account_id is not null
        and quote_profile.channel_shape in ('resale','distributor')
        and quote_profile.merchant_of_record = 'partner'
        and quote_profile.billing_account_id = quote_record.partner_account_id
        and public.app_has_account(quote_record.partner_account_id)
    );
  elsif candidate_aggregate_type = 'provider_operation'
    and candidate_event_type = 'order.provisioning_requested'
  then
    return exists (
      select 1
      from public.lifecycle_provisioning_attempts attempt_record
      join public.orders order_record on order_record.id = attempt_record.order_id
      where attempt_record.id = candidate_aggregate_id
        and attempt_record.account_id = candidate_account_id
        and attempt_record.row_version = candidate_aggregate_version
        and attempt_record.operation = 'provision'
        and attempt_record.state = 'pending'
        and order_record.account_id = attempt_record.account_id
        and public.core_partner_is_order_mor(
          order_record.id, order_record.account_id
        )
    );
  elsif candidate_aggregate_type = 'order'
    and (
      candidate_event_type like 'core.orders.%'
      or candidate_event_type in ('renewal.requested','renewal.declined')
    )
  then
    return exists (
      select 1 from public.orders order_record
      where order_record.id = candidate_aggregate_id
        and order_record.account_id = candidate_account_id
        and order_record.row_version = candidate_aggregate_version
        and order_record.sourcing in ('resale','distributor')
        and order_record.invoicing_account_id = order_record.partner_account_id
        and public.app_has_account(order_record.partner_account_id)
    );
  elsif candidate_aggregate_type = 'termination'
    and candidate_event_type = 'termination.requested'
  then
    return exists (
      select 1
      from public.terminations termination_record
      join public.orders order_record on order_record.id = termination_record.order_id
      where termination_record.id = candidate_aggregate_id
        and termination_record.account_id = candidate_account_id
        and termination_record.row_version = candidate_aggregate_version
        and order_record.account_id = termination_record.account_id
        and order_record.sourcing in ('resale','distributor')
        and order_record.invoicing_account_id = order_record.partner_account_id
        and public.app_has_account(order_record.partner_account_id)
    );
  end if;
  return false;
end
$$;
revoke all on function public.core_partner_can_append_commercial_audit(
  text,uuid,uuid,integer,text,jsonb
) from public;
grant execute on function public.core_partner_can_append_commercial_audit(
  text,uuid,uuid,integer,text,jsonb
) to clockwork_runtime, clockwork_service;

create or replace function public.core_commercial_audit_is_visible(
  candidate_aggregate_type text,
  candidate_aggregate_id uuid,
  candidate_event_type text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  partner_id uuid;
begin
  if candidate_aggregate_type = 'quote'
    and candidate_event_type like 'core.quotes.%'
  then
    select quote_record.partner_account_id into partner_id
    from public.quotes quote_record
    join public.core_quote_commercial_profiles quote_profile
      on quote_profile.quote_id = quote_record.id
    where quote_record.id = candidate_aggregate_id
      and quote_profile.channel_shape in ('resale','distributor')
      and quote_profile.merchant_of_record = 'partner';
  elsif candidate_aggregate_type = 'order'
    and (
      candidate_event_type like 'core.orders.%'
      or candidate_event_type in (
        'renewal.requested','renewal.declined','order.provisioning_requested'
      )
    )
  then
    select order_record.partner_account_id into partner_id
    from public.orders order_record
    where order_record.id = candidate_aggregate_id
      and order_record.sourcing in ('resale','distributor');
  elsif candidate_aggregate_type = 'provider_operation'
    and candidate_event_type = 'order.provisioning_requested'
  then
    select order_record.partner_account_id into partner_id
    from public.lifecycle_provisioning_attempts attempt_record
    join public.orders order_record on order_record.id = attempt_record.order_id
    where attempt_record.id = candidate_aggregate_id
      and attempt_record.account_id = order_record.account_id
      and attempt_record.operation = 'provision'
      and order_record.sourcing in ('resale','distributor');
  elsif candidate_aggregate_type = 'termination'
    and candidate_event_type = 'termination.requested'
  then
    select order_record.partner_account_id into partner_id
    from public.terminations termination_record
    join public.orders order_record on order_record.id = termination_record.order_id
    where termination_record.id = candidate_aggregate_id
      and order_record.sourcing in ('resale','distributor');
  end if;
  if partner_id is null then
    return true;
  end if;
  return public.app_is_internal() or public.app_has_account(partner_id);
end
$$;
revoke all on function public.core_commercial_audit_is_visible(
  text,uuid,text
) from public;
grant execute on function public.core_commercial_audit_is_visible(
  text,uuid,text
) to clockwork_runtime, clockwork_service;

create policy audit_events_partner_mor_insert
on public.audit_events for insert to clockwork_runtime
with check (public.core_partner_can_append_commercial_audit(
  aggregate_type,aggregate_id,account_id,aggregate_version,event_type,actor
));
create policy audit_events_partner_mor_actor_read
on public.audit_events for select to clockwork_runtime
using (public.core_partner_can_append_commercial_audit(
  aggregate_type,aggregate_id,account_id,aggregate_version,event_type,actor
));
create policy audit_events_partner_confidential_visibility
on public.audit_events as restrictive for select to clockwork_runtime
using (public.core_commercial_audit_is_visible(
  aggregate_type,aggregate_id,event_type
));

create policy outbox_messages_partner_mor_insert
on public.outbox_messages for insert to clockwork_runtime
with check (exists (
  select 1
  from public.audit_events event_record
  where event_record.id = event_id
    and public.core_partner_can_append_commercial_audit(
      event_record.aggregate_type,event_record.aggregate_id,
      event_record.account_id,event_record.aggregate_version,
      event_record.event_type,event_record.actor
    )
    and topic = event_record.event_type
    and payload ->> 'eventId' = event_record.id::text
    and payload ->> 'eventType' = event_record.event_type
    and payload ->> 'aggregateType' = event_record.aggregate_type
    and payload ->> 'aggregateId' = event_record.aggregate_id::text
    and payload ->> 'aggregateVersion' = event_record.aggregate_version::text
    and payload ->> 'requestId' = event_record.request_id
));

-- A signed credit-note void reverses only the commission clawback previously
-- created for that exact credit note. It is a distinct source identity so
-- delivery replay remains harmless and statement lines preserve both facts.
alter table public.commission_accruals
  drop constraint commission_accruals_source_type_check,
  drop constraint commission_accruals_sign_check;
alter table public.commission_accruals
  add constraint commission_accruals_source_type_check check (
    source_type in ('payment','credit_note','credit_note_void','refund','dispute')
  ),
  add constraint commission_accruals_sign_check check (
    (source_type = 'payment' and adjustment_source_id is null and
      net_collected_revenue_minor >= 0 and amount_minor >= 0 and holdback_minor >= 0)
    or
    (source_type = 'credit_note_void' and adjustment_source_id is not null and
      net_collected_revenue_minor >= 0 and amount_minor >= 0 and holdback_minor >= 0)
    or
    (source_type in ('credit_note','refund','dispute') and
      adjustment_source_id is not null and net_collected_revenue_minor <= 0 and
      amount_minor <= 0 and holdback_minor <= 0)
  );
alter table public.core_commission_statement_lines
  drop constraint if exists core_commission_statement_line_source_check;
alter table public.core_commission_statement_lines
  add constraint core_commission_statement_line_source_check check (
    source_type in ('payment','credit_note','credit_note_void','refund','dispute')
  );

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
  elsif new.source_type = 'credit_note_void' then
    select c.invoice_id, c.order_id, c.currency, c.amount_minor, c.stripe_last_occurred_at
      into source_invoice_id, source_order_id, source_currency,
           source_amount_minor, source_occurred_at
    from public.credit_notes c
    where c.id = new.source_id and c.status = 'void'
      and c.stripe_last_occurred_at is not null
      and exists (
        select 1 from public.webhook_events event_record
        where event_record.provider = 'stripe'
          and event_record.provider_event_id = c.stripe_last_event_id
          and event_record.event_type = 'credit_note.voided'
          and event_record.signature_verified_at is not null
          and event_record.occurred_at = c.stripe_last_occurred_at
      );
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
  elsif new.source_type = 'credit_note_void' then
    select * into original
    from public.commission_accruals a
    where a.id = new.adjustment_source_id
      and a.source_type = 'credit_note'
      and a.source_id = new.source_id
      and a.invoice_id = source_invoice_id
      and a.partner_account_id = referral_partner_id;
    if original.id is null
      or new.rate_bps <> original.rate_bps
      or new.holdback_bps <> original.holdback_bps
      or original.net_collected_revenue_minor <> -source_amount_minor
    then
      raise exception using errcode = '23514', message = 'credit-note void must reverse its exact persisted commission clawback';
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
