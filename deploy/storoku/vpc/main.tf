locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 3)
}
data "aws_region" "current" {}
data "aws_availability_zones" "available" {}

resource "aws_vpc" "vpc" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.environment}-${var.app}-vpc"
  }
}

resource "aws_internet_gateway" "vpc_internet_gateway" {
  vpc_id = aws_vpc.vpc.id

  tags = {
    Name = "${var.environment}-${var.app}-vpc-internet-gateway"
  }
}

resource "aws_subnet" "vpc_public_subnet" {
  count = length(local.azs)

  vpc_id            = aws_vpc.vpc.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index)

  tags = {
    Name = "${var.environment}-${var.app}-vpc-public-subnet-${local.azs[count.index]}"
  }
}

resource "aws_subnet" "vpc_private_subnet" {
  count = length(local.azs)

  vpc_id            = aws_vpc.vpc.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)

  tags = {
    Name = "${var.environment}-${var.app}-vpc-private-subnet-${local.azs[count.index]}"
  }
}

resource "aws_subnet" "vpc_db_subnet" {
  count = var.create_db_net ? length(local.azs) : 0

  vpc_id            = aws_vpc.vpc.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 20)

  tags = {
    Name = "${var.environment}-${var.app}-vpc-db-subnet-${local.azs[count.index]}"
  }
}


resource "aws_subnet" "vpc_elasticache_subnet" {
  count = var.create_elasticache_net ? length(local.azs) : 0

  vpc_id            = aws_vpc.vpc.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 30)

  tags = {
    Name = "${var.environment}-${var.app}-vpc-elasticache-subnet-${local.azs[count.index]}"
  }
}

resource "aws_route_table" "vpc_public_route_table" {
  count = length(local.azs)

  vpc_id = aws_vpc.vpc.id

  tags = {
    Name = "${var.environment}-${var.app}-vpc-public-route-table-${local.azs[count.index]}"
  }
}

resource "aws_route_table" "vpc_private_route_table" {
  count = length(local.azs)

  vpc_id = aws_vpc.vpc.id

  tags = {
    Name = "${var.environment}-${var.app}-vpc-private-route-table-${local.azs[count.index]}"
  }
}

resource "aws_route_table" "vpc_db_route_table" {
  count = var.create_db_net ? length(local.azs) : 0

  vpc_id = aws_vpc.vpc.id

  tags = {
    Name = "${var.environment}-${var.app}-vpc-db-route-table-${local.azs[count.index]}"
  }
}


resource "aws_route_table" "vpc_elasticache_route_table" {
  count = var.create_elasticache_net ? length(local.azs) : 0

  vpc_id = aws_vpc.vpc.id

  tags = {
    Name = "${var.environment}-${var.app}-vpc-elasticache-route-table-${local.azs[count.index]}"
  }
}

resource "aws_route_table_association" "vpc_public_route_table_association" {
  count = length(local.azs)

  subnet_id      = aws_subnet.vpc_public_subnet[count.index].id
  route_table_id = aws_route_table.vpc_public_route_table[count.index].id
}

resource "aws_route_table_association" "vpc_private_route_table_association" {
  count = length(local.azs)

  subnet_id      = aws_subnet.vpc_private_subnet[count.index].id
  route_table_id = aws_route_table.vpc_private_route_table[count.index].id
}

resource "aws_route_table_association" "vpc_db_route_table_association" {
  count = var.create_db_net ? length(local.azs) : 0

  subnet_id      = aws_subnet.vpc_db_subnet[count.index].id
  route_table_id = aws_route_table.vpc_db_route_table[count.index].id
}

resource "aws_route_table_association" "vpc_elasticache_route_table_association" {
  count = var.create_elasticache_net ? length(local.azs) : 0

  subnet_id      = aws_subnet.vpc_elasticache_subnet[count.index].id
  route_table_id = aws_route_table.vpc_elasticache_route_table[count.index].id
}

