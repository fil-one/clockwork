begin;
select plan(8);
set local role clockwork_service;
set local search_path = public, extensions;

select has_table(
  'public', 'notification_deliveries',
  'the platform keeps evidence of every commercial notification it sends'
);

insert into notification_deliveries (
  id, account_id, channel, alert_kind, subject_type, subject_id, template,
  recipients, idempotency_key, status, provider_message_id, requested_at, delivered_at
) values (
  'c3000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'email', 'renewal_term_window', 'order',
  '80000000-0000-4000-8000-000000000001',
  'renewals.term_end.v1',
  array['renewals@example.test'],
  'lifecycle-effect:term-window-0001',
  'sent', 'msg_term_0001',
  '2026-07-31T09:00:00Z', '2026-07-31T09:00:01Z'
);

select throws_ok(
  $$insert into notification_deliveries (id, account_id, channel, alert_kind, subject_type, subject_id, template, recipients, idempotency_key, status, provider_message_id, requested_at, delivered_at) values ('c3000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'email', 'renewal_term_window', 'order', '80000000-0000-4000-8000-000000000001', 'renewals.term_end.v1', array['renewals@example.test'], 'lifecycle-effect:term-window-0001', 'sent', 'msg_term_0002', '2026-07-31T10:00:00Z', '2026-07-31T10:00:01Z')$$,
  '23505',
  'duplicate key value violates unique constraint "notification_delivery_idempotency_unique"',
  'one alert boundary produces one delivery however often the schedule reruns'
);

select throws_ok(
  $$insert into notification_deliveries (id, account_id, channel, alert_kind, subject_type, subject_id, template, recipients, idempotency_key, status, requested_at) values ('c3000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'email', 'poc_milestone', 'poc', '85000000-0000-4000-8000-000000000001', 'pocs.milestone.v1', array['poc@example.test'], 'lifecycle-effect:poc-milestone-0001', 'sent', '2026-07-31T09:00:00Z')$$,
  '23514',
  'new row for relation "notification_deliveries" violates check constraint "notification_delivery_outcome_check"',
  'a delivery cannot claim it was sent without the provider message that proves it'
);

select lives_ok(
  $$insert into notification_deliveries (id, account_id, channel, alert_kind, subject_type, subject_id, template, recipients, idempotency_key, status, failure_code, requested_at) values ('c3000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'email', 'quote_expiry', 'quote', '70000000-0000-4000-8000-000000000001', 'quotes.expiry.v1', array['quotes@example.test'], 'lifecycle-effect:quote-expiry-0001', 'failed', 'PROVIDER_REJECTED', '2026-07-31T09:00:00Z')$$,
  'a permanently failed alert is recorded with the reason it failed'
);

select throws_ok(
  $$insert into notification_deliveries (id, account_id, channel, alert_kind, subject_type, subject_id, template, recipients, idempotency_key, status, provider_message_id, requested_at, delivered_at) values ('c3000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'email', 'collections_dunning', 'invoice', '90000000-0000-4000-8000-000000000001', 'collections.first_threshold.v1', array[]::text[], 'lifecycle-effect:dunning-0001', 'sent', 'msg_dunning_0001', '2026-07-31T09:00:00Z', '2026-07-31T09:00:01Z')$$,
  '23514',
  'new row for relation "notification_deliveries" violates check constraint "notification_deliveries_recipients_check"',
  'a delivery with no recipient is not evidence of anything'
);

select throws_ok(
  $$update notification_deliveries set recipients = array['someone-else@example.test'] where id = 'c3000000-0000-4000-8000-000000000001'$$,
  '55000', 'notification_deliveries is append-only/immutable',
  'who an alert reached cannot be rewritten after the fact'
);
select throws_ok(
  $$delete from notification_deliveries where id = 'c3000000-0000-4000-8000-000000000001'$$,
  '55000', 'notification_deliveries is append-only/immutable',
  'delivery evidence cannot be deleted'
);

select is(
  (select relforcerowsecurity from pg_class
    where oid = 'public.notification_deliveries'::regclass),
  true,
  'delivery recipients are readable only inside the account they belong to'
);

select * from finish();
rollback;
