-- Self-approval on the two-person controls.
--
-- A person holding `approval:self` (the commerce administrator, 001448) may
-- decide their own request on every two-person control: price book
-- activation and schedules, tax rule book activation, capability switches,
-- channel policy, PAYG offers, exception decisions (below-floor pricing
-- included), terminations and teardown. Everyone else keeps the
-- distinct-approver rule exactly as before.
--
-- Every self-approval:
--   * carries a reason of 8 to 500 characters and a `self_approved` marker
--     on the row that stores the decision;
--   * is made by a person whose STORED memberships confer `approval:self`,
--     who is internal staff and enrolled in MFA (member_can_self_approve);
--     the application checks the session too (MFA verified, own session: an
--     assisted session never carries `approval:self`);
--   * is written on the service pool only; the tenant pool can neither mark
--     a decision self-approved nor write the audit event;
--   * writes one `approval.self_approved` audit event (control, subject,
--     reason, actor) in the decision's own transaction, which notifies every
--     other `staff:manage` holder on the owner console.
--
-- The event is written here, by the trigger that accepts the marker, so no
-- writer can record a self-approval without its audit event and notices.
--
-- Production bootstrap and MNDA countersigner distinctness are not approval
-- controls and are unchanged.

-- The table changes below take short exclusive locks on live decision tables;
-- fail fast rather than queue behind a long transaction.
set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Who may approve their own request, from stored state.
-- ---------------------------------------------------------------------------
create function public.member_can_self_approve(candidate_user uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.commerce_users staff
    where staff.id = candidate_user
      and staff.is_internal_staff
      and staff.mfa_enrolled
  ) and public.member_has_permission(candidate_user, 'approval:self')
$$;
revoke all on function public.member_can_self_approve(uuid) from public;
grant execute on function public.member_can_self_approve(uuid)
  to clockwork_runtime, clockwork_service;
comment on function public.member_can_self_approve(uuid) is
  'Whether a person may decide their own two-person request: internal staff, enrolled in MFA, and stored memberships that confer approval:self.';

-- ---------------------------------------------------------------------------
-- 2. The one place a self-approval is accepted and recorded.
-- ---------------------------------------------------------------------------
-- Called by the row triggers below (which run as their owner) when a decision
-- row is marked self-approved. Refuses the tenant pool, a reason outside 8 to
-- 500 characters, and anyone without approval:self in their stored
-- memberships. Writes the audit event (account-less, so it notifies) and its
-- outbox row.
create function private.record_self_approval(
  control text,
  subject_type text,
  subject_id uuid,
  actor_user uuid,
  reason text,
  decision text
) returns uuid language plpgsql
set search_path = pg_catalog, public as $$
declare
  event_id uuid := public.uuid_v7();
  aggregate uuid := public.uuid_v7();
  request text := coalesce(nullif(current_setting('app.request_id', true), ''),
    'self-approval:' || subject_id::text);
  payload jsonb;
begin
  -- The triggers run as their owner, so current_user is not the caller; the
  -- tenant pool always enters through `set local role clockwork_runtime`
  -- (packages/db/src/transaction.ts), which the role setting still shows.
  if current_setting('role', true) = 'clockwork_runtime'
    or session_user = 'clockwork_runtime' then
    raise exception using errcode = '42501',
      message = 'SELF_APPROVAL_SERVICE_ONLY: a self-approval is recorded on the service pool only';
  end if;
  if reason is null or length(trim(reason)) < 8 or length(trim(reason)) > 500 then
    raise exception using errcode = '23514',
      message = 'SELF_APPROVAL_REASON_REQUIRED: a self-approval needs a reason of 8 to 500 characters';
  end if;
  if actor_user is null or not public.member_can_self_approve(actor_user) then
    raise exception using errcode = '42501',
      message = 'SELF_APPROVAL_NOT_PERMITTED: only a holder of approval:self may approve their own request';
  end if;
  payload := jsonb_build_object(
    'control', control,
    'subjectType', subject_type,
    'subjectId', subject_id,
    'decision', decision,
    'reason', trim(reason),
    'approverId', actor_user
  );
  insert into public.audit_events (
    id, account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id, before, after,
    metadata
  ) values (
    event_id, null, 'self_approval', aggregate, 1,
    'approval.self_approved', 1,
    jsonb_build_object('kind', 'user', 'id', actor_user::text),
    now(), request, null, payload,
    jsonb_build_object('control', control)
  );
  insert into public.outbox_messages (id, event_id, topic, payload)
  values (public.uuid_v7(), event_id, 'approval.self_approved', jsonb_build_object(
    'eventId', event_id,
    'eventType', 'approval.self_approved',
    'aggregateType', 'self_approval',
    'aggregateId', aggregate,
    'aggregateVersion', 1,
    'occurredAt', now(),
    'requestId', request,
    'actor', jsonb_build_object('kind', 'user', 'id', actor_user::text),
    'data', payload
  ));
  return event_id;
