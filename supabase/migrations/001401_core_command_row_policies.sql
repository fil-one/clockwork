-- Four core commands that could not execute, all reproduced against this
-- database under a real signed authorization context on the tenant pool before
-- anything here was written. Each is a row policy that tests WHO the caller is
-- where it meant to test WHAT is being written.
--
-- Two of the four are not what the sweep that found them said they were, and
-- the difference is recorded here rather than quietly corrected, because the
-- fix follows the reproduction and not the report.
--
-- ============================================================================
-- 1. `audit_events_finance_insert_guard`: a role test wearing a command test.
-- ============================================================================
--
-- The guard was RESTRICTIVE, `to clockwork_runtime`, and read
--
--     not app_has_role('finance_approver')
--     or (actor ->> 'id' = app_current_user_id()::text
--         and aggregate_type in ('invoice','credit_note','refund','dispute',
--                                'dispute_case','collection_case',
--                                'collection_action'))
--
-- Two conjuncts protecting two different things, joined by a role predicate:
--
--   * ATTRIBUTION. A finance approver may not append an audit row under
--     another user's name. That is what actually stops a forged four-eyes
--     trail, it is true of every command, and it is kept below verbatim.
--   * AN AGGREGATE ALLOWLIST. "A finance approver does nothing but finance."
--     That is false, and it is false in the direction that kills work: the
--     same human runs `reports:create` and `commissions:accrue`. Because
--     `app_has_role` fires on the CALLER, the allowlist also fires on anyone
--     who merely holds `finance_approver` alongside another role, so it takes
--     down commands the caller's OTHER role plainly authorises.
--
-- Reproduced. `commissions:accrue` over the seeded referral partner, same
-- payment, same actor, only the role differing:
--
--     roles ['internal_operator']                  -> accrual written
--     roles ['finance_approver']                   -> 42501 on audit_events
--     roles ['internal_operator','finance_approver'] -> 42501 on audit_events
--
-- The third line is the whole defect: adding an authority removed one.
-- `commission_accruals_insert_role_guard` (000900) invites exactly
-- `internal_operator` OR `finance_approver` onto that table, and this guard
-- then refused the audit row the accrual is worthless without.
--
-- The allowlist is dropped. The refused set of what remains is exactly:
--
--     { insert into audit_events, on the tenant pool, by a caller holding
--       finance_approver, whose actor.id is not the authenticated user }
--
-- which is strictly smaller than the set refused before this migration -- no
-- row admitted today is refused tomorrow -- and contains no legitimate write:
-- every tenant-pool audit append in the tree passes the acting user as the
-- actor, and `core_partner_can_append_commercial_audit` (001000) already
-- imposes the identical rule on the partner append path. System-attributed
-- appends (`stripe-adjustment-workflow`, `commercial-artifact-workflow`,
-- `lifecycle-runtime`) all run through `withInternalTransaction` as
-- `clockwork_service`, which this policy does not address at all.
--
-- ============================================================================
-- 2. `reports:create` was dead for EVERY internal caller, not only a
--    finance-approver-only one.
-- ============================================================================
--
-- Driving the real command found a second, independent blocker sitting under
-- the first, so fixing the guard alone would have left the command dead and
-- the fix would have been a declaration. A report export has no account --
-- `mutateReportExport` audits with `coreRecord("reports", row)` and no
-- account id -- so the audit row carries `account_id is null`, and the only
-- permissive INSERT policy that could admit it, `audit_events_insert`, reads
-- `app_is_internal() or app_has_account(account_id)`. On the tenant pool
-- `app_is_internal()` is false by construction and `app_has_account(null)` is
-- NULL. Measured:
--
--     reports:create as ['finance_approver']                    -> 42501
--     reports:create as ['internal_operator']                   -> 42501
--     reports:create as ['internal_operator','finance_approver'] -> 42501
--
-- The command is guarded in code to a non-impersonated internal operator or
-- finance approver acting as themselves (`mutateReportExport`), and
-- `report_exports_scope` (000001) already admits the requester's own row on
-- the tenant pool -- so the resource is deliberately tenant-pool and
-- requester-scoped, and moving the command to the service pool would erase
-- that scoping rather than honour it. What was missing is the matching audit
-- trail, added below and keyed to the persisted `report_exports` row rather
-- than to any role: the event is admitted if and only if it is the audit of a
-- report export THIS caller requested, at that row's current version.
--
-- ============================================================================
-- 3. The resale/distributor issuance split write is on the artifact request,
--    not on `core_quote_snapshots`.
-- ============================================================================
--
-- The report attributed it to `core_quote_is_visible`'s third arm admitting
-- only direct/referral/marketplace. That arm is deliberate and is left alone:
-- it is the END CLIENT arm, and a resale quote is partner-confidential. The
-- partner reaches its own quote through the SECOND arm, and measurement
-- agrees -- `core_can_access_quote` for the seeded quotes:
--
--     claims [end client 10..04] -> referral t, marketplace t, resale f, distributor f
--     claims [resale partner 10..03] -> resale t, everything else f
--     claims [distributor 10..05]    -> distributor t, everything else f
--
-- so `quotes` and `core_quote_snapshots` answer identically for every caller
-- and cannot split. The real split is one step earlier, and it is the same
-- INSERT ... RETURNING shape that broke partner quote creation:
-- `core_commercial_artifact_insert` explicitly admits a partner writing the
-- `partner_resale_quote` / `end_client` artifact request for its own quote,
-- while `core_commercial_artifact_select` admits only
-- `app_has_account(audience_account_id)` -- and that audience is the end
-- client. Reproduced as the distributor partner, same statement twice:
--
--     insert ... (no returning) -> row written
--     insert ... returning id   -> 42501
--
-- and through the command, `quotes:prepare_artifact` with audience
-- `end_client` on a distributor quote dies there, so `quotes:issue` is
-- unreachable for every resale and distributor quote. The select policy gains
-- the arm its own insert policy already granted. Refused set unchanged
-- otherwise; the newly admitted rows are exactly the artifact requests the
-- partner is already permitted to CREATE, so nothing is disclosed that the
-- partner did not author.
--
-- ============================================================================
-- 4. Collections is owner-locked, and the symptom is worse than reported.
-- ============================================================================
--
-- `invoices:evaluate_dunning` was reported to give a second approver a
-- misleading VERSION_CONFLICT. It does not. Measured against the seeded
-- overdue invoice:
--
--     approver A -> case created, owner A
--     approver A -> case updated, owner A
--     approver B -> 23505 duplicate key on core_collection_cases_invoice_id_key
--
-- because the prior case is invisible to B under BOTH select policies
-- (`core_collection_case_scope` needs the invoice's account in B's claims;
-- `core_collection_cases_finance_read` needs B to own the case), so the
-- command never reaches the update branch at all -- it takes the insert
-- branch and hits the unique constraint as a raw driver error.
--
-- Owning a collection case is a QUEUE ASSIGNMENT, not an authority. Dunning
-- evaluation is a derivation from the invoice's own aging and the account's
-- persisted billing policy; it approves nothing and moves no money, and the
-- four-eyes controls in this system live on credit notes, refunds and
-- disputes, which are untouched here. The owner lock therefore made the case a
-- private object of whoever happened to touch it first, and cover, handover
-- and escalation all failed on it.
--
-- The lock is removed from the read and update arms and KEPT on insert, so the
-- approver who opens the case still owns it, and
-- `core_protect_collection_case_identity` (001000) still makes that ownership
-- immutable -- a second approver advances the case but cannot take it. The
-- attribution requirement on `core_collection_actions` (`actor_user_id` is the
-- acting user) is kept for the same reason attribution is kept in section 1.
--
-- Refused set of the relaxed policies: a tenant-pool caller who does not hold
-- `finance_approver`, or whose case does not belong to the invoice's account.
-- Strictly smaller than before. Newly admitted: a finance approver reading and
-- advancing a collection case another finance approver opened.