resource "aws_route" "vpc_public_internet_gateway" {
  count = length(local.azs)

  route_table_id         = aws_route_table.vpc_public_route_table[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.vpc_internet_gateway.id

  timeouts {
    create = "5m"
  }
}

resource "aws_route" "vpc_private_nat_gateway" {
  count = var.create_nat ? length(local.azs) : 0

  route_table_id         = aws_route_table.vpc_private_route_table[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.vpc_nat[count.index].id

  timeouts {
    create = "5m"
  }
}

resource "aws_eip" "vpc_nat_ip" {
  count = var.create_nat ? length(local.azs) : 0

  domain = "vpc"

  tags = {
    Name = "${var.environment}-${var.app}-vpc-nat-ip-${local.azs[count.index]}"
  }
}

resource "aws_nat_gateway" "vpc_nat" {
  count = var.create_nat ? length(local.azs) : 0

  subnet_id     = aws_subnet.vpc_public_subnet[count.index].id
  allocation_id = aws_eip.vpc_nat_ip[count.index].id
  depends_on    = [aws_internet_gateway.vpc_internet_gateway]

  tags = {
    Name = "${var.environment}-${var.app}-vpc-nat-${local.azs[count.index]}"
  }
}

// endpoints for accessing servies in the private part of the vpc
// only needed when workloads sit in the private subnets behind a NAT gateway

resource "aws_vpc_endpoint" "ecr" {
  count               = var.create_nat ? 1 : 0
  vpc_id              = aws_vpc.vpc.id
  service_name        = "com.amazonaws.${data.aws_region.current.region}.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for subnet in aws_subnet.vpc_private_subnet : subnet.id]
  security_group_ids  = [aws_security_group.endpoint_sg[0].id]
  private_dns_enabled = true
  tags = {
    "Name" = "${var.environment}-${var.app}-vpc-endpoint-ecr"
  }
}

resource "aws_vpc_endpoint" "ecr_api" {
  count               = var.create_nat ? 1 : 0
  vpc_id              = aws_vpc.vpc.id
  service_name        = "com.amazonaws.${data.aws_region.current.region}.ecr.api"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for subnet in aws_subnet.vpc_private_subnet : subnet.id]
  security_group_ids  = [aws_security_group.endpoint_sg[0].id]
  private_dns_enabled = true
  tags = {
    "Name" = "${var.environment}-${var.app}-vpc-endpoint-ecr-api"
  }
}

resource "aws_vpc_endpoint" "cloudwatch" {
  count               = var.create_nat ? 1 : 0
  vpc_id              = aws_vpc.vpc.id
  service_name        = "com.amazonaws.${data.aws_region.current.region}.logs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for subnet in aws_subnet.vpc_private_subnet : subnet.id]
  security_group_ids  = [aws_security_group.endpoint_sg[0].id]
  private_dns_enabled = true
  tags = {
    "Name" = "${var.environment}-${var.app}-vpc-endpoint-logs"
  }
}

resource "aws_vpc_endpoint" "dynamodb" {
  count              = var.create_nat ? 1 : 0
  vpc_id             = aws_vpc.vpc.id
  service_name       = "com.amazonaws.${data.aws_region.current.region}.dynamodb"
  vpc_endpoint_type  = "Interface"
  subnet_ids         = [for subnet in aws_subnet.vpc_private_subnet : subnet.id]
  security_group_ids = [aws_security_group.endpoint_sg[0].id]
  tags = {
    "Name" = "${var.environment}-${var.app}-vpc-endpoint-dynamodb"
  }
}

resource "aws_vpc_endpoint" "sqs" {
  count               = var.create_nat ? 1 : 0
  vpc_id              = aws_vpc.vpc.id
  service_name        = "com.amazonaws.${data.aws_region.current.region}.sqs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for subnet in aws_subnet.vpc_private_subnet : subnet.id]
  security_group_ids  = [aws_security_group.endpoint_sg[0].id]
  private_dns_enabled = true
  tags = {
    "Name" = "${var.environment}-${var.app}-vpc-endpoint-sqs"
  }
}

resource "aws_vpc_endpoint" "sns" {
  count              = var.create_nat ? 1 : 0
  vpc_id             = aws_vpc.vpc.id
  service_name       = "com.amazonaws.${data.aws_region.current.region}.sns"
  vpc_endpoint_type  = "Interface"
  subnet_ids         = [for subnet in aws_subnet.vpc_private_subnet : subnet.id]
  security_group_ids = [aws_security_group.endpoint_sg[0].id]
  tags = {
    "Name" = "${var.environment}-${var.app}-vpc-endpoint-sns"
  }
}

// Without a NAT gateway nothing in the private subnets can reach Secrets
// Manager, and the database provisioner Lambda runs there and reads the
// master secret. One interface endpoint is a fraction of a NAT gateway.
resource "aws_vpc_endpoint" "secretsmanager" {
  count               = !var.create_nat && var.secretsmanager_endpoint ? 1 : 0
  vpc_id              = aws_vpc.vpc.id
  service_name        = "com.amazonaws.${data.aws_region.current.region}.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for subnet in aws_subnet.vpc_private_subnet : subnet.id]
  security_group_ids  = [aws_security_group.endpoint_sg[0].id]
  private_dns_enabled = true
  tags = {
    "Name" = "${var.environment}-${var.app}-vpc-endpoint-secretsmanager"
  }
}

// gateway endpoints are free and stay in both shapes

#https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_endpoint
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.vpc.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  tags = {
    "Name" = "${var.environment}-${var.app}-vpc-endpoint-s3"
  }
}

