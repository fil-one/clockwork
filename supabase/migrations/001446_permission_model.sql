-- Permissions are the enforcement currency in the database.
--
-- 1. Signed claims carry `permissions`, computed by the application from the
--    person's roles (union of the role bundles, less what the organization's
--    side withholds, less the approver permissions inside an assisted
--    session). `app_has_permission` and `app_has_any_permission` test them. A
--    claim without the key (an instance signed before this release, during
--    the rolling deploy) answers from its roles through the generated
--    role_permissions table (001445), less what the side withholds.
--
-- 2. `member_has_permission(user, permission)` answers the same question for
--    STORED memberships ("does the approver of record still hold finance
--    authority"), across every role the person holds.
--
-- 3. Organizations carry an explicit side: fil_one, customer, channel_partner
--    or referral_partner. The backfill rule is below; a trigger keeps every
--    role a member holds within the roles its organization's side allows
--    (organization_side_roles, generated in 001445).
--
-- 4. A membership may hold several roles. membership_roles holds every role,
--    including the primary role on memberships.role, which still picks the
--    home page. Inserting or changing a membership's primary role keeps
--    membership_roles in step, so every existing writer keeps working.
--
-- 5. Staff notices: an in-app notice to every other commerce administrator
--    whenever a staff member's access changes.

-- ---------------------------------------------------------------------------
-- 1. Permission checks on the signed claim.
-- ---------------------------------------------------------------------------
-- The fallback for a claim without `permissions` exists only for the rolling
-- deploy, while application instances signed before this release still serve
-- requests: it derives the permissions from the claim's roles exactly as the
-- application does, including what the side withholds (the claim's `side`
-- when present, else the side of the organizations of the claimed accounts).
-- Remove it, and require `permissions` in app_context_is_valid, once every
-- instance signs permissions.
create function private.claim_permissions_from_roles(claims jsonb)
returns text[] language plpgsql stable security definer
set search_path = pg_catalog, public as $$
begin
  return (select coalesce(array_agg(distinct grant_row.permission), '{}')
  from public.role_permissions grant_row
  where claims->'roles' ? grant_row.role
    and not exists (
      select 1 from public.organization_side_withheld_permissions withheld
      where withheld.permission = grant_row.permission
        and (
          withheld.side = claims->>'side'
          or (claims->>'side' is null and exists (
            select 1 from public.organizations organization
            where organization.side = withheld.side
              and organization.account_id::text in (
                select jsonb_array_elements_text(claims->'accountIds'))
          ))
        )
    ));
end $$;
revoke all on function private.claim_permissions_from_roles(jsonb)
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

-- The permissions the current signed claim holds.
create function public.app_claim_permissions() returns text[]
language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare claims jsonb;
begin
  if not public.app_context_is_valid() then return '{}'::text[]; end if;
  claims := public.app_context_claims();
  if jsonb_typeof(claims->'permissions') = 'array' then
    return array(select jsonb_array_elements_text(claims->'permissions'));
  end if;
  return private.claim_permissions_from_roles(claims);
end $$;
revoke all on function public.app_claim_permissions() from public;
grant execute on function public.app_claim_permissions()
  to clockwork_runtime, clockwork_service;

create function public.app_has_permission(candidate text) returns boolean
language sql stable set search_path = public as $$
  select app_is_internal() or candidate = any(app_claim_permissions())
$$;
revoke all on function public.app_has_permission(text) from public;
grant execute on function public.app_has_permission(text)
  to clockwork_runtime, clockwork_service;
comment on function public.app_has_permission(text) is
  'True on the service pool, or when the signed claim carries the permission (see app_claim_permissions).';

create function public.app_has_any_permission(candidates text[]) returns boolean
language sql stable set search_path = public as $$
  select app_is_internal() or candidates && app_claim_permissions()
$$;
revoke all on function public.app_has_any_permission(text[]) from public;
grant execute on function public.app_has_any_permission(text[])
  to clockwork_runtime, clockwork_service;

-- ---------------------------------------------------------------------------
-- 3. Organization sides.
-- ---------------------------------------------------------------------------
alter table public.organizations add column side text;

-- The side an organization would be given from its account alone, for an
-- organization with no members. Fil One's own organization is never inferred
-- from account data: it is named explicitly (the backfill below, the
-- production bootstrap, the seed).
create function private.organization_side_from_account(candidate_account uuid)
returns text language sql stable security definer
set search_path = pg_catalog, public as $$
  select case
    when 'partner' = any(account.relationship_roles)
      and not ('direct_client' = any(account.relationship_roles))
      then case
        -- Only a recorded referral agreement makes a referral partner. A
        -- partner account with no agreement type keeps partner quoting, as it
        -- has today.
        when account.partner_agreement_type = 'referral' then 'referral_partner'
        else 'channel_partner'
      end
    else 'customer'
  end
  from public.accounts account where account.id = candidate_account
$$;
revoke all on function private.organization_side_from_account(uuid)
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

-- Backfill rule, applied to every organization in this order:
--   a. bound to one of the two Fil One staff organizations by identity
--      provider (001440), or any member holding an internal role -> fil_one
--   b. any member holding a partner role                     -> referral_partner
--      when the account's partner agreement type is referral, otherwise
--      channel_partner
--   c. any member holding a customer role                    -> customer
--   d. no members                                            -> from the account,
--      as organization_side_from_account above
-- This migration runs unattended, so it never stops on existing data. An
-- organization whose members' roles do not all fit the side it is given (for
-- example a staff organization holding a stray `member` row) is resolved by
-- the order above, named in a NOTICE, and recorded in one audit event per
-- organization (`organization.side_conflict_resolved`). Those memberships are
-- grandfathered: the side guard below checks only rows inserted or changed
-- after this migration, so nobody loses access tonight, and a person resolves
-- each one from the audit trail.
do $$
declare
  resolved record;
  summary text;
  conflicts integer := 0;
