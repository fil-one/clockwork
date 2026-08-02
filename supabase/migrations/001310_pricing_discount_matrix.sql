-- The standard discount matrix of the pricing guardrails (spec section 9). The
-- matrix is pricing policy, so it versions and publishes with the price book
-- that carries it and the quote pins it through the price book it pins.
-- Values arrive with signed commercial data (EXT-COMMERCIAL-01); an empty
-- object authorizes no discount, which routes every discounted quote to the
-- pricing exception queue.

alter table price_books
  add column discount_matrix jsonb not null default '{}'::jsonb;

alter table price_books
  add constraint price_books_discount_matrix_object_check
  check (jsonb_typeof(discount_matrix) = 'object');

create or replace function protect_published_discount_matrix() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status <> 'draft' and new.discount_matrix is distinct from old.discount_matrix then
    raise exception using errcode = '55000', message = 'published discount matrices are immutable; create a price book version';
  end if;
  return new;
end $$;

create trigger price_books_discount_matrix_immutable
  before update on price_books
  for each row execute function protect_published_discount_matrix();
