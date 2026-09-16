-- What a Supabase project already has and a bare RDS instance does not.
--
-- supabase/migrations is written against a Supabase database, so it assumes
-- two things exist before the first migration runs. Creating them here keeps
-- the migrations themselves identical across both targets: whatever RDS needs
-- extra is in this file, and nothing in supabase/migrations knows which kind of
-- database it is talking to.
--
-- Idempotent throughout -- the migrate task runs on every deployment.

-- 000001_foundation.sql installs pgcrypto and pgtap `with schema extensions`,
-- which Supabase provisions and RDS does not. The extensions themselves stay
-- there; both are available on RDS PostgreSQL 17, so only the schema is
-- missing. `usage` to public matches Supabase, where the search path of every
-- role reaches the extension functions.
create schema if not exists extensions;
grant usage on schema extensions to public;

-- The three PostgREST roles. No connection in this deployment ever
-- authenticates as one of them -- the application uses clockwork_runtime and
-- clockwork_service -- but the migrations revoke from them by name
-- (000001_foundation.sql line 1513 and thirteen later `revoke all ...
-- from public, anon, authenticated` statements), and a revoke naming a role
-- that does not exist is an error, not a no-op. `nologin` is the difference
-- that matters: they exist to be revoked from, never to be connected as.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit nobypassrls;
  end if;
end $$;

-- Not handled here: `postgres`. 000001_foundation.sql grants the two
-- application roles to it and 000903_secure_chain_validation.sql makes it own a
-- function, so the RDS master user has to be named `postgres` for the
-- migrations to apply. That is an instance setting rather than something a
-- migration prelude should invent a role for.
