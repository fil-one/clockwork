# storoku:ignore
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0.0"
    }
  }
  # bucket and region come from `make init` (-backend-config)
  backend "s3" {
    key          = "filone/clockwork/shared.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  allowed_account_ids = [var.allowed_account_id]
  region              = var.region
  default_tags {
    tags = {
      Environment  = "shared"
      ManagedBy    = "OpenTofu"
      Owner        = "fil-one"
      Team         = "FilOne Engineering"
      Organization = "FilOne"
      Project      = var.app
    }
  }
}

# storoku's shared module wants a second provider for its shared dev stack;
# this deployment creates none, so it points at the same region.
provider "aws" {
  alias               = "dev"
  allowed_account_ids = [var.allowed_account_id]
  region              = var.region
  default_tags {
    tags = {
      Environment  = "dev"
      ManagedBy    = "OpenTofu"
      Owner        = "fil-one"
      Team         = "FilOne Engineering"
      Organization = "FilOne"
      Project      = var.app
    }
  }
}

# The Route53 zone for this account's hostname and the ECR repository.
# Staging and prod are dedicated workspaces, so there is no shared dev
# database, VPC or cache; a workspace with any other name has nothing to
# attach to and will not plan.
module "shared" {
  source = "../storoku/shared"
  providers = {
    aws     = aws
    aws.dev = aws.dev
  }
  create_db                   = false
  caches                      = []
  networks                    = []
  app                         = var.app
  create_shared_dev_resources = false
  setup_cloudflare            = false
  zone_id                     = ""
  domain_base                 = var.domain_base
}
