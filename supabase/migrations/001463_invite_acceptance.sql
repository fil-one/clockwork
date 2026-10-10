-- Accepting an invitation. An invite becomes a membership once: the person
-- who accepted it is recorded beside the time, an accepted invite never
-- changes again, and an expired or revoked one cannot be accepted or revived.
-- Who sent it is kept for the organization page. Every acceptance is audited
-- as `invite.accepted` by the application in the same transaction.
--
-- The constraint is NOT VALID (ADR 0009): it holds for every write from now
-- on without scanning rows written before it.
set lock_timeout = '5s';

alter table public.invites
  add column if not exists accepted_by uuid references public.commerce_users(id);

alter table public.invites
  add column if not exists invited_by uuid references public.commerce_users(id);

comment on column public.invites.accepted_by is
  'The commerce user whose membership this invite became. Set with accepted_at, once.';

comment on column public.invites.invited_by is
  'The commerce user who sent the invite: an organization administrator or Fil One operations.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invites'::regclass
      and conname = 'invites_acceptance_pair_check'
  ) then
    alter table public.invites
      add constraint invites_acceptance_pair_check
      check ((accepted_at is null) = (accepted_by is null)) not valid;
  end if;
end $$;

-- No invite is created already accepted. Once accepted it never changes, an
-- expired one cannot be accepted, and accepting changes nothing else.
create or replace function public.guard_invite_acceptance() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.accepted_at is not null or new.accepted_by is not null then
      raise exception using errcode = 'P0001', message = 'INVITE_ACCEPTED_ON_INSERT';
    end if;
    return new;
  end if;
  if old.accepted_at is not null then
    raise exception using errcode = 'P0001', message = 'INVITE_ALREADY_ACCEPTED';
  end if;
  -- An expired or revoked invite stays ended: its link is never revived by
  -- moving the expiry forward. A new invite replaces it.
  if old.expires_at <= now() and new.expires_at > old.expires_at then
    raise exception using errcode = 'P0001', message = 'INVITE_EXPIRED';
  end if;
  if new.accepted_at is not null then
    if old.expires_at <= now() then
      raise exception using errcode = 'P0001', message = 'INVITE_EXPIRED';
    end if;
    if new.organization_id <> old.organization_id or new.email <> old.email
       or new.role <> old.role or new.token_hash <> old.token_hash
       or new.expires_at <> old.expires_at
       or new.invited_by is distinct from old.invited_by then
      raise exception using errcode = 'P0001', message = 'INVITE_ACCEPTANCE_CHANGES_INVITE';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.guard_invite_acceptance() from public;

drop trigger if exists guard_invite_acceptance on public.invites;

create trigger guard_invite_acceptance
  before insert or update on public.invites
  for each row execute function public.guard_invite_acceptance();

-- A tenant administrator (the runtime pool, under guard_u_invites_4a46687a)
-- may extend or end a pending invite and record its acceptance, never
-- re-address it, change its role or swap its token. Row policies cannot
-- compare old and new values, so the narrowing is a column grant.
revoke update on public.invites from clockwork_runtime;

grant update (expires_at, accepted_at, accepted_by, updated_at, row_version)
  on public.invites to clockwork_runtime;

reset lock_timeout;
