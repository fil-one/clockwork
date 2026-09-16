variable "app" {
  description = "The name of the application"
  type        = string
}

variable "environment" {
  description = "The environment the VPC will belong to"
  type        = string
}

variable "vpc_cidr" {
  description = "The CIDR used in the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "create_db_net" {
  description = "create a private subnet for a database"
  type        = bool
  default     = true
}

variable "create_elasticache_net" {
  description = "create a private subnet for elasticache"
  type        = bool
  default     = false
}

variable "secretsmanager_endpoint" {
  description = "with create_nat false, create the Secrets Manager interface endpoint the private subnets otherwise lack. Only a private-subnet workload that reads secrets needs it."
  type        = bool
  default     = true
}

variable "create_nat" {
  description = "create NAT gateways and the interface VPC endpoints that let private-subnet workloads reach AWS services. Set false when the tasks run in the public subnets with a public IP."
  type        = bool
  default     = true
}
