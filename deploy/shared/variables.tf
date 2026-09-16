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

variable "domain_base" {
  description = "the Route53 zone to create; the service hostname in this account"
  type        = string
}

variable "github_environment" {
  description = "the GitHub environment (staging or production) whose jobs may assume this account's deploy role"
  type        = string
}

variable "github_repository" {
  description = "owner/name of the repository that deploys into this account"
  type        = string
  default     = "fil-one/clockwork"
}
