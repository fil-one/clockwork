output "database" {
  value = local.database
}

output "caches" {
  value = local.caches
}

output "vpc" {
  value = local.vpc
}

output "kms" {
  value = local.kms
}

output "secrets" {
  value = local.secrets
}

output "ecs_infra" {
  value = module.ecs_infra
}

output "deployment" {
  value = module.deployment
}

output "buckets" {
  value = module.buckets
}

output "tables" {
  value = module.tables
}

output "queue" {
  value = module.queues
}

output "topics" {
  value = module.topics
}

output "env_files" {
  value = module.env_files
}

# Narrow outputs for callers that target single resources: a reference to a
# whole module object drags every resource in that module into the target's
# dependency closure, the CodeDeploy trigger included.
output "task_role_arn" {
  value = module.deployment.task_role.arn
}

output "task_role_name" {
  value = module.deployment.task_role.name
}

output "log_group_name" {
  value = module.ecs_infra.aws_cloudwatch_log_group.name
}
