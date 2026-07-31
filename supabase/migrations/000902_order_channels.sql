-- Complete the database contract for the distributor and marketplace routes
-- already modeled by the domain layer. Distributor artifacts use the same
-- partner merchant-of-record chain and isolation boundary as resale, while a
-- marketplace order binds directly to the end client and records the external
-- merchant of record in its immutable commercial profile.

alter table orders drop constraint orders_sourcing_check;
alter table orders add constraint orders_sourcing_check
  check (sourcing in ('direct','referral','resale','distributor','marketplace'));

create or replace function validate_commerce_chain() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'quote_lines' then
    if not exists (
      select 1 from quotes q join rate_cards r on r.id = new.rate_card_id
      where q.id = new.quote_id and q.price_book_id = r.price_book_id and r.sku = new.sku
    ) then raise exception using errcode = '23514', message = 'quote line must use the quote price book and rate-card SKU'; end if;
  elsif tg_table_name = 'orders' then
    if not exists (
      select 1 from quotes q join agreements a on a.id = new.agreement_id
      where q.id = new.quote_id and q.status = 'accepted' and a.status = 'active'
        and a.effective_on <= new.service_starts_on
        and (
          (new.sourcing in ('direct', 'marketplace') and new.partner_account_id is null
            and new.account_id = new.invoicing_account_id and q.account_id = new.account_id
            and q.partner_account_id is null and q.end_client_account_id is null
            and a.account_id = new.account_id)
          or
          (new.sourcing = 'referral' and new.partner_account_id is not null
            and new.account_id = new.invoicing_account_id and q.account_id = new.account_id
            and q.partner_account_id = new.partner_account_id and a.account_id = new.account_id)
          or
          (new.sourcing in ('resale', 'distributor') and new.partner_account_id is not null
            and new.account_id <> new.partner_account_id and new.invoicing_account_id = new.partner_account_id
            and q.account_id = new.account_id and q.end_client_account_id = new.account_id
            and q.partner_account_id = new.partner_account_id and a.account_id = new.partner_account_id)
        )
    ) then raise exception using errcode = '23514', message = 'order quote/agreement/account merchant-of-record chain is inconsistent'; end if;
  elsif tg_table_name = 'order_lines' then
    if not exists (
      select 1 from orders o join quote_lines ql on ql.id = new.quote_line_id
      where o.id = new.order_id and ql.quote_id = o.quote_id and ql.sku = new.sku
        and ql.quantity = new.quantity and ql.unit_price_minor = new.unit_price_minor
        and ql.overage_rate_minor = new.overage_rate_minor
        and (new.superseded_by_amendment_id is null or exists (
          select 1 from amendments a where a.id = new.superseded_by_amendment_id and a.order_id = new.order_id
        ))
    ) then raise exception using errcode = '23514', message = 'order line must be copied from its order quote'; end if;
  elsif tg_table_name = 'commitment_ledgers' then
    if not exists (select 1 from order_lines ol where ol.id = new.order_line_id and ol.order_id = new.order_id)
    then raise exception using errcode = '23514', message = 'operational record order line must belong to its order'; end if;
  elsif tg_table_name = 'entitlements' then
    if not exists (select 1 from order_lines ol where ol.id = new.order_line_id and ol.order_id = new.order_id)
    then raise exception using errcode = '23514', message = 'operational record order line must belong to its order'; end if;
    if not exists (
      select 1 from orders o join organizations org on org.id = new.organization_id
      where o.id = new.order_id and org.account_id = o.account_id
    ) then raise exception using errcode = '23514', message = 'entitlement organization must belong to the service account'; end if;
  elsif tg_table_name = 'invoices' then
    if not exists (
      select 1 from orders o join quotes q on q.id = o.quote_id
      where o.id = new.order_id and o.invoicing_account_id = new.account_id and q.currency = new.currency
        and new.po_number is not distinct from o.po_number
    ) then raise exception using errcode = '23514', message = 'invoice account/currency must match the order merchant of record'; end if;
  elsif tg_table_name in ('payments', 'credit_notes') then
    if not exists (
      select 1 from invoices i where i.id = new.invoice_id and i.order_id = new.order_id and i.currency = new.currency
    ) then raise exception using errcode = '23514', message = 'invoice adjustment must match its invoice order and currency'; end if;
  elsif tg_table_name in ('refunds', 'dispute_cases') then
    if not exists (
      select 1 from payments p where p.id = new.payment_id and p.order_id = new.order_id and p.currency = new.currency
    ) then raise exception using errcode = '23514', message = 'payment adjustment must match its payment order and currency'; end if;
  elsif tg_table_name = 'inbound_notices' then
    if not exists (select 1 from orders o where o.id = new.order_id and o.account_id = new.account_id)
    then raise exception using errcode = '23514', message = 'notice account must match its order'; end if;
  elsif tg_table_name = 'terminations' then
    if new.order_id is not null and not exists (
      select 1 from orders o where o.id = new.order_id and o.account_id = new.account_id
    ) then raise exception using errcode = '23514', message = 'termination account must match its order'; end if;
  elsif tg_table_name = 'amendment_lines' then
    if new.order_line_id is not null and not exists (
      select 1 from amendments a join order_lines ol on ol.id = new.order_line_id
      where a.id = new.amendment_id and a.order_id = ol.order_id
    ) then raise exception using errcode = '23514', message = 'amendment line must belong to the amended order'; end if;
  elsif tg_table_name = 'commitment_entries' then
    if not exists (
      select 1
      from commitment_ledgers l
      join usage_events u on u.id = new.usage_event_id
      join entitlements e on e.id = u.entitlement_id
      where l.id = new.ledger_id and l.order_id = e.order_id and l.order_line_id = e.order_line_id
    ) then raise exception using errcode = '23514', message = 'usage event must belong to the commitment ledger order line'; end if;
  elsif tg_table_name = 'commission_accruals' then
    if not exists (
      select 1 from invoices i join orders o on o.id = i.order_id
      where i.id = new.invoice_id and o.sourcing = 'referral'
        and o.partner_account_id = new.partner_account_id and i.currency = new.currency
    ) then raise exception using errcode = '23514', message = 'commission must belong to an attributed referral invoice'; end if;
  elsif tg_table_name = 'novations' then
    if not exists (
      select 1 from orders source_order join orders new_order on new_order.id = new.new_order_id
      join agreements new_agreement on new_agreement.id = new.new_agreement_id
      where source_order.id = new.source_order_id and source_order.account_id = new.account_id
        and source_order.partner_account_id = new.former_partner_account_id
        and new_order.account_id = new.account_id and new_agreement.account_id = new.account_id
    ) then raise exception using errcode = '23514', message = 'novation must preserve the end-client artifact chain'; end if;
  end if;
  return new;
