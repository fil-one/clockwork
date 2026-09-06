-- Approval attests to exact price content. Serialize every rate mutation with
-- the parent book and forbid changing content while a proposal is pending.
-- Published immutability must cover INSERT as well as UPDATE and DELETE.
create or replace function guard_price_book_draft_content() returns trigger
language plpgsql set search_path = public as $$
declare
  book_id uuid;
  book_status text;
begin
  if tg_table_name = 'rate_cards' then
    if tg_op = 'UPDATE' and new.price_book_id is distinct from old.price_book_id then
      raise exception using errcode = '55000', message = 'rate cards cannot move between price books';
    end if;
    if tg_op = 'DELETE' then book_id := old.price_book_id;
    else book_id := new.price_book_id; end if;
    select status into book_status from price_books where id = book_id for update;
    if book_status is distinct from 'draft' then
      if tg_op = 'INSERT' then
        raise exception using errcode = '55000', message = 'rate cards require an editable draft price book';
      end if;
      raise exception using errcode = '55000', message = 'published rate cards are immutable; create a price book version';
    end if;
  else
    -- Approval/status and optimistic concurrency changes are not price content.
    if (new.name, new.currency, new.effective_from, new.effective_to, new.version, new.discount_matrix)
      is not distinct from
      (old.name, old.currency, old.effective_from, old.effective_to, old.version, old.discount_matrix) then
      return new;
    end if;
    -- Normal active -> retired closing of the effective window is supported.
    if old.status = 'active' and new.status = 'retired' then return new; end if;
    book_id := old.id;
  end if;
  if exists (select 1 from approvals where action = 'price_book_activation'
    and object_id = book_id and status = 'pending') then
    raise exception using errcode = '55000', message = 'proposed price content is frozen; reject activation before editing';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger rate_cards_draft_content_guard
before insert or update or delete on rate_cards
for each row execute function guard_price_book_draft_content();

create trigger price_books_draft_content_guard
before update on price_books
for each row execute function guard_price_book_draft_content();
