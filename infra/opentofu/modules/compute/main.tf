variable "name" { type = string }
variable "aws_region" { type = string }
variable "kms_key_arn" { type = string }
variable "image_digest" {
  type = string
  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.image_digest))
    error_message = "image_digest must be immutable."
  }
}
variable "application_subnet_ids" { type = list(string) }
variable "application_security_group_id" { type = string }
variable "target_group_arn" { type = string }
variable "execution_role_arns" { type = map(string) }
variable "runtime_role_arn" { type = string }
variable "worker_role_arn" { type = string }
variable "migration_role_arn" { type = string }
variable "database_secret_arns" {
  type      = map(string)
  sensitive = true
}
variable "core_log_group" { type = string }
variable "provider_log_group" { type = string }
variable "desired_count" {
  type    = number
  default = 2
}

resource "aws_ecr_repository" "this" {
  name                 = var.name
  image_tag_mutability = "IMMUTABLE"
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = var.kms_key_arn
  }
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name
  policy     = jsonencode({ rules = [{ rulePriority = 1, description = "Retain recent immutable releases", selection = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }, action = { type = "expire" } }] })
}

resource "aws_ecs_cluster" "this" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enhanced"
  }
}

locals {
  release_image = "${aws_ecr_repository.this.repository_url}@${var.image_digest}"
  common_environment = [
    { name = "APP_ENV", value = strcontains(var.name, "production") ? "production" : "staging" },
    { name = "AWS_REGION", value = var.aws_region },
  ]
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = var.execution_role_arns["runtime"]
  task_role_arn            = var.runtime_role_arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }
  ephemeral_storage { size_in_gib = 50 }
  container_definitions = jsonencode([{
    name                   = "cashmemo", image = local.release_image, essential = true, user = "10001:10001",
    readonlyRootFilesystem = true,
    linuxParameters        = { capabilities = { drop = ["ALL"] }, initProcessEnabled = true },
    portMappings           = [{ containerPort = 3000, hostPort = 3000, protocol = "tcp" }],
    environment            = concat(local.common_environment, [{ name = "PROCESS_ROLE", value = "api" }]),
    secrets = [
      { name = "DATABASE_URL", valueFrom = var.database_secret_arns["runtime"] },
      { name = "AUTH_DATABASE_URL", valueFrom = var.database_secret_arns["identity"] },
    ],
    mountPoints      = [], volumesFrom = [],
    healthCheck      = { command = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""], interval = 30, timeout = 5, retries = 3, startPeriod = 30 },
    logConfiguration = { logDriver = "awslogs", options = { "awslogs-group" = var.core_log_group, "awslogs-region" = var.aws_region, "awslogs-stream-prefix" = "api" } }
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = var.execution_role_arns["worker"]
  task_role_arn            = var.worker_role_arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }
  ephemeral_storage { size_in_gib = 50 }
  container_definitions = jsonencode([{
    name             = "cashmemo-worker", image = local.release_image, essential = true, user = "10001:10001", readonlyRootFilesystem = true,
    linuxParameters  = { capabilities = { drop = ["ALL"] }, initProcessEnabled = true },
    environment      = concat(local.common_environment, [{ name = "PROCESS_ROLE", value = "worker" }]),
    secrets          = [{ name = "DATABASE_URL", valueFrom = var.database_secret_arns["worker"] }],
    mountPoints      = [], volumesFrom = [],
    logConfiguration = { logDriver = "awslogs", options = { "awslogs-group" = var.provider_log_group, "awslogs-region" = var.aws_region, "awslogs-stream-prefix" = "worker" } }
  }])
}

resource "aws_ecs_service" "api" {
  name                   = "${var.name}-api"
  cluster                = aws_ecs_cluster.this.id
  task_definition        = aws_ecs_task_definition.api.arn
  desired_count          = var.desired_count
  launch_type            = "FARGATE"
  enable_execute_command = false
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  network_configuration {
    subnets          = var.application_subnet_ids
    security_groups  = [var.application_security_group_id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "cashmemo"
    container_port   = 3000
  }
}

check "one_release_digest" {
  assert {
    condition     = local.release_image == "${aws_ecr_repository.this.repository_url}@${var.image_digest}"
    error_message = "API and worker must use one immutable release digest."
  }
}

output "cluster_arn" { value = aws_ecs_cluster.this.arn }
output "service_name" { value = aws_ecs_service.api.name }
output "worker_task_definition_arn" { value = aws_ecs_task_definition.worker.arn }
output "repository_url" { value = aws_ecr_repository.this.repository_url }
output "release_image" { value = local.release_image }
