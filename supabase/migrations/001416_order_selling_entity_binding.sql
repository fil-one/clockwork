-- NOTHING BOUND AN ORDER TO A SELLING ENTITY, SO NO PLACE-OF-SUPPLY RULE COULD
-- BE APPLIED TO ONE.
--
-- Verified in the applied schema before writing: `legal_entity_id` appears on
-- exactly one table, `core_tax_registrations` (001410:85). The two `our_entity`
-- rows the seed carries — Clockwork Commerce Ltd (GB) and Clockwork Commerce
-- Inc (US) — are referenced by nothing else. So the question "which of our
-- entities is the supplier on this order" had no answer anywhere in the
-- database, and every place-of-supply rule is a function of that answer.
--
-- THE BINDING IS NOT ONE COLUMN, because there are two entities in the question
-- and they are not the same entity on three of the five routes:
--
--   * THE SUPPLIER ON OUR INVOICE. We bill on direct, referral, resale and
--     distributor routes, and on every one of them the invoice is issued BY ONE
--     OF OUR ENTITIES. That is true on resale and distributor too: the partner
--     is the merchant of record to the END CLIENT, but the bill we write goes
--     to the partner, and its supplier is us. 001410's own worked example is
--     exactly this supply — "a US entity selling to a Spanish reseller" — and
--     it is wrong today because the code reads the invoiced account as the
--     merchant side. Our entity is the supplier; the partner is the customer.
--
--   * THE MERCHANT OF RECORD ON THE END-CLIENT SUPPLY. `merchantOfRecord(route)`
--     already answers this as a WORD ('fil_one', 'partner', 'marketplace') and
--     000100:118 persists that word on core_order_commercial_profiles. A word
--     is not an entity: it cannot carry a registration, an establishment
--     country or an invoice identity. On resale and distributor that entity is
--     the PARTNER's, which is the reason core_legal_entities.account_id exists
--     and is nullable, and until now nothing populated it.
--
-- ON WHAT BASIS OUR ENTITY IS CHOSEN, which is the part that had to be decided
-- rather than derived:
--
--   NOT customer location. It is the tempting rule and it is circular: the
--   supplier's establishment is an INPUT to place of supply, so choosing the
--   supplier from where the customer is makes the answer select its own
--   question. It is also unstable in a way that rewrites history — an account
--   that corrects its registered address would silently move the entity that
--   sold it, and with it the registration the tax already charged was charged
--   under.
--
--   NOT the contracting entity inferred from the agreement, because no
--   agreement row in this schema names one. Reading a legal fact out of a
--   table that does not carry it is the invention this project keeps paying
--   for.
--
--   OPERATOR-STATED, resolved most-specific-first, and PINNED AT ACCEPTANCE.
--   Which of our entities contracts a customer is a fact recorded in the MSA by
--   the people who signed it, so it is stated, effective-dated and amendable as
--   data — the same standing this repository gives a tax registration (001410)
--   and a rule book (001411). It is pinned onto the order at acceptance for the
--   same reason `governing_agreement_version` is: the answer that priced and
--   taxed the supply must survive a later restatement of the assignment.
--
--   Marketplace binds too, and binds to NOTHING BY NAME. The marketplace is the
--   merchant of record, we supply nothing to the end client, and no entity of
--   ours issues a document. A row that says so is the difference between "out
--   of scope for us, decided" and "nobody has looked", which is the same
--   distinction `not_determined` draws on the invoice header.

