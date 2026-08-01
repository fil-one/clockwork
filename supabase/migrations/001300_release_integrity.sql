-- Forward-only release integration corrections.

-- RFC 9562 UUIDv7 keeps the existing UUID storage type while making newly
-- generated aggregate and operational identifiers time ordered. Altering a
-- default is metadata-only and deliberately does not rewrite legacy UUIDs.
create or replace function public.uuid_v7() returns uuid
language plpgsql volatile
set search_path = pg_catalog, extensions
as $$
declare
  observed_at timestamptz := clock_timestamp();
  unix_millis bigint;
  sub_millisecond integer;
  entropy bytea := extensions.gen_random_bytes(10);
  entropy_hex text;
  compact text;
begin
  unix_millis := floor(extract(epoch from observed_at) * 1000);
  if unix_millis < 0 or unix_millis >= 281474976710656 then
    raise exception 'UUIDv7 timestamp is outside its 48-bit range';
  end if;
  sub_millisecond := floor(
    ((extract(microseconds from observed_at)::bigint % 1000) * 4096) / 1000.0
  );
  entropy_hex := encode(entropy, 'hex');
  compact := lpad(to_hex(unix_millis), 12, '0')
    || '7'
    || lpad(to_hex(sub_millisecond), 3, '0')
    || substring('89ab' from (((get_byte(entropy, 0) >> 6) % 4) + 1) for 1)
    || substring(entropy_hex from 2 for 15);
  return (
    substring(compact from 1 for 8) || '-'
    || substring(compact from 9 for 4) || '-'
    || substring(compact from 13 for 4) || '-'
    || substring(compact from 17 for 4) || '-'
    || substring(compact from 21 for 12)
  )::uuid;
end
$$;

-- Document render requests bind a stable authoritative version as well as the
-- canonical source hash. Existing requests are accepted only when they already
-- carry an explicit object version; legacy incomplete rows stop the migration
-- instead of receiving invented business meaning.
alter table public.experience_document_render_requests
  add column if not exists source_version text;
