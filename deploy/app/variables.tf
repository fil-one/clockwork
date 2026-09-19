# storoku:ignore
variable "app" {
  description = "The name of the application"
  type        = string
}

variable "allowed_account_id" {
  description = "account id used for AWS"
  type        = string
}

variable "region" {
  description = "aws region for all services"
  type        = string
}

variable "image_tag" {
  description = "ECR image reference to deploy"
  type        = string
}

variable "env_files" {
  description = "list of environment variable files to upload"
  type        = list(string)
  default     = []
}

variable "domain_base" {
  description = "the Route53 zone the shared root created for this account"
  type        = string
}

variable "hostname" {
  description = "public hostname of the service; also the certificate name and the Route53 record"
  type        = string
}

variable "network" {
  description = "The network to use (defaults to the default 'hot' network)"
  type        = string
  default     = "hot"
}

variable "shared_state_bucket" {
  description = "S3 bucket holding the shared root's state; the same bucket this root uses"
  type        = string
}

variable "cpu_architecture" {
  description = "Fargate architecture; must match the image the Makefile builds (PLATFORM)"
  type        = string
  default     = "ARM64"
}

variable "authorization_context_secret_id" {
  description = "id of the active row in private.authorization_secrets; defaults to <workspace>-initial until bootstrap:production issues a manifest id"
  type        = string
  default     = ""
}

# Supplied secrets. Locally they come from the workspace's secrets file (see
# the Makefile); in CI from the GitHub environment. An empty value leaves the
# integration unconfigured, which the application treats as a denial.

variable "workos_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "workos_client_id" {
  type      = string
  sensitive = true
  default   = ""
}

variable "workos_cookie_password" {
  description = "at least 32 characters"
  type        = string
  sensitive   = true
  default     = ""
}

variable "workos_webhook_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "stripe_secret_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "stripe_webhook_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "trigger_secret_key" {
  type      = string
  sensitive = true
  default   = ""
}

# Production database sizing. Staging keeps upstream's db.t4g.micro.

variable "production_db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "production_db_multi_az" {
  type    = bool
  default = false
}

variable "production_db_allocated_storage" {
  description = "GB"
  type        = number
  default     = 50
}
