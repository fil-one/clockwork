# Vendored storoku Terraform modules

Source: https://github.com/storacha/storoku, tag `v0.6.2`, commit
`c9a45f8cecbccc407d9adfaf46e99a43f550b41f`, copied from
[fil-one/storage-qualification](https://github.com/fil-one/storage-qualification/tree/main/deploy/storoku)
together with that repo's patches, then patched further for Clockwork.

These are the `app` and `shared` modules and everything they reference (`cert`,
`deployment`, `dynamodb`, `ecs-infra`, `elasticaches`, `env_files`, `ga`, `kms`,
`postgres`, `postgres-provisioner`, `s3`, `secret`, `sns`, `sqs`, `vpc`). The Go
CLI, its templates, and the build files are not vendored. Refresh by copying the
same directories from a newer tag and reapplying the patches below.

The modules are vendored so the infrastructure stays pinned to a reviewed tree
in this repo, and local edits need no fork. Every patch keeps the upstream
default, so a caller that sets nothing new gets the upstream infrastructure.

## Patches carried over from storage-qualification

1. `app/remote.tf` reads the shared state location from `shared_state_bucket`,
   `shared_state_key` and `region` (declared in `app/variables.tf` with no
   defaults) instead of Storacha's hard-coded bucket and region. `var.appState`
   is unused but stays declared so the module interface matches upstream.
   storage-qualification's copy of this patch left the region at `us-west-2`;
   here the state lives in `us-east-2`.
2. `deployment/ecs_task.tf` adds `dynamodb:ConditionCheckItem` to the task
   role's table policy. Inert here (no tables).
3. `ga/main.tf`: `client_ip_preservation_enabled = true` on the accelerator
   endpoint. Inert here (`global_accelerator = false`).
4. Public-subnet tasks: `app/variables.tf` gains `public_tasks` (default
   `false`) and `global_accelerator` (default `true`). `public_tasks` passes
   `create_nat = !var.public_tasks` to the VPC module and puts the ECS service
   on the public subnets with a public IP. With `create_nat = false` the VPC
   module builds no NAT gateways, no NAT EIPs, no default route out of the
   private route tables, and none of the interface endpoints (`ecr.dkr`,
   `ecr.api`, `logs`, `dynamodb`, `sqs`, `sns`). The free S3 gateway endpoint
   stays and gains public route-table associations, and DynamoDB gets a gateway
   endpoint in place of the interface one. `global_accelerator` gates
   `module.ga`, and the Route53 alias follows the load balancer when the
   accelerator is off. Three NAT gateways cost about $100 a month per stage.

## Patches for Clockwork

5. **PostgreSQL 17.** `postgres/main.tf`: `engine_version = "17"` and parameter
   group family `postgres17` (upstream: 16.3 / `postgres16`). Clockwork's
   migrations target 17 (`supabase/config.toml`).
6. **Backups.** `postgres/main.tf`: `backup_retention_period = 7`,
   `skip_final_snapshot = false` with a `<env>-<app>-final` snapshot identifier.
   Upstream keeps RDS's one-day default and takes no final snapshot on destroy.
7. **No RDS Proxy for a password-authenticated app.** `app/variables.tf` gains
   `rds_proxy` (default `true`); `app/postgres.tf` creates the production proxy
   only when it is set. The proxy accepts IAM authentication alone for the two
   users it registers, and Clockwork logs in as `clockwork_runtime` /
   `clockwork_service` with passwords, so with a proxy every production
   connection would be refused.
8. **No bastion.** `app/variables.tf` gains `db_bastion` (default `true`),
   passed as `db_config.bastion` (`postgres/variables.tf`, optional, default
   `true`). `postgres/main.tf` gates the bastion security group, instance, EIP
   and key pair on it and makes the bastion ingress rule dynamic. Upstream's
   bastion takes SSH from `0.0.0.0/0` with a hard-coded Storacha admin public
   key, which no FilOne account should carry.
9. **Tasks in the public subnets can reach the database.** `vpc/outputs.tf`
   exports `public_cidr_blocks`; `postgres/variables.tf` accepts it as an
   optional field of `vpc`; `postgres/main.tf` adds it to the RDS ingress rule.
   Upstream admits the private and database CIDRs only, which is correct for
   private-subnet tasks and leaves public-subnet tasks refused.
10. **Secrets Manager endpoint without a NAT gateway.** `vpc/main.tf` adds an
    interface endpoint for Secrets Manager when `create_nat = false` and
    `secretsmanager_endpoint` (new `vpc/variables.tf` input, default `true`) is
    set, and always creates `endpoint_sg`. The database provisioner Lambda runs
    in the private subnets and reads the RDS master secret; with no NAT and no
    endpoint it hangs until Lambda kills it. Clockwork runs no provisioner
    (patch 17), so `app/vpc.tf` passes `db_provisioner` through and the endpoint
    is not created.
11. **Fargate architecture.** `deployment/variables.tf` and `app/variables.tf`
    gain `cpu_architecture` (default `ARM64`, the upstream value);
    `deployment/ecs_task.tf` uses it. Clockwork keeps the default and builds
    `linux/arm64` images; the variable exists so the architecture can follow the
    runner fleet without a module edit.
12. **Hostname override.** `app/variables.tf` gains `hostname` (default `""`);
    `app/locals.tf` uses it for the certificate, the Route53 record and
    `PUBLIC_URL` when set. Staging lives in its own AWS account with its own
    delegated zone, `clockwork-staging.fil.one`, whose apex is the service
    hostname; upstream would derive `staging.clockwork-staging.fil.one`.
13. **Optional identity.** `app/variables.tf`: `private_key` and `did` default
    to `""`; `app/secrets.tf` mints no `PRIVATE_KEY` secret and `app/locals.tf`
    sets no `DID` / `PRINCIPAL_MAPPING` variables when they are empty. Clockwork
    has no DID.
14. **Object Lock on a bucket.** `app/variables.tf` bucket entries accept
    `object_lock` (default `false`), passed through `app/s3.tf` to
    `s3/variables.tf` and set as `object_lock_enabled` on `s3/main.tf`.
    Clockwork's evidence store refuses a bucket without Object Lock and
    versioning, and Object Lock can only be enabled when a bucket is created.
15. **Narrow outputs.** `app/outputs.tf` adds `task_role_arn`, `task_role_name`
    and `log_group_name`. The root's migration task reads these instead of
    `module.app.deployment` and `module.app.ecs_infra`, because a reference to a
    whole module object puts every resource of that module into a targeted
    apply's closure, the CodeDeploy trigger included, and `make migrate` would
    then start the blue/green shift.
16. **Deployment id handoff.** `deployment/codedeploy.tf`'s generated
    `code_deploy.sh` writes the deployment id it created to
    `.last-deployment-id` in the root directory, so `wait-deploy.sh` waits on
    that deployment rather than on whatever `list-deployments` returns first.
17. **Optional provisioner.** `app/variables.tf` gains `db_provisioner` (default
    `true`); `app/postgres.tf` creates the provisioner Lambda only when it is
    set. Clockwork's migration task runs as the master user and creates the
    database itself (`deploy/docker/migrate.sh`), which leaves nothing in the
    private subnets that needs Secrets Manager.
18. **Database sizing inputs and quieter logs.** `app/variables.tf` gains
    `db_instance_class`, `db_multi_az`, `db_allocated_storage` and
    `db_performance_insights_retention_period` (all null, meaning upstream's
    choice by stage); `app/postgres.tf` applies them. `postgres/main.tf`'s
    parameter group logs DDL and statements over one second instead of every
    statement at one millisecond, which billed each query to CloudWatch.
