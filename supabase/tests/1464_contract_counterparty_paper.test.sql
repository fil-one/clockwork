-- Counterparty paper sent for the Fil One countersignature (001464): a
-- second document type on the contract signing table, pinned to an uploaded
-- PDF on a contract on the counterparty's paper, with the counterparty either
-- signing first or not at all, and every earlier rule unchanged.
begin;
select plan(16);
set local search_path = public, extensions;

select has_column('public', 'commerce_contract_signing', 'document_type', 'the document type is kept');
select has_column('public', 'commerce_contract_signing', 'counterparty_signs', 'who signs is kept');

insert into commerce_contracts (id, counterparty_name, contract_type, paper, status, owner_name, created_by_id, created_by_name) values
  ('c1460000-0000-4000-8000-000000000001','Bluefin','other','theirs','in_negotiation','R.W.','a1460000-0000-4000-8000-000000000001','R.W.'),
  ('c1460000-0000-4000-8000-000000000002','Bluefin','other','ours','draft','R.W.','a1460000-0000-4000-8000-000000000001','R.W.'),
  ('c1460000-0000-4000-8000-000000000003','Bluefin','other','theirs','executed','R.W.','a1460000-0000-4000-8000-000000000001','R.W.'),
  ('c1460000-0000-4000-8000-000000000004','Bluefin','other','theirs','draft','R.W.','a1460000-0000-4000-8000-000000000001','R.W.');
insert into commerce_stored_documents (id, purpose, content_type, size_bytes, sha256, bytes) values
  ('d1460000-0000-4000-8000-000000000001','contract','application/pdf',8,repeat('c',64),'%PDF-1.7'::bytea),
  ('d1460000-0000-4000-8000-000000000002','contract','application/pdf',8,repeat('c',64),'%PDF-1.7'::bytea),
  ('d1460000-0000-4000-8000-000000000003','contract','application/pdf',8,repeat('e',64),'%PDF-1.7'::bytea),
  ('d1460000-0000-4000-8000-000000000004','contract','application/pdf',8,repeat('f',64),'%PDF-1.7'::bytea);
insert into commerce_contract_files (id, contract_id, kind, file_name, storage_backend, storage_key, sha256, size_bytes, content_type, uploaded_by_name) values
  ('f1460000-0000-4000-8000-000000000001','c1460000-0000-4000-8000-000000000001','counterparty_draft','Their paper.pdf',
   'postgres','d1460000-0000-4000-8000-000000000001',repeat('c',64),8,'application/pdf','R.W.'),
  ('f1460000-0000-4000-8000-000000000002','c1460000-0000-4000-8000-000000000002','main','Ours.pdf',
   'postgres','d1460000-0000-4000-8000-000000000002',repeat('c',64),8,'application/pdf','R.W.'),
  -- Their signed copy on a contract already executed.
  ('f1460000-0000-4000-8000-000000000003','c1460000-0000-4000-8000-000000000003','main','Signed.pdf',
   'postgres','d1460000-0000-4000-8000-000000000003',repeat('e',64),8,'application/pdf','R.W.'),
  -- A prepared document, which is never the paper a request is pinned to.
  ('f1460000-0000-4000-8000-000000000004','c1460000-0000-4000-8000-000000000004','generated','Prepared.pdf',
   'postgres','d1460000-0000-4000-8000-000000000004',repeat('f',64),8,'application/pdf','R.W.');

create function pg_temp.paper(contract uuid, hash text, signs boolean, type text default 'counterparty_paper') returns void
language sql as $$
  insert into commerce_contract_signing (contract_id, template_id, template_version, template_hash, document_name, input,
    counterparty_signer, countersigner, preparer_id, preparer_name, approval_required, approval_state, test_mode,
    document_type, counterparty_signs)
  values (contract, 'counterparty-paper', 'interim-2026-10-10', hash, 'Doc', '{}', '{}', '{}',
    'a1460000-0000-4000-8000-000000000001', 'R.W.', true, 'pending', true, type, signs)
$$;

set local role clockwork_service;