begin
  with member_kinds as (
    select membership.organization_id,
      bool_or(membership.role in ('internal_operator','finance_approver','legal_approver',
        'destructive_action_approver','revenue','commerce_admin')) as has_internal,
      bool_or(membership.role in ('partner_admin','partner_seller')) as has_partner,
      bool_or(membership.role in ('owner','admin','billing','member')) as has_customer
    from public.memberships membership
    group by membership.organization_id
  )
  update public.organizations organization
  set side = case
    when target.workos_organization_id in (
        'org_01M21Q2N3ER4KWVJ30VRN8G0PV', -- staging
        'org_01M21RDQDM5NHYD4CEHWJZFG3J'  -- production
      ) or coalesce(kinds.has_internal, false) then 'fil_one'
    when coalesce(kinds.has_partner, false) then
      case when account.partner_agreement_type = 'referral'
        then 'referral_partner' else 'channel_partner' end
    when coalesce(kinds.has_customer, false) then 'customer'
    else private.organization_side_from_account(target.account_id)
  end
  from public.organizations target
  join public.accounts account on account.id = target.account_id
  left join member_kinds kinds on kinds.organization_id = target.id
  where target.id = organization.id
    and organization.side is null;

  for resolved in
    select organization.id, organization.account_id, organization.side,
      array_agg(distinct membership.role order by membership.role) as roles,
      array_agg(distinct membership.role order by membership.role)
        filter (where not exists (
          select 1 from public.organization_side_roles allowed
          where allowed.side = organization.side and allowed.role = membership.role
        )) as outside
    from public.organizations organization
    join public.memberships membership on membership.organization_id = organization.id
    group by organization.id, organization.account_id, organization.side
    having bool_or(not exists (
      select 1 from public.organization_side_roles allowed
      where allowed.side = organization.side and allowed.role = membership.role
    ))
  loop
    conflicts := conflicts + 1;
    raise notice 'ORGANIZATION_SIDE_CONFLICT organization % set to %; members also hold % (kept)',
      resolved.id, resolved.side, resolved.outside;
    insert into public.audit_events (
      id, account_id, aggregate_type, aggregate_id, aggregate_version,
      event_type, event_version, actor, occurred_at, request_id, before, after,
      metadata
    ) values (
      gen_random_uuid(), resolved.account_id, 'organization', resolved.id,
      coalesce((select max(event.aggregate_version) from public.audit_events event
        where event.aggregate_type = 'organization' and event.aggregate_id = resolved.id), 0) + 1,
      'organization.side_conflict_resolved', 1,
      jsonb_build_object('kind', 'system', 'id', 'migration:001446_permission_model'),
      now(), 'migration:001446_permission_model',
      jsonb_build_object('roles', to_jsonb(resolved.roles)),
      jsonb_build_object('side', resolved.side,
        'rolesOutsideSide', to_jsonb(resolved.outside)),
      jsonb_build_object('migration', '001446_permission_model',
        'grandfathered', true)
    );
  end loop;

  select string_agg(format('%s=%s', side, total), ', ' order by side) into summary
  from (select side, count(*) as total from public.organizations group by side) counted;
  raise notice 'organization sides after backfill: %; conflicts resolved: %',
    coalesce(summary, 'none'), conflicts;
