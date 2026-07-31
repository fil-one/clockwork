-- Integration hardening: signed role checks are an additional, restrictive
-- condition on top of the existing account-scope policies. Restrictive
-- policies are deliberately used so they cannot accidentally widen access.

create or replace function app_has_any_role(allowed_roles text[]) returns boolean
language sql stable set search_path = public as $$
  select app_is_internal() or exists (
    select 1
    from jsonb_array_elements_text(app_context_claims()->'roles') as claimed(role)
    where claimed.role = any(allowed_roles)
  )
$$;
revoke all on function app_has_any_role(text[]) from public;
grant execute on function app_has_any_role(text[]) to clockwork_runtime, clockwork_service;

-- Account and organization administration.
do $$
declare table_name text;
declare allowed text[] := array['owner','admin','partner_admin','internal_operator'];
begin
  foreach table_name in array array[
    'accounts','procurement_profiles','organizations','invites'
  ] loop
    execute format(
      'create policy %I on %I as restrictive for insert with check (app_has_any_role(%L::text[]))',
      'guard_i_' || left(table_name, 36) || '_' || left(md5(table_name), 8), table_name, allowed::text
    );
    execute format(
      'create policy %I on %I as restrictive for update using (app_has_any_role(%L::text[])) with check (app_has_any_role(%L::text[]))',
      'guard_u_' || left(table_name, 36) || '_' || left(md5(table_name), 8), table_name, allowed::text, allowed::text
    );
  end loop;
end $$;

-- Agreement and evidence initiation. Counsel can act only where the existing
-- account/service policy also grants row access.
do $$
declare table_name text;
declare allowed text[] := array['owner','admin','partner_admin','internal_operator','legal_approver'];
begin
  foreach table_name in array array['documents','agreements','key_terms'] loop
    execute format(
      'create policy %I on %I as restrictive for insert with check (app_has_any_role(%L::text[]))',
      'guard_i_' || left(table_name, 36) || '_' || left(md5(table_name), 8), table_name, allowed::text
    );
    execute format(
      'create policy %I on %I as restrictive for update using (app_has_any_role(%L::text[])) with check (app_has_any_role(%L::text[]))',
      'guard_u_' || left(table_name, 36) || '_' || left(md5(table_name), 8), table_name, allowed::text, allowed::text
    );
  end loop;
end $$;

-- Quote work is available to customer and partner sellers. Finance approval
-- still requires the domain/API action permission; this guard prevents a
-- read-only member or billing-only actor from bypassing that layer with SQL.
do $$
declare table_name text;
declare allowed text[] := array['owner','admin','partner_admin','partner_seller','internal_operator','finance_approver'];
begin
  foreach table_name in array array[
    'quotes','quote_lines','core_quote_commercial_profiles','core_quote_snapshots'
  ] loop
    execute format(
      'create policy %I on %I as restrictive for insert with check (app_has_any_role(%L::text[]))',
      'guard_i_' || left(table_name, 36) || '_' || left(md5(table_name), 8), table_name, allowed::text
    );
    execute format(
      'create policy %I on %I as restrictive for update using (app_has_any_role(%L::text[])) with check (app_has_any_role(%L::text[]))',
      'guard_u_' || left(table_name, 36) || '_' || left(md5(table_name), 8), table_name, allowed::text, allowed::text
    );
  end loop;
end $$;

-- Order and amendment work. Accepted artifacts remain protected by their
-- immutable triggers in addition to these role checks.
do $$
declare table_name text;
declare allowed text[] := array['owner','admin','partner_admin','internal_operator'];
begin
  foreach table_name in array array[
    'orders','order_lines','amendments','amendment_lines',
    'core_order_commercial_profiles','core_order_line_snapshots',
    'core_amendment_financial_terms','core_amendment_line_supersessions'
  ] loop
    execute format(
      'create policy %I on %I as restrictive for insert with check (app_has_any_role(%L::text[]))',
      'guard_i_' || left(table_name, 36) || '_' || left(md5(table_name), 8), table_name, allowed::text
    );
    execute format(
      'create policy %I on %I as restrictive for update using (app_has_any_role(%L::text[])) with check (app_has_any_role(%L::text[]))',
      'guard_u_' || left(table_name, 36) || '_' || left(md5(table_name), 8), table_name, allowed::text, allowed::text
    );
  end loop;
