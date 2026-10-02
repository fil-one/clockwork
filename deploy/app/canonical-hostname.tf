# storoku:ignore
# DNS and certificate validation live in fil-one/infrastructure. Attach the
# issued certificate without replacing the original listener or certificate.
locals {
  has_canonical_alias = var.canonical_hostname != "" && var.canonical_hostname != var.hostname
}

data "aws_acm_certificate" "canonical" {
  count       = local.has_canonical_alias ? 1 : 0
  domain      = var.canonical_hostname
  statuses    = ["ISSUED"]
  types       = ["AMAZON_ISSUED"]
  most_recent = true
}

resource "aws_lb_listener_certificate" "canonical" {
  count           = local.has_canonical_alias ? 1 : 0
  listener_arn    = module.app.ecs_infra.lb_listener.arn
  certificate_arn = data.aws_acm_certificate.canonical[0].arn
}
