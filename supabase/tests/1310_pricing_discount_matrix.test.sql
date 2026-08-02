begin;
select plan(3);
set local role clockwork_service;
set local search_path = public, extensions;

select has_column(
  'public', 'price_books', 'discount_matrix',
  'price books carry the standard discount matrix that governs their quotes'
);

select throws_ok(
  $$update price_books set discount_matrix = '{"id":"widened","version":9,"defaultMaxDiscountBps":10000,"rules":[]}'::jsonb where id = '60000000-0000-4000-8000-000000000001'$$,
  '55000', 'published discount matrices are immutable; create a price book version',
  'a published discount matrix cannot widen the authority its quotes were priced under'
);

select throws_ok(
  $$update price_books set status = 'retired', discount_matrix = '{"id":"widened","version":9,"defaultMaxDiscountBps":10000,"rules":[]}'::jsonb where id = '60000000-0000-4000-8000-000000000001'$$,
  '55000', 'published discount matrices are immutable; create a price book version',
  'retiring a price book cannot rewrite the matrix on the way out'
);

select * from finish();
rollback;
