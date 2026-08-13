terraform {
  required_version = "= 1.12.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.59.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = {
      "cashmemo:environment" = var.environment
      "cashmemo:managed-by"  = "opentofu"
      "cashmemo:release"     = var.release_id
    }
  }
}
