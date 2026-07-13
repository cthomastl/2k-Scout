resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db"
  subnet_ids = aws_subnet.private[*].id

  tags = merge(local.tags, { Name = "${var.project_name}-db-subnet-group" })
}

resource "aws_db_instance" "postgres" {
  identifier     = "${var.project_name}-db"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage      = var.db_allocated_storage
  storage_encrypted      = true
  db_name                = var.db_name
  username               = var.db_username
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  # AWS generates and rotates the master password itself, stored as a
  # Secrets Manager secret this account owns — the actual password value
  # never appears in a .tfvars file, in Terraform state as plaintext, or in
  # this repo at all. The app tier fetches it at boot (see user_data.sh.tpl)
  # via the secret_arn exposed below.
  manage_master_user_password = true

  multi_az            = var.db_multi_az
  publicly_accessible = false
  skip_final_snapshot = true
  deletion_protection = false

  tags = merge(local.tags, { Name = "${var.project_name}-db" })
}
