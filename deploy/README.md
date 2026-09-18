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

   | Variable                                    | Value                                                                                 |
   | ------------------------------------------- | ------------------------------------------------------------------------------------- |
   | `AWS_ROLE_ARN`                              | the `github_deploy_role_arn` output of step 4                                         |
   | `AWS_ACCOUNT_ID`                            | the account id                                                                        |
   | `AWS_REGION`                                | `us-east-2`                                                                           |
   | `TF_STATE_BUCKET`                           | the bucket from step 1                                                                |
   | `TF_STATE_REGION`                           | that bucket's region, when it differs from `AWS_REGION` (production's is `us-west-2`) |
   | `CLOCKWORK_HOSTNAME`                        | the stage's hostname                                                                  |
   | `CLOCKWORK_INTERNAL_EMAIL_DOMAINS`          | the staff email domains, comma separated                                              |
   | `CLOCKWORK_AUTHORIZATION_CONTEXT_SECRET_ID` | empty until the production bootstrap has run, then `bootstrap:<manifest id>`          |
   | `CLOCKWORK_PLATFORM_ISSUER_JSON`            | the approved issuing legal entity, one line of JSON                                   |
   | `CLOCKWORK_CLICK_THROUGH_THRESHOLD_MINOR`   | the click-through acceptance threshold, in minor units                                |
   | `TRIGGER_PROJECT_REF`                       | the Trigger.dev project, once there is one (may be empty)                             |

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
deployed (`tofu apply -target=aws_ecs_task_definition.migrate`) and runs it as a
one-off Fargate task inside the VPC, waiting for it to stop and failing on a
non-zero exit (`run-migrate.sh`, which also prints the task's log). The task
runs `deploy/docker/migrate.sh` as the RDS master user, whose credentials ECS
injects from the master secret:

1. creates the database if it does not exist, then applies
   `deploy/docker/rds-prelude.sql`: the `extensions` schema Supabase ships and
   RDS does not, and empty `anon`, `authenticated` and `service_role` roles so
   the migrations' `revoke` statements have something to revoke from. The
   migrations also grant to and assign ownership to `postgres`, which is the
   master user name the RDS module sets
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

## Reaching the database

The database accepts connections only from inside the VPC. For anything a person
runs against it by hand, raise the bastion for the session; the pipeline's next
apply removes it, because CI never sets the variable:

```sh
IMAGE_TAG=<running tag> TF_VAR_db_bastion=true make apply-app
DB=$(tofu -chdir=app output -raw database_address)
EIP=$(aws ec2 describe-addresses --region us-east-2 \
  --filters Name=tag:Name,Values=$TF_WORKSPACE-clockwork-bastion-host-eip \
  --query 'Addresses[0].PublicIp' --output text)
ssh -N -L 5432:$DB:5432 ec2-user@$EIP
```

The bastion is a `t4g.micro` in a public subnet that takes SSH from anywhere
with the key pair in `storoku/postgres/main.tf`, and the database's security
group admits it while it exists. `psql` then connects to `localhost:5432` as the
master user, whose credentials are the `rds!db-...` entry in Secrets Manager.

### Production bootstrap

`pnpm bootstrap:production` (`docs/operations/production-bootstrap.md`) creates
the staff organization and memberships; until it has run, every WorkOS sign-in
ends in "WorkOS identity is not linked to exactly one commerce membership". It
runs from a checkout, through the tunnel above, and needs two things this
deployment does not give it by default:

- The URL host has to be the database's real hostname (`localhost` is refused
  for production and the host has to match the manifest's `targetDatabaseHost`),
  so alias it to the tunnel for the session:
  `echo "127.0.0.1 $DB" | sudo tee -a /etc/hosts`. `sslmode=require` does not
  check the certificate's name, so TLS still works.
- The authorization-secret register has to be empty, and `make migrate` has
  already written `<workspace>-initial` to it. Delete that row right before the
  apply; the bootstrap writes the same secret back as `bootstrap:<manifest id>`.

```sh
export DIRECT_DATABASE_URL=postgresql://<master user>:<url-encoded password>@$DB:5432/${TF_WORKSPACE}_clockwork?sslmode=require
export AUTHORIZATION_CONTEXT_SECRET=$(aws secretsmanager get-secret-value --region us-east-2 \
  --secret-id /clockwork/$TF_WORKSPACE/Secret/AUTHORIZATION_CONTEXT_SECRET/value --query SecretString --output text)
pnpm bootstrap:production --manifest <manifest.json>                    # validate, no writes
psql "$DIRECT_DATABASE_URL" -c "delete from private.authorization_secrets where id = '$TF_WORKSPACE-initial'"
pnpm bootstrap:production --manifest <manifest.json> --apply --expected-host $DB
```

Then set `TF_VAR_authorization_context_secret_id=bootstrap:<manifest id>` in
`.env.terraform` and the same value as the GitHub environment's
`CLOCKWORK_AUTHORIZATION_CONTEXT_SECRET_ID`, and
`IMAGE_TAG=<running tag> make apply-app`: the tasks restart naming the new row,
and the bastion goes away with the same apply. Remove the `/etc/hosts` line.

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

`AUTHORIZATION_CONTEXT_SECRET_ID` names the active row in
`private.authorization_secrets` and starts as `<workspace>-initial`. The
production bootstrap replaces that row with `bootstrap:<manifest id>` (see
[Reaching the database](#reaching-the-database)); the
`authorization_context_secret_id` variable then carries the new id, locally and
in the GitHub environment. Rotating the secret itself is the overlap procedure
in `docs/foundation-handoff.md`, which needs a second active id; the wiring here
carries one value at a time, so that procedure is a change to this directory
when it is first needed.

## Rough monthly cost

At `us-east-2` list prices, before data transfer:

| Item                         | staging | production |
| ---------------------------- | ------- | ---------- |
| Application load balancer    | $20     | $20        |
| Fargate, always on, one task | $14     | $29        |
| RDS PostgreSQL and storage   | $14     | $211       |
| Secrets, KMS keys, logs      | $10     | $10        |

Roughly $60 for staging and $270 for production. Three NAT gateways would add
about $100 to each.

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
  after the first migration, with the approved manifest
  ([how](#production-bootstrap)). Neither stage has run it yet.
- **WorkOS environments.** Each stage needs its own WorkOS environment whose
  redirect URI is `https://<hostname>/auth/callback`.
- **Staff email domains.** `CLOCKWORK_INTERNAL_EMAIL_DOMAINS` defaults to
  `fil.org`; confirm the list.
- **Deploy role scope.** The deploy role carries AdministratorAccess, as
  FilOne's own deploy roles do. Narrowing it is a follow-up.
