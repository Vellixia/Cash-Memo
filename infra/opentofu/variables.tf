variable "environment" {
  description = "Fail-closed deployment identity."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
  validation {
    condition     = var.aws_region == "ap-southeast-1"
    error_message = "Cashmemo architecture supports only ap-southeast-1."
  }
}

variable "aws_account_id" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a verified 12-digit account identifier."
  }
}

variable "domain_name" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$", var.domain_name))
    error_message = "domain_name must be canonical DNS."
  }
}

variable "certificate_arn" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^arn:aws:acm:ap-southeast-1:[0-9]{12}:certificate/[0-9a-f-]+$", var.certificate_arn))
    error_message = "certificate_arn must be a verified ap-southeast-1 ACM certificate ARN."
  }
}

variable "route53_zone_id" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^Z[A-Z0-9]+$", var.route53_zone_id))
    error_message = "route53_zone_id must be a verified hosted-zone identifier."
  }
}

variable "release_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.release_id))
    error_message = "release_id must be an exact Git commit SHA."
  }
}

variable "reviewed_plan_sha256" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^[0-9a-f]{64}$", var.reviewed_plan_sha256))
    error_message = "reviewed_plan_sha256 must be a SHA-256 digest."
  }
}

variable "approved_plan_sha256" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^[0-9a-f]{64}$", var.approved_plan_sha256))
    error_message = "approved_plan_sha256 must come from protected approval."
  }
}