end $$;

-- Every organization matched exactly one row above.
do $$
begin
  if exists (select 1 from public.organizations where side is null) then
    raise exception 'ORGANIZATION_SIDE_BACKFILL_INCOMPLETE';
  end if;
end $$;

alter table public.organizations alter column side set not null;
alter table public.organizations add constraint organizations_side_check
  check (side in ('fil_one','customer','channel_partner','referral_partner'));
comment on column public.organizations.side is
  'fil_one, customer, channel_partner or referral_partner. Decides the roles members may hold (organization_side_roles) and the portal they see.';

-- New organizations without an explicit side take the side their account
-- implies. Fil One's own organization must say so.
--
-- The side decides which roles members may hold, so the tenant pool may never
-- choose it: on clockwork_runtime an explicit side must be the one the account
-- implies anyway, and a side never changes. Only the service pool (or a
-- migration) names Fil One's organization or moves an organization between
-- sides.
create function public.guard_organization_side() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  implied text := private.organization_side_from_account(new.account_id);
  -- This function runs as its owner, so current_user is not the caller; the
  -- tenant pool always enters through `set local role clockwork_runtime`
  -- (packages/db/src/transaction.ts), which the role setting still shows.
  tenant_pool boolean := current_setting('role', true) = 'clockwork_runtime'
    or session_user = 'clockwork_runtime';
begin
  if tg_op = 'INSERT' then
    if new.side is null then
      new.side := implied;
    elsif tenant_pool and new.side is distinct from implied then
      raise exception using errcode = '42501',
        message = 'ORGANIZATION_SIDE_SERVICE_ONLY: only the service pool chooses an organization''s side';
    end if;
  elsif new.side is distinct from old.side and tenant_pool then
    raise exception using errcode = '42501',
      message = 'ORGANIZATION_SIDE_SERVICE_ONLY: only the service pool changes an organization''s side';
  end if;
  return new;
end $$;
revoke all on function public.guard_organization_side()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
create trigger organizations_default_side
before insert or update of side on public.organizations
for each row execute function public.guard_organization_side();

-- ---------------------------------------------------------------------------
-- 4. Several roles per membership.
-- ---------------------------------------------------------------------------
create table public.membership_roles (
  id uuid primary key default uuid_v7(),
  membership_id uuid not null references public.memberships(id) on delete cascade,
  role text not null,
  granted_by uuid references public.commerce_users(id),
  granted_at timestamptz not null default now(),
  reason text check (reason is null or length(trim(reason)) between 1 and 500),
  constraint membership_roles_membership_role_unique unique (membership_id, role)
);
create index membership_roles_role_idx on public.membership_roles (role);
comment on table public.membership_roles is
  'Every role a membership holds, including the primary role on memberships.role. A person holds the union of the bundles.';

