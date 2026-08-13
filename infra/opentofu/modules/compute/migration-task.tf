resource "aws_ecs_task_definition" "migration" {
  family                   = "${var.name}-migration"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = var.execution_role_arns["migration"]
  task_role_arn            = var.migration_role_arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }
  container_definitions = jsonencode([{
    name             = "cashmemo-migration", image = local.release_image, essential = true, user = "10001:10001", readonlyRootFilesystem = true,
    linuxParameters  = { capabilities = { drop = ["ALL"] }, initProcessEnabled = true },
    command          = ["node", "scripts/db/migrate-production.mjs"],
    environment      = concat(local.common_environment, [{ name = "PROCESS_ROLE", value = "migration" }]),
    secrets          = [{ name = "DATABASE_URL", valueFrom = var.database_secret_arns["migration"] }],
    mountPoints      = [], volumesFrom = [],
    logConfiguration = { logDriver = "awslogs", options = { "awslogs-group" = var.core_log_group, "awslogs-region" = var.aws_region, "awslogs-stream-prefix" = "migration" } }
  }])
}

output "migration_task_definition_arn" { value = aws_ecs_task_definition.migration.arn }
