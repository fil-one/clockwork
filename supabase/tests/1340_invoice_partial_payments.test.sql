begin;
select plan(14);
set local role clockwork_service;
set local search_path = public, extensions;

select has_column(
  'public', 'invoices', 'amount_paid_minor',
  'an invoice records how much of it has been settled'
);
select has_column(
  'public', 'invoices', 'amount_remaining_minor',
  'an invoice records how much of it is still owed'
);
select col_not_null(
  'public', 'invoices', 'amount_remaining_minor',
  'every invoice states an outstanding amount'
);
select col_has_check(
  'public', 'invoices', 'amount_paid_minor',
  'a settled amount is constrained to zero or more'
);

select is(
  (select amount_remaining_minor from invoices
    where id = '90000000-0000-4000-8000-000000000002'),
  0::bigint, 'a settled invoice is owed nothing'
);
select is(
  (select amount_remaining_minor from invoices
    where id = '90000000-0000-4000-8000-000000000001'),
  180000::bigint, 'an unsettled invoice is owed its full total'
);

select lives_ok($$
  update invoices set amount_paid_minor = 60000
  where id = '90000000-0000-4000-8000-000000000003'
$$, 'a part payment persists against an open invoice');
select is(
  (select amount_remaining_minor from invoices
    where id = '90000000-0000-4000-8000-000000000003'),
  108000::bigint, 'the outstanding amount follows the settled amount'
);

select throws_ok($$
  update invoices set amount_paid_minor = 10000
  where id = '90000000-0000-4000-8000-000000000003'
$$, '23514', null, 'a settled amount only moves forward');

select lives_ok($$
  update invoices set amount_paid_minor = 200000
  where id = '90000000-0000-4000-8000-000000000003'
$$, 'an overpayment persists');
select is(
  (select amount_remaining_minor from invoices
    where id = '90000000-0000-4000-8000-000000000003'),
  0::bigint, 'an overpayment leaves nothing owed'
);
select throws_ok($$
  update invoices set amount_remaining_minor = 5
  where id = '90000000-0000-4000-8000-000000000003'
$$, '428C9', null, 'the outstanding amount is derived, never written');

select lives_ok($$
  insert into payments (
    invoice_id, order_id, stripe_payment_intent_id, currency, amount_minor, status
  ) values (
    '90000000-0000-4000-8000-000000000003',
    '80000000-0000-4000-8000-000000000003',
    'pi_partial_settlement', 'EUR', 60000, 'succeeded'
  )
$$, 'a payment may settle part of its invoice');
select throws_ok($$
  insert into payments (
    invoice_id, order_id, stripe_payment_intent_id, currency, amount_minor, status
  ) values (
    '90000000-0000-4000-8000-000000000003',
    '80000000-0000-4000-8000-000000000003',
    'pi_empty_settlement', 'EUR', 0, 'succeeded'
  )
$$, '23514', null, 'a payment carries a positive amount');

select * from finish();
rollback;