-- WHO SELLS WHAT WE SELL. Dated operator statements, in the shape of
-- core_tax_registrations (001410:83): stated by a named person at a named time,
-- effective-dated with a half-open window, and immutable once made.
--
-- Three scopes, resolved most specific first, and the scope lives in which
-- columns are null:
--
--   account_id set              -- this counterparty contracts with this entity
--   customer_country set        -- counterparties in this country do
--   both null                   -- everyone else does
--
-- A deployment that has stated none of the three cannot accept an order we
-- bill, and that refusal is correct: an order whose supplier nobody has stated
-- cannot be taxed, invoiced or defended. The seed states all three levels, so
-- the refusal is reachable in a test and not in a working system.
create table core_selling_entity_assignments (
  id uuid primary key default uuid_v7(),
  legal_entity_id uuid not null references core_legal_entities(id),
  account_id uuid references accounts(id),
  customer_country text check (customer_country ~ '^[A-Z]{2}$'),
  effective_from date not null,
  effective_to date,
  stated_by uuid not null references commerce_users(id),
  stated_at timestamptz not null,
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0),
  constraint core_selling_entity_assignments_window_check
    check (effective_to is null or effective_to > effective_from),
  -- An account-scoped statement names the counterparty and nothing else: a row
  -- carrying both an account and a country would be two statements whose
  -- disagreement has no resolution rule.
  constraint core_selling_entity_assignments_scope_check
    check (account_id is null or customer_country is null)
);
-- At most one open-ended statement per scope. A superseding statement closes
-- its predecessor's window, exactly as a rule book version closes the book it
-- supersedes.
create unique index core_selling_entity_assignments_open_account_unique
  on core_selling_entity_assignments(account_id)
  where effective_to is null and account_id is not null;
create unique index core_selling_entity_assignments_open_country_unique
  on core_selling_entity_assignments(customer_country)
  where effective_to is null and customer_country is not null;
-- The default statement, of which there is at most one open at a time. Indexed
-- on `effective_to` with NULLS NOT DISTINCT rather than on a constant
-- expression: every row the predicate admits has a null there, so treating
-- nulls as equal is what makes the single-row rule a real constraint, and an
-- expression index would be a column no model can mirror.
create unique index core_selling_entity_assignments_open_default_unique
  on core_selling_entity_assignments(effective_to)
  nulls not distinct
  where effective_to is null and account_id is null and customer_country is null;
create index core_selling_entity_assignments_lookup_idx
  on core_selling_entity_assignments(account_id, customer_country, effective_from);
create trigger core_selling_entity_assignments_version
before update on core_selling_entity_assignments
for each row execute function touch_versioned_row();

comment on table public.core_selling_entity_assignments is
  'Operator statements of which of our legal entities contracts a supply: by counterparty, by counterparty country, or as the default. Resolved most specific first and pinned onto the order at acceptance, so a later restatement cannot move the supplier a determination was already made against.';
comment on column public.core_selling_entity_assignments.customer_country is
  'Country of the INVOICED counterparty, which is the party we contract with — the partner on a resale or distributor route, the buyer otherwise. Not the place of supply: this statement is an input to that answer, never a substitute for it.';
comment on column public.core_selling_entity_assignments.reason is
  'Why this entity contracts these counterparties. Required for the same reason core_tax_rates.legal_basis is: a statement with no stated basis cannot be reviewed by the person who has to stand behind it.';

-- A stated assignment is the recorded basis for every order pinned to it.
-- Correcting it in place would rewrite that basis, so the statement is frozen
-- and superseded rather than edited; only the closing date moves.
create or replace function protect_stated_selling_entity_assignment() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.core_order_supplier_bindings binding
      where binding.selling_entity_assignment_id = old.id
    ) then return old; end if;
    raise exception using errcode = '55000',
      message = 'a selling entity assignment an order is pinned to is not deleted; close its window';
  end if;
  if new.legal_entity_id is distinct from old.legal_entity_id
    or new.account_id is distinct from old.account_id
    or new.customer_country is distinct from old.customer_country
    or new.effective_from is distinct from old.effective_from
    or new.stated_by is distinct from old.stated_by
    or new.stated_at is distinct from old.stated_at
  then
    raise exception using errcode = '55000',
      message = 'a stated selling entity assignment is immutable; state a new assignment';
  end if;
  -- A window that has already been closed is history. Re-opening it would put
  -- two statements over one day with no rule to choose between them.
  if old.effective_to is not null and new.effective_to is distinct from old.effective_to then
    raise exception using errcode = '55000',
      message = 'a closed selling entity assignment window does not reopen';
  end if;
  return new;
end $$;

-- The entity must be OURS. A partner entity contracts nothing on our behalf,
-- and an assignment pointing at one would put a counterparty's establishment
-- on our own invoice.
create or replace function validate_selling_entity_assignment() returns trigger
language plpgsql set search_path = public as $$
declare stated_role text;
begin
  select merchant_role into stated_role
  from public.core_legal_entities where id = new.legal_entity_id;
  if stated_role is distinct from 'our_entity' then
    raise exception using errcode = '23514',
      message = 'a selling entity assignment names one of our own entities';
  end if;
  return new;
