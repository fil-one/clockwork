-- Permissions are the enforcement currency in the database.
--
-- 1. Signed claims carry `permissions`, computed by the application from the
--    person's roles (union of the role bundles, less what the organization's
--    side withholds, less the approver permissions inside an assisted
--    session). `app_has_permission` and `app_has_any_permission` test them. A
--    claim without the key (an older signer, a test fixture) answers from its
--    roles through the generated role_permissions table (001445), so the two
--    shapes can never disagree about a bundle.
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
--    whenever a staff member's access changes or a request is approved by the
--    person who raised it.

-- ---------------------------------------------------------------------------
-- 1. Permission checks on the signed claim.
-- ---------------------------------------------------------------------------
create function public.app_has_permission(candidate text) returns boolean
language sql stable set search_path = public as $$
  select app_is_internal() or (
    app_context_is_valid() and (
      case
        when jsonb_typeof(app_context_claims()->'permissions') = 'array'
          then app_context_claims()->'permissions' ? candidate
        else exists (
          select 1 from public.role_permissions grant_row
          where grant_row.permission = candidate
            and app_context_claims()->'roles' ? grant_row.role
        )
      end
    )
  )
$$;
revoke all on function public.app_has_permission(text) from public;
grant execute on function public.app_has_permission(text)
  to clockwork_runtime, clockwork_service;
comment on function public.app_has_permission(text) is
  'True on the service pool, or when the signed claim carries the permission. A claim without a permissions array answers from its roles through role_permissions.';

create function public.app_has_any_permission(candidates text[]) returns boolean
language sql stable set search_path = public as $$
  select app_is_internal() or (
    app_context_is_valid() and (
      case
        when jsonb_typeof(app_context_claims()->'permissions') = 'array'
          then app_context_claims()->'permissions' ?| candidates
        else exists (
          select 1 from public.role_permissions grant_row
          where grant_row.permission = any(candidates)
            and app_context_claims()->'roles' ? grant_row.role
        )
      end
    )
  )
$$;
revoke all on function public.app_has_any_permission(text[]) from public;
grant execute on function public.app_has_any_permission(text[])
  to clockwork_runtime, clockwork_service;

-- ---------------------------------------------------------------------------
-- 3. Organization sides.
-- ---------------------------------------------------------------------------
alter table public.organizations add column side text;

-- The side an organization would be given from its account alone, for an
-- organization with no members yet. Fil One's own organization is never
-- inferred from account data: it is named explicitly (the backfill below, the
-- production bootstrap, the seed).
create function private.organization_side_from_account(candidate_account uuid)
returns text language sql stable security definer
set search_path = pg_catalog, public as $$
  select case
    when 'partner' = any(account.relationship_roles)
      and not ('direct_client' = any(account.relationship_roles))
      then case
        -- A partner account with no agreement type is treated as a referral
        -- partner, as the finance chain already treats it.
        when coalesce(account.partner_agreement_type, 'referral') = 'referral'
          then 'referral_partner'
        else 'channel_partner'
      end
    else 'customer'
  end
  from public.accounts account where account.id = candidate_account
$$;
revoke all on function private.organization_side_from_account(uuid)
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

-- Backfill rule, applied in this order:
--   a. members holding an internal role                    -> fil_one
--   b. no members, and one of the two Fil One staff
--      organizations by identity-provider binding (001440) -> fil_one
--   c. members holding a partner role                      -> referral_partner
--      when the account's partner agreement type is referral or unset,
--      otherwise channel_partner
--   d. members holding a customer role                     -> customer
--   e. no members                                          -> from the account:
--      a partner account (and not also a direct client) by agreement type as
--      in c, otherwise customer
-- An organization whose members span two of a, c and d is a data error a
-- person must resolve; the migration stops and names how many there are.
do $$
declare
  conflicts integer;
  summary text;
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
  select count(*) into conflicts from member_kinds
  where has_internal::int + has_partner::int + has_customer::int > 1;
  if conflicts > 0 then
    raise exception using errcode = '23514',
      message = format('ORGANIZATION_SIDE_CONFLICT: %s organizations have members on more than one side; split them before this migration', conflicts);
  end if;

  with member_kinds as (
    select membership.organization_id,
      bool_or(membership.role in ('internal_operator','finance_approver','legal_approver',
        'destructive_action_approver','revenue','commerce_admin')) as has_internal,
      bool_or(membership.role in ('partner_admin','partner_seller')) as has_partner
    from public.memberships membership
    group by membership.organization_id
  )
  update public.organizations organization
  set side = case
    when kinds.has_internal then 'fil_one'
    when kinds.organization_id is null and organization.workos_organization_id in (
      'org_01M21Q2N3ER4KWVJ30VRN8G0PV', -- staging
      'org_01M21RDQDM5NHYD4CEHWJZFG3J'  -- production
    ) then 'fil_one'
    when kinds.has_partner then
      case when coalesce(account.partner_agreement_type, 'referral') = 'referral'
        then 'referral_partner' else 'channel_partner' end
    when kinds.organization_id is not null then 'customer'
    else private.organization_side_from_account(organization.account_id)
  end
  from public.accounts account
  left join member_kinds kinds on true
  where account.id = organization.account_id
    and (kinds.organization_id = organization.id or kinds.organization_id is null)
    and organization.side is null;

  select string_agg(format('%s=%s', side, total), ', ' order by side) into summary
  from (select side, count(*) as total from public.organizations group by side) counted;
  raise notice 'organization sides after backfill: %', coalesce(summary, 'none');
end $$;

-- The left join above pairs every organization with every member_kinds row or
-- with the null row; the update must have set every side exactly once.
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
create function public.default_organization_side() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.side is null then
    new.side := private.organization_side_from_account(new.account_id);
  end if;
  return new;
end $$;
revoke all on function public.default_organization_side()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
create trigger organizations_default_side
before insert on public.organizations
for each row execute function public.default_organization_side();

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
  'In-app notices on the owner console: one row per other commerce administrator for every staff access change and every self-approval.';

alter table public.staff_notices enable row level security;
alter table public.staff_notices force row level security;
revoke all on public.staff_notices
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select on public.staff_notices to clockwork_service;
grant update (read_at) on public.staff_notices to clockwork_service;
create policy staff_notices_service on public.staff_notices
  for all to clockwork_service using (true) with check (true);

-- Event types that notify. Written as audit events by whichever command made
-- the change, in its own transaction, so a notice exists exactly when the
-- change does.
create function public.notify_commerce_admins() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.event_type in (
    'approval.self_approved',
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