#https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_endpoint_route_table_association
resource "aws_vpc_endpoint_route_table_association" "s3_association" {
  count           = length(local.azs)
  route_table_id  = aws_route_table.vpc_private_route_table[count.index].id
  vpc_endpoint_id = aws_vpc_endpoint.s3.id
}

# with the tasks in the public subnets, the S3 gateway endpoint has to be on
# the public route tables too, or their traffic leaves through the IGW
resource "aws_vpc_endpoint_route_table_association" "s3_public_association" {
  count           = var.create_nat ? 0 : length(local.azs)
  route_table_id  = aws_route_table.vpc_public_route_table[count.index].id
  vpc_endpoint_id = aws_vpc_endpoint.s3.id
}

# DynamoDB has a free gateway endpoint; the interface one above is only worth
# its hourly charge when the workload has no route to the internet at all
resource "aws_vpc_endpoint" "dynamodb_gateway" {
  count             = var.create_nat ? 0 : 1
  vpc_id            = aws_vpc.vpc.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.dynamodb"
  vpc_endpoint_type = "Gateway"
  tags = {
    "Name" = "${var.environment}-${var.app}-vpc-endpoint-dynamodb-gateway"
  }
}

resource "aws_vpc_endpoint_route_table_association" "dynamodb_association" {
  count           = var.create_nat ? 0 : length(local.azs)
  route_table_id  = aws_route_table.vpc_private_route_table[count.index].id
  vpc_endpoint_id = aws_vpc_endpoint.dynamodb_gateway[0].id
}

resource "aws_vpc_endpoint_route_table_association" "dynamodb_public_association" {
  count           = var.create_nat ? 0 : length(local.azs)
  route_table_id  = aws_route_table.vpc_public_route_table[count.index].id
  vpc_endpoint_id = aws_vpc_endpoint.dynamodb_gateway[0].id
}

resource "aws_security_group" "endpoint_sg" {
  # always present: the interface endpoints of both shapes attach to it
  count       = 1
  name        = "endpoint_access"
  description = "allow inbound traffic"
  vpc_id      = aws_vpc.vpc.id
  tags = {
    "Name" = "${var.environment}-${var.app}-endpoint-sg"
  }

  ingress {
    description = "Enable access for the endpoints."
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}
