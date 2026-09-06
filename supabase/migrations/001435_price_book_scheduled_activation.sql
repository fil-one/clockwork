create table public.core_price_book_schedules (
 id uuid primary key default public.uuid_v7(),
 price_book_id uuid not null references public.price_books(id),
 approval_id uuid not null references public.approvals(id),
 currency text not null,
 effective_from date not null,
 effective_to date,
 approved_row_version integer not null,
 status text not null default 'approved',
 approved_by uuid not null references public.commerce_users(id),
 approved_at timestamptz not null,
 completed_at timestamptz,
 completion_reason text,
 cancelled_by uuid references public.commerce_users(id),
 constraint core_price_schedule_status_check check(status in ('approved','executed','cancelled','expired')),
 constraint core_price_schedule_window_check check(effective_to is null or effective_to>=effective_from),
 constraint core_price_schedule_completion_check check(
  (status='approved' and completed_at is null and completion_reason is null and cancelled_by is null)
  or (status<>'approved' and completed_at is not null and completion_reason is not null and length(trim(completion_reason))>0 and ((status='cancelled')=(cancelled_by is not null))))
);
create unique index core_price_schedule_approval_unique on public.core_price_book_schedules(approval_id);
create unique index core_price_schedule_pending_currency_unique on public.core_price_book_schedules(currency) where status='approved';
alter table public.core_price_book_schedules enable row level security;
alter table public.core_price_book_schedules force row level security;
grant select,insert,update on public.core_price_book_schedules to clockwork_service;
grant select on public.core_price_book_schedules to clockwork_runtime;
create policy core_price_schedule_internal_read on public.core_price_book_schedules for select using(app_is_internal());
create policy core_price_schedule_service_write on public.core_price_book_schedules for all to clockwork_service using(app_is_internal()) with check(app_is_internal());

create function public.core_guard_price_schedule() returns trigger
language plpgsql set search_path=public as $$
declare book price_books; decision approvals;
begin
 if tg_op='UPDATE' then
  if old.status<>'approved' or new.status='approved' or
   (new.id,new.price_book_id,new.approval_id,new.currency,new.effective_from,new.effective_to,new.approved_row_version,new.approved_by,new.approved_at)
   is distinct from (old.id,old.price_book_id,old.approval_id,old.currency,old.effective_from,old.effective_to,old.approved_row_version,old.approved_by,old.approved_at) then
   raise exception using errcode='55000',message='approved price schedule is immutable; cancel and propose a new decision';
  end if;
  return new;
 end if;
 select * into book from price_books where id=new.price_book_id for update;
 select * into decision from approvals where id=new.approval_id for share;
 if new.status<>'approved' or book.id is null or decision.id is null or book.status<>'draft'
  or (book.currency,book.effective_from,book.effective_to,book.row_version) is distinct from (new.currency,new.effective_from,new.effective_to,new.approved_row_version)
  or decision.action<>'price_book_activation' or decision.object_id<>book.id or decision.status<>'approved'
  or decision.approved_by is distinct from new.approved_by or decision.requested_by is not distinct from decision.approved_by
  or decision.decided_at is distinct from new.approved_at
  or new.effective_from <= (new.approved_at at time zone 'UTC')::date
  or new.approved_row_version<1 then
   raise exception using errcode='23514',message='price schedule requires the exact draft and distinct approved finance decision';
 end if;
 return new;
end $$;
create trigger core_price_schedule_guard before insert or update on public.core_price_book_schedules for each row execute function public.core_guard_price_schedule();

-- The existing pending-proposal guards remain. Advance approval adds a second
-- immutable phase, including catalog mappings, until cancellation or execution.
create function public.core_guard_scheduled_price_content() returns trigger
language plpgsql set search_path=public as $$
declare book_id uuid; rate_id uuid;
begin
 if tg_table_name='price_books' then
  book_id:=old.id;
  if tg_op='UPDATE' and (new.name,new.currency,new.effective_from,new.effective_to,new.version,new.discount_matrix,new.status)
   is not distinct from (old.name,old.currency,old.effective_from,old.effective_to,old.version,old.discount_matrix,old.status) then return new; end if;
 elsif tg_table_name='rate_cards' then
  if tg_op='DELETE' then book_id:=old.price_book_id; else book_id:=new.price_book_id; end if;
 else
  if tg_op<>'INSERT' and old.provider='fil_one' and old.provider_resource_type='sku_region' and old.aggregate_type='rate_card' then rate_id:=old.aggregate_id;
  elsif tg_op<>'DELETE' and new.provider='fil_one' and new.provider_resource_type='sku_region' and new.aggregate_type='rate_card' then rate_id:=new.aggregate_id;
  else if tg_op='DELETE' then return old; else return new; end if; end if;
  select price_book_id into book_id from rate_cards where id=rate_id;
 end if;
 perform 1 from price_books where id=book_id for update;
 if exists(select 1 from core_price_book_schedules where price_book_id=book_id and status='approved') then
  raise exception using errcode='55000',message='scheduled price content is frozen; cancel the approved schedule before editing';
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger price_books_scheduled_content_guard before update or delete on public.price_books for each row execute function public.core_guard_scheduled_price_content();
create trigger rate_cards_scheduled_content_guard before insert or update or delete on public.rate_cards for each row execute function public.core_guard_scheduled_price_content();
create trigger catalog_scheduled_content_guard before insert or update or delete on public.system_provider_resource_bindings for each row execute function public.core_guard_scheduled_price_content();
