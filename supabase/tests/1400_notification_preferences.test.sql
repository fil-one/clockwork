begin;
select plan(9);
set local role clockwork_service;
set local search_path = public, extensions;

select has_table(
  'public', 'notification_preferences',
  'an account can manage which advisory alerts it receives'
);

select lives_ok(
  $$insert into notification_preferences (account_id, alert_kind, channel, enabled) values ('10000000-0000-4000-8000-000000000001', 'renewal_term_window', 'email', false)$$,
  'a term-window reminder is advisory and can be switched off'
);

select lives_ok(
  $$insert into notification_preferences (account_id, alert_kind, channel, enabled) values ('10000000-0000-4000-8000-000000000001', 'poc_milestone', 'email', false)$$,
  'a POC milestone update is advisory and can be switched off'
);

select lives_ok(
  $$insert into notification_preferences (account_id, alert_kind, channel, enabled) values ('10000000-0000-4000-8000-000000000001', 'quote_expiry', 'email', false)$$,
  'a quote expiry warning is advisory and can be switched off'
);

-- The complete set the constraint refuses. Both are notices the platform owes
-- regardless of preference: the contractual notice window the agreement fixes,
-- and the demand for payment on an issued invoice.
select throws_ok(
  $$insert into notification_preferences (account_id, alert_kind, channel, enabled) values ('10000000-0000-4000-8000-000000000002', 'renewal_notice_window', 'email', false)$$,
  '23514',
  'new row for relation "notification_preferences" violates check constraint "notification_preferences_alert_kind_check"',
  'the contractual notice window has no preference row to switch off'
);

select throws_ok(
  $$insert into notification_preferences (account_id, alert_kind, channel, enabled) values ('10000000-0000-4000-8000-000000000002', 'collections_dunning', 'email', false)$$,
  '23514',
  'new row for relation "notification_preferences" violates check constraint "notification_preferences_alert_kind_check"',
  'a debtor cannot opt out of being told it owes money'
);

select throws_ok(
  $$insert into notification_preferences (account_id, alert_kind, channel, enabled) values ('10000000-0000-4000-8000-000000000001', 'quote_expiry', 'email', true)$$,
  '23505',
  'duplicate key value violates unique constraint "notification_preference_unique"',
  'one account holds one setting per alert kind and channel'
);

update notification_preferences
set enabled = true
where account_id = '10000000-0000-4000-8000-000000000001'
  and alert_kind = 'quote_expiry';

select is(
  (select row_version from notification_preferences where account_id = '10000000-0000-4000-8000-000000000001' and alert_kind = 'quote_expiry'),
  2,
  'switching a preference back on is a versioned write, not a new row'
);

set local role clockwork_runtime;
select is(
  (select count(*)::int from notification_preferences),
  0,
  'a caller with no authorization context sees no account preferences'
);

select * from finish();
rollback;