end $$;
create trigger core_selling_entity_assignments_validate
before insert or update on core_selling_entity_assignments
for each row execute function validate_selling_entity_assignment();
create trigger core_selling_entity_assignments_immutable
before update or delete on core_selling_entity_assignments
for each row execute function protect_stated_selling_entity_assignment();

-- ONE PARTNER ACCOUNT IS ONE PARTNER ENTITY. Without this, two partner_entity
-- rows could name the same account and the merchant of record on an order
-- would be whichever the reader sorted first — the ambiguity that makes a
-- binding worthless. 001410 created the column and left the cardinality open.
create unique index core_legal_entities_partner_account_unique
  on core_legal_entities(account_id)
  where merchant_role = 'partner_entity';

-- THE RESOLUTION, as a function rather than a query in one caller, so the rule
-- is stated once and can be tested on its own.
--
-- Returns the ASSIGNMENT, not the entity: the assignment is what gets pinned,
-- and pinning the entity alone would lose which statement chose it — the
-- difference between "this entity sold it" and "this entity sold it because
-- this person said so on this date".
create or replace function core_resolve_selling_entity_assignment(
  counterparty_account_id uuid,
  counterparty_country text,
  on_date date
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select assignment.id
  from public.core_selling_entity_assignments assignment
  where assignment.effective_from <= on_date
    and (assignment.effective_to is null or on_date < assignment.effective_to)
    and (
      assignment.account_id = counterparty_account_id
      or (assignment.account_id is null and assignment.customer_country is null)
      or (assignment.account_id is null
          and assignment.customer_country = upper(trim(counterparty_country)))
    )
  -- Most specific first: the counterparty's own statement, then its country's,
  -- then the default. `effective_from desc` breaks a tie between two statements
  -- of the same scope, which the open-window unique indexes above already make
  -- unreachable for the current day and which a back-dated resolution can still
  -- meet.
  order by
    case
      when assignment.account_id is not null then 0
      when assignment.customer_country is not null then 1
      else 2
    end,
    assignment.effective_from desc
  limit 1
$$;

revoke all on function public.core_resolve_selling_entity_assignment(uuid, text, date) from public;
grant execute on function public.core_resolve_selling_entity_assignment(uuid, text, date)
  to clockwork_runtime, clockwork_service;

comment on function public.core_resolve_selling_entity_assignment(uuid, text, date) is
  'The operator statement that says which of our entities contracts this counterparty on this date: account statement, then country statement, then the default. Null means nobody has said, which refuses an acceptance rather than picking an entity.';

-- THE PIN ITSELF. One row per order, written at acceptance beside
-- core_order_commercial_profiles, and immutable for the same reason that
-- profile is: it is the commercial identity of a supply that has been made.
create table core_order_supplier_bindings (
  order_id uuid primary key references orders(id),
  merchant_of_record text not null
    check (merchant_of_record in ('fil_one','partner','marketplace')),
  -- The entity that issues OUR invoice. Null only where we issue none.
  supplier_legal_entity_id uuid references core_legal_entities(id),
  -- The entity that is merchant of record to the end client: ours on a fil_one
  -- route, the partner's on resale and distributor, and nobody's on a
  -- marketplace supply we are not a party to.
  merchant_legal_entity_id uuid references core_legal_entities(id),
  selling_entity_assignment_id uuid references core_selling_entity_assignments(id),
  -- The establishment as it stood when the order was accepted.
  -- core_legal_entities carries no immutability trigger — an entity can be
  -- restated — so the country the determination will be made against is copied
  -- here and checked. A silent move of an entity's establishment is then a
  -- refusal at the next write rather than a different answer to the same
  -- question.
  supplier_established_country text
    check (supplier_established_country ~ '^[A-Z]{2}$'),
  bound_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- We supply nothing on a marketplace route and no entity of ours issues a
  -- document, so all four columns are null together or none of them is. The
  -- biconditional is what stops a half-filled marketplace row from reading as
  -- an ordinary sale with a missing supplier.
  constraint core_order_supplier_bindings_marketplace_check
    check (
      (merchant_of_record = 'marketplace') = (supplier_legal_entity_id is null)
      and (supplier_legal_entity_id is null) = (merchant_legal_entity_id is null)
      and (supplier_legal_entity_id is null) = (selling_entity_assignment_id is null)
      and (supplier_legal_entity_id is null) = (supplier_established_country is null)
    ),
  -- On a route we are the merchant of, the two entities are the same entity.
  -- They are separate columns because on the other two routes they are not.
  constraint core_order_supplier_bindings_self_merchant_check
    check (
      merchant_of_record <> 'fil_one'
      or merchant_legal_entity_id = supplier_legal_entity_id
    )
);
create index core_order_supplier_bindings_supplier_idx
  on core_order_supplier_bindings(supplier_legal_entity_id);
create index core_order_supplier_bindings_merchant_idx
  on core_order_supplier_bindings(merchant_legal_entity_id);

comment on table public.core_order_supplier_bindings is
  'Which entity sells an order and which is merchant of record on it, pinned at acceptance. The supplier side every place-of-supply rule needs, resolved once from an operator statement rather than re-derived per determination.';
comment on column public.core_order_supplier_bindings.supplier_legal_entity_id is
  'The entity that issues our invoice for this order — always one of ours, including on resale and distributor where the customer is the partner. Null only on a marketplace route, where we issue nothing.';
comment on column public.core_order_supplier_bindings.merchant_legal_entity_id is
  'The entity that is merchant of record on the end-client supply: ours, or the partner''s. The word on core_order_commercial_profiles.merchant_of_record as an entity that can hold a registration.';
comment on column public.core_order_supplier_bindings.selling_entity_assignment_id is
  'The operator statement that chose the supplier. Pinned so the reason survives a restatement, the same way the agreement version is pinned.';

-- CROSS-ROW IDENTITY. Every fact this row repeats is checked against the row it
-- was copied from, in the shape core_validate_commercial_identity (001000:669)
-- established: a deferrable constraint trigger, initially immediate, so an
-- acceptance that writes the order, the profile and the binding in one
-- statement order still gets checked, and a caller that must interleave can
-- defer it without losing it.
create or replace function public.core_validate_order_supplier_binding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  persisted_order public.orders%rowtype;
  persisted_merchant_of_record text;
  supplier public.core_legal_entities%rowtype;
  merchant public.core_legal_entities%rowtype;
  assignment public.core_selling_entity_assignments%rowtype;
  invoiced_account_id uuid;
  invoiced_country text;
begin
  select * into persisted_order from public.orders where id = new.order_id;
  select commercial.merchant_of_record into persisted_merchant_of_record
  from public.core_order_commercial_profiles commercial
  where commercial.order_id = new.order_id;
  if persisted_order.id is null or persisted_merchant_of_record is null then
    raise exception using errcode = '23514',
      message = 'a supplier binding requires its persisted order and commercial profile';
  end if;
  -- The word and the entities have to agree. Deriving the word here instead of
  -- reading it would give this row a second opinion about the route, which is
  -- exactly how the two copies of merchantOfRecord drifted in the first place.
  if new.merchant_of_record is distinct from persisted_merchant_of_record then
    raise exception using errcode = '23514',
      message = 'supplier binding merchant of record must match the persisted commercial profile';
  end if;

  if new.merchant_of_record = 'marketplace' then
    -- The columns are already null by the table check; what is checked here is
    -- that the ROUTE really is the marketplace one, so a mis-stated word cannot
    -- turn a billable order into an unbound one.
    if persisted_order.sourcing is distinct from 'marketplace' then
      raise exception using errcode = '23514',
        message = 'only a marketplace order binds no selling entity';
    end if;
    return new;
  end if;

  select * into supplier from public.core_legal_entities
  where id = new.supplier_legal_entity_id;
  select * into merchant from public.core_legal_entities
  where id = new.merchant_legal_entity_id;
  select * into assignment from public.core_selling_entity_assignments
  where id = new.selling_entity_assignment_id;
  if supplier.id is null or merchant.id is null or assignment.id is null then
    raise exception using errcode = '23514',
      message = 'supplier binding names an entity or assignment that does not exist';
  end if;
  if supplier.merchant_role <> 'our_entity' then
    raise exception using errcode = '23514',
      message = 'the supplier on our invoice is one of our own entities';
  end if;
  if new.supplier_established_country is distinct from supplier.established_country then
    raise exception using errcode = '23514',
      message = 'pinned supplier establishment does not match the entity it names';
  end if;
  if assignment.legal_entity_id is distinct from new.supplier_legal_entity_id then
    raise exception using errcode = '23514',
      message = 'pinned selling entity assignment does not name the pinned supplier';
  end if;

  -- The counterparty we contract with is the one we invoice: the partner on a
  -- resale or distributor route, the buyer otherwise. `invoicing_account_id` is
  -- that answer already persisted, so it is read rather than re-derived.
  invoiced_account_id := persisted_order.invoicing_account_id;
  select country into invoiced_country from public.accounts where id = invoiced_account_id;
  if assignment.account_id is not null
     and assignment.account_id is distinct from invoiced_account_id then
    raise exception using errcode = '23514',
      message = 'pinned selling entity assignment names a different counterparty';
  end if;
  if assignment.account_id is null
     and assignment.customer_country is not null
     and assignment.customer_country is distinct from invoiced_country then
    raise exception using errcode = '23514',
      message = 'pinned selling entity assignment names a different counterparty country';
  end if;

  if new.merchant_of_record = 'partner' then
    if merchant.merchant_role <> 'partner_entity'
      or persisted_order.partner_account_id is null
      or merchant.account_id is distinct from persisted_order.partner_account_id then
      raise exception using errcode = '23514',
        message = 'a partner-merchant order binds the partner account''s own entity';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.core_validate_order_supplier_binding() from public;
create constraint trigger core_order_supplier_binding_identity
after insert or update on public.core_order_supplier_bindings
deferrable initially immediate for each row
execute function public.core_validate_order_supplier_binding();

-- THE WRITER, IN THE DATABASE, for the same reason
-- core_reserve_order_acceptance (001000) is: acceptance runs on the TENANT
-- pool, and the three rows this binding is derived from are not all readable
-- there. `core_legal_entities` admits a partner's own entity only to that
-- partner (001410:175), and the caller accepting a resale order is the buyer or
-- an internal operator, neither of which is the partner. A repository that
-- assembled this in application code would therefore need the partner entity
-- exposed to whoever accepts an order, which is a wider read than the binding
-- needs. One security-definer function keeps the read narrow and puts the rule
-- in one place that both writers and a pgTAP test can call.
--
-- THE PARTNER ENTITY IS ENSURED, NOT REQUIRED, and the distinction matters.
-- Refusing to accept a resale order because nobody had separately typed the
-- partner's own name into a second table would be a control blocking a
-- legitimate operation. Every column of the row this creates is COPIED from the
-- partner account's own persisted facts — its legal name, its country, its
-- registered address — so nothing about the world is inferred. What is
-- emphatically NOT created is a REGISTRATION: 001410 states that the engine
-- never infers one, so a partner merchant of record starts with an entity and
-- no registrations, and any determination that needs one gets `not_registered`
-- until an operator states it. An entity is an identity; a registration is a
-- claim.
create or replace function public.core_bind_order_selling_entity(
  target_order_id uuid,
  bound_at timestamptz
)
returns public.core_order_supplier_bindings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  persisted_order public.orders%rowtype;
  persisted_merchant_of_record text;
  invoiced public.accounts%rowtype;
  partner public.accounts%rowtype;
  assignment_id uuid;
  supplier public.core_legal_entities%rowtype;
  merchant_entity_id uuid;
  binding public.core_order_supplier_bindings%rowtype;
begin
  select * into persisted_order from public.orders where id = target_order_id;
  select commercial.merchant_of_record into persisted_merchant_of_record
  from public.core_order_commercial_profiles commercial
  where commercial.order_id = target_order_id;
  if persisted_order.id is null or persisted_merchant_of_record is null then
    raise exception using errcode = '23514',
      message = 'an order is bound to a selling entity only once its commercial profile exists';
  end if;

  -- Idempotent by pin, not by re-derivation. Acceptance is replayed by
  -- idempotency key, and a replay must return the binding that was made rather
  -- than make a second one against whatever the assignments say today.
  select * into binding from public.core_order_supplier_bindings
  where order_id = target_order_id;
  if binding.order_id is not null then return binding; end if;

  if persisted_merchant_of_record = 'marketplace' then
    insert into public.core_order_supplier_bindings (
      order_id, merchant_of_record, bound_at
    ) values (target_order_id, 'marketplace', bound_at)
    returning * into binding;
    return binding;
  end if;

  select * into invoiced from public.accounts
  where id = persisted_order.invoicing_account_id;
  assignment_id := public.core_resolve_selling_entity_assignment(
    invoiced.id, invoiced.country, (bound_at at time zone 'UTC')::date
  );
  if assignment_id is null then
    raise exception using errcode = '23514',
      message = format(
        'no selling entity is stated for %s (%s) on %s; state one before accepting an order we bill',
        invoiced.legal_name, invoiced.country, (bound_at at time zone 'UTC')::date
      );
  end if;
  select entity.* into supplier
  from public.core_selling_entity_assignments assignment
  join public.core_legal_entities entity on entity.id = assignment.legal_entity_id
  where assignment.id = assignment_id;

  if persisted_merchant_of_record = 'partner' then
    select * into partner from public.accounts where id = persisted_order.partner_account_id;
    if partner.id is null then
      raise exception using errcode = '23514',
        message = 'a partner-merchant order names the partner account it is merchant of record for';
    end if;
    insert into public.core_legal_entities (
      legal_name, merchant_role, account_id, established_country, registered_address
    ) values (
      partner.legal_name, 'partner_entity', partner.id, partner.country,
      partner.registered_address
    )
    on conflict (account_id) where merchant_role = 'partner_entity' do nothing;
    select id into merchant_entity_id from public.core_legal_entities
    where account_id = partner.id and merchant_role = 'partner_entity';
  else
    merchant_entity_id := supplier.id;
  end if;

  insert into public.core_order_supplier_bindings (
    order_id, merchant_of_record, supplier_legal_entity_id,
    merchant_legal_entity_id, selling_entity_assignment_id,
    supplier_established_country, bound_at
  ) values (
    target_order_id, persisted_merchant_of_record, supplier.id,
    merchant_entity_id, assignment_id, supplier.established_country, bound_at
  )
  returning * into binding;
  return binding;
end $$;

revoke all on function public.core_bind_order_selling_entity(uuid, timestamptz) from public;
grant execute on function public.core_bind_order_selling_entity(uuid, timestamptz)
  to clockwork_runtime, clockwork_service;

comment on function public.core_bind_order_selling_entity(uuid, timestamptz) is
  'Pins the supplier and merchant-of-record entities onto an accepted order from persisted truth alone. Idempotent by order. Raises rather than choosing an entity when no operator statement resolves.';

-- Immutable, in the shape of protect_invoice_document_snapshot (001300:507).
-- The supplier a supply was made by is not restated after the fact; a supply
-- made by a different entity is a different supply.
create or replace function public.protect_order_supplier_binding()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '55000',
    message = 'an order supplier binding is pinned at acceptance and is immutable';
end $$;
create trigger core_order_supplier_binding_immutable
before update or delete on public.core_order_supplier_bindings
for each row execute function public.protect_order_supplier_binding();

alter table core_selling_entity_assignments enable row level security;
alter table core_selling_entity_assignments force row level security;
alter table core_order_supplier_bindings enable row level security;
alter table core_order_supplier_bindings force row level security;

-- Who sells to whom is internal commercial policy, so the assignments are
-- internal-read. The BINDING is not: the entity that issued your invoice is
-- printed on it, and an order's own parties may read which entity sold it.
create policy core_selling_entity_assignments_read on core_selling_entity_assignments
for select using (app_is_internal());
create policy core_selling_entity_assignments_write on core_selling_entity_assignments
for all using (app_is_internal()) with check (app_is_internal());
create policy core_order_supplier_bindings_read on core_order_supplier_bindings
for select using (app_is_internal() or core_can_access_order(order_id));
create policy core_order_supplier_bindings_write on core_order_supplier_bindings
for all using (app_is_internal()) with check (app_is_internal());

grant select, insert, update, delete
  on core_selling_entity_assignments, core_order_supplier_bindings
  to clockwork_runtime, clockwork_service;
revoke insert, update, delete
  on core_selling_entity_assignments, core_order_supplier_bindings
  from clockwork_runtime;
