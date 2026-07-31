-- Run with psql over DIRECT_DATABASE_URL after each new managed project is
-- migrated. Secrets come only from the deployment environment.
\getenv runtime_password CLOCKWORK_RUNTIME_DATABASE_PASSWORD
\getenv service_password CLOCKWORK_SERVICE_DATABASE_PASSWORD
\getenv authorization_secret AUTHORIZATION_CONTEXT_SECRET
\getenv authorization_secret_id AUTHORIZATION_CONTEXT_SECRET_ID

alter role clockwork_runtime login password :'runtime_password';
alter role clockwork_service login password :'service_password';

insert into private.authorization_secrets (id, secret, active)
values (:'authorization_secret_id', :'authorization_secret', true)
on conflict (id) do update
set secret = excluded.secret, active = true, rotated_at = now();
