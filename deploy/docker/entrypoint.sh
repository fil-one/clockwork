#!/bin/sh
# Container entrypoint: compose the database URLs, then hand off to the command.
#
# ECS delivers the pieces separately -- the endpoint from a Terraform output,
# each role password from its own Secrets Manager entry -- because a stored
# connection string would have to be rewritten every time the instance moves or
# a password rotates. Composing here keeps one source of truth per piece.
#
# Nothing in this script prints a secret. The two URLs it builds carry
# passwords, so they are exported and never echoed.
set -eu

# Generated passwords contain characters that end a URL component early or
# change which host is dialled (@ : / ? # %). encodeURIComponent is exactly the
# escaping the connection parser on the other side undoes. The value travels in
# the environment rather than in argv, so it never reaches another process's
# command line.
urlencode() {
  CLOCKWORK_URLENCODE_VALUE="$1" node -e \
    'process.stdout.write(encodeURIComponent(process.env.CLOCKWORK_URLENCODE_VALUE))'
}

require() {
  eval "clockwork_required_value=\${$1:-}"
  if [ -z "$clockwork_required_value" ]; then
    echo "entrypoint: $1 is required to compose a database URL" >&2
    exit 1
  fi
}

# PGHOST is the signal that a managed database is attached. Without it this is
# a build check or a demo container, and the app reads its own configuration.
if [ -n "${PGHOST:-}" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    require PGDATABASE
    require CLOCKWORK_RUNTIME_DATABASE_PASSWORD
    DATABASE_URL="postgresql://clockwork_runtime:$(urlencode "$CLOCKWORK_RUNTIME_DATABASE_PASSWORD")@${PGHOST}:${PGPORT:-5432}/${PGDATABASE}?sslmode=${PGSSLMODE:-require}"
    export DATABASE_URL
  fi

  if [ -z "${CLOCKWORK_SERVICE_DATABASE_URL:-}" ]; then
    require PGDATABASE
    require CLOCKWORK_SERVICE_DATABASE_PASSWORD
    CLOCKWORK_SERVICE_DATABASE_URL="postgresql://clockwork_service:$(urlencode "$CLOCKWORK_SERVICE_DATABASE_PASSWORD")@${PGHOST}:${PGPORT:-5432}/${PGDATABASE}?sslmode=${PGSSLMODE:-require}"
    export CLOCKWORK_SERVICE_DATABASE_URL
  fi
fi

# storoku publishes the evidence bucket as EVIDENCE_BUCKET_NAME; the application
# reads EVIDENCE_BUCKET. Renaming either side would break the other's
# convention, so the two names are bridged here, where the deployment's
# vocabulary already meets the application's.
if [ -z "${EVIDENCE_BUCKET:-}" ] && [ -n "${EVIDENCE_BUCKET_NAME:-}" ]; then
  EVIDENCE_BUCKET="$EVIDENCE_BUCKET_NAME"
  export EVIDENCE_BUCKET
fi

exec "$@"
