-- Signer correction and cancel codes on template contracts (001459): the
-- four columns start empty, the correction columns change only while the
-- request is open, the cancel columns are written only in the change that
-- cancels it, and every rule from 001443 still holds.
begin;
select plan(22);
set local search_path = public, extensions;

select has_column('public', 'commerce_contract_signing', 'corrected_signer_email', 'the confirmed correction is kept');
select has_column('public', 'commerce_contract_signing', 'pending_signer_email', 'the unconfirmed correction is kept');
select has_column('public', 'commerce_contract_signing', 'cancel_code', 'the cancel code is kept');
select has_column('public', 'commerce_contract_signing', 'cancel_reason', 'the typed void reason is kept');

insert into commerce_contracts (id, counterparty_name, contract_type, paper, status, owner_name, created_by_id, created_by_name) values
  ('c1459000-0000-4000-8000-000000000001','Bluefin','other','ours','draft','R.W.','a1459000-0000-4000-8000-000000000001','R.W.'),
  ('c1459000-0000-4000-8000-000000000002','Bluefin','other','ours','draft','R.W.','a1459000-0000-4000-8000-000000000001','R.W.'),
  ('c1459000-0000-4000-8000-000000000003','Bluefin','other','ours','draft','R.W.','a1459000-0000-4000-8000-000000000001','R.W.');

set local role clockwork_service;

-- =========================================================================
-- 1. A request starts with no correction and no cancel code.
-- =========================================================================
select throws_ok($$
  insert into commerce_contract_signing (contract_id, template_id, template_version, template_hash, document_name, input,
    counterparty_signer, countersigner, preparer_id, preparer_name, approval_required, approval_state, test_mode, cancel_code)
  values ('c1459000-0000-4000-8000-000000000001','test-fixture','1',repeat('b',64),'Doc','{}','{}','{}',
    'a1459000-0000-4000-8000-000000000001','R.W.',false,'not_required',true,'voided')
$$, 'P0001', 'A contract signing request starts as an undecided, unsent draft', 'a new request has no cancel code');
select throws_ok($$
  insert into commerce_contract_signing (contract_id, template_id, template_version, template_hash, document_name, input,
    counterparty_signer, countersigner, preparer_id, preparer_name, approval_required, approval_state, test_mode, corrected_signer_email)
  values ('c1459000-0000-4000-8000-000000000001','test-fixture','1',repeat('b',64),'Doc','{}','{}','{}',
    'a1459000-0000-4000-8000-000000000001','R.W.',false,'not_required',true,'right@example.com')
$$, 'P0001', 'A contract signing request starts as an undecided, unsent draft', 'a new request has no correction');
select lives_ok($$
  insert into commerce_contract_signing (contract_id, template_id, template_version, template_hash, document_name, input,
    counterparty_signer, countersigner, preparer_id, preparer_name, approval_required, approval_state, test_mode)
  values
    ('c1459000-0000-4000-8000-000000000001','test-fixture','1',repeat('b',64),'Doc','{}','{}','{}',
     'a1459000-0000-4000-8000-000000000001','R.W.',false,'not_required',true),
    ('c1459000-0000-4000-8000-000000000002','test-fixture','1',repeat('b',64),'Doc','{}','{}','{}',
     'a1459000-0000-4000-8000-000000000001','R.W.',false,'not_required',true),
    ('c1459000-0000-4000-8000-000000000003','test-fixture','1',repeat('b',64),'Doc','{}','{}','{}',
     'a1459000-0000-4000-8000-000000000001','R.W.',false,'not_required',true)
$$, 'three requests are prepared');
update commerce_contract_signing set state = 'sent', provider_id = contract_id::text
where contract_id in ('c1459000-0000-4000-8000-000000000001','c1459000-0000-4000-8000-000000000002','c1459000-0000-4000-8000-000000000003');

