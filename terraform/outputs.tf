output "app_url" {
  description = "The URL to actually use the app — CloudFront serves the SPA and routes /api and /auth to the app tier"
  value       = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "cloudfront_distribution_id" {
  description = "Needed to invalidate the cache after deploying a new frontend build"
  value       = aws_cloudfront_distribution.main.id
}

output "frontend_bucket_name" {
  description = "S3 bucket to sync the built frontend (dist/) into"
  value       = aws_s3_bucket.frontend.bucket
}

output "alb_dns_name" {
  description = "ALB's own DNS name — only reachable from CloudFront's IP ranges, not directly useful in a browser"
  value       = aws_lb.app.dns_name
}

output "rds_endpoint" {
  description = "Postgres endpoint (host:port)"
  value       = "${aws_db_instance.postgres.address}:${aws_db_instance.postgres.port}"
}

output "rds_master_user_secret_arn" {
  description = "Secrets Manager ARN holding the AWS-generated RDS master password"
  value       = aws_db_instance.postgres.master_user_secret[0].secret_arn
}

output "asg_name" {
  description = "Auto Scaling Group name — used to trigger an instance refresh when redeploying"
  value       = aws_autoscaling_group.app.name
}
