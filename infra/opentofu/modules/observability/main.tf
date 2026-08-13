variable "name" { type = string }
variable "aws_region" { type = string }
variable "ecs_cluster_arn" { type = string }
variable "application_subnet_ids" { type = list(string) }
variable "application_security_group_id" { type = string }
variable "execution_role_arn" { type = string }
variable "runtime_role_arn" { type = string }
variable "collector_image" {
  type = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.collector_image))
    error_message = "collector_image must use an immutable digest."
  }
}
variable "alarm_topic_arn" { type = string }
variable "kms_key_arn" { type = string }

resource "aws_cloudwatch_log_group" "core" {
  name              = "/cashmemo/${var.name}/core"
  retention_in_days = 365
  kms_key_id        = var.kms_key_arn
}
resource "aws_cloudwatch_log_group" "providers" {
  name              = "/cashmemo/${var.name}/providers"
  retention_in_days = 365
  kms_key_id        = var.kms_key_arn
}
resource "aws_cloudwatch_log_group" "collector" {
  name              = "/cashmemo/${var.name}/collector"
  retention_in_days = 365
  kms_key_id        = var.kms_key_arn
}

resource "aws_ecs_task_definition" "collector" {
  family                   = "${var.name}-otel-collector"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.runtime_role_arn
  container_definitions    = jsonencode([{ name = "otel-collector", image = var.collector_image, essential = true, user = "10001:10001", readonlyRootFilesystem = true, linuxParameters = { capabilities = { drop = ["ALL"] } }, command = ["--config=env:OTEL_CONFIG"], environment = [{ name = "OTEL_CONFIG", value = "receivers::otlp::protocols::http::endpoint: 0.0.0.0:4318\nexporters::awscloudwatchlogs::log_group_name: ${aws_cloudwatch_log_group.collector.name}\nservice::pipelines::metrics::receivers: [otlp]\nservice::pipelines::metrics::exporters: [awscloudwatchlogs]" }], logConfiguration = { logDriver = "awslogs", options = { "awslogs-group" = aws_cloudwatch_log_group.collector.name, "awslogs-region" = var.aws_region, "awslogs-stream-prefix" = "collector" } } }])
}

resource "aws_ecs_service" "collector" {
  name            = "${var.name}-otel-collector"
  cluster         = var.ecs_cluster_arn
  task_definition = aws_ecs_task_definition.collector.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = var.application_subnet_ids
    security_groups  = [var.application_security_group_id]
    assign_public_ip = false
  }
}

resource "aws_cloudwatch_dashboard" "core" {
  dashboard_name = "${var.name}-core"
  dashboard_body = jsonencode({ widgets = [{ type = "metric", x = 0, y = 0, width = 12, height = 6, properties = { title = "Core availability and latency", region = var.aws_region, metrics = [["Cashmemo/Core", "Availability"], [".", "LatencyP95"]] } }] })
}

resource "aws_cloudwatch_dashboard" "providers" {
  dashboard_name = "${var.name}-providers"
  dashboard_body = jsonencode({ widgets = [{ type = "metric", x = 0, y = 0, width = 12, height = 6, properties = { title = "Provider availability", region = var.aws_region, metrics = [["Cashmemo/Providers", "STTAvailability"], [".", "ExtractionAvailability"], [".", "SESAvailability"]] } }] })
}

locals {
  alarms = {
    core_burn_rate   = { namespace = "Cashmemo/Core", metric = "BurnRate", threshold = 1 }
    worker_backlog   = { namespace = "Cashmemo/Operations", metric = "WorkerOldestAgeSeconds", threshold = 300 }
    audio_cleanup    = { namespace = "Cashmemo/Operations", metric = "AudioCleanupBacklog", threshold = 0 }
    deletion_backlog = { namespace = "Cashmemo/Operations", metric = "DeletionBacklog", threshold = 0 }
    export_backlog   = { namespace = "Cashmemo/Operations", metric = "ExportBacklog", threshold = 0 }
    backup_inventory = { namespace = "Cashmemo/DataSafety", metric = "InventoryFailure", threshold = 0 }
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.alarms
  alarm_name          = "${var.name}-${each.key}"
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = each.value.threshold
  treat_missing_data  = "breaching"
  alarm_actions       = [var.alarm_topic_arn]
}

output "core_log_group" { value = aws_cloudwatch_log_group.core.name }
output "provider_log_group" { value = aws_cloudwatch_log_group.providers.name }