-- ---------------------------------------------------------------------------
-- 1. Attribution, not an aggregate allowlist.
-- ---------------------------------------------------------------------------
drop policy if exists audit_events_finance_insert_guard on public.audit_events;
create policy audit_events_finance_insert_guard
on public.audit_events as restrictive for insert to clockwork_runtime
with check (
  not app_has_role('finance_approver')
  -- ATTRIBUTION IS UNCONDITIONAL for a finance holder. This is the conjunct
  -- that actually stops a forged four-eyes, and it is what 001000 was
  -- protecting; it must not be traded away to fix the scope defect.
  or (
    actor ->> 'id' = public.app_current_user_id()::text
    and (
      -- The tenant lane justifies itself. `audit_events_insert` (000001) is
      -- `app_is_internal() or app_has_account(account_id)` with NO actor
      -- predicate, so an account party may already write here without the
      -- role -- exempting it grants a finance holder nothing its other roles
      -- lack. Without this arm the guard taxes IDENTITY rather than ACTION:
      -- proven live, a composite ['owner','finance_approver'] claim died
      -- 42501 on its own account's ordinary 'order' row while ['owner'] alone
      -- passed. It also breaks the assisted session, which spec S6 requires
      -- to produce the same objects as self-service.
      app_has_account(account_id)
      -- OUTSIDE the claim's accounts, the finance lane stays bounded to its
      -- own aggregates. Dropping this would let a cross-account finance claim
      -- append any aggregate it liked, which is the forgery hole 000935
      -- opened and 001000 closed.
      or aggregate_type in (
        'invoice','credit_note','refund','dispute',
        'dispute_case','collection_case','collection_action'
      )
    )
  )
);

