variable "environment" {
  description = "The environment we are deploying to (your name, dev, prod, staging, warm-prod, warm-staging)"
  type        = string
}

variable "app" {
  description = "The name of the application"
  type        = string
}

variable "appState" {
  description = "folder for application state"
  type        = string
}

variable "private_key" {
  description = "private_key for the peer for this deployment; empty for an app with no identity key"
  type        = string
  default     = ""
}

variable "private_key_env_var" {
  description = "env var set on the machine for the did private key"
  type        = string
  default     = "PRIVATE_KEY"
}

variable "did" {
  description = "DID for this deployment (did:web:... for example); empty for an app with no identity"
  type        = string
  default     = ""
}

variable "did_env_var" {
  description = "env var set on the machine for the did public key"
  type        = string
  default     = "DID"
}

variable "principal_mapping" {
  type        = string
  description = "JSON encoded mapping of did:web to did:key"
  default     = ""
}

variable "principal_mapping_env_var" {
  description = "env var set on the machine for mapping did:web to did:key"
  type        = string
  default     = "PRINCIPAL_MAPPING"
}

variable "caches" {
  description = "elasticache caches to create"
  type        = set(string)
  default     = []
}

variable "create_db" {
  type    = bool
  default = false
}

variable "buckets" {
  description = "s3 buckets to create"
  type = list(object({
    name                   = string
    public                 = optional(bool, false)
    object_expiration_days = optional(number, 0)
    object_lock            = optional(bool, false)
  }))
  default = []
}

variable "queues" {
  description = "sqs queues to create"
  type = list(object({
    name                      = string
    fifo                      = optional(bool, false)
    high_throughput           = optional(bool, false)
    message_retention_seconds = optional(number, 0)
  }))
  default = []
}

variable "tables" {
  description = "dynamodb tables to create"
  type = list(object({
    name = string
    attributes = list(object({
      name = string
      type = string
    }))
    hash_key  = string
    range_key = optional(string)
    global_secondary_indexes = optional(list(object({
      name               = string
      hash_key           = string
      range_key          = optional(string)
      projection_type    = string
      non_key_attributes = optional(list(string))
    })), [])
    local_secondary_indexes = optional(list(object({
      name               = string
      range_key          = string
      projection_type    = string
      non_key_attributes = optional(list(string))
    })), [])
  }))
  default = []
}

variable "topics" {
  description = "sns topics to create"
  type        = set(string)
  default     = []
}


variable "deployment_config" {
  type = object({
    cpu         = number
    memory      = number
    service_min = number
    service_max = number
    httpport    = number
    readonly    = bool
  })
  default = null
}

variable "image_tag" {
  type = string
}

variable "secrets" {
  type    = map(string)
  default = {}
}

variable "external_secrets" {
  description = "list of secrets that are provisioned externally (out-of-band)"
  type        = set(string)
  default     = []
}

variable "deployment_env_vars" {
  description = "list of environment variables to upload and use in the container definition (NO SENSITIVE DATA)"
  type = list(object({
    name  = string
    value = string
  }))
  default = []
}

variable "healthcheck" {
  type    = bool
  default = false
}

variable "httpport" {
  type    = number
  default = 8080
}

variable "env_files" {
  description = "list of environment variable files to upload and use in the container definition (NO SENSITIVE DATA)"
  type        = list(string)
  default     = []
}

variable "domain_base" {
  description = "base domain of the application"
  type        = string
  default     = ""
}

variable "network" {
  description = "The network to use (defaults to the default 'hot' network)"
  type        = string
  default     = "hot"
}

variable "write_to_container" {
  description = "whether applications can write to the container file system"
  type        = bool
  default     = false
}

variable "shared_state_bucket" {
  description = "S3 bucket holding the shared terraform state"
  type        = string
}

variable "region" {
  description = "region of the shared state bucket"
  type        = string
}

variable "shared_state_key" {
  description = "key of the shared terraform state object within shared_state_bucket"
  type        = string
}

variable "public_tasks" {
  description = "run the ECS tasks in the public subnets with a public IP. Drops the NAT gateways and the interface VPC endpoints, which a service that makes no private egress calls never uses."
  type        = bool
  default     = false
}

variable "global_accelerator" {
  description = "put a Global Accelerator in front of the load balancer in production"
  type        = bool
  default     = true
}

variable "hostname" {
  description = "public hostname of the service; overrides the name derived from domain_base and the workspace"
  type        = string
  default     = ""
}

variable "cpu_architecture" {
  description = "Fargate runtime platform architecture: ARM64 or X86_64. Must match the image."
  type        = string
  default     = "ARM64"
}

variable "rds_proxy" {
  description = "put an RDS Proxy in front of the production database. The proxy accepts only IAM authentication for the users it knows, so an app that logs in with a password needs this off."
  type        = bool
  default     = true
}

variable "db_bastion" {
  description = "create the SSH bastion host beside the database"
  type        = bool
  default     = true
}
