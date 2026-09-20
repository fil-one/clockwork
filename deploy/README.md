# Deploying Clockwork

Clockwork runs on AWS ECS Fargate behind an application load balancer, with RDS
PostgreSQL 17, in two stages that live in different AWS accounts:

|                    | staging                               | production                            |
| ------------------ | ------------------------------------- | ------------------------------------- |
| AWS account        | filone-sandbox `654654381893`         | filone-production `811430801166`      |
| Hostname           | `clockwork-staging.fil.one`           | `clockwork.fil.one`                   |
| OpenTofu workspace | `staging`                             | `prod`                                |
| GitHub environment | `staging`                             | `production`                          |
| State bucket       | `filone-terraform-state-654654381893` | `filone-terraform-state-811430801166` |

Both stages are in `us-east-2`. OpenTofu builds the infrastructure from the
vendored storoku modules in `storoku/` (see
[storoku/README.md](storoku/README.md) for what was patched and why); Docker
builds the image from the `Dockerfile` at the repository root. `.storoku.json`
records the configuration for the storoku CLI, but every generated file here is
hand-maintained (`# storoku:ignore`), so the CLI only records the configuration.

Every push to `main` that passes CI deploys staging, smoke-tests it, and then
deploys production the same way. See [The pipeline](#the-pipeline).

## What gets created

The shared stack (`shared/`, workspace `default`), once per account:

- the Route53 hosted zone for the stage's hostname
- the ECR repository `clockwork-ecr` and its KMS key
- the IAM role GitHub Actions deploys with, `clockwork-<environment>-github`,
  assumable only by this repository's jobs in the matching GitHub environment

The app stack (`app/`, workspace `staging` or `prod`):

- a VPC across three availability zones. Tasks run in the public subnets with a
  public IP and take inbound traffic only from the load balancer's security
  group, so there are no NAT gateways and no interface endpoints
- an ALB with an ACM certificate; the hostname's A record aliases it
- an ECS cluster and service on Fargate (arm64, Graviton), deployed blue/green
  by CodeDeploy with rollback on failure. Staging runs 0.5 vCPU / 1 GB, one to
  two tasks; production 1 vCPU / 2 GB, one to four
- RDS PostgreSQL 17: staging `db.t4g.micro`, single-AZ, 20 GB; production
  `db.t4g.medium`, single-AZ, 50 GB (`production_db_*` variables in
  `app/variables.tf`; multi-AZ is one of them). Encrypted, TLS required, seven
  daily backups with point-in-time restore, a final snapshot on destroy,
  deletion protection on, the master password in Secrets Manager rotated every
  fifteen days
- the migration task definition, `<workspace>-clockwork-migrate`
- Secrets Manager entries for every application secret (see [Secrets](#secrets))
- the S3 evidence bucket `<workspace>-clockwork-evidence`, with Object Lock and
  versioning, which the evidence store requires
- a CloudWatch log group, `<workspace>-clockwork-ecs-cluster-log`, kept 14 days
  in staging and a year in production
- the background-task queue, its scheduler and its alarm (see
  [Background tasks](#background-tasks))

## Background tasks

Every background task — the outbox dispatcher, the lifecycle tasks, the crons —
runs in the deployment's own account. Four pieces:

- **The queue.** `<workspace>-clockwork-workflows.fifo`, FIFO with
  high-throughput mode. The message group is the task id, so one task's messages
  stay ordered while different tasks run in parallel. A message is leased for
  300 seconds and a run that outlives its lease extends it; eight failed
  receives move it to `<workspace>-clockwork-workflows-deadletter.fifo`.
- **The scheduler.** One EventBridge Scheduler rule per cron, in the
  `<workspace>-clockwork-tasks` group, built from `app/schedule-manifest.json`.
  That file is generated from the task registry by `pnpm generate:schedules`, so
  a task's cron is declared in TypeScript next to the task and
  `pnpm check:generated` fails a build whose manifest has drifted. Each rule
  sends `{ taskId, scheduledAt }` to the queue under a role that can do nothing
  but send to that one queue.
- **The poller.** In the web container, not a separate service: it receives from
  the queue, looks the task up in the registry, runs it, and deletes the
  message. A failure returns the message with the backoff the task's retry
  policy asks for. `CLOCKWORK_TASK_POLL_CONCURRENCY` (default 4) caps the runs
  in flight.
- **The alarm.** Any message on the dead-letter queue raises
  `<workspace>-clockwork-workflows-dead-letter` to the `workflow-alarms` SNS
  topic. A task only lands there after eight receives, so the alarm means a task
  that keeps failing, not a task that failed.

`task_runtime` chooses the host. It defaults to `sqs`, the arrangement above,
and passes `CLOCKWORK_TASK_RUNTIME` to the container. Set it to `trigger` and
the same tasks run in Trigger.dev Cloud instead, submitted with
`TRIGGER_SECRET_KEY`; the queue and schedules still exist but nothing reads
them. Task code is identical either way (see
[ADR 0010](../docs/adr/0010-vendor-neutral-task-runtime.md)).

## One-time bootstrap

Once per account. Everything runs from this directory.

Prerequisites: OpenTofu 1.10 or newer (`brew upgrade opentofu`; the state
backend's `use_lockfile` is refused by 1.9), Docker with buildx, the AWS CLI
signed in to the account (`aws sso login --profile filone-sandbox`), GNU make.

1. Create the state bucket if the account has none yet. Both stacks keep their
   state in it, so it has to exist before the first `tofu init`. Production
   already has one from the bidder-notary deployment.

   ```sh
   B=filone-terraform-state-654654381893
   aws s3api create-bucket --bucket $B --region us-east-2 \
     --create-bucket-configuration LocationConstraint=us-east-2
   aws s3api put-bucket-versioning --bucket $B --versioning-configuration Status=Enabled
   aws s3api put-bucket-encryption --bucket $B --server-side-encryption-configuration \
     '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
   aws s3api put-public-access-block --bucket $B --public-access-block-configuration \
     'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
   ```

2. `cp .env.terraform.tpl .env.terraform` and set the account's values (the
   template carries staging's, with production's in a comment). Production's
   state bucket predates this deployment and lives in `us-west-2`, which is what
   `TF_STATE_REGION` is for; the stage itself is in `us-east-2`.

3. Put the supplied secrets in
   `~/.config/fil-one/clockwork/<workspace>.secrets.env`, mode 0600, one
   `TF_VAR_<name>=<value>` per line:

   ```sh
   TF_VAR_workos_api_key=
   TF_VAR_workos_client_id=
   TF_VAR_workos_cookie_password=   # at least 32 characters
   TF_VAR_workos_webhook_secret=
   TF_VAR_stripe_secret_key=
   TF_VAR_stripe_webhook_secret=
   TF_VAR_trigger_secret_key=
   ```

   The Makefile reads the file for the workspace named in `.env.terraform`. An
   empty value leaves that integration unconfigured; the three WorkOS values are
   needed before the smoke test can pass, since the application answers 503 to
   everything until authentication is configured.

4. `make init && make apply-shared`. The outputs carry the zone's four name
   servers and the deploy role's ARN. The deploy role trusts the account's
   GitHub OIDC provider, which the shared root looks up rather than creates;
   both FilOne accounts have one from the fil-one/fil-one deployment
   (`aws iam list-open-id-connect-providers` shows it).

5. Delegate the hostname. `fil.one` is served by Cloudflare from
   [fil-one/infrastructure](https://github.com/fil-one/infrastructure), so open
   a PR there adding four `NS` records in `environments/prod/fil-one.tf`,
   following the `dev_delegation` pattern in the staging file but with the name
   servers pasted as literals (the zone is not a resource of that repo). The
   record name is `clockwork-staging` or `clockwork`. Merge it and wait for
   `dig NS clockwork-staging.fil.one` to answer before the next step: the app
   stack requests a certificate and blocks on its DNS validation until the
   delegation resolves.

6. Create the GitHub environment (`staging` or `production`) under the
   repository's settings and set:

   | Variable                                  | Value                                                                                 |
   | ----------------------------------------- | ------------------------------------------------------------------------------------- |
   | `AWS_ROLE_ARN`                            | the `github_deploy_role_arn` output of step 4                                         |
   | `AWS_ACCOUNT_ID`                          | the account id                                                                        |
   | `AWS_REGION`                              | `us-east-2`                                                                           |
   | `TF_STATE_BUCKET`                         | the bucket from step 1                                                                |
   | `TF_STATE_REGION`                         | that bucket's region, when it differs from `AWS_REGION` (production's is `us-west-2`) |
   | `CLOCKWORK_HOSTNAME`                      | the stage's hostname                                                                  |
   | `CLOCKWORK_INTERNAL_EMAIL_DOMAINS`        | the staff email domains, comma separated                                              |
   | `CLOCKWORK_MFA_POLICY_ORGANIZATION_IDS`   | the stage's staff WorkOS organization ([Second factors](#second-factors))             |
   | `CLOCKWORK_PLATFORM_ISSUER_JSON`          | the approved issuing legal entity, one line of JSON                                   |
   | `CLOCKWORK_CLICK_THROUGH_THRESHOLD_MINOR` | the click-through acceptance threshold, in minor units                                |
   | `TRIGGER_PROJECT_REF`                     | the Trigger.dev project, once there is one (may be empty)                             |

   and the same secrets as the file in step 3, under their plain names
   (`WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`,
   `WORKOS_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `TRIGGER_SECRET_KEY`), plus `CLOCKWORK_BOOTSTRAP_MANIFEST` once the stage has
   a bootstrap manifest ([Production bootstrap](#production-bootstrap)). The
   failure notification needs one repository secret, `SLACK_BOT_TOKEN`, the same
   bot token fil-one/fil-one uses. Restrict each environment's deployment
   branches to `main`; the workflow refuses other branches too. Required
   reviewers on `production` are optional.

7. Deploy the stage by hand the first time:

   ```sh
   make docker-push
   make apply
   make migrate
   make wait-deploy
   make smoke
   ```

   The first `apply` creates the internet route the migration task needs, so
   `migrate` follows it here and precedes it on every later deploy. From then on
   the pipeline owns the stage.

## The pipeline

`.github/workflows/deploy.yml` runs when the `CI` workflow completes
successfully on `main`, and on `workflow_dispatch` from `main` (a dispatch from
any other branch is skipped). It calls `.github/workflows/terraform.yml` twice,
in sequence:

1. **staging**: `make init`, `make docker-push`, `make migrate`, `make apply`,
   `make wait-deploy`, `make smoke`
2. **production**: the same, only if every staging step passed

Each job runs in its GitHub environment, assumes that account's deploy role
through OIDC, and builds its own image: the environment file rendered from
`.env.production.local.tpl` is copied into the image before `next build`,
because `NEXT_PUBLIC_*` values are inlined into the client bundle then. CI tags
the image `<workspace>-<short sha>-<run attempt>`, so a re-run of a failed
attempt pushes a fresh tag; the repository refuses a second push of an existing
tag, which is why a redeploy of the same commit by hand sets `IMAGE_TAG=`.
`make migrate` and `make apply` check that the tag exists in the repository
before registering a task definition, so an apply for a commit that was never
pushed fails in seconds rather than after CodeDeploy's hour-long health timeout.

`make wait-deploy` (`wait-deploy.sh`) waits for the CodeDeploy deployment the
apply created to finish its blue/green shift, which rolls back on its own if the
new tasks never pass the load balancer's health check on `/healthcheck`.
`make smoke` (`smoke.sh`) then checks the public hostname: `/healthcheck`
answers 200, `/` answers 200 or a redirect to sign-in (a 503 means
authentication is not configured), and `/developers/openapi.json` serves the API
reference.

A failure in either job posts to `#filone-alerts` and stops the pipeline before
production. Pull requests that touch the deployment run `deploy-check.yml`:
formatting and validation of both roots, ShellCheck, and an image build.

## Migrations

`make migrate` registers the migration task definition for the image being
deployed (`tofu apply -target=aws_ecs_task_definition.migrate`, with the secrets
the task reads targeted alongside, since a secret's value is a resource of its
own that the task definition does not depend on) and runs it as a one-off
Fargate task inside the VPC, waiting for it to stop and failing on a non-zero
exit (`run-migrate.sh`, which also prints the task's log). The task runs
`deploy/docker/migrate.sh` as the RDS master user, whose credentials ECS injects
from the master secret:

1. creates the database if it does not exist, then applies
   `deploy/docker/rds-prelude.sql`: the `extensions` schema Supabase ships and
   RDS does not, and empty `anon`, `authenticated` and `service_role` roles so
   the migrations' `revoke` statements have something to revoke from. The
   migrations also grant to and assign ownership to `postgres`, which is the
   master user name the RDS module sets
2. `supabase db push` applies `supabase/migrations` in order, tracked in
   `supabase_migrations.schema_migrations`, with the same statement semantics
   the migrations were written against
3. the production bootstrap, when the task has a manifest (below)
4. `psql -f supabase/production-roles.sql` sets the `clockwork_runtime` and
   `clockwork_service` passwords and upserts the authorization secret, all from
   the task's environment

The migration runs before the service moves to the new image, so a migration has
to be compatible with the release still serving; the repository's forward-only
migration rules already require that.

### Production bootstrap

The bootstrap (`docs/operations/production-bootstrap.md`) creates the staff
organization and memberships that every WorkOS sign-in is checked against; until
it has run, a sign-in ends in "WorkOS identity is not linked to exactly one
commerce membership". The migration task applies it from the
`BOOTSTRAP_MANIFEST` secret, which only that task reads: locally the file
`~/.config/fil-one/clockwork/<workspace>.bootstrap-manifest.json`, in CI the
environment secret `CLOCKWORK_BOOTSTRAP_MANIFEST`. Without one the task skips
the step, so a stage deploys before its manifest exists. `make migrate` and
`make apply-app` say so when the local file is absent; on a stage that already
has its manifest, an apply without it removes the secret and names the interim
secret row again, which changes nothing the application can see, and the next
apply with the file puts it back.

The manifest's `environment` has to name the stage and its `targetDatabaseHost`
the `database_address` output, and its `mfaVerifiedAt` timestamps have to be
within 24 hours of the run that first applies it. Once applied it is recorded
and every later run is a no-op. It is the immutable record of the first staff,
so later staff changes are made in the application; an edited secret stops every
deploy at the migrate step with `BOOTSTRAP_MANIFEST_CONFLICT` until the recorded
manifest is restored. `pnpm bootstrap:production --manifest <file>` validates
one without a database; its error is deliberately unspecific, so check the
fields against `ProductionBootstrapManifestSchema` in
`packages/db/src/production-bootstrap.ts`. Secrets Manager holds up to 64 KB,
which fits a manifest with an empty catalog.

### Second factors

Privileged roles, which is every staff role, need a verified second factor
before they hold a session. The application counts one only for an organization
named in `WORKOS_MFA_POLICY_ORGANIZATION_IDS`, so that an organization whose
WorkOS factor policy does not exist, or is later relaxed, cannot make a
single-factor session read as verified. An empty list therefore admits nobody:
the authenticator code is accepted, a receipt is written, and the session is
still refused, which returns the signed-in user to `/access/mfa` indefinitely.

Set it to the stage's staff organization, the same `workosOrganizationId` the
bootstrap manifest carries. Each stage is its own WorkOS environment, so the ids
differ. The pipeline refuses to deploy a stage whose environment leaves it
empty; a first deploy by hand can still precede the organization existing.

The manifest also decides the row the authorization secret lives in.
`AUTHORIZATION_CONTEXT_SECRET_ID` is `bootstrap:<manifest id>` whenever a
manifest is set and `<workspace>-initial` before. The bootstrap refuses a
database that already holds a row, so the task names the initial row for
retirement and the bootstrap removes it inside its own transaction, writing the
same secret back under the new id; a bootstrap that fails rolls that back too,
and the release still serving keeps its row.

The container's entrypoint composes `DATABASE_URL` and
`CLOCKWORK_SERVICE_DATABASE_URL` from the host and database ECS injects and the
role passwords from Secrets Manager, so no connection string is stored anywhere.

## Secrets

Every secret is a Secrets Manager entry at
`/clockwork/<workspace>/Secret/<NAME>/value`, injected into the container as the
environment variable of the same name.

Generated by OpenTofu, never typed by anyone:
`CLOCKWORK_RUNTIME_DATABASE_PASSWORD`, `CLOCKWORK_SERVICE_DATABASE_PASSWORD`,
`AUTHORIZATION_CONTEXT_SECRET`, `CLOCKWORK_TELEMETRY_INGEST_SECRET`.

Supplied through `TF_VAR_*` (the secrets file locally, the GitHub environment in
CI): the WorkOS, Stripe and Trigger.dev values listed in the bootstrap. Changing
one and running `make apply` rotates the Secrets Manager value and replaces the
tasks; ECS reads secrets when a task starts, so the running tasks keep the old
value until then. A rotation with no code change reuses the image that is
already running: `IMAGE_TAG=<running tag> make apply`. Adding a new one is a
variable in `app/variables.tf`, an entry in `supplied_secrets` in `app/main.tf`,
and a line in `terraform.yml`.

`AUTHORIZATION_CONTEXT_SECRET_ID` names the row in
`private.authorization_secrets` the migration task writes the secret to:
`bootstrap:<manifest id>` once there is a bootstrap manifest,
`<workspace>-initial` before (see
[Production bootstrap](#production-bootstrap)). Rotating the secret itself is
the overlap procedure in `docs/foundation-handoff.md`, which needs a second
active id; the wiring here carries one value at a time, so that procedure is a
change to this directory when it is first needed.

## Rough monthly cost

At `us-east-2` list prices, before data transfer:

| Item                         | staging | production |
| ---------------------------- | ------- | ---------- |
| Application load balancer    | $20     | $20        |
| Fargate, always on, one task | $14     | $29        |
| RDS PostgreSQL and storage   | $14     | $53        |
| Secrets, KMS keys, logs      | $10     | $10        |

Roughly $60 for staging and $110 for production; multi-AZ would add about
$50 to production. Three NAT gateways would add
about $100 to each.

## Still to decide

- **The evidence service.** The evidence bucket exists with Object Lock and the
  task role can use it, but only the API's artifact reader touches it. Writing
  evidence and verifying the bucket's configuration belong to the evidence
  service behind `EVIDENCE_STORAGE_INTERNAL_URL`, an external contract with no
  implementation in this repository, so every evidence route on the experience
  surface answers 503 until one exists.
- **Commercial policy values.** `CLOCKWORK_PLATFORM_ISSUER_JSON` (the legal
  entity documents are issued by) and `CLOCKWORK_CLICK_THROUGH_THRESHOLD_MINOR`
  are business decisions nobody has made yet. Until they are set, document
  rendering answers 503 and the lifecycle service, public registration included,
  is not wired.
- **Production bootstrap.** Neither stage has a manifest yet, so nobody can sign
  in ([Production bootstrap](#production-bootstrap)). The manifest needs the
  WorkOS organization and user ids, the legal entity, and a second person as
  finance approver.
- **WorkOS environments.** Each stage needs its own WorkOS environment whose
  redirect URI is `https://<hostname>/auth/callback`, and whose staff
  organization enforces a factor policy ([Second factors](#second-factors)).
- **Staff email domains.** `CLOCKWORK_INTERNAL_EMAIL_DOMAINS` defaults to
  `fil.org`; confirm the list.
- **Deploy role scope.** The deploy role carries AdministratorAccess, as
  FilOne's own deploy roles do. Narrowing it is a follow-up.