-- =========================================================================
-- 1. Existing rows read as template contracts both parties sign.
-- =========================================================================
select is(
  (select array[column_default::text] from information_schema.columns
   where table_schema = 'public' and table_name = 'commerce_contract_signing'
     and column_name = 'document_type')
  || (select array[column_default::text] from information_schema.columns
   where table_schema = 'public' and table_name = 'commerce_contract_signing'
     and column_name = 'counterparty_signs'),
  array['''contract_template''::text', 'true'],
  'earlier requests read as template contracts both parties sign');
select throws_ok($$
  select pg_temp.paper('c1460000-0000-4000-8000-000000000002', repeat('b',64), false, 'contract_template')
$$, '23514', null, 'only counterparty paper can leave the counterparty out');

-- =========================================================================
-- 2. Counterparty paper is pinned to a PDF on a contract on their paper.
-- =========================================================================
select throws_ok($$
  select pg_temp.paper('c1460000-0000-4000-8000-000000000002', repeat('c',64), true)
$$, 'P0001', 'Counterparty paper is signed only from a PDF attached to a contract on their paper',
  'a contract on our paper is not counterparty paper');
select throws_ok($$
  select pg_temp.paper('c1460000-0000-4000-8000-000000000001', repeat('d',64), true)
$$, 'P0001', 'Counterparty paper is signed only from a PDF attached to a contract on their paper',
  'the request names the hash of a PDF attached to the contract');
select throws_ok($$
  select pg_temp.paper('c1460000-0000-4000-8000-000000000003', repeat('e',64), false)
$$, 'P0001', 'Counterparty paper is signed only from a PDF attached to a contract on their paper',
  'an executed contract is not sent again');
select throws_ok($$
  select pg_temp.paper('c1460000-0000-4000-8000-000000000004', repeat('f',64), false)
$$, 'P0001', 'Counterparty paper is signed only from a PDF attached to a contract on their paper',
  'only their main PDF or draft can be the paper, never a prepared or executed document');
select lives_ok($$
  select pg_temp.paper('c1460000-0000-4000-8000-000000000001', repeat('c',64), false)
$$, 'their signed PDF is prepared for the Fil One signature alone');

-- =========================================================================
-- 3. The type, the signers and the pinned PDF stay fixed.
-- =========================================================================
select throws_ok($$
  update commerce_contract_signing set counterparty_signs = true
  where contract_id = 'c1460000-0000-4000-8000-000000000001'
$$, 'P0001', 'Contract signing snapshots and provider binding are immutable', 'who signs cannot change');
select throws_ok($$
  update commerce_contract_signing set document_type = 'contract_template'
  where contract_id = 'c1460000-0000-4000-8000-000000000001'
$$, 'P0001', 'Contract signing snapshots and provider binding are immutable', 'the document type cannot change');
select throws_ok($$
  delete from commerce_contract_files where id = 'f1460000-0000-4000-8000-000000000001'
$$, 'P0001', 'A PDF sent for signature is permanent', 'the pinned PDF cannot be removed');
select lives_ok($$
  delete from commerce_contract_files where id = 'f1460000-0000-4000-8000-000000000002'
$$, 'another contract''s upload can still be removed');

-- =========================================================================
-- 4. The 001443 and 001459 rules hold for counterparty paper.
-- =========================================================================
select throws_ok($$
  update commerce_contract_signing set state = 'sending'
  where contract_id = 'c1460000-0000-4000-8000-000000000001'
$$, 'P0001', 'Contract requires approval before sending', 'counterparty paper waits for approval');
select throws_ok($$
  update commerce_contract_signing set cancel_code = 'voided', cancel_reason = 'Wrong file'
  where contract_id = 'c1460000-0000-4000-8000-000000000001'
$$, 'P0001', 'Contract signing cancel code is written only when the request is canceled',
  'the cancel code is still written only with the cancellation');
select lives_ok($$
  update commerce_contract_signing set state = 'canceled', cancel_code = 'discarded'
  where contract_id = 'c1460000-0000-4000-8000-000000000001'
$$, 'an unsent request is discarded');
reset role;

select * from finish();
rollback;