alter table public.membership_roles enable row level security;
alter table public.membership_roles force row level security;
revoke all on public.membership_roles
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select, insert, delete on public.membership_roles to clockwork_service;
grant select on public.membership_roles to clockwork_runtime;
create policy membership_roles_service on public.membership_roles
  for all to clockwork_service using (true) with check (true);
create policy membership_roles_read on public.membership_roles
  for select to clockwork_runtime using (exists (
    select 1 from public.memberships membership
    join public.organizations organization on organization.id = membership.organization_id
    where membership.id = membership_id
      and app_has_account(organization.account_id)
  ));

insert into public.membership_roles (membership_id, role, granted_at)
select membership.id, membership.role, membership.created_at
from public.memberships membership;

-- The primary role is always one of the membership's roles.
create function public.sync_primary_membership_role() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    delete from public.membership_roles
    where membership_id = new.id and role = old.role;
  end if;
  if tg_op = 'INSERT' or new.role is distinct from old.role then
    insert into public.membership_roles (membership_id, role)
    values (new.id, new.role)
    on conflict (membership_id, role) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.sync_primary_membership_role()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
create trigger memberships_sync_primary_role
after insert or update of role on public.memberships
for each row execute function public.sync_primary_membership_role();

create function public.protect_primary_membership_role() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if exists (
    select 1 from public.memberships membership
    where membership.id = old.membership_id and membership.role = old.role
  ) then
    raise exception using errcode = '23514',
      message = 'MEMBERSHIP_PRIMARY_ROLE_REQUIRED: change the primary role before removing it';
  end if;
  return old;
end $$;
revoke all on function public.protect_primary_membership_role()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
create trigger membership_roles_keep_primary
before delete on public.membership_roles
for each row execute function public.protect_primary_membership_role();

-- ---------------------------------------------------------------------------
-- 3 and 4 together: every role a member holds fits the organization's side.
-- ---------------------------------------------------------------------------
create function private.assert_role_fits_side(
  candidate_organization uuid, candidate_role text
) returns void language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare organization_side text;
begin
  select side into organization_side from public.organizations
  where id = candidate_organization;
  if not exists (
    select 1 from public.organization_side_roles allowed
    where allowed.side = organization_side and allowed.role = candidate_role
  ) then
    raise exception using errcode = '23514',
      message = format('ROLE_NOT_ALLOWED_ON_SIDE: %s cannot be held in a %s organization',
        candidate_role, coalesce(organization_side, 'unknown'));
  end if;
end $$;
revoke all on function private.assert_role_fits_side(uuid, text)
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

create function public.guard_membership_role_side() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_table_name = 'memberships' then
    perform private.assert_role_fits_side(new.organization_id, new.role);
  else
    perform private.assert_role_fits_side(
      (select organization_id from public.memberships where id = new.membership_id),
      new.role);
  end if;
  return new;
end $$;
revoke all on function public.guard_membership_role_side()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
create trigger memberships_role_fits_side
before insert or update of role, organization_id on public.memberships
for each row execute function public.guard_membership_role_side();
create trigger membership_roles_role_fits_side
before insert or update of role, membership_id on public.membership_roles
for each row execute function public.guard_membership_role_side();

create function public.guard_organization_side_change() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare held record;
begin
  if new.side is distinct from old.side then
    for held in
      select granted.role from public.membership_roles granted
      join public.memberships membership on membership.id = granted.membership_id
      where membership.organization_id = new.id
    loop
      if not exists (
        select 1 from public.organization_side_roles allowed
        where allowed.side = new.side and allowed.role = held.role
      ) then
        raise exception using errcode = '23514',
          message = format('ROLE_NOT_ALLOWED_ON_SIDE: a member holds %s, which a %s organization cannot hold',
            held.role, new.side);
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.guard_organization_side_change()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
create trigger organizations_side_fits_members
before update of side on public.organizations
for each row execute function public.guard_organization_side_change();

