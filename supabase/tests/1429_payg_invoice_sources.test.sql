begin;
select plan(14);
set local search_path = public, extensions;

-- A complete retained source fixture, independent from term quote/order rows.
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
  insert into invoices(id,billing_source,payg_effect_key,account_id,currency,amount_minor,tax_minor,tax_treatment,status)
    values(target,'payg',effect_key,customer.id,'USD',amount_override,0,'standard','draft');
  if include_snapshot then
    question := jsonb_build_object('currency','USD','supplier',jsonb_build_object('legalEntityId',supplier.id::text),
      'customer',jsonb_build_object('accountId',customer.id::text),'paygSource',jsonb_build_object('enrollmentId',enrollment_id::text,'effectKey',effect_key),
      'lines',jsonb_build_array(jsonb_build_object('lineId','payg','taxCode','txcd_payg','netMinor','100')),
      'ruleBooks',jsonb_build_array(jsonb_build_object('id',book.id::text,'version',book.version)));
    tax_detail := jsonb_build_object('determinationId','pgtap-tax','supplierLegalEntityId',supplier.id::text,'customerAccountId',customer.id::text,
      'taxPointDate','2026-08-31','confidence','determined','reviewReasons','[]'::jsonb,'inputProvenance',book.input_provenance,
      'determinationInput',question,'determinationInputHash',encode(digest(convert_to(private.canonical_jsonb_text(question),'UTF8'),'sha256'),'hex'),
      'lines',jsonb_build_array(jsonb_build_object('lineId','payg','jurisdiction','US','treatment','standard','taxCode','txcd_payg',
        'ratePpm',0,'rateKind','standard','taxableMinor','100','taxMinor','0','ruleBookId',book.id::text,'ruleBookVersion',book.version,'legalBasis','Test fixture only')));
    source := jsonb_build_object('rating',rating,'effect',effect,'stripeCustomerId','cus_payg_test',
      'supplier',jsonb_build_object('legalEntityId',supplier.id::text,'legalName',supplier.legal_name,'registeredAddress',supplier.registered_address,
        'establishedCountry',supplier.established_country,'invoiceHeaderText',supplier.invoice_header_text,'invoiceFooterText',supplier.invoice_footer_text),
      'customer',jsonb_build_object('accountId',customer.id::text,'legalName',customer.legal_name,'registeredAddress',customer.registered_address,
        'country',customer.country,'invoiceDeliveryEmail',customer.invoice_delivery_email),
      'taxDetermination',jsonb_build_object('currency','USD','netMinor','100','taxMinor','0','treatment','standard','detail',tax_detail));
    insert into core_payg_invoice_sources(invoice_id,enrollment_id,effect_key,source_snapshot,source_hash)
      values(target,enrollment_id,effect_key,source,case when corrupt_hash then repeat('0',64) else encode(digest(convert_to(private.canonical_jsonb_text(source),'UTF8'),'sha256'),'hex') end);
  end if;
  return target;
end $$;

select is((select bool_and(billing_source='order' and payg_effect_key is null and order_id is not null) from invoices),true,'existing term invoices retain explicit order source');
select lives_ok($$select pg_temp.payg_invoice_fixture('99000000-0000-4000-8000-000000001429')$$,'PAYG invoice binds retained rating and immutable tax/document source');
set constraints invoices_payg_snapshot_required immediate;
select throws_ok($$select pg_temp.payg_invoice_fixture('99000000-0000-4000-8000-000000001430',101)$$,'23514','PAYG invoice must match its retained authorized billing effect','forged PAYG amount is rejected');
select throws_ok($$select pg_temp.payg_invoice_fixture('99000000-0000-4000-8000-000000001431',100,false)$$,'23514','PAYG invoice requires its immutable tax and document source','invoice cannot commit without its immutable source');
set constraints invoices_payg_snapshot_required deferred;
select throws_ok($$select pg_temp.payg_invoice_fixture('99000000-0000-4000-8000-000000001432',100,true,true)$$,'23514','PAYG invoice canonical source hash mismatch','caller cannot substitute a forged source hash');
select throws_ok($$update core_payg_invoice_sources set source_snapshot='{}' where invoice_id='99000000-0000-4000-8000-000000001429'$$,'P0001','PAYG_RETAINED_HISTORY_IMMUTABLE','retained PAYG evidence cannot be edited');
select lives_ok($$insert into payments(id,invoice_id,order_id,stripe_payment_intent_id,currency,amount_minor,status,received_at)
 values('99100000-0000-4000-8000-000000001429','99000000-0000-4000-8000-000000001429',null,'pi_payg_pgtap','USD',100,'succeeded','2026-09-01T00:00:00Z')$$,'PAYG payment matches its invoice without fabricating an order');
select throws_ok($$insert into payments(id,invoice_id,order_id,stripe_payment_intent_id,currency,amount_minor,status,received_at)
 values('99100000-0000-4000-8000-000000001430','99000000-0000-4000-8000-000000001429','80000000-0000-4000-8000-000000000001','pi_payg_wrong_order','USD',100,'succeeded','2026-09-01T00:00:00Z')$$,'23514','Stripe payment must match its local invoice, order, and currency','PAYG payment cannot acquire a term order');
select is(has_table_privilege('clockwork_runtime','core_payg_invoice_sources','INSERT'),false,'tenant cannot inject authoritative billing sources');
select throws_ok($$update invoices set billing_source='order',order_id='80000000-0000-4000-8000-000000000001',payg_effect_key=null where id='99000000-0000-4000-8000-000000001429'$$,'23514',null,'invoice source cannot change after materialization');
select throws_ok($$insert into core_payg_invoice_sources(invoice_id,enrollment_id,effect_key,source_snapshot,source_hash)
 select invoice_id,enrollment_id,effect_key,source_snapshot #- '{taxDetermination,detail,lines,0,ratePpm}',source_hash
 from core_payg_invoice_sources where invoice_id='99000000-0000-4000-8000-000000001429'$$,
 '23514','PAYG tax lines must match invoice tax and pinned rule books','a missing tax rate cannot hide behind SQL null arithmetic');
select throws_ok($$insert into core_payg_invoice_sources(invoice_id,enrollment_id,effect_key,source_snapshot,source_hash)
 select invoice_id,enrollment_id,effect_key,jsonb_set(source_snapshot,'{taxDetermination,detail,determinationInput,lines,0,netMinor}','"101"'),source_hash
 from core_payg_invoice_sources where invoice_id='99000000-0000-4000-8000-000000001429'$$,
 '23514','PAYG tax question must describe the billed source and net','tax input must describe the actual charge rather than a different net');
select throws_ok($$delete from core_payg_invoice_sources where invoice_id='99000000-0000-4000-8000-000000001429'$$,
 'P0001','PAYG_RETAINED_HISTORY_IMMUTABLE','source evidence cannot be deleted after invoicing');
select throws_ok($$insert into core_payg_pending_invoice_effects(idempotency_key,enrollment_id,payload)
 select idempotency_key||':duplicate',enrollment_id,jsonb_set(payload,'{idempotencyKey}',to_jsonb(idempotency_key||':duplicate'))
 from core_payg_pending_invoice_effects where idempotency_key='pgtap-payg:99000000-0000-4000-8000-000000001429'$$,
 '23505',null,'one period revision cannot be billed again under another effect key');
select * from finish();
rollback;