end $$;
revoke all on function private.record_self_approval(text, text, uuid, uuid, text, text)
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

-- A self-approval marker is set once, by the decision itself, and never
-- changes afterwards.
create function private.assert_self_approval_unchanged(
  was_self_approved boolean, is_self_approved boolean,
  old_reason text, new_reason text
) returns void language plpgsql immutable
set search_path = pg_catalog, public as $$
begin
  if was_self_approved and (
    is_self_approved is distinct from was_self_approved
    or new_reason is distinct from old_reason
  ) then
    raise exception using errcode = '55000',
      message = 'SELF_APPROVAL_IMMUTABLE: a recorded self-approval cannot change';
  end if;
end $$;
revoke all on function private.assert_self_approval_unchanged(boolean, boolean, text, text)
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

-- ---------------------------------------------------------------------------
-- 3. approvals: price book activation and schedules, tax rule book
--    activation, termination teardown.
-- ---------------------------------------------------------------------------
alter table public.approvals
  add column self_approved boolean not null default false,
  add column self_approval_reason text;
alter table public.approvals drop constraint approvals_two_person_check;
alter table public.approvals add constraint approvals_two_person_check check (
  approved_by is null or approved_by <> requested_by or self_approved
);
alter table public.approvals add constraint approvals_self_approval_check check (
  (not self_approved and self_approval_reason is null)
  or (self_approved and approved_by = requested_by and status = 'approved'
    and length(trim(self_approval_reason)) between 8 and 500)
);
comment on column public.approvals.self_approved is
  'The requester decided their own request under approval:self. The reason and an approval.self_approved audit event go with it.';

create function public.guard_approval_self_approval() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' then
    perform private.assert_self_approval_unchanged(
      old.self_approved, new.self_approved,
      old.self_approval_reason, new.self_approval_reason);
    -- A self-approved decision is the record the audit event points at: it
    -- cannot be relabelled to another decision, person or subject.
    if old.self_approved and (
      (new.status, new.requested_by, new.approved_by, new.action,
       new.object_type, new.object_id, new.decided_at)
      is distinct from
      (old.status, old.requested_by, old.approved_by, old.action,
       old.object_type, old.object_id, old.decided_at)
    ) then
      raise exception using errcode = '55000',
        message = 'SELF_APPROVAL_IMMUTABLE: a self-approved decision cannot change';
    end if;
  end if;
  if new.self_approved and (tg_op = 'INSERT' or not old.self_approved) then
    if tg_op = 'UPDATE' and old.status <> 'pending' then
      raise exception using errcode = '55000',
        message = 'SELF_APPROVAL_IMMUTABLE: only the decision itself may be self-approved';
    end if;
    perform private.record_self_approval(
      new.action, new.object_type, new.object_id, new.approved_by,
      new.self_approval_reason, new.status);
  end if;
  return new;
end $$;
revoke all on function public.guard_approval_self_approval()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
create trigger approvals_self_approval_guard
before insert or update on public.approvals
for each row execute function public.guard_approval_self_approval();

