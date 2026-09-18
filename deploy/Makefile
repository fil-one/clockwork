# storoku:ignore
#
# Deploys Clockwork into one AWS account: `shared/` (the Route53 zone, the
# ECR repository, the CI deploy role) in the default workspace and `app/` in
# the staging or prod workspace. See README.md.

ifneq (,$(wildcard ./.env.terraform))
include .env.terraform
export
else
ifneq ($(DEPLOY_ENV), ci)
$(error .env.terraform is missing: copy .env.terraform.tpl and fill it in, see README.md)
endif
endif

# Secrets stay out of .env.terraform. Locally they come from one file per
# workspace outside the repo; in CI the same TF_VAR_* names arrive from the
# GitHub environment. Single-line values only: make parses the file.
CLOCKWORK_SECRETS_FILE ?= $(HOME)/.config/fil-one/clockwork/$(TF_WORKSPACE).secrets.env
ifneq (,$(wildcard $(CLOCKWORK_SECRETS_FILE)))
include $(CLOCKWORK_SECRETS_FILE)
export
endif

# The production bootstrap manifest (docs/operations/production-bootstrap.md)
# travels the same way: a file per workspace locally, the environment secret
# CLOCKWORK_BOOTSTRAP_MANIFEST in CI. Without one the migration task skips
# the bootstrap.
CLOCKWORK_BOOTSTRAP_MANIFEST ?= $(HOME)/.config/fil-one/clockwork/$(TF_WORKSPACE).bootstrap-manifest.json
TF_VAR_bootstrap_manifest ?= $(shell cat $(CLOCKWORK_BOOTSTRAP_MANIFEST) 2>/dev/null)
export TF_VAR_bootstrap_manifest
# Said out loud by the targets it matters to: an apply without the manifest
# on a stage that already has one removes its secret and names the interim
# secret row again, which changes nothing the application can see.
BOOTSTRAP_MANIFEST_NOTE = $(if $(strip $(TF_VAR_bootstrap_manifest)),:,echo "note: no bootstrap manifest at $(CLOCKWORK_BOOTSTRAP_MANIFEST); the migration task skips the bootstrap")

# One state bucket per account. The app root reads the shared root's state
# from the same bucket. The bucket's region is its own setting: production's
# bucket predates this deployment and lives in us-west-2 while the stage is
# in us-east-2. Empty counts as unset, since CI passes every variable.
TF_STATE_BUCKET ?= filone-terraform-state-$(TF_VAR_allowed_account_id)
ifeq ($(strip $(TF_STATE_REGION)),)
TF_STATE_REGION := $(TF_VAR_region)
endif
export TF_VAR_shared_state_bucket := $(TF_STATE_BUCKET)
export TF_VAR_shared_state_region := $(TF_STATE_REGION)
BACKEND_CONFIG = -backend-config="bucket=$(TF_STATE_BUCKET)" -backend-config="region=$(TF_STATE_REGION)"

# Must match cpu_architecture in app/variables.tf (ARM64).
PLATFORM ?= linux/arm64

ECR_URI = $(TF_VAR_allowed_account_id).dkr.ecr.$(TF_VAR_region).amazonaws.com
ECR_REPO = $(ECR_URI)/$(TF_VAR_app)-ecr
# The repository refuses a second push of an existing tag, so a redeploy of
# the same commit sets IMAGE_TAG by hand (CI appends its run attempt).
IMAGE_TAG ?= $(TF_WORKSPACE)-$(shell git rev-parse --short HEAD)
# the app module sets the container image to this value, so it is the full reference
IMAGE_REF = $(ECR_REPO):$(IMAGE_TAG)
ENV_FILE = $(abspath .env.production.local)
APP_VARS = -var="image_tag=$(IMAGE_REF)" -var='env_files=["$(ENV_FILE)"]'

ifeq ($(DEPLOY_ENV), ci)
APPLY_ARGS = -input=false -auto-approve -lock-timeout=5m
else
APPLY_ARGS = -lock-timeout=5m
endif

# --- environment file -------------------------------------------------------

.env.terraform:

# Rendered from the template with esh. Copied into the image at build time
# (NEXT_PUBLIC_* are inlined then) and uploaded as the task's environment
# file at apply time.
.env.production.local: .env.terraform .env.production.local.tpl
	./esh -s /bin/bash -o .env.production.local .env.production.local.tpl

# --- image ------------------------------------------------------------------

.PHONY: docker-login
docker-login:
	aws ecr get-login-password --region $(TF_VAR_region) | docker login --username AWS --password-stdin $(ECR_URI)

.PHONY: docker-build
docker-build: .env.production.local
	cd .. && docker buildx build --platform $(PLATFORM) -t $(IMAGE_REF) --load .

.PHONY: docker-push
docker-push: docker-login .env.production.local
	cd .. && docker buildx build --platform $(PLATFORM) -t $(IMAGE_REF) --push .