-- =========================================================================
-- 2. A correction while the request is out for signature.
-- =========================================================================
select lives_ok($$
  update commerce_contract_signing set pending_signer_email = 'right@example.com'
  where contract_id = 'c1459000-0000-4000-8000-000000000001'
$$, 'a pending correction is recorded on a sent request');
select lives_ok($$
  update commerce_contract_signing set corrected_signer_email = 'right@example.com', pending_signer_email = null
  where contract_id = 'c1459000-0000-4000-8000-000000000001'
$$, 'SignWell''s confirmation replaces it with the corrected email');
select throws_ok($$
  update commerce_contract_signing set pending_signer_email = 'Right@Example.com'
  where contract_id = 'c1459000-0000-4000-8000-000000000001'
$$, '23514', null, 'a correction is stored lowercased');

-- =========================================================================
-- 3. The cancel columns are written only when the request is canceled.
-- =========================================================================
select throws_ok($$
  update commerce_contract_signing set cancel_code = 'signer_change'
  where contract_id = 'c1459000-0000-4000-8000-000000000001'
$$, 'P0001', 'Contract signing cancel code is written only when the request is canceled',
  'an open request takes no cancel code');
select throws_ok($$
  update commerce_contract_signing set state = 'canceled', cancel_code = 'signer_change', cancel_reason = 'New signer'
  where contract_id = 'c1459000-0000-4000-8000-000000000001'
$$, '23514', null, 'only a void with a reason keeps a typed reason');
select throws_ok($$
  update commerce_contract_signing set state = 'canceled', cancel_code = 'discarded', cancel_reason = 'Not needed'
  where contract_id = 'c1459000-0000-4000-8000-000000000001'
$$, '23514', null, 'a discarded draft keeps no typed reason');
select lives_ok($$
  update commerce_contract_signing set state = 'canceled', cancel_code = 'signer_change'
  where contract_id = 'c1459000-0000-4000-8000-000000000001'
$$, 'a void for a different signer records its code');
select lives_ok($$
  update commerce_contract_signing set state = 'canceled', cancel_code = 'voided', cancel_reason = 'Wrong legal entity'
  where contract_id = 'c1459000-0000-4000-8000-000000000002'
$$, 'a void with a reason records both');
select throws_ok($$
  update commerce_contract_signing set state = 'canceled', cancel_code = 'superseded'
  where contract_id = 'c1459000-0000-4000-8000-000000000003'
$$, '23514', null, 'contracts have no superseded code');

-- =========================================================================
-- 4. Terminal requests are frozen, correction and cancel columns included.
-- =========================================================================
select throws_ok($$
  update commerce_contract_signing set corrected_signer_email = 'other@example.com'
  where contract_id = 'c1459000-0000-4000-8000-000000000001'
$$, 'P0001', 'Contract signing terminal state is immutable', 'a canceled request keeps its correction');
select throws_ok($$
  update commerce_contract_signing set cancel_code = 'voided', cancel_reason = 'Changed my mind'
  where contract_id = 'c1459000-0000-4000-8000-000000000001'
$$, 'P0001', 'Contract signing terminal state is immutable', 'a canceled request keeps its cancel code');
select throws_ok($$
  update commerce_contract_signing set cancel_reason = 'Another reason'
  where contract_id = 'c1459000-0000-4000-8000-000000000002'
$$, 'P0001', 'Contract signing terminal state is immutable', 'a canceled request keeps its reason');
select throws_ok($$
  update commerce_contract_signing set state = 'sent'
  where contract_id = 'c1459000-0000-4000-8000-000000000002'
$$, 'P0001', 'Contract signing terminal state is immutable', 'a canceled request stays canceled');

-- =========================================================================
-- 5. The 001443 rules are unchanged.
-- =========================================================================
select throws_ok($$
  update commerce_contract_signing set counterparty_signer = '{"email":"x@example.com"}'
  where contract_id = 'c1459000-0000-4000-8000-000000000003'
$$, 'P0001', 'Contract signing snapshots and provider binding are immutable',
  'the prepared signer snapshot still cannot change: a correction is its own column');
select is(
  (select array_agg(cancel_code::text order by contract_id) from commerce_contract_signing
   where contract_id in ('c1459000-0000-4000-8000-000000000001','c1459000-0000-4000-8000-000000000002','c1459000-0000-4000-8000-000000000003')),
  array['signer_change', 'voided', null],
  'each request keeps the cancel code it closed with');
reset role;

select * from finish();
rollback;
