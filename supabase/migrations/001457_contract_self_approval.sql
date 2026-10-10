-- Self-approval on template contract approval.
--
-- A template contract that needs approval was approved only by someone other
-- than the person who prepared it (001443). A person holding `approval:self`
-- may now approve a contract they prepared, on the same terms as the other
-- two-person controls (001449):
--   * a reason of 8 to 500 characters and a `self_approved` marker on the
--     signing row;
--   * stored memberships that confer `approval:self`, internal staff and MFA
--     enrolment (member_can_self_approve); the application checks the session
--     too;
--   * service pool only;
--   * one `approval.self_approved` audit event (control `contract_approval`)
--     in the decision's own transaction, which notifies every other
--     `staff:manage` holder on the owner console.
--
-- Everyone else keeps the rule that the preparer cannot approve. Rejection
-- and sending are unchanged: a self-approved contract is `approved`, which
-- is what sending already requires.

-- The table changes below take short exclusive locks on a live table; fail
-- fast rather than queue behind a long transaction (ADR 0009).
set lock_timeout = '5s';

alter table public.commerce_contract_signing
  add column if not exists self_approved boolean not null default false;

alter table public.commerce_contract_signing
  add column if not exists self_approval_reason text;

comment on column public.commerce_contract_signing.self_approved is
  'The preparer approved their own contract under approval:self. The reason and an approval.self_approved audit event go with it.';

-- The replacement is added before the unnamed 001443 constraint is dropped,
-- so the table is never without a two-person rule. Both are guarded so a run
-- that timed out resumes.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.commerce_contract_signing'::regclass
      and conname = 'commerce_contract_signing_two_person_check'
  ) then
    alter table public.commerce_contract_signing
      add constraint commerce_contract_signing_two_person_check check (
        approver_id is null or approver_id <> preparer_id or self_approved
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.commerce_contract_signing'::regclass
      and conname = 'commerce_contract_signing_self_approval_check'
  ) then
    alter table public.commerce_contract_signing
      add constraint commerce_contract_signing_self_approval_check check (
        (not self_approved and self_approval_reason is null)
        or (self_approved and approval_state = 'approved'
          and approver_id = preparer_id
          and length(trim(self_approval_reason)) between 8 and 500)
      );
  end if;
end $$;

-- 001443 left the two-person check unnamed; find it by its definition.
do $$
declare
  unnamed name;
begin
  for unnamed in
    select conname from pg_constraint
    where conrelid = 'public.commerce_contract_signing'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid)
        = 'CHECK (((approver_id IS NULL) OR (approver_id <> preparer_id)))'
  loop
    execute format(
      'alter table public.commerce_contract_signing drop constraint %I', unnamed);
  end loop;
end $$;

-- A definition that did not match above would leave the old rule in force,
-- refusing every self-approval. Fail here instead of at first use.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.commerce_contract_signing'::regclass
      and contype = 'c'
      and conname <> 'commerce_contract_signing_two_person_check'
      and pg_get_constraintdef(oid) like '%approver_id <> preparer_id%'
  ) then
    raise exception 'commerce_contract_signing still has a check forbidding the preparer as approver';
  end if;
end $$;

-- Records the self-approval when the pending decision is made, and keeps it
-- fixed afterwards. 001443 already makes every decision final.
create or replace function public.guard_contract_self_approval() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' then
    perform private.assert_self_approval_unchanged(
      old.self_approved, new.self_approved,
      old.self_approval_reason, new.self_approval_reason);
  end if;
  if new.self_approved and (tg_op = 'INSERT' or not old.self_approved) then
    if tg_op = 'INSERT' or old.approval_state <> 'pending' then
      raise exception using errcode = '55000',
        message = 'SELF_APPROVAL_IMMUTABLE: only the decision itself may be self-approved';
    end if;
    perform private.record_self_approval(
      'contract_approval', 'contract', new.contract_id, new.approver_id,
      new.self_approval_reason, new.approval_state);
  end if;
  return new;
end $$;
revoke all on function public.guard_contract_self_approval()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

drop trigger if exists commerce_contract_signing_self_approval_guard
  on public.commerce_contract_signing;

create trigger commerce_contract_signing_self_approval_guard
before insert or update on public.commerce_contract_signing
for each row execute function public.guard_contract_self_approval();

reset lock_timeout;
