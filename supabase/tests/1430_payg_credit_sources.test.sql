begin;
select plan(12);
set local search_path=public,extensions;
create function pg_temp.payg_invoice_fixture(target uuid, amount_override bigint default 100, include_snapshot boolean default true, corrupt_hash boolean default false)
returns uuid language plpgsql as $$
declare
  enrollment_id uuid := public.uuid_v7();
  offer_id uuid := public.uuid_v7();
  effect_key text := 'pgtap-payg:' || target::text;
  supplier public.core_legal_entities%rowtype;
  customer public.accounts%rowtype;
  book public.core_tax_rule_books%rowtype;
  policy jsonb := '{"currency":"USD"}';
  binding jsonb;
  rating jsonb;
  effect jsonb;
  question jsonb;
  tax_detail jsonb;
  source jsonb;
begin
  select * into supplier from core_legal_entities where id='97000000-0000-4000-8000-000000000002';
  select * into customer from accounts where id='10000000-0000-4000-8000-000000000001';
  select * into book from core_tax_rule_books where status='active' and jurisdiction='US' order by version desc limit 1;
  insert into core_payg_offer_versions(id,sku,region,version,terms,created_by,last_edited_by)
    values(offer_id,offer_id::text,'test',1,jsonb_build_object('sku',offer_id::text,'region','test','version',1),
    '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
  binding := jsonb_build_object('accountId',customer.id::text,'source','fil_one','entitlementId',enrollment_id::text);
  insert into core_payg_enrollments(id,account_id,offer_version_id,source,source_entitlement_id,snapshot,binding_evidence_id)
    values(enrollment_id,customer.id,offer_id,'fil_one',enrollment_id::text,
      jsonb_build_object('policy',policy,'binding',binding,'billingAuthority','clockwork','cutoverEvidenceId','pgtap-only',
        'supplierLegalEntityId',supplier.id::text,'stripeCustomerId','cus_payg_test'),'pgtap-binding');
  rating := jsonb_build_object('policy',policy,'binding',binding,'period',jsonb_build_object('month','2026-08'),
    'evidenceHash',repeat('a',64),'total',jsonb_build_object('minor','100','currency','USD'));
  insert into core_payg_period_revisions(enrollment_id,month,revision,snapshot)
    values(enrollment_id,'2026-08',1,jsonb_build_object('rating',rating));
  effect := jsonb_build_object('idempotencyKey',effect_key,'originalInvoiceKey',effect_key,'kind','invoice',
    'enrollmentId',enrollment_id::text,'accountId',customer.id::text,'month','2026-08','revision',1,
    'amount',jsonb_build_object('minor','100','currency','USD'),'ratingEvidenceHash',repeat('a',64));
  insert into core_payg_pending_invoice_effects(idempotency_key,enrollment_id,payload) values(effect_key,enrollment_id,effect);
  insert into invoices(id,billing_source,payg_effect_key,account_id,currency,amount_minor,tax_minor,tax_treatment,status,stripe_invoice_id)
    values(target,'payg',effect_key,customer.id,'USD',amount_override+3,3,'standard','open','in_payg_'||target::text);
  if include_snapshot then
    question := jsonb_build_object('currency','USD','supplier',jsonb_build_object('legalEntityId',supplier.id::text),
      'customer',jsonb_build_object('accountId',customer.id::text),'paygSource',jsonb_build_object('enrollmentId',enrollment_id::text,'effectKey',effect_key),
      'lines',jsonb_build_array(jsonb_build_object('lineId','payg','taxCode','txcd_payg','netMinor','100')),
      'ruleBooks',jsonb_build_array(jsonb_build_object('id',book.id::text,'version',book.version)));
    tax_detail := jsonb_build_object('determinationId','pgtap-tax','supplierLegalEntityId',supplier.id::text,'customerAccountId',customer.id::text,
      'taxPointDate','2026-08-31','confidence','determined','reviewReasons','[]'::jsonb,'inputProvenance',book.input_provenance,
      'determinationInput',question,'determinationInputHash',encode(digest(convert_to(private.canonical_jsonb_text(question),'UTF8'),'sha256'),'hex'),
      'lines',jsonb_build_array(jsonb_build_object('lineId','payg','jurisdiction','US','treatment','standard','taxCode','txcd_payg',
        'ratePpm',30000,'rateKind','standard','taxableMinor','100','taxMinor','3','ruleBookId',book.id::text,'ruleBookVersion',book.version,'legalBasis','Test fixture only')));
    source := jsonb_build_object('rating',rating,'effect',effect,'stripeCustomerId','cus_payg_test',
      'supplier',jsonb_build_object('legalEntityId',supplier.id::text,'legalName',supplier.legal_name,'registeredAddress',supplier.registered_address,
        'establishedCountry',supplier.established_country,'invoiceHeaderText',supplier.invoice_header_text,'invoiceFooterText',supplier.invoice_footer_text),
      'customer',jsonb_build_object('accountId',customer.id::text,'legalName',customer.legal_name,'registeredAddress',customer.registered_address,
        'country',customer.country,'invoiceDeliveryEmail',customer.invoice_delivery_email),
      'taxDetermination',jsonb_build_object('currency','USD','netMinor','100','taxMinor','3','treatment','standard','detail',tax_detail));
    insert into core_payg_invoice_sources(invoice_id,enrollment_id,effect_key,source_snapshot,source_hash)
      values(target,enrollment_id,effect_key,source,case when corrupt_hash then repeat('0',64) else encode(digest(convert_to(private.canonical_jsonb_text(source),'UTF8'),'sha256'),'hex') end);
  end if;
  return target;
end $$;
insert into commerce_users(id,workos_user_id,email,name,is_internal_staff,mfa_enrolled) values
 ('20000000-0000-4000-8000-000000001430','user_payg_credit_test','payg-credit-test@clockwork.test','PAYG credit test finance',true,true);
insert into memberships(user_id,organization_id,role) values
 ('20000000-0000-4000-8000-000000001430','30000000-0000-4000-8000-000000000008','finance_approver');
select pg_temp.payg_invoice_fixture('99000000-0000-4000-8000-000000001430');
create function pg_temp.payg_credit_fixture(target uuid,net bigint default 40,tax bigint default 1,bind_operation boolean default true) returns uuid language plpgsql as $$
declare
 source public.core_payg_invoice_sources%rowtype;
 effect jsonb;
 snapshot jsonb;
 finance_user uuid;
 correction_key text;
 next_revision integer;
 previous_total bigint;
begin
 select * into source from core_payg_invoice_sources where invoice_id='99000000-0000-4000-8000-000000001430';
 select u.id into finance_user from commerce_users u join memberships m on m.user_id=u.id
   where u.is_internal_staff and u.mfa_enrolled and m.role='finance_approver' order by u.id limit 1;
 select previous.revision+1,(previous.snapshot#>>'{rating,total,minor}')::bigint into next_revision,previous_total
   from core_payg_period_revisions previous where previous.enrollment_id=source.enrollment_id order by previous.revision desc limit 1;
 correction_key := source.effect_key||':correction:'||next_revision::text;
 effect := source.source_snapshot->'effect' || jsonb_build_object('idempotencyKey',correction_key,'kind','credit_adjustment',
   'revision',next_revision,'amount',jsonb_build_object('minor','40','currency','USD'),'ratingEvidenceHash',repeat(next_revision::text,64));
 insert into core_payg_period_revisions(enrollment_id,month,revision,snapshot)
   values(source.enrollment_id,'2026-08',next_revision,jsonb_build_object('rating',source.source_snapshot->'rating' ||
     jsonb_build_object('total',jsonb_build_object('minor',(previous_total-40)::text,'currency','USD'),'evidenceHash',repeat(next_revision::text,64))));
 insert into core_payg_pending_invoice_effects(idempotency_key,enrollment_id,payload) values(correction_key,source.enrollment_id,effect);
 insert into credit_notes(id,invoice_id,order_id,currency,amount_minor,reason_code,approved_by,status)
   values(target,source.invoice_id,null,'USD',net+tax,'payg_period_correction',finance_user,'approved');
 snapshot := jsonb_build_object('effect',effect,'invoiceSourceHash',source.source_hash,'netMinor',net::text,'taxMinor',tax::text,'amountMinor',(net+tax)::text);
 insert into core_payg_credit_sources(credit_note_id,effect_key,invoice_id,allocation_index,net_minor,tax_minor,amount_minor,source_snapshot,source_hash)
   values(target,correction_key,source.invoice_id,1,net,tax,net+tax,snapshot,encode(digest(convert_to(private.canonical_jsonb_text(snapshot),'UTF8'),'sha256'),'hex'));
 if bind_operation then perform core_create_stripe_adjustment_operation(target,'credit_note','order_change','payg_period_correction'); end if;
 return target;
end $$;
select throws_ok($$select pg_temp.payg_credit_fixture('99200000-0000-4000-8000-000000001431',40,2)$$,
 '23514','PAYG credit tax must equal the cumulative share of its original invoice tax','credit cannot invent tax the source never charged');
select throws_ok($$select pg_temp.payg_credit_fixture('99200000-0000-4000-8000-000000001432',41)$$,
 '23514','PAYG credit allocation exceeds its correction effect','credit cannot exceed the corrected period difference');
select lives_ok($$select pg_temp.payg_credit_fixture('99200000-0000-4000-8000-000000001430')$$,
 'complete negative correction materializes a retained credit and durable Stripe operation');
set constraints all immediate;
select is((select order_id from core_stripe_adjustment_operations where adjustment_id='99200000-0000-4000-8000-000000001430'),null::uuid,'PAYG credit operation has no fabricated term order');
select is((select amount_minor from core_stripe_adjustment_operations where adjustment_id='99200000-0000-4000-8000-000000001430'),41::bigint,'credit operation amount derives from immutable allocation');
select throws_ok($$update core_payg_credit_sources set net_minor=1 where credit_note_id='99200000-0000-4000-8000-000000001430'$$,
 'P0001','PAYG_RETAINED_HISTORY_IMMUTABLE','credit source cannot be rewritten');
set constraints all deferred;
select lives_ok($$select pg_temp.payg_credit_fixture('99200000-0000-4000-8000-000000001433')$$,
 'a later correction uses the cumulative original tax share without rounding drift');
set constraints all immediate;
select is((select sum(tax_minor) from core_payg_credit_sources where invoice_id='99000000-0000-4000-8000-000000001430'),2::numeric,'two40net corrections allocate exactly2 of original3 tax');
select is(has_table_privilege('clockwork_runtime','core_payg_credit_sources','INSERT'),false,'tenant cannot forge credit allocation evidence');
insert into payments(id,invoice_id,order_id,stripe_payment_intent_id,currency,amount_minor,status,received_at)
 values('99100000-0000-4000-8000-000000001430','99000000-0000-4000-8000-000000001430',null,'pi_payg_refund_test','USD',100,'succeeded','2026-09-01T00:00:00Z');
set constraints all deferred;
select lives_ok($$insert into refunds(id,payment_id,order_id,currency,amount_minor,reason_code,status)
 values('99300000-0000-4000-8000-000000001430','99100000-0000-4000-8000-000000001430',null,'USD',15,'customer_request','approved');
 select core_create_stripe_adjustment_operation('99300000-0000-4000-8000-000000001430','refund','requested_by_customer','customer_request')$$,
 'PAYG refund binds its real payment and invoice without an order');
select throws_ok($$insert into refunds(id,payment_id,order_id,currency,amount_minor,reason_code,status)
 values('99300000-0000-4000-8000-000000001431','99100000-0000-4000-8000-000000001430',null,'USD',10,'customer_request','approved');
 select core_create_stripe_adjustment_operation('99300000-0000-4000-8000-000000001431','refund','requested_by_customer','customer_request')$$,
 '23514','Stripe adjustment aggregate ceiling exceeded','PAYG credits and refunds share the same invoice ceiling');
select throws_ok($$insert into refunds(id,payment_id,order_id,currency,amount_minor,reason_code,status)
 values('99300000-0000-4000-8000-000000001432','99100000-0000-4000-8000-000000001430','80000000-0000-4000-8000-000000000001','USD',1,'customer_request','approved')$$,
 '23514',null,'PAYG refund cannot borrow an unrelated order');
set constraints all immediate;
select * from finish();
rollback;