-- Tax rule book activation (001412): the approval of record is either a
-- second person's or a self-approval whose approver still holds the right.
create or replace function public.protect_tax_rule_book_activation() returns trigger
language plpgsql set search_path = public as $$
begin
  -- A book that begins life active never passed through the approval it was
  -- supposed to need, so every book starts as a draft.
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception using errcode = '23514',
        message = 'a tax rule book is created as a draft and activated through approval';
    end if;
    return new;
  end if;
  -- 'retired' is checked alongside 'active': a retired book still answers
  -- back-dated determinations (001413).
  if old.status = 'draft' and new.status in ('active','retired') then
    if not exists (
      select 1
      from public.approvals approval
      where approval.action = 'tax_rule_book_activation'
        and approval.object_type = 'tax_rule_book'
        and approval.object_id = new.id
        and approval.status = 'approved'
        and approval.approved_by is not null
        and (
          approval.approved_by <> approval.requested_by
          or (approval.self_approved
            and public.member_can_self_approve(approval.approved_by))
        )
    ) then
      raise exception using errcode = '55000',
        message = 'publishing a tax rule book requires an approval from a second person or a recorded self-approval';
    end if;
    -- A jurisdiction with no rates is a book that determines nothing.
    if not exists (
      select 1 from public.core_tax_rates rate where rate.tax_rule_book_id = new.id
    ) then
      raise exception using errcode = '23514',
        message = 'a tax rule book with no rates cannot be published';
    end if;
  end if;
  return new;
end $$;

-- Price book schedules (001435): a schedule may rest on a self-approved
-- decision as well as on a second person's.
create or replace function public.core_guard_price_schedule() returns trigger
language plpgsql set search_path=public as $$
declare book price_books; decision approvals;
begin
 if tg_op='UPDATE' then
  if old.status<>'approved' or new.status='approved' or
   (new.id,new.price_book_id,new.approval_id,new.currency,new.effective_from,new.effective_to,new.approved_row_version,new.approved_by,new.approved_at)
   is distinct from (old.id,old.price_book_id,old.approval_id,old.currency,old.effective_from,old.effective_to,old.approved_row_version,old.approved_by,old.approved_at) then
   raise exception using errcode='55000',message='approved price schedule is immutable; cancel and propose a new decision';
  end if;
  return new;
 end if;
 select * into book from price_books where id=new.price_book_id for update;
 select * into decision from approvals where id=new.approval_id for share;
 if new.status<>'approved' or book.id is null or decision.id is null or book.status<>'draft'
  or (book.currency,book.effective_from,book.effective_to,book.row_version) is distinct from (new.currency,new.effective_from,new.effective_to,new.approved_row_version)
  or decision.action<>'price_book_activation' or decision.object_id<>book.id or decision.status<>'approved'
  or decision.approved_by is distinct from new.approved_by
  or (decision.requested_by is not distinct from decision.approved_by and not decision.self_approved)
  or decision.decided_at is distinct from new.approved_at
  or new.effective_from <= (new.approved_at at time zone 'UTC')::date
  or new.approved_row_version<1 then
   raise exception using errcode='23514',message='price schedule requires the exact draft and a distinct or self-approved finance decision';
 end if;
 return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Capability switches (001423).
-- ---------------------------------------------------------------------------
alter table public.system_capability_requests
  add column self_approved boolean not null default false,
  add column self_approval_reason text;
alter table public.system_capability_requests
  drop constraint system_capability_requests_separation_check;
alter table public.system_capability_requests
  add constraint system_capability_requests_separation_check check (
    status <> 'approved' or decided_by <> requested_by or self_approved
  );
alter table public.system_capability_requests
  add constraint system_capability_requests_self_approval_check check (
    (not self_approved and self_approval_reason is null)
    or (self_approved and status = 'approved' and decided_by = requested_by
      and length(trim(self_approval_reason)) between 8 and 500)
  );