end $$;

-- POC lifecycle commands.
do $$
declare allowed text[] := array['owner','admin','partner_admin','internal_operator'];
begin
  execute format(
    'create policy %I on pocs as restrictive for insert with check (app_has_any_role(%L::text[]))',
    'guard_i_pocs_' || left(md5('pocs'), 8), allowed::text
  );
  execute format(
    'create policy %I on pocs as restrictive for update using (app_has_any_role(%L::text[])) with check (app_has_any_role(%L::text[]))',
    'guard_u_pocs_' || left(md5('pocs'), 8), allowed::text, allowed::text
  );
end $$;

-- Billing actors may create/update account-scoped billing records, but only
-- through rows already visible under the original account-chain policies.
do $$
declare table_name text;
declare allowed text[] := array['owner','billing','internal_operator','finance_approver'];
begin
  foreach table_name in array array[
    'commitment_ledgers','commitment_entries','invoices','payments',
    'credit_notes','refunds','dispute_cases','report_exports'
  ] loop
    execute format(
      'create policy %I on %I as restrictive for insert with check (app_has_any_role(%L::text[]))',
      'guard_i_' || left(table_name, 36) || '_' || left(md5(table_name), 8), table_name, allowed::text
    );
    execute format(
      'create policy %I on %I as restrictive for update using (app_has_any_role(%L::text[])) with check (app_has_any_role(%L::text[]))',
      'guard_u_' || left(table_name, 36) || '_' || left(md5(table_name), 8), table_name, allowed::text, allowed::text
    );
  end loop;
end $$;

-- Provisioning and usage projections are provider/system-owned facts.
do $$
declare table_name text;
declare allowed text[] := array['internal_operator'];
begin
  foreach table_name in array array['entitlements','usage_events'] loop
    execute format(
      'create policy %I on %I as restrictive for insert with check (app_has_any_role(%L::text[]))',
      'guard_i_' || left(table_name, 36) || '_' || left(md5(table_name), 8), table_name, allowed::text
    );
    execute format(
      'create policy %I on %I as restrictive for update using (app_has_any_role(%L::text[])) with check (app_has_any_role(%L::text[]))',
      'guard_u_' || left(table_name, 36) || '_' || left(md5(table_name), 8), table_name, allowed::text, allowed::text
    );
  end loop;
end $$;

-- Notices and partner-originated registration work.
do $$
declare allowed text[];
begin
  allowed := array['owner','admin','partner_admin','internal_operator','legal_approver'];
  execute format(
    'create policy %I on inbound_notices as restrictive for insert with check (app_has_any_role(%L::text[]))',
    'guard_i_inbound_notices_' || left(md5('inbound_notices'), 8), allowed::text
  );
  execute format(
    'create policy %I on inbound_notices as restrictive for update using (app_has_any_role(%L::text[])) with check (app_has_any_role(%L::text[]))',
    'guard_u_inbound_notices_' || left(md5('inbound_notices'), 8), allowed::text, allowed::text
  );

  allowed := array['partner_admin','partner_seller','internal_operator'];
  execute format(
    'create policy %I on deal_registrations as restrictive for insert with check (app_has_any_role(%L::text[]))',
    'guard_i_deal_registrations_' || left(md5('deal_registrations'), 8), allowed::text
  );
  execute format(
    'create policy %I on deal_registrations as restrictive for update using (app_has_any_role(%L::text[])) with check (app_has_any_role(%L::text[]))',
    'guard_u_deal_registrations_' || left(md5('deal_registrations'), 8), allowed::text, allowed::text
  );

  allowed := array['owner','admin','partner_admin','internal_operator','legal_approver'];
  execute format(
    'create policy %I on novations as restrictive for insert with check (app_has_any_role(%L::text[]))',
    'guard_i_novations_' || left(md5('novations'), 8), allowed::text
  );
