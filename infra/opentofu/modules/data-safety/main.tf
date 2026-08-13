variable "name" { type = string }
variable "alarm_topic_arn" { type = string }
variable "database_identifier" { type = string }

locals {
  safety_alarms = {
    pitr_health                 = "PitrHealthFailure"
    copy_policy_drift           = "DeletionCopyPolicyDrift"
    inventory_unavailable       = "BackupInventoryUnavailable"
    inventory_stale             = "BackupInventoryStale"
    restore_drill_missed        = "RestoreDrillMissed"
    rpo_risk                    = "RpoRisk"
    rto_risk                    = "RtoRisk"
    suppression_cleanup_blocked = "SuppressionCleanupBlocked"
  }
}

resource "aws_cloudwatch_metric_alarm" "safety" {
  for_each            = local.safety_alarms
  alarm_name          = "${var.name}-${each.key}"
  namespace           = "Cashmemo/DataSafety"
  metric_name         = each.value
  dimensions          = { DatabaseIdentifier = var.database_identifier }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "breaching"
  alarm_actions       = [var.alarm_topic_arn]
}

resource "aws_cloudwatch_event_rule" "snapshot_activity" {
  name          = "${var.name}-resurrection-capable-copy-events"
  event_pattern = jsonencode({ source = ["aws.rds", "aws.backup"], "detail-type" = ["AWS API Call via CloudTrail"], detail = { eventSource = ["rds.amazonaws.com", "backup.amazonaws.com"], eventName = ["CreateDBSnapshot", "CopyDBSnapshot", "ModifyDBSnapshotAttribute", "StartCopyJob", "StartRestoreJob"] } })
}

resource "aws_cloudwatch_event_target" "snapshot_activity" {
  rule = aws_cloudwatch_event_rule.snapshot_activity.name
  arn  = var.alarm_topic_arn
}

output "no_resurrection_policy_json" { value = local.no_resurrection_copies_policy }
