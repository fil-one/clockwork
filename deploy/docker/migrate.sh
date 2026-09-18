#!/bin/sh
# Bring an RDS database up to the committed schema. Run as a one-off ECS task
# from the application image, before the service rolls to the new revision.
#
# Four steps, in this order:
#   1. rds-prelude.sql       -- the objects Supabase ships and RDS does not
#   2. supabase db push      -- supabase/migrations, the canonical schema
#   3. bootstrap-production  -- the staff organization, from BOOTSTRAP_MANIFEST
#                               when there is one; a no-op once applied
#   4. production-roles.sql  -- give the two application roles their passwords
#
# The connection is the RDS master user, not an application role: the
# migrations create roles, schemas and extensions, which clockwork_runtime and
# clockwork_service are deliberately unable to do.
#
# Nothing here prints a secret. Failures name the variable that was missing,
# never its value.
set -eu

require() {
  eval "clockwork_required_value=\${$1:-}"
  if [ -z "$clockwork_required_value" ]; then
    echo "migrate: $1 is not set" >&2
    exit 1
  fi
}

require RDS_MASTER_SECRET
require PGHOST
require PGDATABASE
# production-roles.sql reads these four with \getenv. Checking them up front
# means a missing one fails before any schema change rather than halfway
# through, with a message that names it.
require CLOCKWORK_RUNTIME_DATABASE_PASSWORD
require CLOCKWORK_SERVICE_DATABASE_PASSWORD
require AUTHORIZATION_CONTEXT_SECRET
require AUTHORIZATION_CONTEXT_SECRET_ID
# private.authorization_secrets checks length(secret) >= 32, and
# production-roles.sql is the last thing this script runs.
if [ "${#AUTHORIZATION_CONTEXT_SECRET}" -lt 32 ]; then
  echo "migrate: AUTHORIZATION_CONTEXT_SECRET is shorter than 32 characters" >&2
  exit 1
fi

# RDS_MASTER_SECRET is the Secrets Manager entry ECS injects whole, the shape
# the RDS-managed password writes: {"username": "...", "password": "..."}.
# Both halves are percent-encoded into the URL for the same reason as in
# entrypoint.sh -- a generated password is not URL-safe.
DIRECT_DATABASE_URL="$(node -e '
const raw = process.env.RDS_MASTER_SECRET;
let secret;
try {
  secret = JSON.parse(raw);
} catch {
  console.error("migrate: RDS_MASTER_SECRET is not JSON");
  process.exit(1);
}
const { username, password } = secret ?? {};
if (!username || !password) {
  console.error("migrate: RDS_MASTER_SECRET needs a username and a password");
  process.exit(1);
}
const host = process.env.PGHOST;
const port = process.env.PGPORT || "5432";
const database = process.env.PGDATABASE;
const sslmode = process.env.PGSSLMODE || "require";
const user = encodeURIComponent(username);
const pass = encodeURIComponent(password);
process.stdout.write(
  "postgresql://" + user + ":" + pass + "@" + host + ":" + port + "/" +
    database + "?sslmode=" + sslmode,
);
')"
export DIRECT_DATABASE_URL

# The database is created here rather than by an apply-time Lambda: this task
# already holds the master credentials, and one fewer thing lives in the
# private subnets. The maintenance database is the connection target until
# the application database exists.
MAINTENANCE_DATABASE_URL="${DIRECT_DATABASE_URL%/*}/postgres${DIRECT_DATABASE_URL#*"/${PGDATABASE}"}"
if [ "$(psql "$MAINTENANCE_DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "select 1 from pg_database where datname = '${PGDATABASE}'")" != "1" ]; then
  echo "migrate: creating database ${PGDATABASE}"
  psql "$MAINTENANCE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "create database \"${PGDATABASE}\""
fi

echo "migrate: preparing ${PGDATABASE} at ${PGHOST}"
psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f /app/deploy/docker/rds-prelude.sql

echo "migrate: applying supabase/migrations"
supabase db push --db-url "$DIRECT_DATABASE_URL" --workdir /app --yes

# The production bootstrap (docs/operations/production-bootstrap.md) creates
# the staff organization and memberships from the manifest, on the first run
# that has one; every later run finds the manifest recorded and changes
# nothing. It refuses a database that already holds an authorization secret,
# and production-roles.sql wrote one as <stage>-initial on every run before
# the manifest existed, so the bootstrap retires that row inside its own
# transaction and writes the same secret back as bootstrap:<manifest id>, the
# id AUTHORIZATION_CONTEXT_SECRET_ID carries from then on. A bootstrap that
# fails rolls the whole thing back, initial row included, and the release
# still serving keeps checking signatures against it.
if [ -n "${BOOTSTRAP_MANIFEST:-}" ]; then
  require DEPLOY_STAGE
  manifest="$HOME/bootstrap-manifest.json"
  printf '%s' "$BOOTSTRAP_MANIFEST" > "$manifest"
  echo "migrate: applying the production bootstrap"
  node /app/bootstrap/bootstrap-production.mjs --manifest "$manifest" --apply \
    --expected-host "$PGHOST" --retire-secret-id "${DEPLOY_STAGE}-initial"
  rm -f "$manifest"
fi

echo "migrate: applying production roles"
psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f /app/supabase/production-roles.sql

echo "migrate: done"