create function public.guard_capability_self_approval() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' then
    perform private.assert_self_approval_unchanged(
      old.self_approved, new.self_approved,
      old.self_approval_reason, new.self_approval_reason);
  end if;
  if new.self_approved and (tg_op = 'INSERT' or not old.self_approved) then
    perform private.record_self_approval(
      'capability_activation', 'system_capability_request', new.id,
      new.decided_by, new.self_approval_reason, new.status);
  end if;
  return new;
end $$;
revoke all on function public.guard_capability_self_approval()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
create trigger system_capability_request_self_approval_guard
before insert or update on public.system_capability_requests
for each row execute function public.guard_capability_self_approval();

-- ---------------------------------------------------------------------------
-- 5. Channel policy (001431) and PAYG offers (001424). The approver may not
--    have created, edited or proposed the version, unless they approve it as
--    their own request.
-- ---------------------------------------------------------------------------
alter table public.core_channel_policy_versions
  add column self_approved boolean not null default false,
  add column self_approval_reason text;
alter table public.core_channel_policy_versions
  drop constraint channel_policy_approval_check;
alter table public.core_channel_policy_versions
  add constraint channel_policy_approval_check check (status<>'approved' or (
    approved_by is not null and proposed_by is not null
    and approval_evidence is not null and length(trim(approval_evidence))>=8
    and (self_approved or (approved_by<>created_by and approved_by<>last_edited_by
      and approved_by<>proposed_by))
  ));
alter table public.core_channel_policy_versions
  add constraint channel_policy_self_approval_check check (
    (not self_approved and self_approval_reason is null)
    or (self_approved and status = 'approved'
      and approved_by in (created_by, last_edited_by, proposed_by)
      and length(trim(self_approval_reason)) between 8 and 500)
  );

alter table public.core_payg_offer_versions
  add column self_approved boolean not null default false,
  add column self_approval_reason text;
alter table public.core_payg_offer_versions
  drop constraint core_payg_offer_approval_check;
alter table public.core_payg_offer_versions
  add constraint core_payg_offer_approval_check check (status not in ('approved','retired') or
    (approved_by is not null and proposed_by is not null
      and approval_evidence_id is not null and length(trim(approval_evidence_id)) > 0
      and (self_approved or (approved_by <> proposed_by and approved_by <> created_by
        and approved_by <> last_edited_by))));
alter table public.core_payg_offer_versions
  add constraint core_payg_offer_self_approval_check check (
    (not self_approved and self_approval_reason is null)
    or (self_approved and status in ('approved','retired')
      and approved_by in (created_by, last_edited_by, proposed_by)
      and length(trim(self_approval_reason)) between 8 and 500)
  );

-- Shared by both version tables: the marker is set only by the approval
-- itself (proposed to approved) and is then fixed.
create function public.guard_version_self_approval() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare control text := case tg_table_name
  when 'core_channel_policy_versions' then 'channel_policy'
  else 'payg_offer' end;
begin
  if tg_op = 'UPDATE' then
    perform private.assert_self_approval_unchanged(
      old.self_approved, new.self_approved,
      old.self_approval_reason, new.self_approval_reason);
  end if;
  if new.self_approved and (tg_op = 'INSERT' or not old.self_approved) then
    if tg_op = 'INSERT' or old.status <> 'proposed' or new.status <> 'approved' then
      raise exception using errcode = '55000',
        message = 'SELF_APPROVAL_IMMUTABLE: only the approval itself may be self-approved';
    end if;
    perform private.record_self_approval(
      control, control, new.id, new.approved_by, new.self_approval_reason,
      new.status);
  end if;
  return new;
end $$;
revoke all on function public.guard_version_self_approval()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
create trigger core_channel_policy_self_approval_guard
before insert or update on public.core_channel_policy_versions
for each row execute function public.guard_version_self_approval();
create trigger core_payg_offer_self_approval_guard
before insert or update on public.core_payg_offer_versions
for each row execute function public.guard_version_self_approval();

