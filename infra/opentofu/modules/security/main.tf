variable "name" { type = string }
variable "aws_account_id" { type = string }
variable "aws_region" { type = string }
variable "github_oidc_provider_arn" { type = string }
variable "github_repository" { type = string }

locals {
  ecs_principal       = { Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] }
  bucket_pattern      = "arn:aws:s3:::cashmemo-*-${var.aws_account_id}-*"
  role_names          = toset(["runtime", "worker", "migration", "restore"])
  database_role_names = toset(["identity", "runtime", "worker", "migration", "restore"])
  execution_role_names = toset([
    "runtime",
    "worker",
    "migration",
    "restore",
    "collector",
  ])
}

resource "aws_kms_key" "secrets" {
  description             = "${var.name} Secrets Manager encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Sid = "AccountAdministration", Effect = "Allow", Principal = { AWS = "arn:aws:iam::${var.aws_account_id}:root" }, Action = "kms:*", Resource = "*"
  }] })
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${var.name}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

resource "aws_secretsmanager_secret" "database_role" {
  # checkov:skip=CKV2_AWS_57:Rotation needs approved database rotation function and credentials from open T233; manual dual-secret rotation remains mandatory.
  for_each                = local.database_role_names
  name                    = "${var.name}/database/${each.key}"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = 30
  description             = "Externally populated ${each.key} database credential; never plaintext IaC."
}

resource "aws_iam_role" "task" {
  for_each           = local.role_names
  name               = "${var.name}-${each.key}"
  assume_role_policy = jsonencode(local.ecs_principal)
}

resource "aws_iam_role" "execution" {
  for_each           = local.execution_role_names
  name               = "${var.name}-${each.key}-execution"
  assume_role_policy = jsonencode(local.ecs_principal)
}

resource "aws_iam_role_policy_attachment" "execution" {
  for_each   = local.execution_role_names
  role       = aws_iam_role.execution[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_database_secret" {
  for_each = local.role_names
  name     = "database-secret-injection"
  role     = aws_iam_role.execution[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    {
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = each.key == "runtime" ? [
        aws_secretsmanager_secret.database_role["runtime"].arn,
        aws_secretsmanager_secret.database_role["identity"].arn,
      ] : [aws_secretsmanager_secret.database_role[each.key].arn]
    },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = [aws_kms_key.secrets.arn] },
  ] })
}

resource "aws_iam_role_policy" "runtime" {
  name = "runtime-boundary"
  role = aws_iam_role.task["runtime"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.database_role["runtime"].arn] },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = [aws_kms_key.secrets.arn] },
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = ["${local.bucket_pattern}/exports/*"] },
    { Effect = "Allow", Action = ["ses:SendEmail"], Resource = "*", Condition = { StringEquals = { "aws:RequestedRegion" = var.aws_region } } },
  ] })
}

resource "aws_iam_role_policy" "worker" {
  name = "worker-boundary"
  role = aws_iam_role.task["worker"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.database_role["worker"].arn] },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = [aws_kms_key.secrets.arn] },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"], Resource = [local.bucket_pattern, "${local.bucket_pattern}/*"] },
  ] })
}

resource "aws_iam_role_policy" "migration" {
  name = "migration-only"
  role = aws_iam_role.task["migration"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.database_role["migration"].arn] },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = [aws_kms_key.secrets.arn] },
  ] })
}

resource "aws_iam_role_policy" "restore" {
  name = "exceptional-restore-only"
  role = aws_iam_role.task["restore"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.database_role["restore"].arn] },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = [aws_kms_key.secrets.arn] },
    { Effect = "Allow", Action = ["rds:RestoreDBInstanceToPointInTime", "rds:DeleteDBInstance", "rds:Describe*"], Resource = "*", Condition = { StringEquals = { "aws:RequestTag/cashmemo:lineage-registered" = "true" } } },
  ] })
}

resource "aws_iam_role" "deployment" {
  name = "${var.name}-deployment"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Allow", Principal = { Federated = var.github_oidc_provider_arn }, Action = "sts:AssumeRoleWithWebIdentity",
    Condition = { StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }, StringLike = { "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:*" } }
  }] })
}

resource "aws_iam_role_policy" "deployment" {
  # checkov:skip=CKV_AWS_290:RegisterTaskDefinition and service discovery require account-scoped wildcard resources; OIDC environment trust and iam:PassRole constrain use.
  # checkov:skip=CKV_AWS_355:RegisterTaskDefinition and ECR authorization do not support resource-level permissions.
  name = "immutable-release-deployment"
  role = aws_iam_role.deployment.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart"], Resource = "arn:aws:ecr:${var.aws_region}:${var.aws_account_id}:repository/${var.name}" },
    { Effect = "Allow", Action = ["ecs:DescribeServices", "ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition", "ecs:RunTask", "ecs:UpdateService"], Resource = "*" },
    { Effect = "Allow", Action = ["iam:PassRole"], Resource = concat([for role in aws_iam_role.task : role.arn], [for role in aws_iam_role.execution : role.arn]) },
  ] })
}

resource "aws_iam_role" "break_glass" {
  name                 = "${var.name}-break-glass"
  max_session_duration = 3600
  assume_role_policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { AWS = "arn:aws:iam::${var.aws_account_id}:root" }, Action = "sts:AssumeRole", Condition = { Bool = { "aws:MultiFactorAuthPresent" = "true" } } }] })
}

resource "aws_iam_role" "rds_monitoring" {
  name               = "${var.name}-rds-monitoring"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "monitoring.rds.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

check "runtime_has_no_privileged_database_secret" {
  assert {
    condition     = length(setintersection(toset([aws_secretsmanager_secret.database_role["migration"].arn, aws_secretsmanager_secret.database_role["restore"].arn]), toset([aws_secretsmanager_secret.database_role["runtime"].arn]))) == 0
    error_message = "Runtime must never receive migration or restore credentials."
  }
}

output "execution_role_arns" { value = { for key, role in aws_iam_role.execution : key => role.arn } }
output "runtime_role_arn" { value = aws_iam_role.task["runtime"].arn }
output "worker_role_arn" { value = aws_iam_role.task["worker"].arn }
output "migration_role_arn" { value = aws_iam_role.task["migration"].arn }
output "restore_role_arn" { value = aws_iam_role.task["restore"].arn }
output "deployment_role_arn" { value = aws_iam_role.deployment.arn }
output "rds_monitoring_role_arn" { value = aws_iam_role.rds_monitoring.arn }
output "database_secret_arns" {
  value     = { for key, secret in aws_secretsmanager_secret.database_role : key => secret.arn }
  sensitive = true
}
output "secrets_kms_key_arn" { value = aws_kms_key.secrets.arn }
