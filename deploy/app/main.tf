# storoku:ignore
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0.0"
    }
    archive = {
      source = "hashicorp/archive"
    }
    random = {
      source = "hashicorp/random"
    }
  }
  # bucket and region come from `make init` (-backend-config): staging and
  # prod live in different AWS accounts, each with its own state bucket
  backend "s3" {
    key          = "filone/clockwork/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  allowed_account_ids = [var.allowed_account_id]
  region              = var.region
  default_tags {
    tags = {
      Environment  = terraform.workspace
      ManagedBy    = "OpenTofu"
      Owner        = "fil-one"
      Team         = "FilOne Engineering"
      Organization = "FilOne"
      Project      = var.app
    }
  }
}

locals {
  is_production = terraform.workspace == "prod"
  # must match the backend block in ../shared/main.tf
  shared_state_key = "filone/clockwork/shared.tfstate"
  # the database the migration task creates and migrates
  db_database                     = "${terraform.workspace}_${var.app}"
  authorization_context_secret_id = var.authorization_context_secret_id != "" ? var.authorization_context_secret_id : "${terraform.workspace}-initial"

  # Minted here and stored in Secrets Manager; no person ever types them.
  # production-roles.sql sets the two role passwords and writes the
  # authorization secret into the database on every migration run.
  generated_secrets = {
    CLOCKWORK_RUNTIME_DATABASE_PASSWORD = random_password.runtime_database.result
    CLOCKWORK_SERVICE_DATABASE_PASSWORD = random_password.service_database.result
    AUTHORIZATION_CONTEXT_SECRET        = random_password.authorization_context.result
    CLOCKWORK_TELEMETRY_INGEST_SECRET   = random_password.telemetry_ingest.result
  }
  supplied_secrets = {
    WORKOS_API_KEY         = var.workos_api_key
    WORKOS_CLIENT_ID       = var.workos_client_id
    WORKOS_COOKIE_PASSWORD = var.workos_cookie_password
    WORKOS_WEBHOOK_SECRET  = var.workos_webhook_secret
    STRIPE_SECRET_KEY      = var.stripe_secret_key
    STRIPE_WEBHOOK_SECRET  = var.stripe_webhook_secret
    TRIGGER_SECRET_KEY     = var.trigger_secret_key
  }
}

# Alphanumeric only: the passwords travel inside connection URLs.
resource "random_password" "runtime_database" {
  length  = 40
  special = false
}

resource "random_password" "service_database" {
  length  = 40
  special = false
}

resource "random_password" "authorization_context" {
  length  = 48
  special = false
}

resource "random_password" "telemetry_ingest" {
  length  = 48
  special = false
}

module "app" {
  source              = "../storoku/app"
  shared_state_bucket = var.shared_state_bucket
  shared_state_key    = local.shared_state_key
  shared_state_region = var.shared_state_region
  app                 = var.app
  appState            = var.app
  environment         = terraform.workspace
  network             = var.network
  domain_base         = var.domain_base
  hostname            = var.hostname
  httpport            = 3000
  # the container check shells out to curl, which node:slim lacks; the ALB
  # check on /healthcheck is what guards the service
  healthcheck = false
  # Next writes its render and fetch caches under .next at runtime
  write_to_container = true
  cpu_architecture   = var.cpu_architecture
  deployment_config = {
    cpu         = local.is_production ? 1024 : 512
    memory      = local.is_production ? 2048 : 1024
    service_min = 1
    service_max = local.is_production ? 4 : 2
    httpport    = 3000
    readonly    = false
  }
  # non-secret settings the container needs from this root; everything else
  # is in the environment file rendered from .env.production.local.tpl
  deployment_env_vars = [
    { name = "AWS_REGION", value = var.region },
    { name = "AUTHORIZATION_CONTEXT_SECRET_ID", value = local.authorization_context_secret_id },
  ]
  image_tag = var.image_tag

  create_db = true
  # the app logs in with passwords, which the proxy refuses; see storoku/README.md
  rds_proxy  = false
  db_bastion = false
  # An internal portal: production runs a medium single-AZ instance with
  # seven-day backups and point-in-time restore. Multi-AZ only shortens the
  # failover during an AZ event or maintenance; flip db_multi_az to take it.
  db_instance_class                        = local.is_production ? var.production_db_instance_class : null
  db_multi_az                              = local.is_production ? var.production_db_multi_az : null
  db_allocated_storage                     = local.is_production ? var.production_db_allocated_storage : null
  db_performance_insights_retention_period = 7
  # the migration task creates the database itself, so neither the provisioner
  # Lambda nor the Secrets Manager endpoint it would need exists
  db_provisioner = false

  # every entry becomes a Secrets Manager secret injected as an env var of the same name
  # nonsensitive() on the test alone: a sensitive condition marks the whole map
  # sensitive, and the secret module's for_each then refuses it
  secrets          = merge(local.generated_secrets, { for name, value in local.supplied_secrets : name => value if nonsensitive(value) != "" })
  external_secrets = []
  queues           = []
  caches           = []
  topics           = []
  tables           = []
  buckets = [
    {
      name        = "evidence"
      public      = false
      object_lock = true
    },
  ]
  env_files = var.env_files

  # WorkOS, Stripe and Trigger.dev are reached over the internet from a
  # public IP; no NAT gateways, no interface endpoints, no accelerator
  public_tasks       = true
  global_accelerator = false
}

output "url" {
  value = "https://${var.hostname}"
}

output "database_address" {
  value = module.app.database.instance_address
}
