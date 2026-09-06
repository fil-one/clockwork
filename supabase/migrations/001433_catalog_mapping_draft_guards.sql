-- A rate has one retained provisionable mapping; changes are serialized with
-- its economic proposal. Other provider identity bindings are unaffected.
create unique index system_fil_one_rate_mapping_unique
on system_provider_resource_bindings(aggregate_id)
where provider='fil_one' and provider_resource_type='sku_region' and aggregate_type='rate_card';

create function core_guard_catalog_mapping() returns trigger
language plpgsql set search_path=public as $$
declare target_rate uuid; target_book uuid; book_status text;
begin
  if tg_op <> 'INSERT' and old.provider='fil_one' and old.provider_resource_type='sku_region' and old.aggregate_type='rate_card' then
    target_rate := old.aggregate_id;
    if tg_op='UPDATE' and (new.provider,new.provider_resource_type,new.aggregate_type,new.aggregate_id,new.provider_resource_id)
      is distinct from (old.provider,old.provider_resource_type,old.aggregate_type,old.aggregate_id,old.provider_resource_id) then
      raise exception using errcode='55000',message='catalog mapping identity is immutable';
    end if;
  elsif tg_op <> 'DELETE' and new.provider='fil_one' and new.provider_resource_type='sku_region' and new.aggregate_type='rate_card' then
    target_rate := new.aggregate_id;
  else
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  select price_book_id into target_book from rate_cards where id=target_rate;
  select status into book_status from price_books where id=target_book for update;
  if book_status is distinct from 'draft' or exists(select 1 from approvals where action='price_book_activation' and object_id=target_book and status='pending') then
    raise exception using errcode='55000',message='catalog mappings require an unproposed draft';
  end if;
  if tg_op<>'DELETE' and (jsonb_typeof(new.binding) is distinct from 'object'
    or coalesce(length(trim(new.binding->>'providerSku')),0)=0
    or coalesce(length(trim(new.binding->>'providerRegion')),0)=0
    or coalesce(length(trim(new.binding->>'meterId')),0)=0
    or coalesce(length(trim(new.binding->>'sourceEvidence')),0)=0) then
    raise exception using errcode='23514',message='catalog mapping source evidence and provider dimensions required';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger system_catalog_mapping_draft_guard before insert or update or delete
on system_provider_resource_bindings for each row execute function core_guard_catalog_mapping();
