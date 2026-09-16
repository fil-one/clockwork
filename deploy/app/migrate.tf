# storoku:ignore
#
# Schema migrations run as a one-off Fargate task from the same image, inside
# the VPC, as the database owner (deploy/docker/migrate.sh). `make migrate`
# registers this task definition for the image being deployed
# (tofu apply -target) and runs it to completion before the service moves to
# that image, so a release never serves against a schema it has not seen.
#
# Everything this file reads from module.app is a narrow output on purpose:
# a reference to a whole module object (module.app.deployment, for instance)
# would put every resource of that module, the CodeDeploy trigger included,
# into the targeted apply, and the blue/green shift would start during the
# migration.

data "aws_region" "current" {}

resource "aws_security_group" "migrate" {
  name        = "${terraform.workspace}-${var.app}-migrate-sg"
  description = "egress only: the migration task reaches RDS, Secrets Manager and ECR"
  vpc_id      = module.app.vpc.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${terraform.workspace}-${var.app}-migrate-sg"
  }
}

resource "aws_iam_role" "migrate_execution" {
  name = "${terraform.workspace}-${var.app}-migrate-execution-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "migrate_execution_ecs" {
  role       = aws_iam_role.migrate_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# the RDS master secret and the key it is encrypted with
resource "aws_iam_role_policy_attachment" "migrate_execution_rds" {
  role       = aws_iam_role.migrate_execution.name
  policy_arn = module.app.database.access_policy_arn
}

# the app's own secrets: the role passwords and the authorization secret that
# production-roles.sql writes into the database
resource "aws_iam_role_policy" "migrate_execution_secrets" {
  name = "${terraform.workspace}-${var.app}-migrate-secrets"
  role = aws_iam_role.migrate_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [for secret in module.app.secrets : secret.valueFrom]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [module.app.kms.arn]
      },
    ]
  })
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${terraform.workspace}-${var.app}-migrate"
  execution_role_arn       = aws_iam_role.migrate_execution.arn
  task_role_arn            = module.app.task_role_arn
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = var.image_tag
      essential = true
      command   = ["/app/deploy/docker/migrate.sh"]
      environment = [
        { name = "PGHOST", value = module.app.database.instance_address },
        { name = "PGPORT", value = tostring(module.app.database.port) },
        { name = "PGDATABASE", value = local.db_database },
        { name = "PGSSLMODE", value = "require" },
        { name = "AUTHORIZATION_CONTEXT_SECRET_ID", value = local.authorization_context_secret_id },
      ]
      secrets = concat(module.app.secrets, [
        { name = "RDS_MASTER_SECRET", valueFrom = module.app.database.secret_arn },
      ])
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = module.app.log_group_name
          awslogs-region        = data.aws_region.current.region
          awslogs-stream-prefix = "migrate"
        }
      }
    }
  ])
}

output "migrate_task_definition" {
  value = aws_ecs_task_definition.migrate.family
}

output "migrate_network_configuration" {
  value = jsonencode({
    awsvpcConfiguration = {
      subnets        = module.app.vpc.subnet_ids.public
      securityGroups = [aws_security_group.migrate.id]
      assignPublicIp = "ENABLED"
    }
  })
}

output "log_group" {
  value = module.app.log_group_name
}
