# storoku:ignore
output "route53_zones" {
  value = module.shared.route53_zones
}

# the four records to delegate the hostname to in fil-one/infrastructure
output "name_servers" {
  value = module.shared.route53_zones["hot"].name_servers
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "dev_vpc" {
  value = module.shared.dev_vpc
}

output "dev_caches" {
  value = module.shared.dev_caches
}

output "dev_databases" {
  value = module.shared.dev_databases
}

output "dev_kms" {
  value = module.shared.dev_kms
}
