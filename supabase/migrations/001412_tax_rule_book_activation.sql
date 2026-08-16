-- ACTIVATION: the append-only record, and the two-person control that has to
-- pass before a jurisdiction's rates become the rates this platform charges.
--
-- The event table copies core_price_book_activation_events (000100:68-75)
-- column for column, plus the two provenance columns section 3 needs, because
-- signing a jurisdiction is an activation-class decision on the same object and
-- splitting it into a second timeline would leave neither one complete.
create table core_tax_rule_book_activation_events (
  id uuid primary key default uuid_v7(),
  tax_rule_book_id uuid not null references core_tax_rule_books(id),
  action text not null check (action in (
    'activate','retire','schedule','cancel_schedule','sign','withdraw_signature'
  )),
  previous_status text,
  resulting_status text not null,
  previous_provenance text,
  resulting_provenance text,
  effective_at timestamptz not null,
  actor_user_id uuid not null references commerce_users(id),
  reason text not null check (length(trim(reason)) > 0),
  request_id text not null check (length(trim(request_id)) > 0),
  created_at timestamptz not null default now(),
  -- A signature decision that does not say what the provenance became is not a
  -- record of the decision.
  constraint core_tax_activation_signature_check check (
    action not in ('sign','withdraw_signature')
    or (previous_provenance is not null and resulting_provenance is not null)
  )
);
create index core_tax_activation_timeline_idx
  on core_tax_rule_book_activation_events(tax_rule_book_id, effective_at);

create trigger core_tax_rule_book_activation_events_immutable
before update or delete on core_tax_rule_book_activation_events
for each row execute function deny_immutable_mutation();

comment on table public.core_tax_rule_book_activation_events is
  'Append-only record of every tax rule book activation, retirement, schedule, and signature change, with the deciding user and reason. Two more actions than the price book''s, because provenance is a decision this object has and that one does not.';

-- TWO-PERSON ACTIVATION, ENFORCED IN THE DATABASE.
--
-- Verified before writing, and this is a deliberate departure from the
-- precedent rather than a copy of it: the price book's two-person rule lives
-- ONLY in TypeScript (packages/db/src/repositories/core/database-finance.ts:
-- 5261-5333 requests an approval and refuses a self-approval), and the database
-- accepts a bare `update price_books set status = 'active'` from any writer —
-- supabase/tests/1360_price_book_activation.test.sql:26 does exactly that and
-- passes. A control that exists in one caller is not a control; a second
-- writer, a migration or a console session bypasses it, and a pgTAP test can
-- prove nothing about a rule that is not in the database.
--
-- So the rule is here. `approvals` already carries the separation of duties as
-- a CHECK — approvals_two_person_check (000001:136) forbids approved_by =
-- requested_by, and approvals_decision_check (000001:950) forbids a decided
-- approval with no approver — so this trigger reuses those rather than
-- re-deriving them, and only requires that such an approval exists for THIS
-- book.
create or replace function protect_tax_rule_book_activation() returns trigger
language plpgsql set search_path = public as $$
begin
  -- A book that begins life active never passed through the approval it was
  -- supposed to need. Insert-as-published is the hole the update path would
  -- otherwise leave wide open, so every book starts as a draft.
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception using errcode = '23514',
        message = 'a tax rule book is created as a draft and activated through approval';
    end if;
    return new;
  end if;
  -- 'retired' is checked alongside 'active' and that is not defensive padding.
  -- A retired book still ANSWERS: 001413 resolves over ('active','retired') so
  -- that a back-dated tax point gets the rates that were in force. Publishing
  -- straight to 'retired' would therefore put live answers into the resolver
  -- having passed no approval at all, which is the whole control, bypassed by
  -- picking a different target status.
  if old.status = 'draft' and new.status in ('active','retired') then
    if not exists (
      select 1
      from public.approvals approval
      where approval.action = 'tax_rule_book_activation'
        and approval.object_type = 'tax_rule_book'
        and approval.object_id = new.id
        and approval.status = 'approved'
        and approval.approved_by is not null
        and approval.approved_by <> approval.requested_by
    ) then
      raise exception using errcode = '55000',
        message = 'publishing a tax rule book requires an approval from a second person';
    end if;
    -- A jurisdiction with no rates is a book that determines nothing, and
    -- activating it would answer a determination with silence rather than with
    -- a refusal. A jurisdiction that genuinely charges nothing says so with a
    -- zero-rate row and its legal basis.
    if not exists (
      select 1 from public.core_tax_rates rate where rate.tax_rule_book_id = new.id
    ) then
      raise exception using errcode = '23514',
        message = 'a tax rule book with no rates cannot be published';
    end if;
  end if;
  return new;
end $$;
create trigger core_tax_rule_books_activation_control
before insert or update on core_tax_rule_books
for each row execute function protect_tax_rule_book_activation();

comment on function public.protect_tax_rule_book_activation() is
  'Database-side two-person control on tax rule book activation. Unlike the price book''s, which lives only in the repository layer, this one holds against every writer.';

alter table core_tax_rule_book_activation_events enable row level security;
alter table core_tax_rule_book_activation_events force row level security;

create policy core_tax_activation_read on core_tax_rule_book_activation_events
for select using (
  app_is_internal()
  or exists (
    select 1 from core_tax_rule_books book
    where book.id = tax_rule_book_id and book.status in ('active','retired')
  )
);
create policy core_tax_activation_write on core_tax_rule_book_activation_events
for all using (app_is_internal()) with check (app_is_internal());
create policy core_tax_activation_finance_read on core_tax_rule_book_activation_events
for select to clockwork_runtime
using (app_has_any_role(array['finance_approver']));

grant select, insert, update, delete on core_tax_rule_book_activation_events
  to clockwork_runtime, clockwork_service;
revoke insert, update, delete on core_tax_rule_book_activation_events
  from clockwork_runtime;