end $$;

-- Keep the core-finance validator aligned with the widened order source. This
-- is intentionally the same validator body with only the billing-shape/source
-- correspondence extended; replacing it preserves every existing invariant.
create or replace function core_validate_finance_chain() returns trigger
language plpgsql set search_path = public as $$
declare parent_order orders%rowtype;
declare parent_quote quotes%rowtype;
begin
  if tg_table_name = 'core_account_commercial_profiles' then
    if exists (
      select 1 from accounts a where a.id = new.account_id and 'partner' = any(a.relationship_roles)
        and a.aggregate_credit_limit_minor <> new.approved_credit_limit_minor
    ) then raise exception using errcode = '23514', message = 'partner credit limit must match the account aggregate limit'; end if;
  elsif tg_table_name = 'core_account_relationship_roles' then
    if not exists (select 1 from accounts a where a.id = new.account_id and new.role = any(a.relationship_roles)) then
      raise exception using errcode = '23514', message = 'normalized relationship role must match the account role set';
    end if;
  elsif tg_table_name = 'core_quote_commercial_profiles' then
    select * into parent_quote from quotes where id = new.quote_id;
    if not found or new.billing_account_id not in (parent_quote.account_id, coalesce(parent_quote.partner_account_id, parent_quote.account_id)) then
      raise exception using errcode = '23514', message = 'quote commercial billing party is outside the quote chain';
    end if;
    if (new.channel_shape = 'direct' and (parent_quote.partner_account_id is not null or new.merchant_of_record <> 'fil_one' or new.pricing_authority <> 'fil_one'))
      or (new.channel_shape = 'referral' and (parent_quote.partner_account_id is null or new.merchant_of_record <> 'fil_one' or new.billing_account_id <> parent_quote.account_id))
      or (new.channel_shape in ('resale','distributor') and (parent_quote.partner_account_id is null or parent_quote.end_client_account_id is null or new.merchant_of_record <> 'partner' or new.pricing_authority <> 'partner' or new.billing_account_id <> parent_quote.partner_account_id))
      or (new.channel_shape = 'marketplace' and new.merchant_of_record <> 'marketplace')
    then raise exception using errcode = '23514', message = 'quote channel, pricing authority, and merchant of record are inconsistent'; end if;
  elsif tg_table_name = 'core_quote_snapshots' then
    if not exists (select 1 from quotes q where q.id = new.quote_id and q.revision = new.revision and q.status <> 'draft') then
      raise exception using errcode = '23514', message = 'quote snapshot must pin an issued quote revision';
    end if;
  elsif tg_table_name = 'core_order_commercial_profiles' then
    select * into parent_order from orders where id = new.order_id;
    if not found or not exists (select 1 from agreements a where a.id = parent_order.agreement_id and a.version = new.governing_agreement_version) then
      raise exception using errcode = '23514', message = 'order must pin the governing agreement version';
    end if;
    if (new.billing_shape in ('direct','referral') and new.merchant_of_record <> 'fil_one')
      or (new.billing_shape in ('resale','distributor') and new.merchant_of_record <> 'partner')
      or (new.billing_shape = 'marketplace' and new.merchant_of_record <> 'marketplace')
      or (new.billing_shape = 'direct' and parent_order.sourcing <> 'direct')
      or (new.billing_shape = 'referral' and parent_order.sourcing <> 'referral')
      or (new.billing_shape = 'resale' and parent_order.sourcing <> 'resale')
      or (new.billing_shape = 'distributor' and parent_order.sourcing <> 'distributor')
      or (new.billing_shape = 'marketplace' and parent_order.sourcing <> 'marketplace')
    then raise exception using errcode = '23514', message = 'order billing shape and merchant of record are inconsistent'; end if;
    if new.co_term_parent_order_id is not null and not exists (
      select 1 from orders parent where parent.id = new.co_term_parent_order_id
        and (parent.invoicing_account_id = parent_order.invoicing_account_id or parent.partner_account_id = parent_order.partner_account_id)
    ) then raise exception using errcode = '23514', message = 'co-termination parent must share the invoicing chain'; end if;
    if new.deal_registration_id is not null and not exists (
      select 1 from deal_registrations r where r.id = new.deal_registration_id
        and r.partner_account_id = parent_order.partner_account_id and r.end_client_account_id = parent_order.account_id
        and r.status in ('approved','converted')
    ) then raise exception using errcode = '23514', message = 'order deal registration must match its partner and end client'; end if;
  elsif tg_table_name = 'core_order_line_snapshots' then
    if not exists (select 1 from order_lines ol join orders o on o.id = ol.order_id where ol.id = new.order_line_id and o.status <> 'submitted') then
      raise exception using errcode = '23514', message = 'order line snapshot requires an accepted order';
    end if;
  elsif tg_table_name = 'core_amendment_line_supersessions' then
    if not exists (
      select 1 from amendments a join order_lines ol on ol.id = new.superseded_order_line_id
      where a.id = new.amendment_id and a.order_id = ol.order_id and new.effective_on = a.effective_on
    ) then raise exception using errcode = '23514', message = 'supersession must target a line on the amended order at its effective date'; end if;
  elsif tg_table_name = 'core_commitment_periods' then
    if exists (
      select 1 from core_commitment_periods period where period.ledger_id = new.ledger_id and period.id <> new.id
      and tstzrange(period.starts_at, period.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
    ) then raise exception using errcode = '23P01', message = 'commitment periods cannot overlap'; end if;
  elsif tg_table_name = 'core_commitment_ledger_corrections' then
    if new.period_id is not null and not exists (select 1 from core_commitment_periods p where p.id = new.period_id and p.ledger_id = new.ledger_id) then
      raise exception using errcode = '23514', message = 'ledger correction period must belong to its ledger';
    end if;
    if new.reverses_entry_id is not null and not exists (select 1 from commitment_entries e where e.id = new.reverses_entry_id and e.ledger_id = new.ledger_id) then
      raise exception using errcode = '23514', message = 'ledger correction entry must belong to its ledger';
    end if;
  elsif tg_table_name = 'core_invoice_end_client_allocations' then
    if not exists (
      select 1 from invoices i join orders o on o.id = new.order_id
      where i.id = new.invoice_id and i.account_id = o.invoicing_account_id and o.account_id = new.end_client_account_id and i.currency = new.currency
    ) then raise exception using errcode = '23514', message = 'invoice allocation must preserve invoice, order, and end-client chain'; end if;
  elsif tg_table_name = 'core_deal_registration_attributions' then
    if not exists (select 1 from deal_registrations r where r.id = new.registration_id and r.status in ('approved','converted')) then
      raise exception using errcode = '23514', message = 'attribution requires an approved registration';
    end if;
  elsif tg_table_name = 'core_partner_hierarchy_edges' then
    if not exists (
      select 1 from accounts distributor join accounts reseller on reseller.id = new.reseller_account_id
      where distributor.id = new.distributor_account_id and 'partner' = any(distributor.relationship_roles)
        and 'partner' = any(reseller.relationship_roles) and reseller.parent_partner_id = distributor.id
    ) then raise exception using errcode = '23514', message = 'partner hierarchy must match the account distributor parent'; end if;
    if new.status = 'active' and exists (
      select 1 from core_partner_hierarchy_edges reverse_edge where reverse_edge.status = 'active'
        and reverse_edge.distributor_account_id = new.reseller_account_id and reverse_edge.reseller_account_id = new.distributor_account_id
        and reverse_edge.id <> new.id
    ) then raise exception using errcode = '23514', message = 'partner hierarchy cannot contain a cycle'; end if;
  elsif tg_table_name = 'core_commission_statement_lines' then
    if not exists (
      select 1 from core_commission_statements s join commission_accruals a on a.id = new.accrual_id
      where s.id = new.statement_id and s.partner_account_id = a.partner_account_id and s.currency = a.currency
    ) then raise exception using errcode = '23514', message = 'commission statement line must match its partner and currency'; end if;
  elsif tg_table_name = 'core_marketplace_events' then
    if new.order_id is not null and new.account_id is not null and not exists (
      select 1 from orders o where o.id = new.order_id and (o.account_id = new.account_id or o.invoicing_account_id = new.account_id)
    ) then raise exception using errcode = '23514', message = 'marketplace event order must belong to its account'; end if;
    if new.entitlement_id is not null and not exists (
      select 1 from entitlements e where e.id = new.entitlement_id and (new.order_id is null or e.order_id = new.order_id)
    ) then raise exception using errcode = '23514', message = 'marketplace entitlement must belong to its order'; end if;
  end if;
  return new;
end $$;

-- A distributor owns the commercial artifact just like a reseller. The end
-- client receives the service but must not see the distributor's economics.
drop policy orders_scope on orders;
create policy orders_scope on orders for all using (
  app_is_internal() or app_has_account(invoicing_account_id) or app_has_account(partner_account_id)
  or (sourcing not in ('resale', 'distributor') and app_has_account(account_id))
) with check (
  app_is_internal() or app_has_account(invoicing_account_id) or app_has_account(partner_account_id)
  or (sourcing not in ('resale', 'distributor') and app_has_account(account_id))
);

drop policy order_lines_scope on order_lines;
create policy order_lines_scope on order_lines for all using (exists (
  select 1 from orders o where o.id = order_id and (
    app_is_internal() or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)
    or (o.sourcing not in ('resale', 'distributor') and app_has_account(o.account_id))
  )
)) with check (exists (
  select 1 from orders o where o.id = order_id and (
    app_is_internal() or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)
    or (o.sourcing not in ('resale', 'distributor') and app_has_account(o.account_id))
  )
));

