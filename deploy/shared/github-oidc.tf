# storoku:ignore
#
# The identity GitHub Actions deploys with. One role per account, and only a
# job of this repository running in the matching GitHub environment can
# assume it: the environment's own protection rules (main only, reviewers)
# then decide what gets to deploy. This is the shape FilOne's own
# filone-infra-<stage>-github roles use, including AdministratorAccess, which
# an OpenTofu apply that creates IAM roles and KMS keys needs; narrowing it is
# a follow-up.
#
# The OIDC provider is one per account and shared with every other
# repository that deploys into it, so it is read rather than owned.

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_role" "github_deploy" {
  name = "${var.app}-${var.github_environment}-github"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:${var.github_environment}"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "github_deploy_admin" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
