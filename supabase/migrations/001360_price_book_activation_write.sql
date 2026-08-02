-- A price book carried only its published version number, which readers quote
-- and which never moves once the book exists. The audit chain needs a counter
-- that advances once per mutation, and finance activation needs a version a
-- reader can pin. Those are two different numbers, so the book now carries
-- both. Emitted by drizzle-kit and copied unchanged.
ALTER TABLE "price_books" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "price_books" ADD COLUMN "row_version" integer DEFAULT 1 NOT NULL;

create trigger price_books_version
before update on price_books
for each row execute function touch_versioned_row();

comment on column public.price_books.version is
  'Published price-book number quoted to readers; unique per currency.';
comment on column public.price_books.row_version is
  'Optimistic concurrency counter advanced by every persisted mutation.';

-- Price books carry no account, so their policies were written for the service
-- connection alone: a draft is invisible to every other role and only an active
-- book is readable. The finance activation surface has to scan drafts in order
-- to approve them. Give that one role the narrow reads it needs, the same way
-- finance already reads invoices and collection cases it does not own. The
-- restrictive rate-card economics guard still applies on top of these.

create policy price_books_finance_read on public.price_books
for select to clockwork_runtime
using (app_has_any_role(array['finance_approver']));

create policy rate_cards_finance_read on public.rate_cards
for select to clockwork_runtime
using (app_has_any_role(array['finance_approver']));

create policy core_price_activation_finance_read
on public.core_price_book_activation_events
for select to clockwork_runtime
using (app_has_any_role(array['finance_approver']));

comment on table public.core_price_book_activation_events is
  'Append-only record of every price book activation, retirement, and scheduled activation, with the deciding user and reason.';