-- The permissive finance arm keeps its aggregate list: it is permissive, so it
-- grants and never refuses, and the commands it was written for still reach
-- the table through it. `reports:create` and `commissions:accrue` reach it
-- through `audit_events_insert` and the report-export arm below.

-- ---------------------------------------------------------------------------
-- 2. The account-less report-export audit trail.
-- ---------------------------------------------------------------------------
drop policy if exists audit_events_report_export_insert on public.audit_events;
create policy audit_events_report_export_insert
on public.audit_events for insert to clockwork_runtime
with check (
  account_id is null
  and aggregate_type = 'report_export'
  and actor ->> 'kind' = 'user'
  and actor ->> 'id' = public.app_current_user_id()::text
  and exists (
    select 1 from public.report_exports source
    where source.id = aggregate_id
      and source.requested_by = public.app_current_user_id()
      and source.row_version = aggregate_version
  )
);

-- `appendAuditAndOutbox` returns the inserted event, so the insert above is an
-- INSERT ... RETURNING and needs a select arm or it fails on its own row.
drop policy if exists audit_events_report_export_read on public.audit_events;
create policy audit_events_report_export_read
on public.audit_events for select to clockwork_runtime
using (
  account_id is null
  and aggregate_type = 'report_export'
  and actor ->> 'id' = public.app_current_user_id()::text
  and exists (
    select 1 from public.report_exports source
    where source.id = aggregate_id
      and source.requested_by = public.app_current_user_id()
  )
);

-- The dispatch row for the same event. `outbox_tenant_append` cannot admit it
-- for the same reason: it joins through `app_has_account(event.account_id)`.
drop policy if exists outbox_messages_report_export_insert
  on public.outbox_messages;
create policy outbox_messages_report_export_insert
on public.outbox_messages for insert to clockwork_runtime
with check (
  exists (
    select 1 from public.audit_events source_event
    where source_event.id = outbox_messages.event_id
      and source_event.account_id is null
      and source_event.aggregate_type = 'report_export'
      and source_event.actor ->> 'id' = public.app_current_user_id()::text
      and outbox_messages.topic = source_event.event_type
      and (outbox_messages.payload ->> 'eventId') = source_event.id::text
      and (outbox_messages.payload ->> 'eventType') = source_event.event_type
      and (outbox_messages.payload ->> 'aggregateType')
        = source_event.aggregate_type
      and (outbox_messages.payload ->> 'aggregateId')
        = source_event.aggregate_id::text
      and (outbox_messages.payload ->> 'requestId') = source_event.request_id
  )
);

