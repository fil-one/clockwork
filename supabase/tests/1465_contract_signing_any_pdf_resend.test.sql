-- Any uploaded PDF sent for signature, and a contract sent again (001465):
-- an uploaded PDF on our paper is sendable, an ended request is replaced by
-- the next one and kept whole in an append-only history, the numbering and
-- the preparer's copy address stay fixed, and the PDFs a replaced request
-- used stay attached.
begin;
select plan(25);
set local search_path = public, extensions;

select has_column('public', 'commerce_contract_signing', 'request_number', 'requests are numbered');
select has_column('public', 'commerce_contract_signing', 'preparer_email', 'the preparer copied on the signed copy is kept');
select has_table('public', 'commerce_contract_signing_history', 'replaced requests are kept');

insert into commerce_contracts (id, counterparty_name, contract_type, paper, status, owner_name, created_by_id, created_by_name) values
  -- Fil One's own term sheet, uploaded as a PDF.
  ('c1465000-0000-4000-8000-000000000001','Qubi','channel_partnership','ours','draft','R.W.','a1465000-0000-4000-8000-000000000001','R.W.'),
  -- A template contract signed elsewhere and marked executed by hand.
  ('c1465000-0000-4000-8000-000000000002','Bonum','other','ours','draft','R.W.','a1465000-0000-4000-8000-000000000001','R.W.');
insert into commerce_stored_documents (id, purpose, content_type, size_bytes, sha256, bytes) values
  ('d1465000-0000-4000-8000-000000000001','contract','application/pdf',8,repeat('c',64),'%PDF-1.7'::bytea),
  ('d1465000-0000-4000-8000-000000000002','contract','application/pdf',8,repeat('d',64),'%PDF-1.7'::bytea),
  ('d1465000-0000-4000-8000-000000000003','contract','application/pdf',8,repeat('e',64),'%PDF-1.7'::bytea);
insert into commerce_contract_files (id, contract_id, kind, file_name, storage_backend, storage_key, sha256, size_bytes, content_type, uploaded_by_name) values
  ('f1465000-0000-4000-8000-000000000001','c1465000-0000-4000-8000-000000000001','main','Term sheet.pdf',
   'postgres','d1465000-0000-4000-8000-000000000001',repeat('c',64),8,'application/pdf','R.W.'),
  ('f1465000-0000-4000-8000-000000000002','c1465000-0000-4000-8000-000000000001','generated','Prepared 1.pdf',
   'postgres','d1465000-0000-4000-8000-000000000002',repeat('d',64),8,'application/pdf','R.W.');

create function pg_temp.request(contract uuid, hash text, number integer, type text default 'counterparty_paper') returns void
language sql as $$
  insert into commerce_contract_signing (contract_id, request_number, template_id, template_version, template_hash,
    document_name, input, counterparty_signer, countersigner, preparer_id, preparer_name, preparer_email,
    approval_required, approval_state, test_mode, document_type, counterparty_signs)
  values (contract, number, 'counterparty-paper', '2026-10-10', hash, 'Doc', '{}', '{}', '{}',
    'a1465000-0000-4000-8000-000000000001', 'R.W.', 'rw@fil.one', true, 'pending', true, type, true)
$$;

set local role clockwork_service;

-- =========================================================================
-- 1. An uploaded PDF on Fil One's own paper is sent for signature.
-- =========================================================================
select lives_ok($$
  select pg_temp.request('c1465000-0000-4000-8000-000000000001', repeat('c',64), 1)
$$, 'our own term sheet is prepared for signature');
select throws_ok($$
  insert into commerce_contract_signing (contract_id, template_id, template_version, template_hash, document_name, input,
    counterparty_signer, countersigner, preparer_id, preparer_name, preparer_email, approval_required, approval_state, test_mode)
  values ('c1465000-0000-4000-8000-000000000002','t','1',repeat('b',64),'Doc','{}','{}','{}',
    'a1465000-0000-4000-8000-000000000001','R.W.','not an email',false,'not_required',true)
$$, '23514', null, 'the preparer copy address is an email address');

-- =========================================================================
-- 2. Only an ended request, not in use, is replaced.
-- =========================================================================
select throws_ok($$
  delete from commerce_contract_signing where contract_id = 'c1465000-0000-4000-8000-000000000001'
$$, 'P0001', 'Only a declined, expired or voided signing request can be replaced', 'an open request stays');
update commerce_contract_signing set state = 'canceled', cancel_code = 'discarded',
  lease_until = now() + interval '1 minute', lease_token = 'a1465000-0000-4000-8000-0000000000ff'
  where contract_id = 'c1465000-0000-4000-8000-000000000001';
select throws_ok($$
  delete from commerce_contract_signing where contract_id = 'c1465000-0000-4000-8000-000000000001'
$$, 'P0001', 'A signing request in use cannot be replaced', 'a request under a lease stays');
update commerce_contract_signing set lease_until = null
  where contract_id = 'c1465000-0000-4000-8000-000000000001';
select lives_ok($$
  delete from commerce_contract_signing where contract_id = 'c1465000-0000-4000-8000-000000000001'
$$, 'a voided request is replaced');
select is(
  (select array[state, request->>'request_number', request->>'cancel_code', request->>'preparer_email',
     (request ? 'lease_token')::text]
   from commerce_contract_signing_history where contract_id = 'c1465000-0000-4000-8000-000000000001'),
  array['canceled', '1', 'discarded', 'rw@fil.one', 'false'],
  'the replaced request is kept whole, without its lease');

