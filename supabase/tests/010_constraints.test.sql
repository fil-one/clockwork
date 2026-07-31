begin;
select plan(5);
set local role clockwork_service;
set local search_path = public, extensions;

select throws_ok(
  $$insert into accounts (legal_name, relationship_roles, registered_address, billing_contact, ap_contact, invoice_delivery_email, domain, country, currency) values ('Bad Currency', array['direct_client'], '{}', '{}', '{}', 'bad@example.test', 'bad-currency.test', 'US', 'CAD')$$,
  '23514', null, 'unsupported currency is rejected'
);
select throws_ok(
  $$insert into accounts (legal_name, relationship_roles, registered_address, billing_contact, ap_contact, invoice_delivery_email, domain, country, currency) values ('Bad Role', array['unknown'], '{}', '{}', '{}', 'bad@example.test', 'bad-role.test', 'US', 'USD')$$,
  '23514', null, 'unknown relationship role is rejected'
);
select throws_ok(
  $$insert into memberships (organization_id, user_id, role) values ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'superuser')$$,
  '23514', null, 'unknown commerce role is rejected'
);
select throws_ok(
  $$insert into approvals (action, object_type, object_id, requested_by, approved_by, status) values ('teardown', 'organization', '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'approved')$$,
  '23514', null, 'destructive approval requires two distinct people'
);
select throws_ok(
  $$insert into webhook_events (provider, provider_event_id, event_type, signature_verified_at, payload_hash, payload, occurred_at, locked_until) values ('stripe','event-duplicate','invoice.paid',now(),repeat('a',64),'{}',now(),now()),('stripe','event-duplicate','invoice.paid',now(),repeat('a',64),'{}',now(),now())$$,
  '23505', null, 'provider webhook IDs deduplicate'
);

select * from finish();
rollback;
