begin;
select plan(27);
set local search_path=public,extensions;

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
  'public.commerce_stored_documents'::regclass,'public.commerce_contracts'::regclass,
  'public.commerce_contract_files'::regclass,'public.commerce_contract_events'::regclass,
  'public.commerce_contract_signing'::regclass,'public.commerce_sales_collateral'::regclass)),
  'every contract table forces row security');
select ok(not has_table_privilege('clockwork_runtime','public.commerce_contracts','SELECT'),'customer identities cannot read the register');
select ok(not has_table_privilege('clockwork_runtime','public.commerce_stored_documents','SELECT'),'customer identities cannot read stored documents');
select ok(not has_table_privilege('authenticated','public.commerce_sales_collateral','SELECT'),'authenticated cannot read the sales library');
select ok(not has_table_privilege('clockwork_service','public.commerce_contracts','DELETE'),'contracts are never deleted');
select ok(not has_table_privilege('clockwork_service','public.commerce_contract_events','UPDATE'),'activity history cannot be rewritten');
select ok(not has_table_privilege('clockwork_service','public.commerce_contract_events','DELETE'),'activity history cannot be erased');
select ok(not has_table_privilege('clockwork_service','public.commerce_contract_files','UPDATE'),'stored file references are immutable');
select ok(not has_table_privilege('clockwork_service','public.commerce_stored_documents','UPDATE'),'stored bytes are never rewritten');

select is(commerce_contract_term_boundary('2024-01-31',1,true,1,'2024-02-29'),'2024-03-31'::date,'monthly renewals keep the month-end anniversary');
select is(commerce_contract_term_boundary('2024-02-29',12,true,12,'2027-03-01'),'2028-02-29'::date,'leap-day contracts renew on 29 February when it exists');
select is(commerce_contract_term_boundary('2025-08-31',6,false,null,'2030-01-01'),'2026-02-28'::date,'a fixed term keeps its expiry');

set local role clockwork_service;
select throws_ok($$insert into commerce_stored_documents(id,purpose,content_type,size_bytes,sha256,bytes)
  values('019a44ac-0000-7000-8000-00000000aa01','contract','application/pdf',9,repeat('a',64),'not a pdf'::bytea)$$,
  '23514',null,'only PDF bytes are stored');
select lives_ok($$insert into commerce_contracts(id,counterparty_name,contract_type,paper,status,owner_name,created_by_id,created_by_name)
  values('019a44ac-0000-7000-8000-00000000aa02','Bluefin','other','ours','draft','R.W.','019a44ac-0000-7000-8000-00000000aa03','R.W.')$$,
  'staff record a contract');
select throws_ok($$insert into commerce_contracts(id,counterparty_name,contract_type,paper,status,owner_name,created_by_id,created_by_name,auto_renew)
  values('019a44ac-0000-7000-8000-00000000aa09','Bluefin','other','ours','draft','R.W.','019a44ac-0000-7000-8000-00000000aa03','R.W.',true)$$,
  '23514',null,'auto-renewal needs a term');
select throws_ok($$insert into commerce_contract_signing(contract_id,template_id,template_version,template_hash,document_name,input,counterparty_signer,countersigner,preparer_id,preparer_name,approval_required,approval_state,approver_id,approver_name,decided_at,test_mode)
  values('019a44ac-0000-7000-8000-00000000aa02','test-fixture','1',repeat('b',64),'Doc','{}','{}','{}','019a44ac-0000-7000-8000-00000000aa03','R.W.',true,'approved','019a44ac-0000-7000-8000-00000000aa03','R.W.',now(),true)$$,
  'P0001','A contract signing request starts as an undecided, unsent draft','an approval cannot be recorded at creation');
select throws_ok($$insert into commerce_contract_signing(contract_id,template_id,template_version,template_hash,document_name,input,counterparty_signer,countersigner,preparer_id,preparer_name,approval_required,approval_state,state,provider_id,test_mode)
  values('019a44ac-0000-7000-8000-00000000aa02','test-fixture','1',repeat('b',64),'Doc','{}','{}','{}','019a44ac-0000-7000-8000-00000000aa03','R.W.',false,'not_required','sent','11111111-1111-4111-8111-111111111111',true)$$,
  'P0001','A contract signing request starts as an undecided, unsent draft','a signing request cannot be created already sent');
select lives_ok($$insert into commerce_contract_signing(contract_id,template_id,template_version,template_hash,document_name,input,counterparty_signer,countersigner,preparer_id,preparer_name,approval_required,approval_state,test_mode)
  values('019a44ac-0000-7000-8000-00000000aa02','test-fixture','1',repeat('b',64),'Doc','{}','{}','{}','019a44ac-0000-7000-8000-00000000aa03','R.W.',true,'pending',true)$$,
  'a preparation waits for approval');
select throws_ok($$update commerce_contract_signing set approval_state='approved',approver_id=preparer_id,approver_name='R.W.',decided_at=now() where contract_id='019a44ac-0000-7000-8000-00000000aa02'$$,
  '23514',null,'the preparer cannot be the approver');
select throws_ok($$update commerce_contract_signing set state='sending' where contract_id='019a44ac-0000-7000-8000-00000000aa02'$$,
  'P0001','Contract requires approval before sending','nothing is sent before approval');
select throws_ok($$update commerce_contract_signing set input='{"x":"y"}' where contract_id='019a44ac-0000-7000-8000-00000000aa02'$$,
  'P0001','Contract signing snapshots and provider binding are immutable','prepared values cannot change');
select throws_ok($$update commerce_contract_signing set approval_state='approved',approver_id='019a44ac-0000-7000-8000-00000000aa04',approver_name='J',decided_at=now(),state='completed' where contract_id='019a44ac-0000-7000-8000-00000000aa02'$$,
  'P0001','Contract completion requires archived evidence','completion requires the executed PDF');
select lives_ok($$insert into commerce_stored_documents(id,purpose,content_type,size_bytes,sha256,bytes)
  values('019a44ac-0000-7000-8000-00000000aa05','contract','application/pdf',8,repeat('c',64),'%PDF-1.7'::bytea)$$,
  'a PDF is stored');
select lives_ok($$insert into commerce_contract_files(id,contract_id,kind,file_name,storage_backend,storage_key,sha256,size_bytes,content_type,uploaded_by_name)
  values('019a44ac-0000-7000-8000-00000000aa06','019a44ac-0000-7000-8000-00000000aa02','main','Signed.pdf','postgres','019a44ac-0000-7000-8000-00000000aa05',repeat('c',64),8,'application/pdf','R.W.')$$,
  'a contract references it');
select throws_ok($$delete from commerce_stored_documents where id='019a44ac-0000-7000-8000-00000000aa05'$$,
  'P0001','Stored document is still referenced','referenced bytes cannot be deleted');
select lives_ok($$update commerce_contracts set status='executed' where id='019a44ac-0000-7000-8000-00000000aa02'$$,
  'the contract is executed');
select throws_ok($$update commerce_contracts set status='draft' where id='019a44ac-0000-7000-8000-00000000aa02'$$,
  'P0001','An executed contract can only expire or be terminated','an executed contract cannot return to draft');
reset role;

select * from finish();
rollback;
