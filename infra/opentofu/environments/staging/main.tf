terraform {
  required_version = "= 1.12.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.59.0" }
  }
  backend "s3" {
    region       = "ap-southeast-1"
    encrypt      = true
    use_lockfile = true
  }
}

variable "aws_account_id" {
  type      = string
  sensitive = true
}
variable "domain_name" { type = string }
variable "route53_zone_id" {
  type      = string
  sensitive = true
}
variable "certificate_arn" {
  type      = string
  sensitive = true
}
variable "github_oidc_provider_arn" {
  type      = string
  sensitive = true
}
variable "github_repository" { type = string }
variable "release_id" { type = string }
variable "image_digest" { type = string }
variable "collector_image" { type = string }

locals {
  name       = "cashmemo-staging"
  aws_region = "ap-southeast-1"
}

provider "aws" {
  region              = local.aws_region
  allowed_account_ids = [var.aws_account_id]
  default_tags { tags = { "cashmemo:environment" = "staging", "cashmemo:managed-by" = "opentofu", "cashmemo:release" = var.release_id } }
}

resource "aws_sns_topic" "operations" {
  name              = "${local.name}-content-free-operations"
  kms_master_key_id = module.security.secrets_kms_key_arn
}

module "network" {
  source                   = "../../modules/network"
  name                     = local.name
  vpc_cidr                 = "10.42.0.0/16"
  availability_zones       = ["ap-southeast-1a", "ap-southeast-1b"]
  public_subnet_cidrs      = ["10.42.0.0/24", "10.42.1.0/24"]
  application_subnet_cidrs = ["10.42.16.0/24", "10.42.17.0/24"]
  database_subnet_cidrs    = ["10.42.32.0/24", "10.42.33.0/24"]
  certificate_arn          = var.certificate_arn
  kms_key_arn              = module.security.secrets_kms_key_arn
}

module "security" {
  source                   = "../../modules/security"
  name                     = local.name
  aws_account_id           = var.aws_account_id
  aws_region               = local.aws_region
  github_oidc_provider_arn = var.github_oidc_provider_arn
  github_repository        = var.github_repository
}

module "storage" {
  source              = "../../modules/storage"
  name                = local.name
  aws_account_id      = var.aws_account_id
  runtime_role_arn    = module.security.runtime_role_arn
  worker_role_arn     = module.security.worker_role_arn
  restore_role_arn    = module.security.restore_role_arn
  deployment_role_arn = module.security.deployment_role_arn
}

module "database" {
  source                     = "../../modules/database"
  name                       = local.name
  database_subnet_ids        = module.network.database_subnet_ids
  database_security_group_id = module.network.database_security_group_id
  kms_key_arn                = module.security.secrets_kms_key_arn
  monitoring_role_arn        = module.security.rds_monitoring_role_arn
  instance_class             = "db.m7g.large"
  allocated_storage          = 100
}

module "compute" {
  source                        = "../../modules/compute"
  name                          = local.name
  aws_region                    = local.aws_region
  kms_key_arn                   = module.security.secrets_kms_key_arn
  image_digest                  = var.image_digest
  application_subnet_ids        = module.network.application_subnet_ids
  application_security_group_id = module.network.application_security_group_id
  target_group_arn              = module.network.target_group_arn
  execution_role_arns           = module.security.execution_role_arns
  runtime_role_arn              = module.security.runtime_role_arn
  worker_role_arn               = module.security.worker_role_arn
  migration_role_arn            = module.security.migration_role_arn
  database_secret_arns          = module.security.database_secret_arns
  core_log_group                = "/cashmemo/${local.name}/core"
  provider_log_group            = "/cashmemo/${local.name}/providers"
  desired_count                 = 2
}

module "observability" {
  source                        = "../../modules/observability"
  name                          = local.name
  aws_region                    = local.aws_region
  ecs_cluster_arn               = module.compute.cluster_arn
  application_subnet_ids        = module.network.application_subnet_ids
  application_security_group_id = module.network.application_security_group_id
  execution_role_arn            = module.security.execution_role_arns["collector"]
  runtime_role_arn              = module.security.runtime_role_arn
  collector_image               = var.collector_image
  alarm_topic_arn               = aws_sns_topic.operations.arn
  kms_key_arn                   = module.security.secrets_kms_key_arn
}

module "email" {
  source          = "../../modules/email"
  name            = local.name
  domain_name     = var.domain_name
  event_topic_arn = aws_sns_topic.operations.arn
}

module "data_safety" {
  source              = "../../modules/data-safety"
  name                = local.name
  alarm_topic_arn     = aws_sns_topic.operations.arn
  database_identifier = module.database.resource_id
}

resource "aws_route53_record" "application" {
  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "CNAME"
  ttl     = 60
  records = [module.network.alb_dns_name]
}

output "release_image" { value = module.compute.release_image }
output "deployment_role_arn" { value = module.security.deployment_role_arn }