-- ---------------------------------------------------------------------------
-- 6. Exception decisions (below-floor pricing included). Separation is
--    enforced in the application; the row records the self-approval and the
--    trigger audits it.
-- ---------------------------------------------------------------------------
alter table public.exception_cases
  add column self_approved boolean not null default false,
  add column self_approval_reason text;
alter table public.exception_cases
  add constraint exception_cases_self_approval_check check (
    (not self_approved and self_approval_reason is null)
    or (self_approved and status = 'approved' and requester_user_id is not null
      and length(trim(self_approval_reason)) between 8 and 500)
  );

create function public.guard_exception_self_approval() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' then
    perform private.assert_self_approval_unchanged(
      old.self_approved, new.self_approved,
      old.self_approval_reason, new.self_approval_reason);
    -- The self-approver is the requester; once recorded, neither moves.
    if old.self_approved and (
      new.requester_user_id is distinct from old.requester_user_id
      or new.status is distinct from old.status
    ) then
      raise exception using errcode = '55000',
        message = 'SELF_APPROVAL_IMMUTABLE: a self-approved case cannot change hands';
    end if;
  end if;
  if new.self_approved and (tg_op = 'INSERT' or not old.self_approved) then
    if tg_op = 'INSERT' or old.status <> 'open' then
      raise exception using errcode = '55000',
        message = 'SELF_APPROVAL_IMMUTABLE: only the decision itself may be self-approved';
    end if;
    perform private.record_self_approval(
      'exception_case', 'exception_case', new.id, new.requester_user_id,
      new.self_approval_reason, new.status);
  end if;
  return new;
end $$;
revoke all on function public.guard_exception_self_approval()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
create trigger exception_cases_self_approval_guard
before insert or update on public.exception_cases
for each row execute function public.guard_exception_self_approval();

