# storoku:ignore
# copy to .env.terraform and adjust -- never commit .env.terraform
#
# One file per account. Staging deploys into filone-sandbox, production into
# filone-production; the values below are staging's.
TF_WORKSPACE=staging
TF_VAR_app=clockwork
TF_VAR_allowed_account_id=654654381893
TF_VAR_region=us-east-2
TF_STATE_BUCKET=filone-terraform-state-654654381893
TF_VAR_hostname=clockwork-staging.fil.one
TF_VAR_domain_base=clockwork-staging.fil.one
TF_VAR_github_environment=staging
AWS_PROFILE=filone-sandbox

# Non-secret application settings rendered into .env.production.local
CLOCKWORK_INTERNAL_EMAIL_DOMAINS=fil.org
TRIGGER_PROJECT_REF=
# the approved issuing legal entity, as one line of JSON (README: Still to decide)
CLOCKWORK_PLATFORM_ISSUER_JSON=
# order value in minor units below which click-through acceptance is allowed
CLOCKWORK_CLICK_THROUGH_THRESHOLD_MINOR=

# Secrets never go in this file. The Makefile also reads
# ~/.config/fil-one/clockwork/<workspace>.secrets.env; see README.md.

# Production:
#   TF_WORKSPACE=prod
#   TF_VAR_allowed_account_id=811430801166
#   TF_STATE_BUCKET=filone-terraform-state-811430801166
#   TF_VAR_hostname=clockwork.fil.one
#   TF_VAR_domain_base=clockwork.fil.one
#   TF_VAR_github_environment=production
#   AWS_PROFILE=filone-production
