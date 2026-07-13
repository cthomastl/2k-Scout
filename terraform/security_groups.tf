# AWS-managed, auto-updating list of CloudFront's origin-facing IP ranges.
# Using this instead of 0.0.0.0/0 means the ALB is internet-facing (CloudFront
# needs a public origin) but only actually reachable from CloudFront itself —
# nobody can bypass CloudFront and hit the ALB directly.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb"
  description = "Allows inbound HTTP only from CloudFront's origin-facing IP ranges"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTP from CloudFront only"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${var.project_name}-alb-sg" })
}

resource "aws_security_group" "app" {
  name        = "${var.project_name}-app"
  description = "App-tier EC2 instances — inbound only from the ALB"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "gateway from the ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${var.project_name}-app-sg" })
}

resource "aws_security_group" "rds" {
  name        = "${var.project_name}-rds"
  description = "RDS Postgres — inbound only from the app tier"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from the app tier"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${var.project_name}-rds-sg" })
}
