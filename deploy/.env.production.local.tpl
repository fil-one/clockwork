# storoku:ignore
# Rendered by the Makefile into .env.production.local with esh, from
# .env.terraform (or the CI environment). The file is copied into the image
# before `next build`, which is when NEXT_PUBLIC_* values are inlined, and
# uploaded as the task's environment file. Non-secret values only: secrets
# reach the container from Secrets Manager (deploy/app/main.tf).
#
# The production preflight in scripts/check-demo-deploy-environment.mjs
# requires the three origins and the WorkOS redirect to agree; they are all
# derived from TF_VAR_hostname so they cannot drift.
CLOCKWORK_ENV=production
CLOCKWORK_EXPERIENCE_ADAPTER=database
NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV=production
NEXT_PUBLIC_APP_URL=https://<%= ${TF_VAR_hostname:?} %>
APP_ORIGIN=https://<%= ${TF_VAR_hostname:?} %>
CLOCKWORK_CANONICAL_ORIGIN=https://<%= ${TF_VAR_hostname:?} %>
WORKOS_REDIRECT_URI=https://<%= ${TF_VAR_hostname:?} %>/auth/callback

# one hop: the application load balancer
CLOCKWORK_TRUSTED_PROXY_HOPS=1
INTERNAL_EMAIL_DOMAINS=<%= ${CLOCKWORK_INTERNAL_EMAIL_DOMAINS:-fil.org} %>

# Commercial policy. The issuer is the approved legal entity every document is
# issued by (EXT-LEGAL-01), as JSON; without it the persisted experience surface
# refuses to render documents. The threshold is the order value in minor units
# below which a customer may accept click-through; without it the lifecycle
# service, including public registration, is not wired.
PLATFORM_ISSUER_JSON=<%= ${CLOCKWORK_PLATFORM_ISSUER_JSON:-} %>
CLICK_THROUGH_THRESHOLD_MINOR=<%= ${CLOCKWORK_CLICK_THROUGH_THRESHOLD_MINOR:-} %>
MIGRATION_FEATURE_ENABLED=false
AUTOMATED_TEARDOWN_ENABLED=false

# the evidence bucket name arrives from ECS as EVIDENCE_BUCKET_NAME; the
# entrypoint maps it to EVIDENCE_BUCKET
EVIDENCE_AWS_REGION=<%= ${TF_VAR_region:?} %>
EVIDENCE_AWS_ACCOUNT_ID=<%= ${TF_VAR_allowed_account_id:?} %>

# no e-signature provider yet: an empty list collapses the frame policy to 'self'
NEXT_PUBLIC_ESIGN_SIGNING_ORIGINS=

# Trigger.dev Cloud project; the worker itself is deployed with the Trigger CLI
TRIGGER_PROJECT_REF=<%= ${TRIGGER_PROJECT_REF:-} %>

OTEL_SDK_DISABLED=true
OTEL_SERVICE_NAME=clockwork-runtime
OTEL_RESOURCE_ATTRIBUTES=service.namespace=clockwork,deployment.environment.name=<%= $TF_WORKSPACE %>

CLOCKWORK_RELEASE_PROOF=0
CLOCKWORK_ENABLE_SIMULATORS=false
