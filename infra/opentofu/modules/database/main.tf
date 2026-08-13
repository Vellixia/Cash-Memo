variable "name" { type = string }
variable "database_subnet_ids" { type = list(string) }
variable "database_security_group_id" { type = string }
variable "kms_key_arn" { type = string }
variable "monitoring_role_arn" { type = string }
variable "instance_class" {
  type    = string
  default = "db.m7g.large"
}
variable "allocated_storage" {
  type    = number
  default = 100
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.database_subnet_ids
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-postgres18"
  family = "postgres18"
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
  parameter {
    name         = "log_statement"
    value        = "none"
    apply_method = "immediate"
  }
}

resource "aws_db_instance" "this" {
  identifier                          = var.name
  engine                              = "postgres"
  engine_version                      = "18.0"
  instance_class                      = var.instance_class
  allocated_storage                   = var.allocated_storage
  max_allocated_storage               = var.allocated_storage * 4
  storage_type                        = "gp3"
  storage_encrypted                   = true
  kms_key_id                          = var.kms_key_arn
  multi_az                            = true
  publicly_accessible                 = false
  db_subnet_group_name                = aws_db_subnet_group.this.name
  vpc_security_group_ids              = [var.database_security_group_id]
  parameter_group_name                = aws_db_parameter_group.this.name
  db_name                             = "cashmemo"
  username                            = "cashmemo_admin"
  manage_master_user_password         = true
  master_user_secret_kms_key_id       = var.kms_key_arn
  iam_database_authentication_enabled = true
  backup_retention_period             = 35
  backup_window                       = "18:00-19:00"
  maintenance_window                  = "sun:19:00-sun:20:00"
  copy_tags_to_snapshot               = true
  deletion_protection                 = true
  delete_automated_backups            = true
  skip_final_snapshot                 = true
  auto_minor_version_upgrade          = true
  apply_immediately                   = false
  monitoring_interval                 = 60
  monitoring_role_arn                 = var.monitoring_role_arn
  performance_insights_enabled        = true
  performance_insights_kms_key_id     = var.kms_key_arn
  enabled_cloudwatch_logs_exports     = ["postgresql", "upgrade"]
}

output "endpoint" { value = aws_db_instance.this.endpoint }
output "resource_id" { value = aws_db_instance.this.resource_id }
output "master_secret_arn" {
  value     = try(aws_db_instance.this.master_user_secret[0].secret_arn, null)
  sensitive = true
}