-- =========================================================================
-- 3. The next request is numbered after the ones it replaces.
-- =========================================================================
select throws_ok($$
  select pg_temp.request('c1465000-0000-4000-8000-000000000001', repeat('c',64), 1)
$$, 'P0001', 'A contract signing request is numbered after the requests it replaces', 'a number is not reused');
select throws_ok($$
  select pg_temp.request('c1465000-0000-4000-8000-000000000001', repeat('c',64), 3)
$$, 'P0001', 'A contract signing request is numbered after the requests it replaces', 'no number is skipped');
select lives_ok($$
  select pg_temp.request('c1465000-0000-4000-8000-000000000001', repeat('c',64), 2)
$$, 'the second request is prepared');
select lives_ok($$
  insert into commerce_contract_files (id, contract_id, kind, file_name, storage_backend, storage_key, sha256, size_bytes, content_type, uploaded_by_name)
  values ('f1465000-0000-4000-8000-000000000003','c1465000-0000-4000-8000-000000000001','generated','Prepared 2.pdf',
    'postgres','d1465000-0000-4000-8000-000000000003',repeat('e',64),8,'application/pdf','R.W.')
$$, 'each request keeps its own prepared PDF');
select throws_ok($$
  update commerce_contract_signing set request_number = 5
  where contract_id = 'c1465000-0000-4000-8000-000000000001'
$$, 'P0001', 'Contract signing snapshots and provider binding are immutable', 'the number is fixed');
select throws_ok($$
  update commerce_contract_signing set preparer_email = 'someone@fil.one'
  where contract_id = 'c1465000-0000-4000-8000-000000000001'
$$, 'P0001', 'Contract signing snapshots and provider binding are immutable', 'the copy address is fixed');

-- =========================================================================
-- 4. The history is append-only, and its PDFs stay attached.
-- =========================================================================
select throws_ok($$
  update commerce_contract_signing_history set state = 'expired'
$$, '42501', null, 'a replaced request is never changed');
select throws_ok($$
  insert into commerce_contract_signing_history (contract_id, request_number, state, request)
  values ('c1465000-0000-4000-8000-000000000001', 7, 'canceled', '{}')
$$, '42501', null, 'a request is never written to the history except as it is replaced');
select throws_ok($$
  delete from commerce_contract_signing_history
$$, '42501', null, 'a replaced request is never removed');
select throws_ok($$
  delete from commerce_contract_files where id = 'f1465000-0000-4000-8000-000000000001'
$$, 'P0001', 'A PDF sent for signature is permanent', 'the PDF sent is kept');
update commerce_contract_signing set state = 'expired'
  where contract_id = 'c1465000-0000-4000-8000-000000000001';
delete from commerce_contract_signing where contract_id = 'c1465000-0000-4000-8000-000000000001';
select is(
  (select array_agg(request_number order by request_number) from commerce_contract_signing_history
   where contract_id = 'c1465000-0000-4000-8000-000000000001'),
  array[1, 2], 'every replaced request is kept');
select throws_ok($$
  delete from commerce_contract_files where id = 'f1465000-0000-4000-8000-000000000001'
$$, 'P0001', 'A PDF sent for signature is permanent', 'the PDF a replaced request sent is kept');

-- =========================================================================
-- 5. An executed contract is not sent again; earlier rules hold.
-- =========================================================================
select lives_ok($$
  insert into commerce_contract_signing (contract_id, template_id, template_version, template_hash, document_name, input,
    counterparty_signer, countersigner, preparer_id, preparer_name, approval_required, approval_state, test_mode)
  values ('c1465000-0000-4000-8000-000000000002','t','1',repeat('b',64),'Doc','{}','{}','{}',
    'a1465000-0000-4000-8000-000000000001','R.W.',false,'not_required',true)
$$, 'a template request is prepared');
update commerce_contract_signing set state = 'canceled', cancel_code = 'discarded'
  where contract_id = 'c1465000-0000-4000-8000-000000000002';
update commerce_contracts set status = 'executed' where id = 'c1465000-0000-4000-8000-000000000002';
delete from commerce_contract_signing where contract_id = 'c1465000-0000-4000-8000-000000000002';
select throws_ok($$
  insert into commerce_contract_signing (contract_id, request_number, template_id, template_version, template_hash,
    document_name, input, counterparty_signer, countersigner, preparer_id, preparer_name, approval_required,
    approval_state, test_mode)
  values ('c1465000-0000-4000-8000-000000000002',2,'t','1',repeat('b',64),'Doc','{}','{}','{}',
    'a1465000-0000-4000-8000-000000000001','R.W.',false,'not_required',true)
$$, 'P0001', 'An executed contract is not sent for signature again', 'an executed contract is not sent again');
select throws_ok($$
  select pg_temp.request('c1465000-0000-4000-8000-000000000001', repeat('c',64), 3, 'contract_template') ;
  update commerce_contract_signing set state = 'sending'
  where contract_id = 'c1465000-0000-4000-8000-000000000001'
$$, 'P0001', 'Contract requires approval before sending', 'a request sent again waits for approval');
select throws_ok($$
  insert into commerce_contract_signing (contract_id, request_number, template_id, template_version, template_hash,
    document_name, input, counterparty_signer, countersigner, preparer_id, preparer_name, approval_required,
    approval_state, test_mode, state)
  values ('c1465000-0000-4000-8000-000000000001',3,'t','1',repeat('b',64),'Doc','{}','{}','{}',
    'a1465000-0000-4000-8000-000000000001','R.W.',false,'not_required',true,'sent')
$$, 'P0001', 'A contract signing request starts as an undecided, unsent draft', 'a request sent again starts as a draft');
reset role;

select * from finish();
rollback;
