variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short name used to prefix/tag every resource"
  type        = string
  default     = "2k-scout"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

# --- App tier (EC2 Auto Scaling Group) --------------------------------------

variable "app_instance_type" {
  description = "EC2 instance type for the app-tier Auto Scaling Group"
  type        = string
  default     = "t3.small"
}

variable "app_min_size" {
  description = "Minimum number of app-tier instances"
  type        = number
  default     = 2
}

variable "app_max_size" {
  description = "Maximum number of app-tier instances"
  type        = number
  default     = 4
}

variable "app_desired_capacity" {
  description = "Desired number of app-tier instances at steady state"
  type        = number
  default     = 2
}

variable "app_cpu_target_value" {
  description = "Target average CPU utilization (%) the ASG's scaling policy holds the fleet to"
  type        = number
  default     = 50
}

variable "ssh_key_name" {
  description = "Existing EC2 key pair name for optional SSH access. Leave null to rely on SSM Session Manager only (recommended — instances have no public IP)."
  type        = string
  default     = null
}

# --- Database tier (RDS) -----------------------------------------------------

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage in GiB"
  type        = number
  default     = 20
}

variable "db_engine_version" {
  description = "Postgres engine version"
  type        = string
  default     = "16"
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "scout"
}

variable "db_username" {
  description = "Master username"
  type        = string
  default     = "scout"
}

variable "db_multi_az" {
  description = "Whether to run RDS Multi-AZ for automatic failover. Off by default to keep this cheap to run as a portfolio project — flip to true for anything resembling production."
  type        = bool
  default     = false
}

# --- Application secrets (read from SSM Parameter Store at boot) ------------

variable "ssm_secrets_prefix" {
  description = "SSM Parameter Store path prefix under which app secrets are created. You must put real values into these SecureString parameters yourself (see terraform/README.md) — Terraform never sees or stores the actual secret values."
  type        = string
  default     = "/2k-scout"
}

# --- Logging (self-hosted Splunk) --------------------------------------------

variable "splunk_instance_type" {
  description = "EC2 instance type for the Splunk log sink"
  type        = string
  default     = "t3.medium"
}

variable "splunk_data_volume_size" {
  description = "GiB for Splunk's data volume (the instance's root EBS volume — this is a single non-autoscaled box, not a fleet)"
  type        = number
  default     = 30
}

# --- Container images ---------------------------------------------------------

variable "ghcr_owner" {
  description = "GitHub Container Registry owner/org that images are published under (ghcr.io/<ghcr_owner>/2k-scout-<service>)"
  type        = string
  default     = "cthomastl"
}

variable "image_tag" {
  description = "Image tag the app-tier instances pull on boot"
  type        = string
  default     = "latest"
}

# --- Demo account (matches the existing DEMO_EMAIL/DEMO_PASSWORD seeded by auth-service) ---

variable "demo_email" {
  description = "Seeded demo account email"
  type        = string
  default     = "scout@2kscout.app"
}