update public.experience_document_render_requests
set source_version = nullif(input #>> '{verification,objectVersion}', '')
where source_version is null;
do $$
begin
  if exists (
    select 1 from public.experience_document_render_requests
    where source_version is null
  ) then
    raise exception 'ARTIFACT_SOURCE_INCOMPLETE: render request source version';
  end if;
end
$$;
alter table public.experience_document_render_requests
  alter column source_version set not null;
alter table public.experience_document_render_requests
  drop constraint if exists experience_document_render_requests_source_version_check;
alter table public.experience_document_render_requests
  add constraint experience_document_render_requests_source_version_check
  check (length(source_version) between 1 and 80);

alter table public.experience_document_render_requests
  alter column account_id drop not null;
alter table public.experience_artifact_deliveries
  alter column account_id drop not null;
alter table public.experience_document_render_requests
  drop constraint if exists experience_render_audience_check;
alter table public.experience_document_render_requests
  add constraint experience_render_audience_check check (
    (audience = 'internal' and account_id is null and audience_account_id is null)
    or (audience <> 'internal' and account_id is not null and audience_account_id is not null)
  );
alter table public.experience_artifact_deliveries
  drop constraint if exists experience_delivery_audience_check;
alter table public.experience_artifact_deliveries
  add constraint experience_delivery_audience_check check (
    (audience = 'internal' and account_id is null and audience_account_id is null)
    or (audience <> 'internal' and account_id is not null and audience_account_id is not null)
  );

create or replace function public.protect_experience_render_truth()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = format('%s cannot be deleted', tg_table_name);
  end if;
  if tg_table_name = 'experience_artifact_deliveries' then
    raise exception using errcode = '55000', message = 'artifact deliveries are immutable';
  end if;
  if old.account_id is distinct from new.account_id
    or old.audience is distinct from new.audience
    or old.audience_account_id is distinct from new.audience_account_id
    or old.subject_type is distinct from new.subject_type
    or old.subject_id is distinct from new.subject_id
    or old.document_kind is distinct from new.document_kind
    or old.input is distinct from new.input
    or old.source_hash is distinct from new.source_hash
    or old.source_version is distinct from new.source_version
    or old.requested_by is distinct from new.requested_by
    or old.retain_until is distinct from new.retain_until
    or old.created_at is distinct from new.created_at
  then
    raise exception using errcode = '55000', message = 'render source truth is immutable';
  end if;
  if new.row_version <> old.row_version + 1 then
    raise exception using errcode = '40001', message = 'render request version conflict';
  end if;
  if not (
    (old.status = 'pending' and new.status in ('rendering','failed'))
    or (old.status = 'rendering' and new.status in ('stored','failed'))
    or (old.status = 'failed' and new.status = 'rendering'
      and new.failure_code is null)
  ) then
    raise exception using errcode = '23514', message = 'invalid render request transition';
  end if;
  return new;
end;
$$;

drop policy if exists experience_render_read
  on public.experience_document_render_requests;
create policy experience_render_read on public.experience_document_render_requests
for select to clockwork_runtime using (
  (audience = 'internal' and account_id is null
    and experience_session_is_internal()
    and experience_session_has_role('internal_operator')
    and experience_session_assisted_account() is null)
  or (audience <> 'internal' and app_has_account(account_id)
    and app_has_account(audience_account_id))
);
drop policy if exists experience_render_insert
  on public.experience_document_render_requests;
create policy experience_render_insert on public.experience_document_render_requests
for insert to clockwork_runtime with check (
  app_is_current_user(requested_by)
  and (
    (audience = 'internal' and account_id is null and audience_account_id is null
      and experience_session_is_internal()
      and experience_session_has_role('internal_operator')
      and experience_session_assisted_account() is null)
    or (audience <> 'internal' and app_has_account(account_id)
      and app_has_account(audience_account_id))
  )
);
drop policy if exists experience_delivery_read
  on public.experience_artifact_deliveries;
create policy experience_delivery_read on public.experience_artifact_deliveries
for select to clockwork_runtime using (
  (audience = 'internal' and account_id is null
    and experience_session_is_internal()
    and experience_session_has_role('internal_operator')
    and experience_session_assisted_account() is null)
  or (audience <> 'internal' and app_has_account(audience_account_id))
);

-- Exact invoice presentation lines are frozen with the draft invoice. They
-- are immutable source evidence and cannot later drift with catalog/order data.
create table public.core_invoice_document_snapshots (
  invoice_id uuid primary key,
  order_id uuid not null,
  quote_id uuid not null,
  currency text not null,
  line_items jsonb not null,
  subtotal_minor bigint not null,
  tax_minor bigint not null,
  total_minor bigint not null,
  source_hash text not null,
  source_version text not null,
  created_at timestamptz not null default now(),
  constraint core_invoice_document_snapshots_invoice_id_invoices_id_fk
    foreign key (invoice_id) references public.invoices(id)
    on delete no action on update no action,
  constraint core_invoice_document_snapshots_order_id_orders_id_fk
    foreign key (order_id) references public.orders(id)
    on delete no action on update no action,
  constraint core_invoice_document_snapshots_quote_id_quotes_id_fk
    foreign key (quote_id) references public.quotes(id)
    on delete no action on update no action,
  constraint core_invoice_document_snapshot_currency_check
    check (currency in ('USD','EUR','GBP')),
  constraint core_invoice_document_snapshot_lines_check
    check (jsonb_typeof(line_items) = 'array' and jsonb_array_length(line_items) > 0),
  constraint core_invoice_document_snapshot_amounts_check
    check (subtotal_minor >= 0 and tax_minor >= 0
      and total_minor = subtotal_minor + tax_minor),
  constraint core_invoice_document_snapshot_hash_check
    check (source_hash ~ '^[a-f0-9]{64}$'),
  constraint core_invoice_document_snapshot_version_check
    check (length(source_version) between 1 and 80)
);
create unique index core_invoice_document_snapshot_source_unique
  on public.core_invoice_document_snapshots(source_hash);

-- Populated upgrades are reconstructed only from the immutable order-line
-- snapshots captured at acceptance. Any missing or inconsistent evidence
-- aborts instead of synthesizing invoice presentation facts.
create or replace function private.canonical_jsonb_text(value jsonb)
returns text
language sql immutable strict
set search_path = pg_catalog, private
as $$
  select case jsonb_typeof(value)
    when 'object' then '{' || coalesce((
      select string_agg(
        to_jsonb(entry.key)::text || ':'
          || private.canonical_jsonb_text(entry.value),
        ',' order by entry.key
      )
      from jsonb_each(value) entry
    ), '') || '}'
    when 'array' then '[' || coalesce((
      select string_agg(
        private.canonical_jsonb_text(entry.value),
        ',' order by entry.ordinality
      )
      from jsonb_array_elements(value) with ordinality entry(value, ordinality)
    ), '') || ']'
    else value::text
  end
$$;

do $$
begin
  if exists (
    select 1
    from public.invoices invoice
    join public.orders source_order on source_order.id = invoice.order_id
    join public.quotes quote on quote.id = source_order.quote_id
    where source_order.immutable_at is null
       or quote.immutable_at is null
       or invoice.currency is distinct from quote.currency
       or invoice.amount_minor is distinct from quote.total_minor
       or not exists (
         select 1 from public.order_lines line
         where line.order_id = source_order.id
       )
       or exists (
         select 1
         from public.order_lines line
         left join public.core_order_line_snapshots snapshot
           on snapshot.order_line_id = line.id
         where line.order_id = source_order.id
           and (
             snapshot.order_line_id is null
             or jsonb_typeof(snapshot.snapshot) is distinct from 'object'
             or snapshot.snapshot_hash is distinct from encode(extensions.digest(
               convert_to(private.canonical_jsonb_text(snapshot.snapshot), 'UTF8'),
               'sha256'
             ), 'hex')
             or snapshot.snapshot->>'id' is distinct from line.id::text
             or snapshot.snapshot->>'quoteLineId' is distinct from line.quote_line_id::text
             or snapshot.snapshot->>'sku' is distinct from line.sku
             or jsonb_typeof(snapshot.snapshot->'quantity') is distinct from 'string'
             or snapshot.snapshot->>'quantity' !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
             or case
               when snapshot.snapshot->>'quantity' ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
               then (snapshot.snapshot->>'quantity')::numeric
               else null
             end is distinct from line.quantity
             or jsonb_typeof(snapshot.snapshot#>'{unitPrice,currency}') is distinct from 'string'
             or snapshot.snapshot#>>'{unitPrice,currency}' is distinct from quote.currency
             or snapshot.snapshot#>>'{unitPrice,minor}' !~ '^(0|[1-9][0-9]*)$'
             or case
               when snapshot.snapshot#>>'{unitPrice,minor}' ~ '^(0|[1-9][0-9]*)$'
               then (snapshot.snapshot#>>'{unitPrice,minor}')::bigint
               else null
             end is distinct from line.unit_price_minor
             or jsonb_typeof(snapshot.snapshot#>'{lineTotal,currency}') is distinct from 'string'
             or snapshot.snapshot#>>'{lineTotal,currency}' is distinct from quote.currency
             or snapshot.snapshot#>>'{lineTotal,minor}' !~ '^(0|[1-9][0-9]*)$'
           )
       )
       or invoice.amount_minor is distinct from (
         select sum(case
           when snapshot.snapshot#>>'{lineTotal,minor}' ~ '^(0|[1-9][0-9]*)$'
           then (snapshot.snapshot#>>'{lineTotal,minor}')::bigint
           else null
         end)
         from public.order_lines line
         join public.core_order_line_snapshots snapshot
           on snapshot.order_line_id = line.id
         where line.order_id = source_order.id
       )
  ) then
    raise exception 'ARTIFACT_SOURCE_INCOMPLETE: invoice line snapshot backfill';
  end if;
end
$$;

with reconstructed as (
  select invoice.id as invoice_id,
         source_order.id as order_id,
         quote.id as quote_id,
         quote.currency,
         jsonb_agg(
           jsonb_build_object(
             'id', snapshot.snapshot->>'id',
             'description', snapshot.snapshot->>'sku',
             'quantity', snapshot.snapshot->>'quantity',
             'unitPrice', jsonb_build_object(
               'currency', snapshot.snapshot#>>'{unitPrice,currency}',
               'minorUnits', snapshot.snapshot#>>'{unitPrice,minor}'
             ),
             'amount', jsonb_build_object(
               'currency', snapshot.snapshot#>>'{lineTotal,currency}',
               'minorUnits', snapshot.snapshot#>>'{lineTotal,minor}'
             )
           ) order by snapshot.snapshot->>'id'
         ) as line_items,
         invoice.amount_minor as subtotal_minor,
         0::bigint as tax_minor,
         invoice.amount_minor as total_minor,
         'quote:' || quote.id::text || ':r' || quote.revision::text as source_version,
         invoice.created_at
  from public.invoices invoice
  join public.orders source_order on source_order.id = invoice.order_id
  join public.quotes quote on quote.id = source_order.quote_id
  join public.order_lines line on line.order_id = source_order.id
  join public.core_order_line_snapshots snapshot
    on snapshot.order_line_id = line.id
  group by invoice.id, source_order.id, quote.id, quote.currency, quote.revision
), sources as (
  select reconstructed.*,
         jsonb_build_object(
           'invoiceId', invoice_id::text,
           'orderId', order_id::text,
           'quoteId', quote_id::text,
           'currency', currency,
           'lineItems', line_items,
           'subtotalMinor', subtotal_minor::text,
           'taxMinor', tax_minor::text,
           'totalMinor', total_minor::text,
           'sourceVersion', source_version
         ) as source
  from reconstructed
)
insert into public.core_invoice_document_snapshots (
  invoice_id, order_id, quote_id, currency, line_items, subtotal_minor,
  tax_minor, total_minor, source_hash, source_version, created_at
)
select invoice_id, order_id, quote_id, currency, line_items, subtotal_minor,
       tax_minor, total_minor,
       encode(extensions.digest(
         convert_to(private.canonical_jsonb_text(source), 'UTF8'),
         'sha256'
       ), 'hex'),
       source_version, created_at
from sources;

do $$
begin
  if exists (
    select 1
    from public.invoices invoice
    left join public.core_invoice_document_snapshots snapshot
      on snapshot.invoice_id = invoice.id
    where snapshot.invoice_id is null
  ) then
    raise exception 'ARTIFACT_SOURCE_INCOMPLETE: invoice snapshot parity';
  end if;
end
$$;
revoke all on function private.canonical_jsonb_text(jsonb) from public;

create or replace function public.validate_invoice_document_snapshot()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  persisted_invoice public.invoices%rowtype;
  persisted_order public.orders%rowtype;
  persisted_quote public.quotes%rowtype;
  expected_version text;
  expected_hash text;
  expected_line_items jsonb;
  expected_line_count integer;
  source_line_count integer;
  source jsonb;
begin
  select * into persisted_invoice from public.invoices
  where id = new.invoice_id for share;
  select * into persisted_order from public.orders
  where id = persisted_invoice.order_id for share;
  select * into persisted_quote from public.quotes
  where id = persisted_order.quote_id for share;
  if not found
    or persisted_order.immutable_at is null
    or persisted_quote.immutable_at is null
    or new.order_id is distinct from persisted_invoice.order_id
    or new.quote_id is distinct from persisted_order.quote_id
    or new.currency is distinct from persisted_invoice.currency
    or new.currency is distinct from persisted_quote.currency
    or new.total_minor is distinct from persisted_invoice.amount_minor
  then
    raise exception using errcode = '23514',
      message = 'invoice snapshot authoritative binding mismatch';
  end if;

  expected_version := 'quote:' || persisted_quote.id::text
    || ':r' || persisted_quote.revision::text;
  if new.source_version is distinct from expected_version then
    raise exception using errcode = '23514',
      message = 'invoice snapshot source version mismatch';
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'id', snapshot.snapshot->>'id',
             'description', snapshot.snapshot->>'sku',
             'quantity', snapshot.snapshot->>'quantity',
             'unitPrice', jsonb_build_object(
               'currency', snapshot.snapshot#>>'{unitPrice,currency}',
               'minorUnits', snapshot.snapshot#>>'{unitPrice,minor}'
             ),
             'amount', jsonb_build_object(
               'currency', snapshot.snapshot#>>'{lineTotal,currency}',
               'minorUnits', snapshot.snapshot#>>'{lineTotal,minor}'
             )
           ) order by snapshot.snapshot->>'id'
         ),
         count(*)::integer
  into expected_line_items, expected_line_count
  from public.order_lines line
  join public.core_order_line_snapshots snapshot
    on snapshot.order_line_id = line.id
  where line.order_id = persisted_order.id;
  select count(*)::integer into source_line_count
  from public.order_lines line where line.order_id = persisted_order.id;
  if expected_line_count is distinct from source_line_count
    or expected_line_count = 0
    or new.line_items is distinct from expected_line_items
  then
    raise exception using errcode = '23514',
      message = 'invoice snapshot immutable line binding mismatch';
  end if;

  if jsonb_typeof(new.line_items) is distinct from 'array'
    or jsonb_array_length(new.line_items) = 0
    or exists (
      select 1
      from jsonb_array_elements(new.line_items) line
      where jsonb_typeof(line) is distinct from 'object'
        or jsonb_typeof(line->'id') is distinct from 'string'
        or nullif(btrim(line->>'id'), '') is null
        or jsonb_typeof(line->'description') is distinct from 'string'
        or nullif(btrim(line->>'description'), '') is null
        or jsonb_typeof(line->'quantity') is distinct from 'string'
        or nullif(btrim(line->>'quantity'), '') is null
        or jsonb_typeof(line#>'{unitPrice,currency}') is distinct from 'string'
        or line#>>'{unitPrice,currency}' is distinct from new.currency
        or jsonb_typeof(line#>'{unitPrice,minorUnits}') is distinct from 'string'
        or line#>>'{unitPrice,minorUnits}' !~ '^(0|[1-9][0-9]*)$'
        or jsonb_typeof(line#>'{amount,currency}') is distinct from 'string'
        or line#>>'{amount,currency}' is distinct from new.currency
        or jsonb_typeof(line#>'{amount,minorUnits}') is distinct from 'string'
        or line#>>'{amount,minorUnits}' !~ '^(0|[1-9][0-9]*)$'
    )
    or (
      select count(*) <> count(distinct line->>'id')
      from jsonb_array_elements(new.line_items) line
    )
    or new.subtotal_minor is distinct from (
      select sum((line#>>'{amount,minorUnits}')::bigint)
      from jsonb_array_elements(new.line_items) line
    )
  then
    raise exception using errcode = '23514',
      message = 'invoice snapshot presentation lines mismatch';
  end if;

  source := jsonb_build_object(
    'invoiceId', new.invoice_id::text,
    'orderId', new.order_id::text,
    'quoteId', new.quote_id::text,
    'currency', new.currency,
    'lineItems', new.line_items,
    'subtotalMinor', new.subtotal_minor::text,
    'taxMinor', new.tax_minor::text,
    'totalMinor', new.total_minor::text,
    'sourceVersion', new.source_version
  );
  expected_hash := encode(extensions.digest(
    convert_to(private.canonical_jsonb_text(source), 'UTF8'), 'sha256'
  ), 'hex');
  if new.source_hash is distinct from expected_hash then
    raise exception using errcode = '23514',
      message = 'invoice snapshot canonical source hash mismatch';
  end if;
  return new;
end
$$;
revoke all on function public.validate_invoice_document_snapshot() from public;
create trigger core_invoice_document_snapshot_validate
before insert on public.core_invoice_document_snapshots
for each row execute function public.validate_invoice_document_snapshot();
create or replace function public.protect_invoice_document_snapshot()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '55000',
    message = 'invoice document snapshots are immutable';
end
$$;
drop trigger if exists core_invoice_document_snapshot_immutable
  on public.core_invoice_document_snapshots;
create trigger core_invoice_document_snapshot_immutable
before update or delete on public.core_invoice_document_snapshots
for each row execute function public.protect_invoice_document_snapshot();
alter table public.core_invoice_document_snapshots enable row level security;
alter table public.core_invoice_document_snapshots force row level security;
create policy core_invoice_document_snapshot_read
  on public.core_invoice_document_snapshots for select to clockwork_runtime
  using (exists (
    select 1 from public.invoices invoice
    where invoice.id = invoice_id and app_has_account(invoice.account_id)
  ));
create policy core_invoice_document_snapshot_service
  on public.core_invoice_document_snapshots for all to clockwork_service
  using (true) with check (true);
revoke all on public.core_invoice_document_snapshots
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select on public.core_invoice_document_snapshots to clockwork_runtime;
grant select, insert on public.core_invoice_document_snapshots to clockwork_service;

-- New POC and offboarding evidence is complete at creation time. The release
-- deliberately fails on legacy rows without these facts rather than assigning
-- a guessed target or retention reason.
do $$
begin
  if exists (
    select 1
    from public.pocs source
    where jsonb_typeof(source.success_tests) is distinct from 'array'
       or exists (
         select 1
         from jsonb_array_elements(source.success_tests) item
         where jsonb_typeof(item) is distinct from 'object'
            or jsonb_typeof(item->'target') is distinct from 'string'
            or nullif(btrim(item->>'target'), '') is null
       )
  ) then
    raise exception 'ARTIFACT_SOURCE_INCOMPLETE: POC success-test target';
  end if;
  if exists (
    select 1
    from public.lifecycle_offboarding_plans source
    where jsonb_typeof(source.plan->'lockedExclusions') is distinct from 'array'
       or exists (
         select 1
         from jsonb_array_elements(source.plan->'lockedExclusions') item
         where jsonb_typeof(item) is distinct from 'object'
            or case
              when jsonb_typeof(item->'legalHold') = 'boolean'
                and jsonb_typeof(item->'reason') = 'string'
              then not (
                ((item->>'legalHold')::boolean and item->>'reason' = 'legal_hold')
                or (not (item->>'legalHold')::boolean
                  and item->>'reason' = 'object_lock_retention')
              )
              else true
            end
       )
  ) then
    raise exception 'ARTIFACT_SOURCE_INCOMPLETE: retained-object exclusion reason';
  end if;
end
$$;
alter table public.pocs
  add constraint pocs_success_test_targets_check check (
    coalesce(jsonb_typeof(success_tests) = 'array', false)
    and jsonb_array_length(success_tests) > 0
    and coalesce(
      jsonb_path_exists(
        success_tests,
        '$[*] ? (@.type() != "object" || !exists(@.target) || @.target.type() != "string" || @.target like_regex "^\\s*$")'
      ),
      true
    ) = false
  );
alter table public.lifecycle_offboarding_plans
  add constraint lifecycle_offboarding_exclusion_reasons_check check (
    coalesce(jsonb_typeof(plan->'lockedExclusions') = 'array', false)
    and coalesce(
      jsonb_path_exists(
        plan,
        '$.lockedExclusions[*] ? (@.type() != "object" || !exists(@.legalHold) || @.legalHold.type() != "boolean" || !exists(@.reason) || @.reason.type() != "string" || (@.legalHold == true && @.reason != "legal_hold") || (@.legalHold == false && @.reason != "object_lock_retention"))'
      ),
      true
    ) = false
  );
revoke all on function public.uuid_v7() from public;
grant execute on function public.uuid_v7()
  to clockwork_runtime, clockwork_service;
comment on function public.uuid_v7() is
  'RFC 9562 UUIDv7 generator with a 12-bit sub-millisecond fraction';

-- Authorization context expiry is intentionally evaluated once per statement.
-- statement_timestamp() is STABLE, matching this function's contract and the
-- stable RLS helper functions that call it.
create or replace function public.app_context_is_valid() returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  payload_text text := current_setting('app.authorization_context', true);
  signature text := current_setting('app.authorization_signature', true);
  claims jsonb;
  signature_valid boolean;
begin
  if coalesce(payload_text, '') = '' or coalesce(signature, '') = '' then
    return false;
  end if;
  claims := payload_text::jsonb;
  select bool_or(signature = encode(extensions.hmac(payload_text, secret, 'sha256'), 'hex'))
  into signature_valid from private.authorization_secrets where active;
  return coalesce(signature_valid, false)
    and (claims->>'expiresAt')::timestamptz > statement_timestamp()
    and jsonb_typeof(claims->'accountIds') = 'array'
    and jsonb_typeof(claims->'roles') = 'array'
    and nullif(claims->>'userId', '') is not null
    and nullif(claims->>'requestId', '') is not null;
exception when others then
  return false;
end
$$;
revoke all on function public.app_context_is_valid() from public;
grant execute on function public.app_context_is_valid()
  to clockwork_runtime, clockwork_service;

-- Reconcile queued portal-action audit actors with the strict shared Actor
-- contract. Assisted-session identity is explicit on the actor while the
-- session identifier remains non-actor audit metadata.
create or replace function public.append_experience_projection_action_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  audit_actor jsonb;
begin
  if not public.app_context_is_valid()
     or not public.app_is_current_user(new.actor_user_id) then
    raise exception using errcode = '42501',
      message = 'invalid projection action actor context';
  end if;
  audit_actor := case
    when new.assisted_session_id is not null then jsonb_strip_nulls(
      jsonb_build_object(
        'kind', 'user',
        'id', new.actor_user_id,
        'impersonatedAccountId', coalesce(
          new.effective_account_id,
          new.subject_account_id,
          new.audience_account_id
        ),
        'assistedActionReason', new.assisted_reason
      )
    )
    else jsonb_build_object('kind', 'user', 'id', new.actor_user_id)
  end;
  insert into public.audit_events (
    id, account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id, after, metadata
  ) values (
    new.audit_event_id,
    coalesce(
      new.effective_account_id,
      new.subject_account_id,
      new.audience_account_id
    ),
    'experience_action_request', new.id, 1,
    'experience.projection_action.queued', 1,
    audit_actor,
    new.created_at,
    coalesce(public.app_context_claims()->>'requestId', 'experience-action'),
    jsonb_build_object(
      'actionRequestId', new.id,
      'projectionId', new.projection_id,
      'aggregateType', new.aggregate_type,
      'aggregateId', new.aggregate_id,
      'action', new.action,
      'expectedVersion', new.expected_version,
      'status', new.status
    ),
    jsonb_strip_nulls(jsonb_build_object(
      'commandResource', new.command_resource,
      'idempotencyKey', new.idempotency_key,
      'assistedSessionId', new.assisted_session_id
    ))
  );
  insert into public.outbox_messages (id, event_id, topic, payload)
  values (
    new.outbox_message_id,
    new.audit_event_id,
    'experience.projection_action.queued',
    jsonb_build_object(
      'eventId', new.audit_event_id,
      'actionRequestId', new.id,
      'projectionId', new.projection_id,
      'aggregateType', new.aggregate_type,
      'aggregateId', new.aggregate_id,
      'action', new.action,
      'expectedVersion', new.expected_version
    )
  );
  return new;
end;
$$;
revoke all on function public.append_experience_projection_action_event()
  from public;
grant execute on function public.append_experience_projection_action_event()
  to clockwork_runtime, clockwork_service;

-- Exception decisions must keep the authoritative persisted roster decision;
-- no later worker or API process may reconstruct approvers from environment.
alter table public.exception_cases
  add column requester_user_id uuid references public.commerce_users(id),
  add column escalation_owner_user_id uuid references public.commerce_users(id),
  add column separation_required boolean not null default true,
  add column ownership_roster_entry_ids uuid[] not null default '{}'::uuid[],
  add column ownership_absence_escalated boolean not null default false;

with first_requester as (
  select distinct on (event.aggregate_id)
    event.aggregate_id,
    nullif(event.after->>'requestedBy', '')::uuid as requester_user_id
  from public.audit_events event
  where event.aggregate_type = 'exception_case'
    and event.event_type in ('exception_case.opened','workflow.exception.opened')
    and coalesce(event.after->>'requestedBy', '') ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  order by event.aggregate_id, event.aggregate_version asc
)
update public.exception_cases exception_case
set requester_user_id = first_requester.requester_user_id
from first_requester
where exception_case.requester_user_id is null
  and first_requester.aggregate_id = exception_case.id;

alter table public.exception_cases
  add constraint exception_case_roster_separation_check check (
    escalation_owner_user_id is null
    or (
      escalation_owner_user_id <> owner_user_id
      and escalation_owner_user_id is distinct from backup_user_id
    )
  );

-- Portal projections are caches of authoritative aggregates. Persist the
-- source aggregate version separately from the projection row's own CAS
-- version so workers cannot compare two unrelated counters.
alter table public.experience_portal_projections
  add column source_aggregate_version integer;

update public.experience_portal_projections projection
set source_aggregate_version = case projection.aggregate_type
  when 'account' then (
    select source.row_version from public.accounts source
    where source.id = projection.aggregate_id
      and date_trunc('milliseconds', source.updated_at)
        = date_trunc('milliseconds', projection.source_updated_at)
  )
  when 'agreement' then (
    select source.version from public.agreements source
    where source.id = projection.aggregate_id
      and date_trunc('milliseconds', source.created_at)
        = date_trunc('milliseconds', projection.source_updated_at)
  )
  when 'quote' then (
    select source.row_version from public.quotes source
    where source.id = projection.aggregate_id
      and date_trunc('milliseconds', source.updated_at)
        = date_trunc('milliseconds', projection.source_updated_at)
  )
  when 'order' then (
    select source.row_version from public.orders source
    where source.id = projection.aggregate_id
      and date_trunc('milliseconds', source.updated_at)
        = date_trunc('milliseconds', projection.source_updated_at)
  )
  when 'amendment' then (
    select source.version from public.amendments source
    where source.id = projection.aggregate_id
      and date_trunc('milliseconds', source.created_at)
        = date_trunc('milliseconds', projection.source_updated_at)
  )
  when 'poc' then (
    select source.row_version from public.pocs source
    where source.id = projection.aggregate_id
      and date_trunc('milliseconds', source.updated_at)
        = date_trunc('milliseconds', projection.source_updated_at)
  )
  when 'invoice' then (
    select source.row_version from public.invoices source
    where source.id = projection.aggregate_id
      and date_trunc('milliseconds', source.updated_at)
        = date_trunc('milliseconds', projection.source_updated_at)
  )
  when 'exception_case' then (
    select source.row_version from public.exception_cases source
    where source.id = projection.aggregate_id
      and date_trunc('milliseconds', source.updated_at)
        = date_trunc('milliseconds', projection.source_updated_at)
  )
  when 'approval' then (
    select source.row_version from public.approvals source
    where source.id = projection.aggregate_id
      and date_trunc('milliseconds', source.updated_at)
        = date_trunc('milliseconds', projection.source_updated_at)
  )
  when 'provider_operation' then (
    select source.row_version from public.provider_operations source
    where source.id = projection.aggregate_id
      and date_trunc('milliseconds', source.updated_at)
        = date_trunc('milliseconds', projection.source_updated_at)
  )
  when 'report_export' then (
    select source.row_version from public.report_exports source
    where source.id = projection.aggregate_id
      and date_trunc('milliseconds', source.updated_at)
        = date_trunc('milliseconds', projection.source_updated_at)
  )
  when 'termination' then (
    select source.row_version from public.terminations source
    where source.id = projection.aggregate_id
      and date_trunc('milliseconds', source.updated_at)
        = date_trunc('milliseconds', projection.source_updated_at)
  )
end;

-- A cache row that predates authoritative source-version binding may remain
-- visible, but it cannot retain a mutation grant until a current event has
-- rematerialized and rehashed it under the new contract.
update public.experience_portal_projections
set command_resource = null,
    payload = jsonb_set(payload, '{allowedActions}', '[]'::jsonb, true),
    row_version = row_version + 1
where command_resource is not null
   or payload ? 'allowedActions';

do $$
begin
  if exists (
    select 1 from public.experience_portal_projections
    where source_aggregate_version is null or source_aggregate_version <= 0
  ) then
    raise exception 'portal projection source versions require an authoritative rebuild';
  end if;
end
$$;

alter table public.experience_portal_projections
  alter column source_aggregate_version set not null,
  add constraint experience_projection_source_aggregate_version_check
    check (source_aggregate_version > 0);

-- Terminal action outcomes retain enough durable state to replay the exact
-- authoritative command result without invoking the command twice.
alter table public.experience_projection_action_requests
  add column result_code text,
  add column authoritative_version integer,
  add column command_replayed boolean,
  add column mfa_verified boolean not null default false,
  add column recent_authentication_verified boolean not null default false,
  add column updated_at timestamptz not null default now(),
  add column row_version integer not null default 1 check (row_version > 0);

drop trigger experience_projection_action_protect
  on public.experience_projection_action_requests;

create trigger experience_projection_action_version
before update on public.experience_projection_action_requests
for each row execute function public.touch_versioned_row();

update public.experience_projection_action_requests
set result_reference = coalesce(
      result_reference,
      'legacy-action:' || id::text || ':' || status
    ),
    result_code = coalesce(
      result_code,
      case status
        when 'applied' then 'LEGACY_PORTAL_ACTION_APPLIED'
        when 'rejected' then 'LEGACY_PORTAL_ACTION_REJECTED'
        when 'failed' then 'LEGACY_PORTAL_ACTION_FAILED'
      end
    ),
    updated_at = coalesce(completed_at, created_at)
where status <> 'queued';

update public.experience_projection_action_requests
set status = 'failed',
    result_reference = 'legacy-action:' || id::text || ':version-unverified',
    result_code = 'LEGACY_PROJECTION_VERSION_UNVERIFIED',
    command_replayed = false,
    completed_at = coalesce(completed_at, now())
where status = 'queued';

-- Every action normalized by the upgrade receives a terminal audit/outbox
-- tuple. Deterministic RFC UUIDv5-shaped IDs make the evidence recoverable and
-- tie aggregate version 2 to the trigger-driven normalization transition.
with legacy_terminal as (
  select action.*,
         case
           when action.assisted_session_id is not null then jsonb_strip_nulls(
             jsonb_build_object(
               'kind', 'user',
               'id', action.actor_user_id,
               'impersonatedAccountId', coalesce(
                 action.effective_account_id,
                 action.subject_account_id,
                 action.audience_account_id
               ),
               'assistedActionReason', action.assisted_reason
             )
           )
           else jsonb_build_object('kind', 'user', 'id', action.actor_user_id)
         end as terminal_actor,
         (
           substring(encode(extensions.digest(
             convert_to(action.id::text || ':001300:terminal-audit', 'UTF8'),
             'sha256'
           ), 'hex') from 1 for 8) || '-' ||
           substring(encode(extensions.digest(
             convert_to(action.id::text || ':001300:terminal-audit', 'UTF8'),
             'sha256'
           ), 'hex') from 9 for 4) || '-' ||
           '5' || substring(encode(extensions.digest(
             convert_to(action.id::text || ':001300:terminal-audit', 'UTF8'),
             'sha256'
           ), 'hex') from 14 for 3) || '-' ||
           '8' || substring(encode(extensions.digest(
             convert_to(action.id::text || ':001300:terminal-audit', 'UTF8'),
             'sha256'
           ), 'hex') from 18 for 3) || '-' ||
           substring(encode(extensions.digest(
             convert_to(action.id::text || ':001300:terminal-audit', 'UTF8'),
             'sha256'
           ), 'hex') from 21 for 12)
         )::uuid as terminal_audit_id
  from public.experience_projection_action_requests action
  where (
      (action.status = 'applied'
       and action.result_code = 'LEGACY_PORTAL_ACTION_APPLIED')
      or (action.status = 'rejected'
          and action.result_code = 'LEGACY_PORTAL_ACTION_REJECTED')
      or (action.status = 'failed'
          and action.result_code in (
            'LEGACY_PORTAL_ACTION_FAILED',
            'LEGACY_PROJECTION_VERSION_UNVERIFIED'
          ))
    )
    and action.row_version = 2
)
insert into public.audit_events (
  id, account_id, aggregate_type, aggregate_id, aggregate_version,
  event_type, event_version, actor, occurred_at, request_id, after, metadata
)
select terminal_audit_id,
       coalesce(effective_account_id, subject_account_id, audience_account_id),
       'experience_action_request', id, row_version,
       'experience.projection_action.' || status, 1,
       terminal_actor,
       completed_at, 'migration:001300:legacy-projection-action',
       jsonb_build_object(
         'actionRequestId', id,
         'aggregateType', aggregate_type,
         'aggregateId', aggregate_id,
         'action', action,
         'expectedVersion', expected_version,
         'status', status,
         'resultCode', result_code,
         'resultReference', result_reference,
         'authoritativeVersion', authoritative_version,
         'commandReplayed', command_replayed,
         'migrationCommandReplayed', false,
         'historicalProviderIssuance', 'unknown',
         'reconciliationRequired', true
       ),
       jsonb_strip_nulls(jsonb_build_object(
         'migration', '001300_release_integrity',
         'legacyQueued', result_code = 'LEGACY_PROJECTION_VERSION_UNVERIFIED',
         'legacyTerminalNormalized', true,
         'migrationCommandReplayed', false,
         'historicalProviderIssuance', 'unknown',
         'reconciliationRequired', true,
         'queuedAuditEventId', audit_event_id,
         'assistedSessionId', assisted_session_id
       ))
from legacy_terminal;

with legacy_terminal as (
  select action.*,
         terminal.id as terminal_audit_id,
         terminal.actor,
         terminal.after,
         (
           substring(encode(extensions.digest(
             convert_to(action.id::text || ':001300:terminal-outbox', 'UTF8'),
             'sha256'
           ), 'hex') from 1 for 8) || '-' ||
           substring(encode(extensions.digest(
             convert_to(action.id::text || ':001300:terminal-outbox', 'UTF8'),
             'sha256'
           ), 'hex') from 9 for 4) || '-' ||
           '5' || substring(encode(extensions.digest(
             convert_to(action.id::text || ':001300:terminal-outbox', 'UTF8'),
             'sha256'
           ), 'hex') from 14 for 3) || '-' ||
           '8' || substring(encode(extensions.digest(
             convert_to(action.id::text || ':001300:terminal-outbox', 'UTF8'),
             'sha256'
           ), 'hex') from 18 for 3) || '-' ||
           substring(encode(extensions.digest(
             convert_to(action.id::text || ':001300:terminal-outbox', 'UTF8'),
             'sha256'
           ), 'hex') from 21 for 12)
         )::uuid as terminal_outbox_id
  from public.experience_projection_action_requests action
  join public.audit_events terminal
    on terminal.aggregate_type = 'experience_action_request'
   and terminal.aggregate_id = action.id
   and terminal.aggregate_version = action.row_version
   and terminal.event_type = 'experience.projection_action.' || action.status
  where (
      (action.status = 'applied'
       and action.result_code = 'LEGACY_PORTAL_ACTION_APPLIED')
      or (action.status = 'rejected'
          and action.result_code = 'LEGACY_PORTAL_ACTION_REJECTED')
      or (action.status = 'failed'
          and action.result_code in (
            'LEGACY_PORTAL_ACTION_FAILED',
            'LEGACY_PROJECTION_VERSION_UNVERIFIED'
          ))
    )
    and action.row_version = 2
)
insert into public.outbox_messages (id, event_id, topic, payload)
select terminal_outbox_id, terminal_audit_id,
       'experience.projection_action.' || status,
       jsonb_build_object(
         'eventId', terminal_audit_id,
         'eventType', 'experience.projection_action.' || status,
         'aggregateType', 'experience_action_request',
         'aggregateId', id,
         'aggregateVersion', row_version,
         'occurredAt', completed_at,
         'requestId', 'migration:001300:legacy-projection-action',
         'actor', actor,
         'data', after
       )
from legacy_terminal;

alter table public.experience_projection_action_requests
  drop constraint experience_action_completion_check,
  add constraint experience_action_completion_check check (
    (
      status = 'queued'
      and completed_at is null
      and result_reference is null
      and result_code is null
      and authoritative_version is null
      and command_replayed is null
    )
    or (
      status <> 'queued'
      and completed_at is not null
      and result_reference is not null
      and result_code is not null
      and (
        command_replayed is not null
        or (status = 'applied'
            and result_code = 'LEGACY_PORTAL_ACTION_APPLIED')
        or (status = 'rejected'
            and result_code = 'LEGACY_PORTAL_ACTION_REJECTED')
        or (status = 'failed'
            and result_code in (
              'LEGACY_PORTAL_ACTION_FAILED',
              'LEGACY_PROJECTION_VERSION_UNVERIFIED'
            ))
      )
      and (authoritative_version is null or authoritative_version > 0)
    )
  );

-- The action compares the authoritative source version, not the projection
-- cache row's independent maintenance counter. Authentication assurance is a
-- request-time fact and is immutable with the rest of the command envelope.
create or replace function public.validate_experience_projection_action()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  projection public.experience_portal_projections%rowtype;
begin
  select * into projection
  from public.experience_portal_projections
  where id = new.projection_id
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'projection record not found';
  end if;
  if projection.source_aggregate_version <> new.expected_version then
    raise exception using errcode = '40001', message = 'authoritative version conflict';
  end if;
  if projection.aggregate_type <> new.aggregate_type
    or projection.aggregate_id <> new.aggregate_id
    or projection.command_resource is distinct from new.command_resource
    or projection.audience_account_id is distinct from new.audience_account_id
    or projection.subject_account_id is distinct from new.subject_account_id
  then
    raise exception using errcode = '42501', message = 'projection command binding mismatch';
  end if;
  if not coalesce(projection.payload->'allowedActions', '[]'::jsonb) ? new.action then
    raise exception using errcode = '42501', message = 'projection action is not allowed';
  end if;
  return new;
end
$$;
revoke all on function public.validate_experience_projection_action()
  from public;

create or replace function public.protect_experience_projection_action()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'projection action requests cannot be deleted';
  end if;
  if old.projection_id is distinct from new.projection_id
    or old.audience_account_id is distinct from new.audience_account_id
    or old.subject_account_id is distinct from new.subject_account_id
    or old.aggregate_type is distinct from new.aggregate_type
    or old.aggregate_id is distinct from new.aggregate_id
    or old.command_resource is distinct from new.command_resource
    or old.action is distinct from new.action
    or old.expected_version is distinct from new.expected_version
    or old.actor_user_id is distinct from new.actor_user_id
    or old.effective_account_id is distinct from new.effective_account_id
    or old.assisted_session_id is distinct from new.assisted_session_id
    or old.assisted_reason is distinct from new.assisted_reason
    or old.mfa_verified is distinct from new.mfa_verified
    or old.recent_authentication_verified is distinct from new.recent_authentication_verified
    or old.idempotency_key is distinct from new.idempotency_key
    or old.request_payload is distinct from new.request_payload
    or old.created_at is distinct from new.created_at
    or old.audit_event_id is distinct from new.audit_event_id
    or old.outbox_message_id is distinct from new.outbox_message_id
  then
    raise exception using errcode = '55000', message = 'projection action identity is immutable';
  end if;
  if old.status <> 'queued'
    or new.status not in ('applied','rejected','failed')
    or new.completed_at is null
  then
    raise exception using errcode = '23514', message = 'invalid projection action transition';
  end if;
  return new;
end
$$;

create trigger experience_projection_action_protect
before update or delete on public.experience_projection_action_requests
for each row execute function public.protect_experience_projection_action();

-- Claims are separate from immutable request identity. Lease expiry permits
-- crash recovery without a queued-to-queued mutation of the request itself.
create table public.experience_projection_action_claims (
  action_request_id uuid primary key
    references public.experience_projection_action_requests(id),
  event_id uuid not null references public.audit_events(id),
  message_id uuid not null references public.outbox_messages(id),
  idempotency_key text not null check (length(idempotency_key) between 16 and 255),
  claim_token uuid,
  lease_until timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0),
  constraint experience_action_claim_event_unique unique (event_id),
  constraint experience_action_claim_message_unique unique (message_id),
  constraint experience_action_claim_lease_check check (
    (claim_token is null and lease_until is null)
    or (claim_token is not null and lease_until is not null)
  )
);
create index experience_projection_action_claim_lease_idx
  on public.experience_projection_action_claims(lease_until)
  where claim_token is not null;
create trigger experience_projection_action_claim_version
before update on public.experience_projection_action_claims
for each row execute function public.touch_versioned_row();

-- One receipt represents one atomic projection set. The event uniqueness is
-- the durable dedupe boundary; the aggregate tuple detects conflicting event
-- identities for a source version.
create table public.experience_projection_materialization_receipts (
  id uuid primary key default public.uuid_v7(),
  event_id uuid not null unique references public.audit_events(id),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  aggregate_version integer not null,
  source_hash text not null,
  projection_count integer not null,
  projected_at timestamptz not null,
  constraint experience_projection_materialization_event_type_check
    check (length(event_type) between 3 and 160),
  constraint experience_projection_materialization_aggregate_type_check
    check (length(aggregate_type) between 1 and 80),
  constraint experience_projection_materialization_aggregate_version_check
    check (aggregate_version > 0),
  constraint experience_projection_materialization_source_hash_check
    check (source_hash ~ '^[a-f0-9]{64}$'),
  constraint experience_projection_materialization_projection_count_check
    check (projection_count >= 0),
  constraint experience_projection_receipt_source_unique
    unique (aggregate_type, aggregate_id, aggregate_version, event_type)
);

alter table public.experience_projection_action_claims enable row level security;
alter table public.experience_projection_action_claims force row level security;
alter table public.experience_projection_materialization_receipts enable row level security;
alter table public.experience_projection_materialization_receipts force row level security;
create policy experience_action_claim_service
  on public.experience_projection_action_claims for all
  using (public.app_is_internal()) with check (public.app_is_internal());
create policy experience_projection_receipt_service
  on public.experience_projection_materialization_receipts for all
  using (public.app_is_internal()) with check (public.app_is_internal());
revoke all on public.experience_projection_action_claims,
  public.experience_projection_materialization_receipts
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select, insert, update on public.experience_projection_action_claims
  to clockwork_service;
grant select, insert on public.experience_projection_materialization_receipts
  to clockwork_service;

-- Repoint every legacy public-table UUID generator without changing any
-- existing identifier. This also covers operational UUID columns such as
-- leases that were introduced by earlier forward-only migrations.
do $$
declare
  target record;
begin
  for target in
    select table_schema, table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and data_type = 'uuid'
      and column_default like '%gen_random_uuid()%'
      and column_name not in ('lock_token', 'claim_token', 'lease_token')
  loop
    execute format(
      'alter table %I.%I alter column %I set default public.uuid_v7()',
      target.table_schema,
      target.table_name,
      target.column_name
    );
  end loop;
end
$$;
