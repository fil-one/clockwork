#!/usr/bin/env bash
# Checks a deployed stage over public HTTPS. A 200 from /healthcheck covers
# the Route53 record, the certificate, the listener, the target group and a
# running task in one request; the other two prove the application behind it
# is the real one with authentication configured, since an unauthenticated
# document request is sent to sign in and the API reference is served to
# anyone. Retries because a fresh record or listener rule can lag the deploy.
set -euo pipefail

base=${1:?usage: smoke.sh https://hostname}
attempts=${SMOKE_ATTEMPTS:-20}
delay=${SMOKE_DELAY:-15}

# curl prints the -w template even when the transfer fails, as 000
status() {
  curl -sS -o "$2" -w '%{http_code}' --max-time 15 "$base$1" || true
}

body=$(mktemp)
trap 'rm -f "$body"' EXIT

code=000
for i in $(seq 1 "$attempts"); do
  code=$(status /healthcheck "$body")
  [ "$code" = 200 ] && break
  echo "attempt $i/$attempts: /healthcheck answered $code, retrying in ${delay}s"
  sleep "$delay"
done
if [ "$code" != 200 ]; then
  echo "FAIL /healthcheck: $code" >&2
  exit 1
fi
echo "ok   /healthcheck: $code"

code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 --max-redirs 0 "$base/" || true)
case $code in
  200|302|303|307) echo "ok   /: $code" ;;
  *) echo "FAIL /: $code (503 means authentication is not configured)" >&2; exit 1 ;;
esac

code=$(status /developers/openapi.json "$body")
if [ "$code" != 200 ] || ! grep -q '"openapi"' "$body"; then
  echo "FAIL /developers/openapi.json: $code" >&2
  exit 1
fi
echo "ok   /developers/openapi.json: $code"
echo "smoke test passed for $base"