end $$;

-- Commission facts are finance/system written even though partners can read
-- their own statements and accruals.
create policy commission_accruals_insert_role_guard on commission_accruals
  as restrictive for insert
  with check (app_has_any_role(array['internal_operator','finance_approver']));
create policy commission_accruals_update_role_guard on commission_accruals
  as restrictive for update
  using (app_has_any_role(array['internal_operator','finance_approver']))
  with check (app_has_any_role(array['internal_operator','finance_approver']));

-- A requester can create a termination request, but only a segregated
-- destructive approver (or an internal system operation) can advance it.
create policy terminations_insert_role_guard on terminations
  as restrictive for insert
  with check (app_has_any_role(array['owner','admin','partner_admin','internal_operator']));
create policy terminations_update_role_guard on terminations
  as restrictive for update
  using (app_has_any_role(array['destructive_action_approver','internal_operator']))
  with check (app_has_any_role(array['destructive_action_approver','internal_operator']));
create policy terminations_delete_service_guard on terminations
  as restrictive for delete using (app_is_internal());

-- Certificates are generated only after provider-confirmed teardown. Tenant
-- users may read the immutable certificate but cannot forge one.
create policy deletion_certificates_insert_service_guard on deletion_certificates
  as restrictive for insert with check (app_is_internal());
create policy deletion_certificates_update_service_guard on deletion_certificates
  as restrictive for update using (app_is_internal()) with check (app_is_internal());
create policy deletion_certificates_delete_service_guard on deletion_certificates
  as restrictive for delete using (app_is_internal());

-- Audit/outbox append remains possible in an authorized domain transaction,
-- but a read-only member cannot manufacture evidence or durable work.
create policy audit_events_insert_role_guard on audit_events
  as restrictive for insert
  with check (app_has_any_role(array[
    'owner','admin','billing','partner_admin','partner_seller','internal_operator',
    'finance_approver','legal_approver','destructive_action_approver'
  ]));
create policy outbox_messages_insert_role_guard on outbox_messages
  as restrictive for insert
  with check (app_has_any_role(array[
    'owner','admin','billing','partner_admin','partner_seller','internal_operator',
    'finance_approver','legal_approver','destructive_action_approver'
  ]));

-- Deletion of commerce records is a service-only operation. Immutable tables
-- additionally reject service mutation through their existing triggers.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'accounts','documents','procurement_profiles','organizations','invites',
    'agreements','key_terms','quotes','quote_lines','pocs','orders','order_lines',
    'amendments','amendment_lines','commitment_ledgers','commitment_entries',
    'entitlements','usage_events','invoices','payments','credit_notes','refunds',
    'dispute_cases','inbound_notices','deal_registrations','novations',
    'commission_accruals','report_exports','core_quote_commercial_profiles',
    'core_quote_snapshots','core_order_commercial_profiles',
    'core_order_line_snapshots','core_amendment_financial_terms',
    'core_amendment_line_supersessions'
  ] loop
    execute format(
      'create policy %I on %I as restrictive for delete using (app_is_internal())',
      'guard_d_' || left(table_name, 36) || '_' || left(md5(table_name), 8), table_name
    );
  end loop;
end $$;

-- Partner economics never travel through the tenant runtime role. Quote and
-- document services expose only the audience-safe calculated result.
create policy rate_cards_economics_select_guard on rate_cards
  as restrictive for select
  using (app_has_any_role(array['finance_approver']));
create policy core_transfer_tiers_economics_select_guard on core_partner_transfer_tiers
  as restrictive for select
  using (app_has_any_role(array['finance_approver']));

