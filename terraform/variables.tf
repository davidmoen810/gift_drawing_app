variable "aws_region" {
  description = "AWS region containing the website bucket."
  type        = string
}

variable "bucket_name" {
  description = "Globally unique S3 bucket name for the public website."
  type        = string
}