-- ---------------------------------------------------------------------------
-- 3. Reading back the artifact request the partner is allowed to write.
-- ---------------------------------------------------------------------------
drop policy if exists core_commercial_artifact_select
  on public.core_commercial_artifact_requests;
create policy core_commercial_artifact_select
on public.core_commercial_artifact_requests for select to clockwork_runtime
using (
  app_is_internal()
  or app_has_account(audience_account_id)
  or (
    subject_type = 'quote'
    and document_kind = 'partner_resale_quote'
    and audience = 'end_client'
    and exists (
      select 1 from public.quotes quote_record
      where quote_record.id
          = core_commercial_artifact_requests.subject_id
        and quote_record.account_id
          = core_commercial_artifact_requests.commercial_account_id
        and quote_record.partner_account_id is not null
        and app_has_account(quote_record.partner_account_id)
    )
  )
);

-- The audit trail of that same request. `appendAuditAndOutbox` scopes the
-- event to the AUDIENCE account -- correctly, because the end client is who the
-- document belongs to -- so the partner who authored it cannot append it under
-- `audit_events_insert`. Rather than add a fourth partner arm to three separate
-- policies, the existing predicate gains the case: `audit_events_partner_mor_
-- insert`, `audit_events_partner_mor_actor_read` and `outbox_messages_partner_
-- mor_insert` all already call it, so one arm reopens the insert, the RETURNING
-- read and the dispatch row together. Everything the arm requires is persisted:
-- the request row, its kind and audience, the caller as its requester, and the
-- caller holding the quote's partner account.
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
  elsif candidate_aggregate_type = 'document'
    and candidate_event_type = 'commerce.commercial_artifact_requested'
  then
    return candidate_aggregate_version = 1 and exists (
      select 1
      from public.core_commercial_artifact_requests request_record
      join public.quotes quote_record
        on quote_record.id = request_record.subject_id
      where request_record.id = candidate_aggregate_id
        and request_record.audience_account_id = candidate_account_id
        and request_record.subject_type = 'quote'
        and request_record.document_kind = 'partner_resale_quote'
        and request_record.audience = 'end_client'
        and request_record.requested_by = public.app_current_user_id()
        and quote_record.account_id = request_record.commercial_account_id
        and quote_record.partner_account_id is not null
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

-- ---------------------------------------------------------------------------
-- 4. The signer a commercial artifact prints.
-- ---------------------------------------------------------------------------
--
-- `commerce_users_read` is `app_is_current_user(id)`: on the tenant pool a
-- caller sees exactly one row, their own. `orderArtifactDefinition` and
-- `amendmentArtifactDefinition` (core/artifact-definitions.ts) look the order's
-- signer up by id to print their name, so both threw
-- COMMERCIAL_ARTIFACT_SIGNER_NOT_FOUND whenever the caller was not the person
-- who signed the order -- every amendment raised by anyone but the original
-- signer, and every order form an operator submits on a customer's behalf.
--
-- This is NOT fixed by widening `commerce_users`. That table carries `email`
-- and `workos_user_id`, and a row policy cannot hand out one column, so
-- admitting the signer's row would disclose the directory entry to fix a name
-- on a PDF. The accessor below returns the single field the artifact needs,
-- and follows the `core_quote_is_visible` pattern exactly: the SECURITY
-- DEFINER half takes the caller's authority as arguments, because inside a
-- definer `current_user` is the owner and `app_is_internal()` would answer for
-- the wrong session.
--
-- Refused set: a name is returned only when the candidate is the caller, or
-- signed an ORDER whose client, invoicing or partner account the caller holds,
-- or signed an AGREEMENT on an account the caller holds -- and internal
-- callers always. Everything else returns null and the callers above raise
-- COMMERCIAL_ARTIFACT_SIGNER_NOT_FOUND exactly as they do now.
create or replace function public.core_commercial_signer_name(
  candidate uuid,
  internal_access boolean,
  allowed_account_ids jsonb
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select signer.name
  from public.commerce_users signer
  where signer.id = candidate
    and (
      internal_access
      or signer.id::text = coalesce(
        public.app_context_claims() ->> 'userId', ''
      )
      or exists (
        select 1 from public.orders order_record
        where order_record.signer_user_id = signer.id
          and (
            order_record.account_id::text in (
              select jsonb_array_elements_text(
                coalesce(allowed_account_ids, '[]'::jsonb)
              )
            )
            or order_record.invoicing_account_id::text in (
              select jsonb_array_elements_text(
                coalesce(allowed_account_ids, '[]'::jsonb)
              )
            )
            or order_record.partner_account_id::text in (
              select jsonb_array_elements_text(
                coalesce(allowed_account_ids, '[]'::jsonb)
              )
            )
          )
      )
      or exists (
        select 1 from public.agreements agreement_record
        where agreement_record.signer_user_id = signer.id
          and agreement_record.account_id::text in (
            select jsonb_array_elements_text(
              coalesce(allowed_account_ids, '[]'::jsonb)
            )
          )
      )
    )
$$;
revoke all on function public.core_commercial_signer_name(uuid,boolean,jsonb)
  from public;
grant execute on function public.core_commercial_signer_name(uuid,boolean,jsonb)
  to clockwork_runtime, clockwork_service;

create or replace function public.core_commercial_signer(candidate uuid)
returns text
language sql
stable
set search_path = public
as $$
  select public.core_commercial_signer_name(
    candidate,
    app_is_internal(),
    coalesce(app_context_claims()->'accountIds', '[]'::jsonb)
  )
$$;
revoke all on function public.core_commercial_signer(uuid) from public;
grant execute on function public.core_commercial_signer(uuid)
  to clockwork_runtime, clockwork_service;

-- ---------------------------------------------------------------------------
-- 5. Collections: the owner lock leaves the read and update arms.
-- ---------------------------------------------------------------------------
drop policy if exists core_collection_cases_finance_read
  on public.core_collection_cases;
create policy core_collection_cases_finance_read
on public.core_collection_cases for select to clockwork_runtime
using (app_has_role('finance_approver'));

drop policy if exists core_collection_cases_finance_update
  on public.core_collection_cases;
create policy core_collection_cases_finance_update
on public.core_collection_cases for update to clockwork_runtime
using (app_has_role('finance_approver'))
with check (
  app_has_role('finance_approver')
  and exists (
    select 1 from public.invoices source_invoice
    where source_invoice.id = core_collection_cases.invoice_id
      and source_invoice.account_id = core_collection_cases.account_id
  )
);

-- The WITH CHECK above also repairs a tautology. As written in 001000 it read
-- `source_invoice.account_id = account_id`, and inside a subquery over
-- `invoices` the unqualified `account_id` resolves to the INVOICE's own
-- column, so the clause compared a row to itself and constrained nothing.
-- `core_collection_cases_finance_insert` carries the same tautology and is
-- rewritten here for the same reason.
drop policy if exists core_collection_cases_finance_insert
  on public.core_collection_cases;
create policy core_collection_cases_finance_insert
on public.core_collection_cases for insert to clockwork_runtime
with check (
  app_has_role('finance_approver')
  and owner_user_id = public.app_current_user_id()
  and exists (
    select 1 from public.invoices source_invoice
    where source_invoice.id = core_collection_cases.invoice_id
      and source_invoice.account_id = core_collection_cases.account_id
  )
);

drop policy if exists core_collection_actions_finance_read
  on public.core_collection_actions;
create policy core_collection_actions_finance_read
on public.core_collection_actions for select to clockwork_runtime
using (
  app_has_role('finance_approver')
  and actor_user_id = public.app_current_user_id()
);

drop policy if exists core_collection_actions_finance_insert
  on public.core_collection_actions;
create policy core_collection_actions_finance_insert
on public.core_collection_actions for insert to clockwork_runtime
with check (
  app_has_role('finance_approver')
  and actor_user_id = public.app_current_user_id()
  and exists (
    select 1 from public.core_collection_cases collection_case
    where collection_case.id
      = core_collection_actions.collection_case_id
  )
);
