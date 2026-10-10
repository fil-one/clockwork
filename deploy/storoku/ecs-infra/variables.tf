variable "app" {
  description = "The name of the application"
  type        = string
}

variable "environment" {
  description = "The environment the cluster will belong to"
  type        = string
}

variable "is_production" {
  description = "Indicates whether production-grade features should be enabled"
  type        = bool
}

variable "kms" {
  description = "id of a KMS key used to encrypt"
  type = object({
    id = string
    arn = string
  })
}

variable "vpc" {
  description = "The VPC to deploy the cluster in"
  type        = object({
    id         = string
    subnet_ids = object({
      public      = list(string)
      private     = list(string)
      db          = list(string)
      elasticache = list(string)
    })
  })
}

variable "domain" {
  description = "Domain information"
  type = object({
    zone_id = string
    name = string
  })
}

variable "cert_arn" {
  description = "arn for cert to use with HTTPS listener"
  type = string
}

variable "httpport" {
  type = number
  default = 8080
}

variable "lb_health_check" {
  description = "Target group health check timing. The defaults are the AWS provider's (30 s, 3 and 3); a null timeout leaves AWS's default, 5 s for HTTP."
  nullable    = false
  type = object({
    interval            = optional(number, 30)
    healthy_threshold   = optional(number, 3)
    unhealthy_threshold = optional(number, 3)
    timeout             = optional(number)
  })
  default = {}
  validation {
    condition     = coalesce(var.lb_health_check.timeout, 5) < var.lb_health_check.interval
    error_message = "The health check timeout (5 s when unset) must be shorter than its interval."
  }
}