-- ---------------------------------------------------------------------------
-- 2. Stored-membership permission checks.
-- ---------------------------------------------------------------------------
create function public.member_has_permission(
  candidate_user uuid, candidate text, candidate_organization uuid default null
) returns boolean language sql stable security definer
set search_path = pg_catalog, public as $$
  select exists (
    select 1
    from public.memberships membership
    join public.organizations organization on organization.id = membership.organization_id
    join public.membership_roles granted on granted.membership_id = membership.id
    join public.role_permissions grant_row
      on grant_row.role = granted.role and grant_row.permission = candidate
    where membership.user_id = candidate_user
      and (candidate_organization is null
        or membership.organization_id = candidate_organization)
      and not exists (
        select 1 from public.organization_side_withheld_permissions withheld
        where withheld.side = organization.side and withheld.permission = candidate
      )
  )
$$;
revoke all on function public.member_has_permission(uuid, text, uuid) from public;
grant execute on function public.member_has_permission(uuid, text, uuid)
  to clockwork_runtime, clockwork_service;
comment on function public.member_has_permission(uuid, text, uuid) is
  'Whether a person''s stored memberships (in one organization, when given) confer a permission, across every role they hold, less what the organization''s side withholds.';

-- ---------------------------------------------------------------------------
-- 5. Notices to the other commerce administrators.
-- ---------------------------------------------------------------------------
create table public.staff_notices (
  id uuid primary key default uuid_v7(),
  recipient_user_id uuid not null references public.commerce_users(id),
  audit_event_id uuid not null references public.audit_events(id),
  event_type text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint staff_notices_recipient_event_unique unique (recipient_user_id, audit_event_id)
);
create index staff_notices_unread_idx
  on public.staff_notices (recipient_user_id, created_at desc) where read_at is null;
comment on table public.staff_notices is
  'In-app notices on the owner console: one row per other commerce administrator for every staff access change.';

alter table public.staff_notices enable row level security;
alter table public.staff_notices force row level security;
revoke all on public.staff_notices
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select on public.staff_notices to clockwork_service;
grant update (read_at) on public.staff_notices to clockwork_service;
create policy staff_notices_service on public.staff_notices
  for all to clockwork_service using (true) with check (true);

-- Event types that notify. Written as audit events by the staff-team commands
-- on the service pool, in the change's own transaction, so a notice exists
-- exactly when the change does. Staff events concern a membership and no
-- account, and the tenant pool may not write them at all (policy below), so
-- nobody can forge a notice from a tenant session.
create function public.notify_commerce_admins() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.account_id is null and new.aggregate_type = 'membership'
    and new.event_type in (
      'staff.invited', 'staff.reactivated', 'staff.deactivated',
      'staff.role_changed', 'staff.role_granted', 'staff.role_revoked'
    ) then
    insert into public.staff_notices (recipient_user_id, audit_event_id, event_type)
    select staff.id, new.id, new.event_type
    from public.commerce_users staff
    where staff.is_internal_staff
      and public.member_has_permission(staff.id, 'staff:manage')
      and staff.id::text is distinct from new.actor->>'id'
    on conflict (recipient_user_id, audit_event_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.notify_commerce_admins()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
create trigger audit_events_notify_commerce_admins
after insert on public.audit_events
for each row execute function public.notify_commerce_admins();

-- Staff events come only from the service pool. A restriction on a fact about
-- the row, so it is monotone: no grant can widen or narrow it.
create policy audit_events_staff_events_service_only
on public.audit_events as restrictive for insert to clockwork_runtime
with check (event_type not like 'staff.%');
