# Self-hosted Splunk for centralized logging. A single EC2 instance, not an
# ASG — this is a log sink, not a horizontally-scaled service, and matches
# the single-instance Splunk deployment this replaced. Docker containers on
# the app tier ship logs to it directly via Docker's native `splunk` logging
# driver (see user_data.sh.tpl) — no separate forwarder agent needed.

resource "aws_security_group" "splunk" {
  name        = "${var.project_name}-splunk"
  description = "Splunk HEC — inbound only from the app tier"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HEC from the app tier"
    from_port       = 8088
    to_port         = 8088
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${var.project_name}-splunk-sg" })
}

resource "aws_iam_role" "splunk_instance" {
  name = "${var.project_name}-splunk-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "splunk_ssm_managed_instance" {
  role       = aws_iam_role.splunk_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Deliberately its own, narrower role than the app tier's — the logging box
# only needs its own two secrets, not the RDS password or anything else.
resource "aws_iam_role_policy" "splunk_read_secrets" {
  name = "${var.project_name}-splunk-read-secrets"
  role = aws_iam_role.splunk_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadSplunkSsmSecrets"
        Effect = "Allow"
        Action = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = [
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_secrets_prefix}/SPLUNK_PASSWORD",
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_secrets_prefix}/SPLUNK_HEC_TOKEN",
        ]
      },
      {
        Sid      = "DecryptWithDefaultSsmKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "arn:aws:kms:${var.aws_region}:${data.aws_caller_identity.current.account_id}:key/*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com"
          }
        }
      }
    ]
  })
}

resource "aws_iam_instance_profile" "splunk" {
  name = "${var.project_name}-splunk-instance-profile"
  role = aws_iam_role.splunk_instance.name
}

resource "aws_instance" "splunk" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.splunk_instance_type
  subnet_id              = aws_subnet.private[0].id
  vpc_security_group_ids = [aws_security_group.splunk.id]
  iam_instance_profile   = aws_iam_instance_profile.splunk.name

  # Pinned rather than left to DHCP so the app tier's baked-in HEC URL (see
  # asg.tf) stays valid even if this instance is ever replaced — a raw
  # private IP would otherwise be free to change on relaunch, silently
  # breaking log delivery for every app-tier instance until their next boot.
  private_ip = cidrhost(aws_subnet.private[0].cidr_block, 10)

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  root_block_device {
    volume_size = var.splunk_data_volume_size
    volume_type = "gp3"
  }

  user_data = base64encode(templatefile("${path.module}/splunk_user_data.sh.tpl", {
    aws_region = var.aws_region
    ssm_prefix = var.ssm_secrets_prefix
  }))

  tags = merge(local.tags, { Name = "${var.project_name}-splunk" })
}