-- ---------------------------------------------------------------------------
-- 7. Terminations and teardown (001000). Two approvals, neither the
--    requester's and from distinct people, or self-approvals: the requester,
--    holding approval:self, fills every remaining approver slot at once with
--    entries marked `selfApproved` that name a self-approved durable approval
--    row. Before final billing settles a self-approval fills one slot, as a
--    first ordinary approval does, and the requester or a second person fills
--    the other later. Teardown is requested only while the self-approver
--    still holds approval:self.
-- ---------------------------------------------------------------------------
create or replace function public.core_validate_offboarding_plan_transition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  approval_count integer;
  old_approval_count integer;
  appended integer;
  appended_entry jsonb;
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
  approval_count := jsonb_array_length(new.plan -> 'approvals');
  -- Approvals by other people are distinct and never the requester's. The
  -- requester's own entries are self-approvals: marked, approved, naming a
  -- durable self-approved approval, and at most the two slots.
  if (
    select count(*) <> count(distinct approval ->> 'approverId')
    from jsonb_array_elements(new.plan -> 'approvals') approval
    where approval ->> 'approverId' is distinct from new.requested_by::text
  ) or exists (
    select 1 from jsonb_array_elements(new.plan -> 'approvals') approval
    where (approval ->> 'approverId' = new.requested_by::text)
      is distinct from coalesce((approval ->> 'selfApproved')::boolean, false)
  ) or exists (
    select 1 from jsonb_array_elements(new.plan -> 'approvals') approval
    where coalesce((approval ->> 'selfApproved')::boolean, false)
      and (
        approval ->> 'decision' is distinct from 'approved'
        or not exists (
          select 1 from public.approvals durable_approval
          where durable_approval.id = nullif(approval ->> 'approvalId', '')::uuid
            and durable_approval.self_approved
            and durable_approval.approved_by = new.requested_by
        )
      )
  ) or (
    select count(*)
    from jsonb_array_elements(new.plan -> 'approvals') approval
    where coalesce((approval ->> 'selfApproved')::boolean, false)
  ) > 2 then
    raise exception using errcode = '23514', message = 'offboarding requires distinct non-requester approvals or one recorded self-approval';
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
      -- A self-approval fills both slots at once, so it passes through
      -- pending approval in the same step.
      or old.plan ->> 'status' in (
          'pending_final_billing','retrieval_window','retention_blocked'
        )
        and new.plan ->> 'status' in ('ready_for_teardown','teardown_requested')
        and exists (
          select 1 from jsonb_array_elements(new.plan -> 'approvals')
            with ordinality as entry(approval, position)
          where position > old_approval_count
            and coalesce((approval ->> 'selfApproved')::boolean, false)
        )
      or old.plan ->> 'status' = 'ready_for_teardown'
        and new.plan ->> 'status' = 'teardown_requested'
      or old.plan ->> 'status' = 'teardown_requested'
        and new.plan ->> 'status' = 'teardown_confirmed'
      or old.plan ->> 'status' = 'teardown_confirmed'
        and new.plan ->> 'status' = 'complete'
    ) then
      raise exception using errcode = '23514', message = 'invalid offboarding status transition';
    end if;
    appended := approval_count - old_approval_count;
    -- One approval per update; a self-approval may fill both slots at once.
    if appended < 0 or appended > 2 or appended = 2 and exists (
      select 1 from jsonb_array_elements(new.plan -> 'approvals')
        with ordinality as entry(approval, position)
      where position > old_approval_count
        and not coalesce((approval ->> 'selfApproved')::boolean, false)
    ) then
      raise exception using errcode = '23514', message = 'offboarding update may append at most one durable approval, or one self-approval for both slots';
    end if;
    for appended_entry in
      select approval from jsonb_array_elements(new.plan -> 'approvals')
        with ordinality as entry(approval, position)
      where position > old_approval_count
    loop
      last_approver := nullif(appended_entry ->> 'approverId', '')::uuid;
      if not exists (
        select 1
        from public.approvals durable_approval
        where durable_approval.id = (appended_entry ->> 'approvalId')::uuid
          and durable_approval.account_id = new.account_id
          and durable_approval.action = 'termination_teardown'
          and durable_approval.object_type = 'termination'
          and durable_approval.object_id = new.termination_id
          and durable_approval.requested_by = new.requested_by
          and durable_approval.approved_by = last_approver
          and durable_approval.status = appended_entry ->> 'decision'
          and durable_approval.decided_at is not null
      ) then
        raise exception using errcode = '23514', message = 'offboarding approval must match its durable approval row';
      end if;
    end loop;
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
  if new.plan ->> 'status' = 'teardown_requested'
    and new.plan ->> 'status' is distinct from (case when tg_op = 'UPDATE' then old.plan ->> 'status' end)
    and exists (
      select 1 from jsonb_array_elements(new.plan -> 'approvals') approval
      where coalesce((approval ->> 'selfApproved')::boolean, false)
    )
    and not public.member_can_self_approve(new.requested_by)
  then
    raise exception using errcode = '42501',
      message = 'TEARDOWN_SELF_APPROVAL_REVOKED: the self-approver no longer holds approval:self; obtain a new approval';
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

-- ---------------------------------------------------------------------------
-- 8. Notices and the audit trail.
-- ---------------------------------------------------------------------------
-- Every other commerce administrator hears about a self-approval, as they do
-- about a staff access change. Both kinds of event are account-less and come
-- only from the service pool.
create or replace function public.notify_commerce_admins() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.account_id is null and (
    new.aggregate_type = 'membership' and new.event_type in (
      'staff.invited', 'staff.reactivated', 'staff.deactivated',
      'staff.role_changed', 'staff.role_granted', 'staff.role_revoked'
    )
    or new.aggregate_type = 'self_approval'
      and new.event_type = 'approval.self_approved'
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

-- Self-approval events come only from the service pool. A restriction on a
-- fact about the row, so it is monotone.
create policy audit_events_self_approval_service_only
on public.audit_events as restrictive for insert to clockwork_runtime
with check (event_type <> 'approval.self_approved');

reset lock_timeout;
