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

# The immutable subject form names the owner and repository by id. Both ids
# come from `gh api repos/fil-one/clockwork --jq '[.owner.id, .id]'`.
variable "github_owner" {
  type    = string
  default = "fil-one"
}

variable "github_owner_id" {
  type    = string
  default = "276426624"
}

variable "github_repository_name" {
  type    = string
  default = "clockwork"
}

variable "github_repository_id" {
  type    = string
  default = "1319729323"
}