drop policy amendments_scope on amendments;
create policy amendments_scope on amendments for all using (exists (
  select 1 from orders o where o.id = order_id and (
    app_is_internal() or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)
    or (o.sourcing not in ('resale', 'distributor') and app_has_account(o.account_id))
  )
)) with check (exists (
  select 1 from orders o where o.id = order_id and (
    app_is_internal() or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)
    or (o.sourcing not in ('resale', 'distributor') and app_has_account(o.account_id))
  )
));

drop policy amendment_lines_scope on amendment_lines;
create policy amendment_lines_scope on amendment_lines for all using (exists (
  select 1 from amendments a join orders o on o.id = a.order_id
  where a.id = amendment_id and (
    app_is_internal() or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)
    or (o.sourcing not in ('resale', 'distributor') and app_has_account(o.account_id))
  )
)) with check (exists (
  select 1 from amendments a join orders o on o.id = a.order_id
  where a.id = amendment_id and (
    app_is_internal() or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)
    or (o.sourcing not in ('resale', 'distributor') and app_has_account(o.account_id))
  )
));

create or replace function core_can_access_order(candidate uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1 from orders o where o.id = candidate and (
      app_is_internal() or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)
      or (o.sourcing not in ('resale', 'distributor') and app_has_account(o.account_id))
    )
  )
$$;
