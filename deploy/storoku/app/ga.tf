locals {
  # Only prod gets a Global Accelerator, and only when it is asked for
  should_create_ga = var.global_accelerator && local.is_production
}

module "ga" {
  count       = local.should_create_ga ? 1 : 0
  source      = "../ga"
  target_arn  = module.ecs_infra.lb.arn
  environment = var.environment
  app         = var.app
}
