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
  group, so there are no NAT gateways; one interface endpoint lets the database
  provisioner reach Secrets Manager from the private subnets
- an ALB with an ACM certificate; the hostname's A record aliases it
- an ECS cluster and service on Fargate (arm64, Graviton), deployed blue/green
  by CodeDeploy with rollback on failure. Staging runs 0.5 vCPU / 1 GB, one to
  two tasks; production 1 vCPU / 2 GB, one to four
- RDS PostgreSQL 17: staging `db.t4g.micro`, single-AZ, 20 GB; production
  `db.t4g.large`, multi-AZ, 100 GB. Encrypted, TLS required, seven daily
  backups, a final snapshot on destroy, deletion protection on, the master
  password in Secrets Manager rotated every fifteen days
- the migration task definition, `<workspace>-clockwork-migrate`
- Secrets Manager entries for every application secret (see [Secrets](#secrets))
- the S3 evidence bucket `<workspace>-clockwork-evidence`, with Object Lock and
  versioning, which the evidence store requires
- a CloudWatch log group, `<workspace>-clockwork-ecs-cluster-log`, kept 14 days
  in staging and a year in production

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
   template carries staging's, with production's in a comment).

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

   | Variable                                  | Value                                                     |
   | ----------------------------------------- | --------------------------------------------------------- |
   | `AWS_ROLE_ARN`                            | the `github_deploy_role_arn` output of step 4             |
   | `AWS_ACCOUNT_ID`                          | the account id                                            |
   | `AWS_REGION`                              | `us-east-2`                                               |
   | `TF_STATE_BUCKET`                         | the bucket from step 1                                    |
   | `CLOCKWORK_HOSTNAME`                      | the stage's hostname                                      |
   | `CLOCKWORK_INTERNAL_EMAIL_DOMAINS`        | the staff email domains, comma separated                  |
   | `CLOCKWORK_PLATFORM_ISSUER_JSON`          | the approved issuing legal entity, one line of JSON       |
   | `CLOCKWORK_CLICK_THROUGH_THRESHOLD_MINOR` | the click-through acceptance threshold, in minor units    |
   | `TRIGGER_PROJECT_REF`                     | the Trigger.dev project, once there is one (may be empty) |

   and the same secrets as the file in step 3, under their plain names
   (`WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`,
   `WORKOS_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `TRIGGER_SECRET_KEY`). The failure notification needs one repository secret,
   `SLACK_BOT_TOKEN`, the same bot token fil-one/fil-one uses. Restrict each
   environment's deployment branches to `main`; the workflow refuses other
   branches too. Required reviewers on `production` are optional.

7. Deploy the stage by hand the first time:

   ```sh
   make docker-push
   make apply
   make migrate
   make wait-deploy
   make smoke
   ```

   The first `apply` creates the database and the internet route the migration
   task needs, so `migrate` follows it here and precedes it on every later
   deploy. From then on the pipeline owns the stage.

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
deployed (`tofu apply -target=aws_ecs_task_definition.migrate`) and runs it as a
one-off Fargate task inside the VPC, waiting for it to stop and failing on a
non-zero exit (`run-migrate.sh`, which also prints the task's log). The task
runs `deploy/docker/migrate.sh` as the RDS master user, whose credentials ECS
injects from the master secret:

1. applies `deploy/docker/rds-prelude.sql` to the database the provisioner
   created during `apply`: the `extensions` schema Supabase ships and RDS does
   not, and empty `anon`, `authenticated` and `service_role` roles so the
   migrations' `revoke` statements have something to revoke from. The migrations
   also grant to and assign ownership to `postgres`, which is the master user
   name the RDS module sets
2. `supabase db push` applies `supabase/migrations` in order, tracked in
   `supabase_migrations.schema_migrations`, with the same statement semantics
   the migrations were written against
3. `psql -f supabase/production-roles.sql` sets the `clockwork_runtime` and
   `clockwork_service` passwords and upserts the authorization secret, all from
   the task's environment

The migration runs before the service moves to the new image, so a migration has
to be compatible with the release still serving; the repository's forward-only
migration rules already require that.

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
tasks. Adding a new one is a variable in `app/variables.tf`, an entry in
`supplied_secrets` in `app/main.tf`, and a line in `terraform.yml`.

`AUTHORIZATION_CONTEXT_SECRET_ID` names the active row in
`private.authorization_secrets` and starts as `<workspace>-initial`. After
`pnpm bootstrap:production` has issued a manifest, set the
`authorization_context_secret_id` variable to `bootstrap:<manifest id>` and
apply. Rotating the secret itself is the overlap procedure in
`docs/foundation-handoff.md`, which needs a second active id; the wiring here
carries one value at a time, so that procedure is a change to this directory
when it is first needed.

## Rough monthly cost

At `us-east-2` list prices, before data transfer:

| Item                                          | staging | production |
| --------------------------------------------- | ------- | ---------- |
| Application load balancer                     | $20     | $20        |
| Fargate, always on, one task                  | $14     | $29        |
| RDS PostgreSQL and storage                    | $14     | $211       |
| Secrets Manager interface endpoint, three AZs | $22     | $22        |
| Secrets, KMS keys, logs                       | $10     | $10        |

Roughly $80 for staging and $290 for production. The interface endpoint replaces
three NAT gateways at about $100.

## Still to decide

- **Trigger.dev.** The workflow worker runs in Trigger.dev Cloud, deployed with
  the Trigger CLI, and connects to the database on `DIRECT_DATABASE_URL`. The
  database here is reachable only inside the VPC, so the worker cannot run
  against it as-is. Until that is settled (a public endpoint with a restricted
  security group, or self-hosting) the portal serves reads and writes but
  nothing scheduled runs: the outbox dispatcher and every cron are Trigger
  tasks.
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
- **Production bootstrap.** `pnpm bootstrap:production` runs once, by hand,
  after the first migration, with the approved manifest.
- **WorkOS environments.** Each stage needs its own WorkOS environment whose
  redirect URI is `https://<hostname>/auth/callback`.
- **Staff email domains.** `CLOCKWORK_INTERNAL_EMAIL_DOMAINS` defaults to
  `fil.org`; confirm the list.
- **Deploy role scope.** The deploy role carries AdministratorAccess, as
  FilOne's own deploy roles do. Narrowing it is a follow-up.