-- Allocate an order's contracted total across exactly its quoted billing
-- months. Integer division supplies the base amount and the first remainder
-- months receive one minor unit, so monthly rows always sum to the source
-- quote without emitting an extra service-end month.
create or replace view core_revenue_forecast with (security_invoker = true) as
with booked_source as (
  select
    o.id as order_id,
    q.id as quote_id,
    o.account_id,
    o.partner_account_id,
    q.currency,
    q.total_minor,
    greatest(
      1,
      coalesce((select max(ql.term_months) from quote_lines ql where ql.quote_id = q.id), 1)
    )::integer as billing_months,
    coalesce(
      cp.merchant_of_record,
      case
        when o.sourcing in ('resale', 'distributor') then 'partner'
        when o.sourcing = 'marketplace' then 'marketplace'
        else 'fil_one'
      end
    ) as merchant_of_record,
    o.sourcing as channel,
    o.service_starts_on,
    o.service_ends_on,
    o.notice_on
  from orders o
  join quotes q on q.id = o.quote_id
  left join core_order_commercial_profiles cp on cp.order_id = o.id
  where o.status in ('accepted','provisioning','active','amended')
), booked as (
  select
    source.order_id,
    source.quote_id,
    source.account_id,
    source.partner_account_id,
    source.currency,
    source.merchant_of_record,
    source.channel,
    (date_trunc('month', source.service_starts_on)::date + month_offset * interval '1 month')::date as forecast_month,
    'committed_backlog'::text as forecast_stage,
    source.total_minor / source.billing_months
      + case
          when month_offset < source.total_minor % source.billing_months then 1
          else 0
        end
      + coalesce((
          select sum(aft.monthly_delta_minor)
          from amendments a
          join core_amendment_financial_terms aft on aft.amendment_id = a.id
          where a.order_id = source.order_id
            and date_trunc('month', a.effective_on)::date
              <= (date_trunc('month', source.service_starts_on)::date + month_offset * interval '1 month')::date
        ), 0) as forecast_revenue_minor,
    source.service_starts_on,
    source.service_ends_on,
    source.notice_on
  from booked_source source
  cross join lateral generate_series(0, source.billing_months - 1) as month_offset
), pipeline as (
  select
    null::uuid as order_id,
    q.id as quote_id,
    q.account_id,
    q.partner_account_id,
    q.currency,
    coalesce(qcp.merchant_of_record, 'fil_one') as merchant_of_record,
    coalesce(
      qcp.channel_shape,
      case when q.partner_account_id is null then 'direct' else 'referral' end
    ) as channel,
    date_trunc('month', q.created_at)::date as forecast_month,
    'pipeline'::text as forecast_stage,
    q.total_minor as forecast_revenue_minor,
    null::date as service_starts_on,
    null::date as service_ends_on,
    null::date as notice_on
  from quotes q
  left join core_quote_commercial_profiles qcp on qcp.quote_id = q.id
  where q.status = 'issued'
    and not exists (select 1 from orders o where o.quote_id = q.id)
), forecast as (
  select * from booked
  union all
  select * from pipeline
)
select
  forecast.*,
  forecast_revenue_minor as mrr_minor,
  forecast_revenue_minor * 12 as arr_minor,
  case when merchant_of_record = 'partner' then 'transfer_price' else 'gross' end as revenue_basis,
  jsonb_build_object('orderId', order_id, 'quoteId', quote_id) as source_record_ids
from forecast;

revoke all on core_revenue_forecast from public, anon, authenticated, clockwork_runtime;
grant select on core_revenue_forecast to clockwork_service;

-- A partner registration command may persist only the deterministic rejection
-- evidence produced from the unified Account and active-registration records.
-- Updates and deletes remain internal-only under the foundation policy.
create policy core_registration_derived_exclusion_insert
on core_deal_registration_exclusions
for insert
with check (
  kind in ('house_account', 'prior_deal')
  and status = 'open'
  and resolved_by is null
  and resolved_at is null
  and evidence ->> 'source' = 'unified_account_and_active_deal_records'
  and exists (
    select 1
    from deal_registrations registration
    where registration.id = registration_id
      and registration.status = 'rejected'
      and registration.end_client_account_id = matched_account_id
      and app_has_account(registration.partner_account_id)
  )
);
