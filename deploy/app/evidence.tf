# storoku:ignore
#
# The evidence store (packages/integrations/src/evidence-storage) verifies
# bucket versioning and Object Lock, writes objects under COMPLIANCE
# retention, and reads them back by version; evidenceBucketIamPolicy() in
# that file is the policy it expects. storoku's bucket grant covers
# Get/Put/Delete/List only, so the rest is granted here and the destructive
# actions are denied outright.

resource "aws_iam_role_policy" "evidence" {
  name = "${terraform.workspace}-${var.app}-evidence-bucket"
  role = module.app.task_role_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetBucketVersioning", "s3:GetBucketObjectLockConfiguration"]
        Resource = module.app.buckets["evidence"].arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObjectVersion",
          "s3:GetObjectRetention",
          "s3:GetObjectLegalHold",
          "s3:PutObjectRetention",
          "s3:PutObjectLegalHold",
        ]
        Resource = "${module.app.buckets["evidence"].arn}/evidence/*"
      },
      {
        Effect = "Deny"
        Action = [
          "s3:DeleteObjectVersion",
          "s3:BypassGovernanceRetention",
          "s3:PutBucketObjectLockConfiguration",
          "s3:PutBucketVersioning",
        ]
        Resource = [
          module.app.buckets["evidence"].arn,
          "${module.app.buckets["evidence"].arn}/*",
        ]
      },
    ]
  })
}
