# storoku:ignore
#
# Staff notification email through Amazon SES (docs/operations/notifications.md).
# Everything here is off until `notifications_email_enabled` is true, so an
# apply of this file with the defaults creates nothing.
#
# When it is on:
#
# - an SES domain identity for `notifications_email_domain` (the hostname by
#   default). Creating one never waits on DNS: SES verifies it on its own once
#   the DKIM records resolve, and until then a send is refused and recorded
#   as a failed delivery, never an apply failure.
# - when the domain is in this account's Route53 zone (the hostname's own
#   zone, from the shared root), the three Easy DKIM CNAMEs in that zone, so
#   verification needs no manual DNS. A domain elsewhere, such as fil.one in
#   Cloudflare, gets no records here; the `notifications_email_dkim_records`
#   output lists the CNAMEs to add by hand.
# - permission for the task role to send from that identity only.
#
# The container learns the sender from COMMERCE_NOTIFICATIONS_EMAIL_PROVIDER
# and COMMERCE_NOTIFICATIONS_EMAIL_FROM, from `local.notifications_env_vars`
# below, which main.tf adds to the task's environment. A new SES account is in the
# sandbox and sends only to verified addresses until AWS grants production
# access, which is requested by hand.

locals {
  notifications_email_domain = var.notifications_email_domain != "" ? var.notifications_email_domain : var.hostname

  notifications_email_address = "notifications@${local.notifications_email_domain}"

  notifications_email_from = "${var.notifications_email_from_name} <${local.notifications_email_address}>"

  # Only an enabled channel adds anything to the task's environment.
  notifications_env_vars = var.notifications_email_enabled ? [
    { name = "COMMERCE_NOTIFICATIONS_EMAIL_PROVIDER", value = "ses" },
    { name = "COMMERCE_NOTIFICATIONS_EMAIL_FROM", value = local.notifications_email_from },
  ] : []

  # The shared root's zone is named for the hostname on the default network.
  notifications_dkim_in_route53 = var.notifications_email_enabled && var.network == "hot" && (
    local.notifications_email_domain == var.domain_base ||
    endswith(local.notifications_email_domain, ".${var.domain_base}")
  )
}

resource "aws_sesv2_email_identity" "notifications" {
  count          = var.notifications_email_enabled ? 1 : 0
  email_identity = local.notifications_email_domain
}

data "aws_route53_zone" "notifications" {
  count        = local.notifications_dkim_in_route53 ? 1 : 0
  name         = var.domain_base
  private_zone = false
}

# Easy DKIM always issues three tokens.
resource "aws_route53_record" "notifications_dkim" {
  count   = local.notifications_dkim_in_route53 ? 3 : 0
  zone_id = data.aws_route53_zone.notifications[0].zone_id
  name    = "${aws_sesv2_email_identity.notifications[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${local.notifications_email_domain}"
  type    = "CNAME"
  ttl     = 1800
  records = ["${aws_sesv2_email_identity.notifications[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

# In the SES sandbox a send is also authorized against each recipient's
# verified identity, so the grant covers every identity in the account and the
# condition keeps the sender to the one address.
resource "aws_iam_role_policy" "notifications_ses" {
  count = var.notifications_email_enabled ? 1 : 0

  name = "${terraform.workspace}-${var.app}-notifications-ses"
  role = module.app.task_role_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Action    = ["ses:SendEmail"]
        Resource  = "arn:aws:ses:${var.region}:${var.allowed_account_id}:identity/*"
        Condition = { StringEquals = { "ses:FromAddress" = local.notifications_email_address } }
      },
    ]
  })
}

output "notifications_email_dkim_records" {
  description = "The DKIM CNAMEs that verify the sending domain. Created in Route53 when the domain is in this account's zone; otherwise add them by hand."

  value = var.notifications_email_enabled ? [
    for token in aws_sesv2_email_identity.notifications[0].dkim_signing_attributes[0].tokens : {
      name  = "${token}._domainkey.${local.notifications_email_domain}"
      type  = "CNAME"
      value = "${token}.dkim.amazonses.com"
    }
  ] : []
}