# Every target that registers a task definition checks the tag first. ECS
# retries a missing image for the whole CodeDeploy window (an hour) and only
# then rolls back, so an `apply-app` without a `docker-push` for the same
# commit used to cost an hour to find out. `make docker-push` pushes the tag
# for this commit; IMAGE_TAG=<tag> reuses one the repository already holds.
.PHONY: image-exists
image-exists:
	@aws ecr describe-images --region $(TF_VAR_region) --repository-name $(TF_VAR_app)-ecr \
	    --image-ids imageTag=$(IMAGE_TAG) --output text >/dev/null 2>&1 || { \
	  echo "error: $(IMAGE_REF) is not in ECR." >&2; \
	  echo "  Run \`make docker-push\` first, or reuse a pushed tag with IMAGE_TAG=<tag>. Newest tags:" >&2; \
	  aws ecr describe-images --region $(TF_VAR_region) --repository-name $(TF_VAR_app)-ecr \
	      --query 'sort_by(imageDetails[?imageTags],&imagePushedAt)[-5:].imageTags[0]' --output text 2>/dev/null \
	    | tr '\t' '\n' | sed 's/^/    /' >&2; \
	  exit 1; }

# --- init -------------------------------------------------------------------

app/.terraform:
	TF_WORKSPACE=default tofu -chdir=app init $(BACKEND_CONFIG)

shared/.terraform:
	TF_WORKSPACE=default tofu -chdir=shared init $(BACKEND_CONFIG)

# Create the workspace once. TF_WORKSPACE is unset for the check and the
# creation because tofu refuses to switch workspaces while it is set.
.tfworkspace: app/.terraform
	env -u TF_WORKSPACE tofu -chdir=app workspace list | grep -Eq '(^|[* ])$(TF_WORKSPACE)$$' || env -u TF_WORKSPACE tofu -chdir=app workspace new $(TF_WORKSPACE)
	touch .tfworkspace

.PHONY: init
init: app/.terraform shared/.terraform .tfworkspace

# after pointing .env.terraform at the other account
.PHONY: reinit
reinit:
	rm -rf app/.terraform shared/.terraform .tfworkspace
	$(MAKE) init

.PHONY: upgrade-shared
upgrade-shared:
	TF_WORKSPACE=default tofu -chdir=shared init -upgrade $(BACKEND_CONFIG)

.PHONY: upgrade-app
upgrade-app: upgrade-shared
	tofu -chdir=app init -upgrade $(BACKEND_CONFIG)

.PHONY: upgrade
upgrade: upgrade-shared upgrade-app

# --- plan / apply -----------------------------------------------------------

.PHONY: validate-shared
validate-shared: shared/.terraform
	TF_WORKSPACE=default tofu -chdir=shared validate

.PHONY: validate-app
validate-app: app/.terraform .tfworkspace
	tofu -chdir=app validate

.PHONY: validate
validate: validate-shared validate-app

.PHONY: plan-shared
plan-shared: shared/.terraform
	TF_WORKSPACE=default tofu -chdir=shared plan

.PHONY: plan-app
plan-app: app/.terraform .tfworkspace .env.production.local
	tofu -chdir=app plan $(APP_VARS)

.PHONY: plan
plan: plan-shared plan-app

.PHONY: apply-shared
apply-shared: shared/.terraform
	TF_WORKSPACE=default tofu -chdir=shared apply $(APPLY_ARGS)

.PHONY: apply-app
apply-app: app/.terraform .tfworkspace .env.production.local image-exists
	@$(BOOTSTRAP_MANIFEST_NOTE)
	tofu -chdir=app apply $(APP_VARS) $(APPLY_ARGS)

.PHONY: apply
apply: apply-shared apply-app

# Register the migration task definition for this image and run it to
# completion. Runs before `apply`, so the schema is in place when the new
# tasks take traffic. The first deploy of a stage runs `apply` first
# (README.md), because the task needs the VPC's internet route. The secrets
# the task reads travel with it: a Secrets Manager value is its own resource,
# one the task definition does not depend on, and a task whose secret has no
# value never starts.
.PHONY: migrate
migrate: app/.terraform .tfworkspace .env.production.local image-exists
	@$(BOOTSTRAP_MANIFEST_NOTE)
	tofu -chdir=app apply -target=aws_ecs_task_definition.migrate -target=module.bootstrap_manifest -target=module.app.module.secrets $(APP_VARS) $(APPLY_ARGS)
	./run-migrate.sh

.PHONY: wait-deploy
wait-deploy:
	./wait-deploy.sh

.PHONY: smoke
smoke:
	./smoke.sh https://$(TF_VAR_hostname)

.PHONY: console-shared
console-shared: shared/.terraform
	TF_WORKSPACE=default tofu -chdir=shared console

.PHONY: console
console: app/.terraform .tfworkspace .env.production.local
	tofu -chdir=app console $(APP_VARS)

.PHONY: clean-app
clean-app: app/.terraform .tfworkspace .env.production.local
	tofu -chdir=app destroy $(APP_VARS)

.PHONY: clean-shared
clean-shared: shared/.terraform
	TF_WORKSPACE=default tofu -chdir=shared destroy

.PHONY: clean
clean: clean-app clean-shared
