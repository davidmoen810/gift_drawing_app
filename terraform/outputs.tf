output "website_url" {
  description = "HTTP endpoint for the S3 static website."
  value       = "http://${aws_s3_bucket_website_configuration.website.website_endpoint}"
}
