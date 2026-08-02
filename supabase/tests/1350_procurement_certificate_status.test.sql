begin;
select plan(7);
set local role clockwork_service;
set local search_path = public, extensions;

select col_has_check(
  'public', 'core_procurement_certificates', 'status',
  'a certificate status is constrained to its shipped vocabulary'
);
select has_index(
  'public', 'core_procurement_certificates',
  'core_procurement_cert_identity_unique',
  'one certificate per account, kind, jurisdiction and document'
);

-- The sweep upserts on every run, so the identity index has to hold.
insert into core_procurement_certificates
  (id, account_id, kind, jurisdiction, document_id, expires_on, status)
values (
  'b0000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'tax_exemption', 'US-CA',
  '40000000-0000-4000-8000-000000000001',
  '2026-01-01', 'expired'
);

select throws_ok(
  $$insert into core_procurement_certificates
      (account_id, kind, jurisdiction, document_id, expires_on, status)
    values (
      '10000000-0000-4000-8000-000000000001',
      'tax_exemption', 'US-CA',
      '40000000-0000-4000-8000-000000000001',
      '2027-01-01', 'valid'
    )$$,
  '23505',
  null,
  'the same certificate cannot be recorded twice for one account'
);

-- A certificate close to expiry is still valid. "Expiring" is relative to the
-- day it is asked about, so it is derived on read and never stored: a stored
-- value would be wrong the next morning with no writer having touched the row.
select throws_ok(
  $$update core_procurement_certificates
      set status = 'expiring'
    where id = 'b0000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'a time-relative status is not persistable'
);

select lives_ok(
  $$update core_procurement_certificates
      set status = 'valid', expires_on = '2027-01-01'
    where id = 'b0000000-0000-4000-8000-000000000001'$$,
  'the sweep can return a renewed certificate to valid'
);

select lives_ok(
  $$update core_procurement_certificates
      set status = 'revoked'
    where id = 'b0000000-0000-4000-8000-000000000001'$$,
  'the shipped vocabulary still admits a hand-revoked certificate'
);

select is(
  (select status from core_procurement_certificates
    where id = 'b0000000-0000-4000-8000-000000000001'),
  'revoked', 'the recorded status is what was last written'
);

select * from finish();
rollback;
